// Adversarial evaluation: `final` against 5 copies of one strong opponent
// (sim/baselines/strong.ts), in both payment modes, plus mixed fields.
//
//   node sim/threats.ts --only shadow,late [--matches 300] [--cand final] [--params '{"x":1}']
//
// Scenarios: clone, shadow, denier, snowball, late, outbid, jitter,
//            slow (5 clones that always win ties), mixed (5 drawn from all
//            adversaries), duel-<name> (2 bots), big (8 bots from the pool).

import { runBatch, rows, type BatchSpec } from "./batch.ts";
import type { AuctionType } from "../src/game/letters.ts";
import "./strategies.ts";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : process.argv[i + 1]!;
}
const matches = Number(arg("matches", "300"));
const cand = arg("cand", "final");
const params = JSON.parse(arg("params", "{}")) as Record<string, number>;
const seed = Number(arg("seed", "808"));
const ADV = ["clone", "shadow", "denier", "snowball", "late", "outbid", "jitter"];
const only = arg("only", [...ADV, "slow", "mixed", "big"].join(",")).split(",");

/** Five labelled copies of one strategy, e.g. shadow, shadow:shadow2, ... */
const five = (n: string) => [n, ...[2, 3, 4, 5].map((i) => `${n}:${n}${i}`)];

function spec(name: string, auctionType: AuctionType): Omit<BatchSpec, "matches"> {
  const base = { auctionType, seed, params: { [cand.split(":")[0]!]: params } };
  if (name === "slow") return { ...base, seats: five("clone"), fixed: [cand], priority: five("clone").map((x) => x.split(":").pop()!) };
  if (name === "mixed") return { ...base, seats: ADV, fixed: [cand], seatsPerMatch: 6 };
  if (name === "big") return { ...base, seats: ADV, fixed: [cand], seatsPerMatch: 8 };
  if (name.startsWith("duel-")) return { ...base, seats: [cand, name.slice(5)] };
  return { ...base, seats: five(name), fixed: [cand] };
}

console.log(`| scenario | ${cand} V: win / rank / score | best opp V | ${cand} F: win / rank / score | best opp F |`);
console.log("|---|---|---|---|---|");
for (const name of only) {
  const cells: string[] = [];
  for (const auctionType of ["Vickrey", "FirstPrice"] as const) {
    const r = rows(await runBatch({ ...spec(name, auctionType), matches }));
    const me = r.find((x) => x.name === cand)!;
    const opp = r.filter((x) => x.name !== cand).sort((a, b) => a.meanRank - b.meanRank)[0]!;
    cells.push(`${(100 * me.winRate).toFixed(1)}% / ${me.meanRank.toFixed(2)} / ${me.meanScore.toFixed(1)}`);
    cells.push(`${opp.name} ${(100 * opp.winRate).toFixed(1)}% / ${opp.meanRank.toFixed(2)}`);
  }
  console.log(`| ${name} | ${cells.join(" | ")} |`);
}
