// Opponent fields used to evaluate a candidate ("cand").

import type { AuctionType } from "../src/game/letters.ts";
import type { BatchSpec } from "./batch.ts";

export interface Field {
  name: string;
  auctionType: AuctionType;
  /** Opponent seats (cand is added). With `sample`, a pool to draw 5 from. */
  opponents: string[];
  sample?: boolean;
}

const BASE = ["starter", "greedy", "overbidder", "hoarder", "random"];
// A real lobby: five of the six seeded sims (lib.rs:679-688).
const LOBBY = ["brutus-sim", "brutus-sim:maverick-sim", "valor-sim", "valor-sim:hagrid-sim", "cheapo-sim"];
const SELF = ["agent", "agent:agent2", "agent:agent3", "agent:agent4", "agent:agent5"];
/** Mixed league: earlier versions, style variants, baselines and sims. */
export const LEAGUE = [
  "agent", "agent:agent2", "v1", "v1:v1b", "aggr", "cons", "nocash",
  "overbidder", "random", "brutus-sim", "brutus-sim:maverick-sim", "starter",
];

export const FIELDS: Record<string, Field> = {
  "base-v": { name: "base-v", auctionType: "Vickrey", opponents: BASE },
  "base-f": { name: "base-f", auctionType: "FirstPrice", opponents: BASE },
  "lobby-v": { name: "lobby-v", auctionType: "Vickrey", opponents: LOBBY },
  "lobby-f": { name: "lobby-f", auctionType: "FirstPrice", opponents: LOBBY },
  "self-v": { name: "self-v", auctionType: "Vickrey", opponents: SELF },
  "self-f": { name: "self-f", auctionType: "FirstPrice", opponents: SELF },
  "league-v": { name: "league-v", auctionType: "Vickrey", opponents: LEAGUE, sample: true },
  "league-f": { name: "league-f", auctionType: "FirstPrice", opponents: LEAGUE, sample: true },
  // 2-bot matches, like the tournament final: against v6 and against final.
  "duel-v": { name: "duel-v", auctionType: "Vickrey", opponents: ["v6"] },
  "duel-f": { name: "duel-f", auctionType: "FirstPrice", opponents: ["v6"] },
  "duelself-v": { name: "duelself-v", auctionType: "Vickrey", opponents: ["agent"] },
};

/** Batch spec for `cand` in a field (sampled fields draw its 5 opponents per match). */
export function fieldSpec(
  f: Field,
  cand: Record<string, number>,
  matches: number,
  seed: number,
  oppParams: Record<string, Record<string, number>> = {},
): BatchSpec {
  return {
    seats: f.opponents,
    fixed: ["cand"],
    seatsPerMatch: f.sample ? 6 : undefined,
    matches,
    auctionType: f.auctionType,
    seed,
    params: { ...oppParams, cand },
  };
}
