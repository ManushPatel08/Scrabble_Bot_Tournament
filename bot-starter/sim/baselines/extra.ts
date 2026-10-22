// Extra opponents used only for the final robustness check (never for
// tuning), to see how the bot copes with styles it was not trained against.
//
// sniper — bids nothing for the first half, then splits its balance evenly
//          over the remaining auctions (x2 on letters it can use).
// allin  — every auction, bids balance / remaining auctions x 3 (spends
//          early, starves late); cashes in like greedy.

import { sharedIndex } from "../../src/game/dictionary.ts";
import { letterIndex } from "../../src/game/letters.ts";
import type { AuctionOutcome, AuctionView, Decision, MatchStart, Policy, WordPlayed } from "../../src/game/types.ts";
import { cashIn } from "./policies.ts";

abstract class Base implements Policy {
  abstract readonly name: string;
  protected seat = -1;
  protected total = 68;
  onMatchStart(m: MatchStart): void {
    this.seat = m.seat;
    this.total = 98 - 5 * m.nPlayers;
  }
  abstract onAuction(v: AuctionView): Decision;
  onAuctionResult(_r: AuctionOutcome): void {}
  onWordPlayed(_w: WordPlayed): void {}
}

export class SniperPolicy extends Base {
  readonly name = "sniper";
  onAuction(v: AuctionView): Decision {
    const words = v.bagTotal === 0 ? sharedIndex().bestPartition(v.rack, 2, 50_000).words : cashIn(v.rack, 6);
    const balance = v.balances[this.seat]!;
    const left = v.bagTotal; // auctions after this one
    if (left > this.total / 2 || left === 0) return { words, bid: 0 };
    const r = v.rack.slice();
    r[letterIndex(v.letter)]!++;
    const useful = sharedIndex().bestRewardSig(r, 4) !== -1;
    const bid = Math.floor((balance / Math.max(1, left)) * (useful ? 2 : 1));
    return { words, bid: Math.min(balance, bid) };
  }
}

export class AllInPolicy extends Base {
  readonly name = "allin";
  onAuction(v: AuctionView): Decision {
    const balance = v.balances[this.seat]!;
    const bid = Math.floor((3 * balance) / Math.max(1, v.bagTotal + 1));
    return { words: cashIn(v.rack, 3), bid: Math.min(balance, bid) };
  }
}
