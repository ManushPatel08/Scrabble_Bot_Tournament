// Name -> seat factory. Worker threads rebuild seats from names, so every
// strategy the runner or tuner can field must be registered here.

import type { SeatSpec } from "./engine.ts";
import {
  GreedyPolicy,
  HoarderPolicy,
  OverbidderPolicy,
  RandomPolicy,
  StarterPolicy,
} from "./baselines/policies.ts";
import { AllInPolicy, SniperPolicy } from "./baselines/extra.ts";
import { IdlePolicy } from "./baselines/idle.ts";

type Factory = (params?: Record<string, number>) => SeatSpec;

const registry = new Map<string, Factory>([
  ["starter", () => ({ name: "starter", make: () => new StarterPolicy() })],
  ["greedy", () => ({ name: "greedy", make: () => new GreedyPolicy() })],
  ["overbidder", () => ({ name: "overbidder", make: () => new OverbidderPolicy() })],
  ["hoarder", () => ({ name: "hoarder", make: () => new HoarderPolicy() })],
  ["random", () => ({ name: "random", make: () => new RandomPolicy() })],
  ["idle", () => ({ name: "idle", make: () => new IdlePolicy(), offline: true })],
  // Connected but inactive (e.g. crashed): not flagged offline, must be inferred.
  ["ghost", () => ({ name: "ghost", make: () => new IdlePolicy() })],
  // Robustness-only opponents (never used for tuning).
  ["sniper", () => ({ name: "sniper", make: () => new SniperPolicy() })],
  ["allin", () => ({ name: "allin", make: () => new AllInPolicy() })],
  // The module's own sim bots (lib.rs:679-688), driven inside the engine.
  ["cheapo-sim", () => ({ name: "cheapo-sim", sim: "Cheapskate" })],
  ["valor-sim", () => ({ name: "valor-sim", sim: "ValueBidder" })],
  ["brutus-sim", () => ({ name: "brutus-sim", sim: "Aggressive" })],
]);

export function register(name: string, f: Factory): void {
  registry.set(name, f);
}

export function registeredNames(): string[] {
  return [...registry.keys()];
}

/**
 * Builds a seat from "name" or "name:label" (label renames the seat so two
 * copies of one strategy can be told apart in results).
 */
export function makeSeat(spec: string, params?: Record<string, number>): SeatSpec {
  const [name, label] = spec.split(":");
  const f = registry.get(name!);
  if (!f) throw new Error(`unknown strategy '${name}' (known: ${registeredNames().join(", ")})`);
  const seat = f(params);
  return label ? { ...seat, name: label } : seat;
}

export const BASELINE_FIELD = ["starter", "greedy", "overbidder", "hoarder", "random"];
export const MODULE_SIMS = ["cheapo-sim", "valor-sim", "brutus-sim"];
