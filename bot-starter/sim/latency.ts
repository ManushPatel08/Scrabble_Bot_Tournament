// Measures the shipped strategy's decision latency in simulation, with the
// live client's between-round precompute enabled.
//
//   node sim/latency.ts [matches] [--params '{"futureCountNoise":1}']
//
// Reports p50/p99/max of chooseWord (word decision) and decideBid (bid
// decision) overall and on the largest racks seen (top 5% by rack size).

import { runMatch, type SeatSpec } from "./engine.ts";
import { makeSeat } from "./registry.ts";
import { createAgent } from "../src/strategy.ts";
import type { Agent } from "../src/strategy/agent.ts";
import type { Params } from "../src/strategy/params.ts";
import type { AuctionView, Decision } from "../src/game/types.ts";
import "./strategies.ts";

export interface Sample {
  rack: number;
  wordMs: number;
  bidMs: number;
  prepMs: number;
}

/** Wraps an Agent to record per-decision timings. */
export function timedSeat(samples: Sample[], params: Partial<Params> = {}): SeatSpec {
  return {
    name: "final",
    make: () => {
      const a: Agent = createAgent("final", undefined, params);
      const onAuction = a.onAuction.bind(a);
      const prepareNext = a.prepareNext.bind(a);
      let last: Sample | null = null;
      a.onAuction = (v: AuctionView): Decision => {
        const d = onAuction(v);
        last = { rack: v.rack.reduce((x, y) => x + y, 0), wordMs: a.timing.wordMs, bidMs: a.timing.bidMs, prepMs: 0 };
        samples.push(last);
        return d;
      };
      a.prepareNext = () => {
        const t0 = performance.now();
        prepareNext();
        if (last) last.prepMs = performance.now() - t0;
      };
      return a;
    },
  };
}

export function collect(matches: number, params: Partial<Params> = {}): Sample[] {
  const samples: Sample[] = [];
  const fields = [
    ["agent", "agent", "v4", "aggr", "overbidder"],
    ["starter", "greedy", "overbidder", "hoarder", "random"],
    ["brutus-sim", "brutus-sim", "valor-sim", "valor-sim", "cheapo-sim"],
  ];
  for (let m = 0; m < matches; m++) {
    const field = fields[m % fields.length]!;
    const seats = [timedSeat(samples, params), ...field.map((f) => makeSeat(f))];
    runMatch(seats, { auctionType: m % 2 ? "FirstPrice" : "Vickrey", seed: 9000 + m, prepare: true });
  }
  return samples;
}

export function pct(xs: number[], p: number): number {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? NaN;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("sim/latency.ts")) {
  const n = Number(process.argv[2] ?? 60);
  const paramsAt = process.argv.indexOf("--params");
  const params: Partial<Params> = paramsAt === -1 ? {} : JSON.parse(process.argv[paramsAt + 1]!);
  const s = collect(n, params);
  const big = s.slice().sort((a, b) => b.rack - a.rack).slice(0, Math.max(1, Math.floor(s.length * 0.05)));
  const row = (label: string, xs: Sample[]) =>
    `| ${label} | ${xs.length} | ${Math.max(...xs.map((x) => x.rack))} | ` +
    (["wordMs", "bidMs", "prepMs"] as const)
      .map((k) => `${pct(xs.map((x) => x[k]), 50).toFixed(2)} / ${pct(xs.map((x) => x[k]), 99).toFixed(2)} / ${Math.max(...xs.map((x) => x[k])).toFixed(1)}`)
      .join(" | ") + " |";
  console.log("| decisions | n | max rack | chooseWord p50/p99/max ms | decideBid p50/p99/max ms | prepareNext p50/p99/max ms |");
  console.log("|---|---:|---:|---|---|---|");
  console.log(row("all", s));
  console.log(row("largest 5% of racks", big));
}
