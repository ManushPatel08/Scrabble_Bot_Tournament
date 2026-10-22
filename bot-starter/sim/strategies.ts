// Registers our own strategies with the simulator.
//   agent  — the strategy with DEFAULT_PARAMS, overridable per batch
//   final  — the shipped configuration (src/strategy.ts)
//   v1..v5 — frozen earlier versions for self-play

import { Agent } from "../src/strategy/agent.ts";
import type { Params } from "../src/strategy/params.ts";
import { VERSIONS } from "../src/strategy/versions.ts";
import { register } from "./registry.ts";

register("agent", (params) => ({ name: "agent", make: () => new Agent(params as Partial<Params>, "agent") }));
for (const [name, p] of Object.entries(VERSIONS)) {
  register(name, (params) => ({
    name,
    make: () => new Agent({ ...p, ...(params as Partial<Params>) }, name),
  }));
}

// `cand` is the candidate under test in sim/compare.ts and sim/tune.ts, so its
// params never collide with opponents that are also Agents.
register("cand", (params) => ({ name: "cand", make: () => new Agent(params as Partial<Params>, "cand") }));

// Style variants used as league opponents (not earlier versions).
const STYLES: Record<string, Partial<Params>> = {
  // Half / double the money price in both modes (first-price has its own).
  aggr: { mu0: 0.25, fpMu0: 0.175 },
  cons: { mu0: 1, fpMu0: 0.7 },
  nocash: { cashTiming: 0 },
};
for (const [name, p] of Object.entries(STYLES)) {
  register(name, (params) => ({ name, make: () => new Agent({ ...p, ...(params as Partial<Params>) }, name) }));
}

// Generic param-carrying seats for the tuner: the incumbent and hall of fame.
for (const name of ["inc", ...Array.from({ length: 10 }, (_, i) => `hof${i}`)]) {
  register(name, (params) => ({ name, make: () => new Agent(params as Partial<Params>, name) }));
}

// Strong adversaries (sim/baselines/strong.ts) and exploit-style variants.
import { JitterAgent, LateAgent, OutbidAgent, ShadowAgent } from "./baselines/strong.ts";
// Adversaries are built on v7 (the pre-hardening final) so they stay the
// opponents the hardening was measured against.
const FINALP = VERSIONS.v7!;
register("clone", () => ({ name: "clone", make: () => new Agent(FINALP, "clone") }));
register("shadow", () => ({ name: "shadow", make: () => new ShadowAgent() }));
register("late", () => ({ name: "late", make: () => new LateAgent() }));
register("outbid", () => ({ name: "outbid", make: () => new OutbidAgent() }));
register("jitter", () => ({ name: "jitter", make: () => new JitterAgent() }));
register("denier", () => ({ name: "denier", make: () => new Agent({ ...FINALP, denial: 1.5, denialMargin: 1000 }, "denier") }));
register("snowball", () => ({
  name: "snowball",
  make: () => new Agent({ ...FINALP, cashTiming: 1, cashMinLen: 4, mu0: 0.3, fpMu0: 0.2, muTimeExp: 2 }, "snowball"),
}));
