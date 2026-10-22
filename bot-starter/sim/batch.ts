// Runs batches of matches across worker threads and aggregates per-strategy
// statistics. Used by sim/run.ts (CLI) and sim/tune.ts.

import * as os from "node:os";
import { Worker } from "node:worker_threads";
import type { AuctionType } from "../src/game/letters.ts";
import { runMatch } from "./engine.ts";
import { makeSeat } from "./registry.ts";
import { Rng } from "../src/game/rng.ts";

export interface BatchSpec {
  /** Seat specs ("name" or "name:label"). With `seatsPerMatch`, a pool to sample from. */
  seats: string[];
  /** If set, each match samples this many seats in total (fixed + drawn from `seats`). */
  seatsPerMatch?: number;
  /** Seats present in every match (e.g. the candidate under test). */
  fixed?: string[];
  matches: number;
  auctionType: AuctionType;
  seed: number;
  /** Per-name strategy parameters (for tuning). */
  params?: Record<string, Record<string, number>>;
  timings?: boolean;
  /** Record per-match (this seat's score − best other score) for series analysis. */
  recordDiff?: string;
  /** Run agents' between-round precompute, as the live client does (true = all, or seat names). */
  prepare?: boolean | string[];
  /** Seat names whose bids insert first (win ties). */
  priority?: string[];
}

export interface Agg {
  name: string;
  n: number;
  wins: number;
  score: number;
  score2: number;
  rank: number;
  /** Matches finished in last place (the bracket eliminates last place). */
  last: number;
  /** Per-match score margin over the best opponent (only for BatchSpec.recordDiff). */
  diffs: number[];
  lettersWon: number;
  spent: number;
  words: number;
  unplayed: number;
  rejectedWords: number;
  rejectedBids: number;
  /** Sampled decision times (ms). */
  ms: number[];
}

export interface BatchResult {
  byName: Record<string, Agg>;
  matches: number;
  auctions: number;
  unsold: number;
}

function emptyAgg(name: string): Agg {
  return {
    name, n: 0, wins: 0, score: 0, score2: 0, rank: 0, last: 0, diffs: [], lettersWon: 0, spent: 0,
    words: 0, unplayed: 0, rejectedWords: 0, rejectedBids: 0, ms: [],
  };
}

/** Runs matches [from, to) of a batch in this thread. */
export function runSlice(spec: BatchSpec, from: number, to: number): BatchResult {
  const out: BatchResult = { byName: {}, matches: 0, auctions: 0, unsold: 0 };
  for (let m = from; m < to; m++) {
    const seed = (spec.seed * 1_000_003 + m * 7919) >>> 0;
    const pick = new Rng(seed ^ 0x5eed);
    const fixed = spec.fixed ?? [];
    let names = spec.seats.slice();
    if (spec.seatsPerMatch) names = pick.shuffle(names).slice(0, spec.seatsPerMatch - fixed.length);
    names = [...fixed, ...names];
    pick.shuffle(names); // random seat order: deal order, sim priority, ties
    const seats = names.map((s) => makeSeat(s, spec.params?.[s.split(":")[0]!]));
    const res = runMatch(seats, { auctionType: spec.auctionType, seed, timings: spec.timings, prepare: spec.prepare, priority: spec.priority });
    out.matches++;
    out.auctions += res.auctions;
    out.unsold += res.unsold;
    for (const s of res.seats) {
      const a = (out.byName[s.name] ??= emptyAgg(s.name));
      a.n++;
      if (s.rank === 1) a.wins++;
      // Last place, counting ties for the lowest score (the bracket breaks
      // those on tournament total score, tournament.ts:304-318).
      if (s.score === Math.min(...res.seats.map((o) => o.score))) a.last++;
      if (spec.recordDiff && s.name === spec.recordDiff) {
        const best = Math.max(...res.seats.filter((o) => o !== s).map((o) => o.score));
        a.diffs.push(s.score - best);
      }
      a.score += s.score;
      a.score2 += s.score * s.score;
      a.rank += s.rank;
      a.lettersWon += s.lettersWon;
      a.spent += s.spent;
      a.words += s.wordsPlayed;
      a.unplayed += s.unplayedTiles;
      a.rejectedWords += s.rejectedWords;
      a.rejectedBids += s.rejectedBids;
      if (s.decisionMs.length) a.ms.push(...s.decisionMs);
    }
  }
  return out;
}

export function merge(into: BatchResult, b: BatchResult): BatchResult {
  into.matches += b.matches;
  into.auctions += b.auctions;
  into.unsold += b.unsold;
  for (const [k, v] of Object.entries(b.byName)) {
    const a = (into.byName[k] ??= emptyAgg(k));
    a.n += v.n; a.wins += v.wins; a.score += v.score; a.score2 += v.score2; a.rank += v.rank; a.last += v.last;
    for (const x of v.diffs) a.diffs.push(x);
    a.lettersWon += v.lettersWon; a.spent += v.spent; a.words += v.words; a.unplayed += v.unplayed;
    a.rejectedWords += v.rejectedWords; a.rejectedBids += v.rejectedBids;
    for (const x of v.ms) a.ms.push(x);
  }
  return into;
}

/** Runs a batch split across worker threads. */
export async function runBatch(spec: BatchSpec, workers = Math.max(1, os.cpus().length - 2)): Promise<BatchResult> {
  const k = Math.min(workers, spec.matches);
  if (k <= 1) return runSlice(spec, 0, spec.matches);
  const per = Math.ceil(spec.matches / k);
  const jobs: Promise<BatchResult>[] = [];
  for (let w = 0; w < k; w++) {
    const from = w * per;
    const to = Math.min(spec.matches, from + per);
    if (from >= to) break;
    jobs.push(
      new Promise((resolve, reject) => {
        const worker = new Worker(new URL("./worker.ts", import.meta.url), {
          workerData: { spec, from, to },
        });
        worker.once("message", resolve);
        worker.once("error", reject);
        worker.once("exit", (code) => {
          if (code !== 0) reject(new Error(`worker exited with ${code}`));
        });
      }),
    );
  }
  const parts = await Promise.all(jobs);
  return parts.reduce(merge, { byName: {}, matches: 0, auctions: 0, unsold: 0 });
}

function pct(ms: number[], p: number): number {
  if (ms.length === 0) return NaN;
  const s = ms.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

export interface Row {
  name: string;
  n: number;
  winRate: number;
  meanScore: number;
  se: number;
  meanRank: number;
  letters: number;
  spent: number;
  words: number;
  unplayed: number;
  p99ms: number;
  maxMs: number;
}

export function rows(r: BatchResult): Row[] {
  return Object.values(r.byName)
    .map((a) => {
      const mean = a.score / a.n;
      const variance = Math.max(0, a.score2 / a.n - mean * mean);
      return {
        name: a.name,
        n: a.n,
        winRate: a.wins / a.n,
        meanScore: mean,
        se: Math.sqrt(variance / a.n),
        meanRank: a.rank / a.n,
        letters: a.lettersWon / a.n,
        spent: a.spent / a.n,
        words: a.words / a.n,
        unplayed: a.unplayed / a.n,
        p99ms: pct(a.ms, 99),
        maxMs: a.ms.length ? a.ms.reduce((m, x) => (x > m ? x : m), 0) : NaN,
      };
    })
    .sort((x, y) => y.meanScore - x.meanScore);
}

export function table(r: BatchResult, title: string, withTimings = false): string {
  const head =
    "| strategy | seats | win rate | mean score (±SE) | mean rank | letters won | spent | words | tiles left |" +
    (withTimings ? " p99 ms | max ms |" : "");
  const sep = "|---|---:|---:|---:|---:|---:|---:|---:|---:|" + (withTimings ? "---:|---:|" : "");
  const lines = rows(r).map(
    (x) =>
      `| ${x.name} | ${x.n} | ${(100 * x.winRate).toFixed(1)}% | ${x.meanScore.toFixed(1)} ± ${x.se.toFixed(1)} | ${x.meanRank.toFixed(2)} | ${x.letters.toFixed(1)} | ${x.spent.toFixed(0)} | ${x.words.toFixed(1)} | ${x.unplayed.toFixed(1)} |` +
      (withTimings ? ` ${x.p99ms.toFixed(1)} | ${x.maxMs.toFixed(1)} |` : ""),
  );
  return [
    `**${title}** — ${r.matches} matches, ${(r.auctions / r.matches).toFixed(0)} auctions/match, ${(r.unsold / r.matches).toFixed(1)} unsold/match`,
    "",
    head,
    sep,
    ...lines,
  ].join("\n");
}
