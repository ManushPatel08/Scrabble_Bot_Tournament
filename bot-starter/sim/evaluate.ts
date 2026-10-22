// Reproduces every evaluation reported in RESULTS.md.
//
//   node sim/evaluate.ts [--matches 1000] [--only base,lobby,self,robust,duel,big] [--mode both|vickrey|first] [--prepare]
//
// --prepare runs the live client's between-round precompute for our bot
// (~2x slower; it changes when work is done, not the strategy).

import { runBatch, table, type BatchSpec } from "./batch.ts";
import type { AuctionType } from "../src/game/letters.ts";
import "./strategies.ts";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : process.argv[i + 1]!;
}
const matches = Number(arg("matches", "1000"));
const only = arg("only", "base,lobby,self,robust,duel,big").split(",");
const modeArg = arg("mode", "both");
const modes: AuctionType[] =
  modeArg === "both" ? ["Vickrey", "FirstPrice"] : modeArg.startsWith("f") ? ["FirstPrice"] : ["Vickrey"];

interface Exp {
  key: string;
  title: string;
  spec: Omit<BatchSpec, "auctionType" | "matches">;
}

const EXPS: Exp[] = [
  {
    key: "base",
    title: "Baseline field: final + starter, greedy, overbidder, hoarder, random",
    spec: { seats: ["final", "starter", "greedy", "overbidder", "hoarder", "random"], seed: 101 },
  },
  {
    key: "lobby",
    title: "Real lobby: final + five of the module's sims",
    spec: {
      seats: ["final", "brutus-sim", "brutus-sim:maverick-sim", "valor-sim", "valor-sim:hagrid-sim", "cheapo-sim"],
      seed: 202,
    },
  },
  {
    key: "self",
    title: "Self-play: final vs its five most recent earlier versions (v3-v7)",
    spec: { seats: ["final", "v3", "v4", "v5", "v6", "v7"], seed: 303, timings: true },
  },
  {
    key: "robust",
    title: "Robustness pool: final + 5 drawn from versions, style variants, unseen opponents (sniper, allin) and sims",
    spec: {
      seats: ["v7", "v6", "v5", "aggr", "cons", "overbidder", "allin", "sniper", "brutus-sim", "random", "starter"],
      fixed: ["final"],
      seatsPerMatch: 6,
      seed: 404,
    },
  },
  {
    key: "duel",
    title: "Duel (2 bots, like the tournament final): final vs v7 (previous final)",
    spec: { seats: ["final", "v7"], seed: 505 },
  },
  {
    key: "big",
    title: "Big bracket match (8 bots): final + 7 drawn from the robustness pool",
    spec: {
      seats: ["v7", "v6", "v5", "aggr", "cons", "overbidder", "allin", "sniper", "brutus-sim", "random", "starter"],
      fixed: ["final"],
      seatsPerMatch: 8,
      seed: 606,
    },
  },
];

for (const e of EXPS.filter((x) => only.includes(x.key))) {
  for (const auctionType of modes) {
    const t0 = performance.now();
    const prepare = process.argv.includes("--prepare") ? ["final"] : false;
    const res = await runBatch({ ...e.spec, prepare, matches, auctionType });
    const secs = ((performance.now() - t0) / 1000).toFixed(0);
    console.log(table(res, `${e.title} — ${auctionType} (${secs}s)`, !!e.spec.timings));
    console.log();
  }
}
