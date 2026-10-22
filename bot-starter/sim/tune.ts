// Parameter search for the strategy: iterated best response with a hall of
// fame, so the tuned bot has to beat (a) its own incumbent in self-play,
// (b) a league of earlier champions, style variants, baselines and sims, and
// (c) keep crushing the baseline field and real sim lobbies.
//
//   node sim/tune.ts --iters 8 --cands 8 --matches 400 [--start '{"mu0":0.5}'] [--keys mu0,muTimeExp]
//
// Each candidate is evaluated on identical seeds (common random numbers) in
// both payment modes. Objective (lower is better):
//   J = rank(self) + rank(league) + 0.5 * rank(base) + 0.5 * rank(lobby)
// averaged over Vickrey and first-price. Progress is appended to
// sim/tune-log.md.

import * as fs from "node:fs";
import { runBatch, rows, type BatchSpec } from "./batch.ts";
import { Rng } from "../src/game/rng.ts";
import { DEFAULT_PARAMS, type Params } from "../src/strategy/params.ts";
import { VERSIONS } from "../src/strategy/versions.ts";
import "./strategies.ts";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : process.argv[i + 1]!;
}

interface Dim {
  key: keyof Params;
  lo: number;
  hi: number;
  log?: boolean;
  int?: boolean;
}

const SPACE: Dim[] = [
  { key: "mu0", lo: 0.05, hi: 2, log: true },
  { key: "muTimeExp", lo: 0, hi: 3 },
  { key: "muBalExp", lo: 0, hi: 2 },
  { key: "paceRate", lo: 0, hi: 0.5 },
  { key: "winPrior", lo: 0.05, hi: 0.8 },
  { key: "horizonCap", lo: 4, hi: 24, int: true },
  { key: "cashMinLen", lo: 3, hi: 7, int: true },
  { key: "cashTiming", lo: 0, hi: 1, int: true },
  { key: "denial", lo: 0, hi: 1.5 },
  { key: "priceDrive", lo: 0, hi: 1, int: true },
];

const iters = Number(arg("iters", "8"));
const nCands = Number(arg("cands", "8"));
const matches = Number(arg("matches", "400"));
const keys = arg("keys", SPACE.map((d) => d.key).join(",")).split(",");
const dims = SPACE.filter((d) => keys.includes(d.key));
const logPath = new URL("./tune-log.md", import.meta.url);
const rng = new Rng(Number(arg("seed", "2024")));

const BASE = ["starter", "greedy", "overbidder", "hoarder", "random"];
const LOBBY = ["brutus-sim", "brutus-sim:maverick-sim", "valor-sim", "valor-sim:hagrid-sim", "cheapo-sim"];
const STATIC_LEAGUE = ["v1", "aggr", "cons", "nocash", "overbidder", "random", "brutus-sim", "starter"];

type P = Partial<Params>;

function clampDim(d: Dim, x: number): number {
  let v = Math.min(d.hi, Math.max(d.lo, x));
  if (d.int) v = Math.round(v);
  return Number(v.toFixed(4));
}

function perturb(p: P, scale: number): P {
  const out: P = { ...p };
  // Move 1-3 random coordinates.
  const k = 1 + rng.int(3);
  for (let i = 0; i < k; i++) {
    const d = dims[rng.int(dims.length)]!;
    const cur = (out[d.key] ?? DEFAULT_PARAMS[d.key]) as number;
    const g = (rng.next() + rng.next() + rng.next() - 1.5) * 2 * scale; // ~N(0, scale)
    let v: number;
    if (d.int && d.hi - d.lo <= 1) v = rng.next() < 0.5 ? d.lo : d.hi;
    else if (d.log) v = cur * Math.exp(g * Math.log(d.hi / d.lo) * 0.25);
    else v = cur + g * (d.hi - d.lo) * 0.25;
    (out as Record<string, number>)[d.key] = clampDim(d, v);
  }
  return out;
}

/** Registers hall-of-fame members as named opponents with fixed params. */
function opponents(hof: P[], incumbent: P): { self: string[]; league: string[]; params: Record<string, Record<string, number>> } {
  const params: Record<string, Record<string, number>> = { inc: incumbent as Record<string, number> };
  const league = [...STATIC_LEAGUE];
  hof.forEach((h, i) => {
    params[`hof${i}`] = h as Record<string, number>;
    league.push(`hof${i}`);
  });
  return {
    self: ["inc", "inc:inc2", "inc:inc3", "inc:inc4", "inc:inc5"],
    league,
    params,
  };
}

async function evaluate(cand: P, inc: P, hof: P[], seed: number): Promise<{ J: number; detail: string }> {
  const { self, league, params } = opponents(hof, inc);
  const allParams = { ...params, cand: cand as Record<string, number> };
  let J = 0;
  const parts: string[] = [];
  for (const auctionType of ["Vickrey", "FirstPrice"] as const) {
    const specs: [string, BatchSpec, number][] = [
      ["self", { seats: self, fixed: ["cand"], matches, auctionType, seed, params: allParams }, 1],
      ["league", { seats: league, fixed: ["cand"], seatsPerMatch: 6, matches, auctionType, seed: seed + 1, params: allParams }, 1],
      ["base", { seats: BASE, fixed: ["cand"], matches: Math.round(matches / 4), auctionType, seed: seed + 2, params: allParams }, 0.5],
      ["lobby", { seats: LOBBY, fixed: ["cand"], matches: Math.round(matches / 5), auctionType, seed: seed + 3, params: allParams }, 0.5],
    ];
    for (const [name, spec, w] of specs) {
      const r = rows(await runBatch(spec)).find((x) => x.name === "cand")!;
      J += (w * r.meanRank) / 2;
      parts.push(`${name}-${auctionType[0]!.toLowerCase()} ${(100 * r.winRate).toFixed(0)}%/${r.meanRank.toFixed(2)}`);
    }
  }
  return { J, detail: parts.join(" ") };
}

function fmt(p: P): string {
  return JSON.stringify(p);
}

const start: P = JSON.parse(arg("start", JSON.stringify(VERSIONS.v5 ?? {})));
let incumbent: P = { ...start };
const hof: P[] = [];
const out = (s: string) => {
  console.log(s);
  fs.appendFileSync(logPath, s + "\n");
};
out(`\n## Tuning run ${new Date().toISOString()} — ${matches} matches/field, ${nCands} candidates/iter, keys ${keys.join(",")}\n`);
out(`start: ${fmt(incumbent)}`);

for (let it = 1; it <= iters; it++) {
  const seed = 1000 * it + 17;
  const scale = Math.max(0.15, 0.6 * Math.pow(0.8, it - 1));
  const incEval = await evaluate(incumbent, incumbent, hof, seed);
  out(`\n### iter ${it} (scale ${scale.toFixed(2)}) incumbent J=${incEval.J.toFixed(3)} ${incEval.detail}`);
  let best: { p: P; J: number; detail: string } | null = null;
  for (let c = 0; c < nCands; c++) {
    const cand = perturb(incumbent, scale);
    const e = await evaluate(cand, incumbent, hof, seed);
    out(`- J=${e.J.toFixed(3)} ${e.detail} ${fmt(cand)}`);
    if (!best || e.J < best.J) best = { p: cand, ...e };
  }
  // Accept if clearly better than the incumbent on the same seeds; the
  // incumbent joins the hall of fame so later candidates must beat it too.
  if (best && best.J < incEval.J - 0.03) {
    hof.push(incumbent);
    if (hof.length > 4) hof.shift();
    incumbent = best.p;
    out(`**accepted** J ${incEval.J.toFixed(3)} -> ${best.J.toFixed(3)}: ${fmt(incumbent)}`);
  } else {
    out(`kept incumbent`);
  }
}
out(`\nfinal: ${fmt(incumbent)}`);
