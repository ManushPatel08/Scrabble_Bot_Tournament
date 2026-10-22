// A registered bot that never connects: it never bids or plays a word.
// start_tournament enters every bot in the `bot` table (lib.rs:1561), so
// tournament matches can contain several of these.

import type { AuctionOutcome, AuctionView, Decision, MatchStart, Policy, WordPlayed } from "../../src/game/types.ts";

export class IdlePolicy implements Policy {
  readonly name = "idle";
  onMatchStart(_m: MatchStart): void {}
  onAuction(_v: AuctionView): Decision {
    return { words: [], bid: 0 };
  }
  onAuctionResult(_r: AuctionOutcome): void {}
  onWordPlayed(_w: WordPlayed): void {}
}
