// The policy interface shared by the live bot (src/index.ts) and the
// headless simulator (sim/engine.ts). A policy sees exactly what a real bot
// can see through public tables plus its own `my_rack` view.

import type { AuctionType, Counts } from "./letters.ts";

/** Strategy of a module-driven sim bot; `bot.strategy` is a public column. */
export type SimStrategy = "Cheapskate" | "ValueBidder" | "Aggressive";

export interface MatchStart {
  /** My index in the participant list. */
  seat: number;
  nPlayers: number;
  names: readonly string[];
  /** Non-null for module sims (public via `bot.is_simulated` / `bot.strategy`). */
  simStrategies: readonly (SimStrategy | null)[];
  auctionType: AuctionType;
  /** My dealt starting rack (5 tiles). */
  rack: Counts;
  /** Seed for any policy-internal randomness. */
  seed: number;
  /**
   * Participants known to be offline at match start (no connected
   * credential; public via bot_credential.connected). Registered bots that
   * never connect are still entered in tournaments (lib.rs:1561).
   */
  offline?: readonly boolean[];
}

export interface AuctionView {
  /** 1-based auction number in this match (`match_state.current_round`). */
  round: number;
  /** Letter being auctioned, "A".."Z". */
  letter: string;
  /** Tiles left in the bag after this letter was drawn; 0 means final auction. */
  bagTotal: number;
  /** My current rack (a copy). */
  rack: Counts;
  /** Public balances and scores of every participant at auction open. */
  balances: readonly number[];
  scores: readonly number[];
}

export interface Decision {
  /** Words to play now, in order, before the bid is placed. */
  words: string[];
  /** Bid for the current letter; 0 = no bid. */
  bid: number;
}

export interface AuctionOutcome {
  round: number;
  letter: string;
  winner: number | null;
  paid: number;
}

export interface WordPlayed {
  player: number;
  word: string;
  reward: number;
}

export interface Policy {
  readonly name: string;
  onMatchStart(m: MatchStart): void;
  onAuction(v: AuctionView): Decision;
  onAuctionResult(r: AuctionOutcome): void;
  onWordPlayed(w: WordPlayed): void;
}

export type { AuctionType, Counts };
