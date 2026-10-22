// Baseline opponents for the simulator.
//
// starter    — the unmodified starter: decideBid from the verbatim copy; its
//              chooseWord (longest word >= 2 letters, lexicographic tie-break)
//              is reproduced with the fast index (equivalence is unit-tested).
//              Like the real client it tries one word per rack gain: the
//              my_rack callback fires on a gain and the 500 ms throttle
//              swallows the follow-up update from its own play.
// greedy     — bids the letter's face value; cashes in its best word
//              (>= 3 letters) every round.
// overbidder — bids 2 x value + 4; cashes in like greedy.
// hoarder    — bids value + 2; plays only words of 7+ letters.
// random     — bids a uniform integer in [0, 12]; cashes in like greedy.

import { sharedIndex } from "../../src/game/dictionary.ts";
import { type Counts, LETTER_VALUES, countsToMap, letterIndex } from "../../src/game/letters.ts";
import { Rng } from "../../src/game/rng.ts";
import type {
  AuctionOutcome,
  AuctionView,
  Decision,
  MatchStart,
  Policy,
  WordPlayed,
} from "../../src/game/types.ts";
import { decideBid as starterDecideBid } from "./starter-strategy.ts";

const cap = (bid: number, balance: number) => Math.max(0, Math.min(Math.floor(bid), balance));

/** Repeatedly takes the highest-reward word of at least minLen letters. */
export function cashIn(rack: Counts, minLen: number): string[] {
  const idx = sharedIndex();
  const r = rack.slice();
  const words: string[] = [];
  for (;;) {
    const s = idx.bestWord(r, minLen);
    if (s === -1) return words;
    words.push(idx.sigWord[s]!);
    idx.subtract(r, s);
  }
}

abstract class Base implements Policy {
  abstract readonly name: string;
  protected seat = -1;
  onMatchStart(m: MatchStart): void {
    this.seat = m.seat;
  }
  abstract onAuction(v: AuctionView): Decision;
  onAuctionResult(_r: AuctionOutcome): void {}
  onWordPlayed(_w: WordPlayed): void {}
}

export class StarterPolicy extends Base {
  readonly name = "starter";
  private rackChanged = true; // racks are dealt -> my_rack inserts fire

  override onMatchStart(m: MatchStart): void {
    super.onMatchStart(m);
    this.rackChanged = true;
  }

  onAuction(v: AuctionView): Decision {
    const balance = v.balances[this.seat]!;
    const bid = starterDecideBid({ letter: v.letter, myBalance: balance, myRack: countsToMap(v.rack) });
    const words: string[] = [];
    if (this.rackChanged) {
      const w = sharedIndex().longestWord(v.rack, 2);
      if (w) words.push(w);
      this.rackChanged = false;
    }
    return { words, bid };
  }

  override onAuctionResult(r: AuctionOutcome): void {
    if (r.winner === this.seat) this.rackChanged = true;
  }
}

export class GreedyPolicy extends Base {
  readonly name = "greedy";
  onAuction(v: AuctionView): Decision {
    const balance = v.balances[this.seat]!;
    return { words: cashIn(v.rack, 3), bid: cap(LETTER_VALUES[letterIndex(v.letter)]!, balance) };
  }
}

export class OverbidderPolicy extends Base {
  readonly name = "overbidder";
  onAuction(v: AuctionView): Decision {
    const balance = v.balances[this.seat]!;
    const value = LETTER_VALUES[letterIndex(v.letter)]!;
    return { words: cashIn(v.rack, 3), bid: cap(2 * value + 4, balance) };
  }
}

export class HoarderPolicy extends Base {
  readonly name = "hoarder";
  onAuction(v: AuctionView): Decision {
    const balance = v.balances[this.seat]!;
    const value = LETTER_VALUES[letterIndex(v.letter)]!;
    return { words: cashIn(v.rack, 7), bid: cap(value + 2, balance) };
  }
}

export class RandomPolicy extends Base {
  readonly name = "random";
  private rng = new Rng(0);
  override onMatchStart(m: MatchStart): void {
    super.onMatchStart(m);
    this.rng = new Rng(m.seed);
  }
  onAuction(v: AuctionView): Decision {
    const balance = v.balances[this.seat]!;
    return { words: cashIn(v.rack, 3), bid: cap(this.rng.int(13), balance) };
  }
}
