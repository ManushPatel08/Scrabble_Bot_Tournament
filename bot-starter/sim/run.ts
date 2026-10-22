// CLI: run simulated matches and print a results table.
//
//   node sim/run.ts --field starter,greedy,overbidder,hoarder,random,final
//   node sim/run.ts --pool starter,greedy,...,brutus-sim --seats 6
//   options: --matches N (default 1000)  --mode vickrey|first|both (default both)
//            --seed S  --workers W  --timings

import { BASELINE_FIELD, MODULE_SIMS } from "./registry.ts";
import { runBatch, table } from "./batch.ts";
import type { AuctionType } from "../src/game/letters.ts";
import "./strategies.ts";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? "true" : v;
}

const presets: Record<string, string[]> = {
  baselines: BASELINE_FIELD,
  sims: MODULE_SIMS,
  all: [...BASELINE_FIELD, ...MODULE_SIMS],
};
const expand = (s: string) => s.split(",").flatMap((x) => presets[x] ?? [x]);

const field = arg("field");
const pool = arg("pool");
if (!field && !pool) {
  console.error("need --field a,b,... or --pool a,b,... --seats N");
  process.exit(1);
}
const seats = expand((field ?? pool)!);
const seatsPerMatch = pool ? Number(arg("seats", "6")) : undefined;
const matches = Number(arg("matches", "1000"));
const seed = Number(arg("seed", "1"));
const workers = arg("workers") ? Number(arg("workers")) : undefined;
const timings = arg("timings") === "true";
const mode = arg("mode", "both")!;
const modes: AuctionType[] =
  mode === "both" ? ["Vickrey", "FirstPrice"] : mode.startsWith("f") ? ["FirstPrice"] : ["Vickrey"];

for (const auctionType of modes) {
  const t0 = performance.now();
  const res = await runBatch({ seats, seatsPerMatch, matches, auctionType, seed, timings }, workers);
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(table(res, `${auctionType} — ${pool ? `pool of ${seats.length}, ${seatsPerMatch} per match` : seats.join(", ")} (${secs}s)`, timings));
  console.log();
}
