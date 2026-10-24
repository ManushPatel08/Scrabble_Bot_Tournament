// Market replay: plays a candidate configuration through real live matches
// (sim/replay/matches.json, built by scripts/replay-data.mjs) against the
// real rivals' bids. In each auction the candidate wins if its bid beats the
// highest bid anyone else actually placed, and then pays that bid (Vickrey).
// It plays words from its own rack as it chooses; rivals' word plays and
// final scores are the recorded ones by default. --rival-adjust 0..1 adds
// a proportional tile-loss score correction as a sensitivity check only.
//
//   node sim/replay.ts [--seeds 4] --variants '[{"label":"final"},{"label":"mu.435","mu0":0.435}]' [--limit 189]
//
// Limits: rivals don't react (their bids and scores are as recorded, even
// when the candidate takes a letter they actually won, so the rank estimate
// is conservative), and the replay can't see how a different winner would
// have changed later prices. It measures how a bidding policy fares against
// the live market, which the simulator's opponents don't reproduce.

import * as os from "node:os";
import * as fs from "node:fs";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { canSpell, countsOf, letterIndex, wordReward } from "../src/game/letters.ts";
import { sharedIndex } from "../src/game/dictionary.ts";
import { Agent } from "../src/strategy/agent.ts";
import type { Params } from "../src/strategy/params.ts";

interface RAuction { letter: string; winner: number | null; paid: number; maxOther: number; closedAt: number }
interface RMatch {
  matchId: number;
  me: number;
  names: string[];
  sims: boolean[];
  scores: number[];
  rack: string;
  auctions: RAuction[];
  words: { player: number; word: string; reward: number; at: number }[];
}
interface Result { matchId: number; score: number; rank: number; n: number; letters: number; left: number; actualScore: number; actualRank: number }

function replay(m: RMatch, params: Partial<Params>, seedOffset = 0, rivalAdjust = 0): Result {
  const index = sharedIndex();
  const n = m.names.length;
  const me = m.me;
  const agent = new Agent(params, "cand", index);
  agent.onMatchStart({
    seat: me,
    nPlayers: n,
    names: m.names,
    simStrategies: m.names.map(() => null),
    auctionType: "Vickrey",
    rack: countsOf(m.rack),
    seed: (m.matchId ^ 0x51ab) + 7919 * seedOffset,
    offline: m.names.map(() => false),
  });
  const rack = countsOf(m.rack);
  const balances = new Array<number>(n).fill(100);
  const scores = new Array<number>(n).fill(0);
  let letters = 0;
  const originalLetters = new Array<number>(n).fill(0);
  const replayLetters = new Array<number>(n).fill(0);
  let wi = 0;
  const N = m.auctions.length;
  for (let i = 0; i < N; i++) {
    const a = m.auctions[i]!;
    // Rivals' words played before this auction opened (the previous one closed).
    const openAt = i === 0 ? -Infinity : m.auctions[i - 1]!.closedAt;
    while (wi < m.words.length && m.words[wi]!.at <= openAt) {
      const w = m.words[wi++]!;
      if (w.player === me) continue;
      agent.onWordPlayed({ player: w.player, word: w.word, reward: w.reward });
      scores[w.player]! += w.reward;
      balances[w.player]! += w.reward;
    }
    const d = agent.onAuction({ round: i + 1, letter: a.letter, bagTotal: N - 1 - i, rack: rack.slice(), balances: balances.slice(), scores: scores.slice() });
    for (const word of d.words) {
      if (word.length < 2 || !index.isWord(word) || !canSpell(rack, word)) continue;
      for (const ch of word) rack[letterIndex(ch)]!--;
      const reward = wordReward(word);
      balances[me]! += reward;
      scores[me]! += reward;
      agent.onWordPlayed({ player: me, word, reward });
    }
    const bid = Math.max(0, Math.min(d.bid, balances[me]!));
    let winner: number | null;
    let paid: number;
    if (bid > a.maxOther) {
      winner = me;
      paid = a.maxOther;
      balances[me]! -= paid;
      rack[letterIndex(a.letter)]!++;
      letters++;
    } else if (a.winner === me) {
      // We actually won it but not this time: the runner-up (seat unknown) takes it.
      winner = me === 0 ? 1 : 0;
      paid = Math.max(bid, Math.floor(a.maxOther * 0.8));
      balances[winner]! -= paid;
    } else {
      winner = a.winner;
      paid = winner === null ? 0 : Math.max(a.paid, bid);
      if (winner !== null) balances[winner]! -= paid;
    }
    agent.onAuctionResult({ round: i + 1, letter: a.letter, winner, paid });
    if (i < N - 1) {
      if (a.winner !== null) originalLetters[a.winner]!++;
      if (winner !== null) replayLetters[winner]!++;
    }
  }
  // Sensitivity estimate only: rivals do not react, and their initial racks
  // are unknown. Default 0 preserves their observed scores. At 1, adjust by
  // net changed usable tiles times their recorded points per available tile.
  const others = m.scores.filter((_, j) => j !== me);
  const adjusted = m.scores.map((score, j) => Math.max(0, score + rivalAdjust *
    (replayLetters[j]! - originalLetters[j]!) * score / (5 + originalLetters[j]!)))
    .filter((_, j) => j !== me);
  const score = scores[me]!;
  return {
    matchId: m.matchId,
    score,
    rank: 1 + adjusted.filter((s) => s > score).length,
    n,
    letters,
    left: balances[me]!,
    actualScore: m.scores[me]!,
    actualRank: 1 + others.filter((s) => s > m.scores[me]!).length,
  };
}

if (!isMainThread) {
  const { matches, params, seeds, rivalAdjust } = workerData as { matches: RMatch[]; params: Partial<Params>; seeds: number; rivalAdjust: number };
  const out: Result[] = [];
  for (let k = 0; k < seeds; k++) for (const m of matches) out.push(replay(m, params, k, rivalAdjust));
  parentPort!.postMessage(out);
} else {
  const arg = (name: string, def: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? def : process.argv[i + 1]!;
  };
  const all = JSON.parse(fs.readFileSync(arg("data", "sim/replay/matches.json"), "utf8")) as RMatch[];
  const matches = all.filter((m) => m.matchId >= Number(arg("since", "0")) &&
    m.matchId <= Number(arg("until", "Infinity"))).slice(-Number(arg("limit", String(all.length))));
  if (!matches.length) throw new Error("No replay matches selected");
  const variants = JSON.parse(arg("variants", '[{"label":"final"}]')) as ({ label: string } & Partial<Params>)[];
  const workers = Number(process.env.SIM_WORKERS) || Math.max(1, os.cpus().length - 2);
  // Each seed reruns every match with different Monte Carlo draws, to average out sampling noise.
  const seeds = Number(arg("seeds", "1"));
  const rivalAdjust = Number(arg("rival-adjust", "0"));
  if (!(rivalAdjust >= 0 && rivalAdjust <= 1)) throw new Error("--rival-adjust must be 0..1");

  const run = (params: Partial<Params>) =>
    Promise.all(
      Array.from({ length: Math.min(workers, matches.length) }, (_, w) => {
        const chunk = matches.filter((_, i) => i % workers === w);
        return new Promise<Result[]>((resolve, reject) => {
          const worker = new Worker(new URL(import.meta.url), { workerData: { matches: chunk, params, seeds, rivalAdjust } });
          worker.once("message", resolve);
          worker.once("error", reject);
        });
      }),
    ).then((parts) => parts.flat());

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  console.log(`market replay over ${matches.length} live matches x ${seeds} seed(s), #${matches[0]!.matchId}-${matches.at(-1)!.matchId} (rival score adjustment ${rivalAdjust}; fixed bids, not causal)\n`);
  console.log("| variant | win% | mean place | last% | mean score | letters | coins left |");
  console.log("|---|---:|---:|---:|---:|---:|---:|");
  let shownActual = false;
  const outputs: { label: string; params: Partial<Params>; results: Result[] }[] = [];
  for (const v of variants) {
    const { label, ...params } = v;
    const t0 = Date.now();
    const rs = await run(params);
    outputs.push({ label, params, results: rs });
    if (!shownActual) {
      shownActual = true;
      console.log(
        `| (actual live results) | ${((100 * rs.filter((r) => r.actualRank === 1).length) / rs.length).toFixed(1)} | ${mean(rs.map((r) => r.actualRank)).toFixed(2)} | ${((100 * rs.filter((r) => r.actualRank === r.n).length) / rs.length).toFixed(1)} | ${mean(rs.map((r) => r.actualScore)).toFixed(1)} | | |`,
      );
    }
    console.log(
      `| ${label} | ${((100 * rs.filter((r) => r.rank === 1).length) / rs.length).toFixed(1)} | ${mean(rs.map((r) => r.rank)).toFixed(2)} | ${((100 * rs.filter((r) => r.rank === r.n).length) / rs.length).toFixed(1)} | ${mean(rs.map((r) => r.score)).toFixed(1)} | ${mean(rs.map((r) => r.letters)).toFixed(1)} | ${mean(rs.map((r) => r.left)).toFixed(1)} |` +
        ` <!-- ${((Date.now() - t0) / 1000).toFixed(0)} s -->`,
    );
  }
  console.log("\nPaired mean-place change vs first variant (negative is better; SE clusters seeds by match):");
  const byMatch = (rs: Result[]) => {
    const out = new Map<number, number[]>();
    for (const r of rs) (out.get(r.matchId) ?? out.set(r.matchId, []).get(r.matchId)!).push(r.rank);
    return new Map([...out].map(([mid, values]) => [mid, mean(values)]));
  };
  const base = byMatch(outputs[0]!.results);
  for (const o of outputs.slice(1)) {
    const diffs = [...byMatch(o.results)].map(([mid, rank]) => rank - base.get(mid)!);
    const delta = mean(diffs);
    const se = Math.sqrt(diffs.reduce((s, d) => s + (d - delta) ** 2, 0) / Math.max(1, diffs.length - 1) / diffs.length);
    console.log(`${o.label}: ${delta.toFixed(3)} +/- ${(1.96 * se).toFixed(3)} (approx 95%, ${diffs.length} matches)`);
  }
  const outFile = arg("out", "");
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ seeds, rivalAdjust, outputs }));
}
