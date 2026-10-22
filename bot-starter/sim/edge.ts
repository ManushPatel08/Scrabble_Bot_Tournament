// Edge-case scenarios for the tournament format (lib.rs:1543-1985).
//
//   node sim/edge.ts sizes  [--matches 300]   match sizes 3..16 (bracket matches hold
//                                              everyone still in)
//   node sim/edge.ts idle   [--matches 300]   offline team bots in the match
//   node sim/edge.ts series [--matches 600]   best-of-3 finals decided on aggregate
//                                              score, against every adversary
//
// Reports our win rate, mean rank, last-place rate (the bracket eliminates
// last place) and mean score. Run one at a time: each uses every core.

import { runBatch, type BatchResult, type BatchSpec } from "./batch.ts";
import type { AuctionType } from "../src/game/letters.ts";
import "./strategies.ts";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : process.argv[i + 1]!;
}
const what = process.argv[2] ?? "sizes";
const cand = arg("cand", "final");
const params = JSON.parse(arg("params", "{}")) as Record<string, number>;
const modes: AuctionType[] = ["Vickrey", "FirstPrice"];

const POOL = ["v7", "shadow", "denier", "outbid", "jitter", "aggr", "cons", "snowball", "brutus-sim", "valor-sim", "idle", "starter"];
// Two labelled copies of everything, so 16-bot matches can be filled.
const POOL2 = [...POOL, ...POOL.map((n) => `${n}:${n}_2`)];

function cell(r: BatchResult): string {
  const a = r.byName[cand]!;
  return `${((100 * a.wins) / a.n).toFixed(1)}% / ${(a.rank / a.n).toFixed(2)} / ${((100 * a.last) / a.n).toFixed(1)}% / ${(a.score / a.n).toFixed(1)}`;
}

async function run(spec: Omit<BatchSpec, "auctionType">, auctionType: AuctionType): Promise<BatchResult> {
  return runBatch({ ...spec, auctionType, params: { [cand]: params } });
}

const matches = Number(arg("matches", what === "series" ? "600" : "300"));

if (what === "sizes") {
  console.log(`| bots | auctions | V: win / rank / last / score | F: win / rank / last / score | fair win |`);
  console.log("|---:|---:|---|---|---:|");
  for (const n of arg("sizes", "3,4,5,7,10,12,16").split(",").map(Number)) {
    const cells: string[] = [];
    for (const m of modes) cells.push(cell(await run({ seats: POOL2, fixed: [cand], seatsPerMatch: n, matches, seed: 900 + n }, m)));
    console.log(`| ${n} | ${98 - 5 * n} | ${cells.join(" | ")} | ${(100 / n).toFixed(1)}% |`);
  }
}

if (what === "idle") {
  const fields: [string, string[]][] = [
    ["final + 5 idle", ["idle", "idle:i2", "idle:i3", "idle:i4", "idle:i5"]],
    ["final + v7 + 4 idle", ["v7", "idle", "idle:i2", "idle:i3", "idle:i4"]],
    ["final + 2 v7 + 3 idle", ["v7", "v7:v7b", "idle", "idle:i2", "idle:i3"]],
    ["final + 2 sims + 3 idle", ["brutus-sim", "valor-sim", "idle", "idle:i2", "idle:i3"]],
    ["final + shadow + 4 idle", ["shadow", "idle", "idle:i2", "idle:i3", "idle:i4"]],
    ["final + v7 + 4 ghosts (crashed, not flagged)", ["v7", "ghost", "ghost:g2", "ghost:g3", "ghost:g4"]],
  ];
  console.log(`| field | V: win / rank / last / score | F: win / rank / last / score |`);
  console.log("|---|---|---|");
  for (const [label, opp] of fields) {
    const cells: string[] = [];
    for (const m of modes) cells.push(cell(await run({ seats: [cand, ...opp], matches, seed: 77 }, m)));
    console.log(`| ${label} | ${cells.join(" | ")} |`);
  }
}

if (what === "series") {
  // Consecutive matches use independent seeds, so non-overlapping triples are
  // independent best-of-3 finals. The final is decided on aggregate score
  // (lib.rs:1743-1795), so a series is won when the summed margin is > 0.
  const opps = ["v7", "shadow", "denier", "outbid", "jitter", "snowball", "late", "aggr", "cons"];
  console.log(`| final vs | V: game win / series win (aggregate) / mean margin | F: game win / series win / mean margin |`);
  console.log("|---|---|---|");
  for (const o of opps) {
    const cells: string[] = [];
    for (const m of modes) {
      const r = await run({ seats: [cand, o], matches, seed: 1300, recordDiff: cand }, m);
      const d = r.byName[cand]!.diffs;
      let series = 0;
      let won = 0;
      for (let i = 0; i + 2 < d.length; i += 3) {
        series++;
        if (d[i]! + d[i + 1]! + d[i + 2]! > 0) won++;
      }
      const games = d.filter((x) => x > 0).length / d.length;
      const mean = d.reduce((a, b) => a + b, 0) / d.length;
      cells.push(`${(100 * games).toFixed(1)}% / **${((100 * won) / series).toFixed(1)}%** / ${mean >= 0 ? "+" : ""}${mean.toFixed(1)}`);
    }
    console.log(`| ${o} | ${cells.join(" | ")} |`);
  }
}
