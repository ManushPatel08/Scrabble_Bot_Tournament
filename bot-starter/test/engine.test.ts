// Simulator auction/end-of-match rules against lib.rs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAuction, runMatch, simBid, type SeatSpec } from "../sim/engine.ts";
import { letterIndex } from "../src/game/letters.ts";
import type { AuctionOutcome, AuctionView, Decision, MatchStart, Policy, WordPlayed } from "../src/game/types.ts";
import { makeSeat } from "../sim/registry.ts";
import { Rng } from "../src/game/rng.ts";

test("Vickrey: single bidder pays the reserve (1)", () => {
  assert.deepEqual(resolveAuction([{ player: 2, amount: 17 }], "Vickrey"), { winner: 2, paid: 1 });
});

test("Vickrey: winner pays the second-highest bid", () => {
  const bids = [{ player: 0, amount: 4 }, { player: 1, amount: 9 }, { player: 2, amount: 6 }];
  assert.deepEqual(resolveAuction(bids, "Vickrey"), { winner: 1, paid: 6 });
});

test("without the module's shuffle, ties go to the earlier bid; the winner pays the tied amount", () => {
  const bids = [{ player: 3, amount: 5 }, { player: 1, amount: 5 }, { player: 0, amount: 2 }];
  assert.deepEqual(resolveAuction(bids, "Vickrey"), { winner: 3, paid: 5 });
  assert.deepEqual(resolveAuction(bids, "FirstPrice"), { winner: 3, paid: 5 });
});

test("first-price: winner pays own bid, even when alone", () => {
  assert.deepEqual(resolveAuction([{ player: 0, amount: 7 }], "FirstPrice"), { winner: 0, paid: 7 });
  assert.deepEqual(
    resolveAuction([{ player: 0, amount: 7 }, { player: 1, amount: 3 }], "FirstPrice"),
    { winner: 0, paid: 7 },
  );
});

test("zero bids are ignored; no bids means no winner", () => {
  assert.deepEqual(resolveAuction([{ player: 0, amount: 0 }], "Vickrey"), { winner: null, paid: 0 });
  assert.deepEqual(resolveAuction([], "FirstPrice"), { winner: null, paid: 0 });
  assert.deepEqual(
    resolveAuction([{ player: 0, amount: 0 }, { player: 1, amount: 3 }], "Vickrey"),
    { winner: 1, paid: 1 },
  );
});

test("equal bids are resolved at random (game.ts:485-488)", () => {
  const rng = new Rng(17);
  const wins = [0, 0, 0];
  for (let i = 0; i < 3000; i++) {
    const { winner, paid } = resolveAuction(
      [{ player: 0, amount: 6 }, { player: 1, amount: 6 }, { player: 2, amount: 6 }],
      "Vickrey",
      rng,
    );
    wins[winner!]!++;
    assert.equal(paid, 6);
  }
  for (const w of wins) assert.ok(w > 850 && w < 1150, `roughly a third each: ${wins}`);
});

test("sim bids: base + jitter in [-2, 2], floored at 1, capped at balance (game.ts:703-727)", () => {
  const L = letterIndex;
  assert.equal(simBid("Cheapskate", L("A"), 100, -2), 1); // max(0 - 2, 1)
  assert.equal(simBid("Cheapskate", L("Q"), 100, 2), 11); // 9 + 2
  assert.equal(simBid("ValueBidder", L("K"), 100, -1), 4);
  assert.equal(simBid("Aggressive", L("Z"), 100, 2), 14); // 12 + 2
  assert.equal(simBid("Aggressive", L("Z"), 13, 2), 13); // capped at balance
  assert.equal(simBid("Aggressive", L("E"), 0, 2), 0); // broke: no bid
});

test("sim bids match decide_bid with zero jitter", () => {
  const L = letterIndex;
  assert.equal(simBid("Cheapskate", L("A"), 100), 1); // max(1-1, 1)
  assert.equal(simBid("Cheapskate", L("Q"), 100), 9);
  assert.equal(simBid("ValueBidder", L("K"), 100), 5);
  assert.equal(simBid("Aggressive", L("E"), 100), 5); // vowel +4
  assert.equal(simBid("Aggressive", L("Z"), 100), 12); // consonant +2
  assert.equal(simBid("Aggressive", L("Z"), 3), 3); // capped at balance
  assert.equal(simBid("Aggressive", L("Y"), 100), 6); // Y is not a vowel
});

/** Scripted external bot that records everything it sees. */
class Probe implements Policy {
  readonly name = "probe";
  seat = -1;
  views: AuctionView[] = [];
  results: AuctionOutcome[] = [];
  plays: WordPlayed[] = [];
  start!: MatchStart;
  private bidFn: (v: AuctionView) => number;
  private wordsFn: (v: AuctionView) => string[];
  constructor(bidFn: (v: AuctionView) => number, wordsFn: (v: AuctionView) => string[] = () => []) {
    this.bidFn = bidFn;
    this.wordsFn = wordsFn;
  }
  onMatchStart(m: MatchStart) {
    this.seat = m.seat;
    this.start = m;
  }
  onAuction(v: AuctionView): Decision {
    this.views.push(v);
    return { words: this.wordsFn(v), bid: this.bidFn(v) };
  }
  onAuctionResult(r: AuctionOutcome) {
    this.results.push(r);
  }
  onWordPlayed(w: WordPlayed) {
    this.plays.push(w);
  }
}

test("6-bot match: 30 dealt tiles, 68 auctions, conservation of tiles and money", () => {
  for (const auctionType of ["Vickrey", "FirstPrice"] as const) {
    for (let seed = 1; seed <= 20; seed++) {
      const probe = new Probe(() => 0);
      const seats: SeatSpec[] = [
        { name: "probe", make: () => probe },
        makeSeat("overbidder"),
        makeSeat("random"),
        makeSeat("cheapo-sim"),
        makeSeat("brutus-sim"),
        makeSeat("hoarder"),
      ];
      const res = runMatch(seats, { auctionType, seed });
      assert.equal(res.auctions, 68);
      assert.equal(probe.views.length, 68);
      assert.equal(probe.views.at(-1)!.bagTotal, 0); // final auction visible as bag_total == 0
      assert.equal(probe.views[0]!.bagTotal, 98 - 30 - 1);
      const won = res.seats.reduce((a, s) => a + s.lettersWon, 0);
      assert.equal(won + res.unsold, 68);
      for (const s of res.seats) {
        assert.equal(s.balance, 100 + s.score - s.spent, `${s.name} money`);
      }
      // Rank 1 has the top score.
      const top = Math.max(...res.seats.map((s) => s.score));
      assert.equal(res.seats.find((s) => s.rank === 1)!.score, top);
    }
  }
});

test("unsold letters are discarded, not returned to the bag", () => {
  // Nobody bids: every auction is unsold, and there are still exactly
  // 98 - 5*N auctions (a returned tile would lengthen the match).
  const seats: SeatSpec[] = [0, 1, 2].map((i) => ({ name: `p${i}`, make: () => new Probe(() => 0) }));
  const res = runMatch(seats, { auctionType: "Vickrey", seed: 3 });
  assert.equal(res.auctions, 98 - 15);
  assert.equal(res.unsold, 98 - 15);
});

test("the final auction's letter can never be played by an external bot", () => {
  const probe = new Probe((v) => (v.bagTotal === 0 ? 1 : 0));
  const other = new Probe(() => 0);
  const res = runMatch(
    [{ name: "probe", make: () => probe }, { name: "other", make: () => other }],
    { auctionType: "Vickrey", seed: 11 },
  );
  assert.equal(probe.results.at(-1)!.winner, probe.seat);
  assert.equal(res.seats[0]!.lettersWon, 1);
  // No onAuction call happens after the final result, so no chance to play it.
  assert.equal(probe.views.length, res.auctions);
  assert.equal(res.seats[0]!.unplayedTiles, 5 + 1);
});

test("a sim that wins plays its longest >= 3-letter word right away", () => {
  const probe = new Probe(() => 0);
  runMatch([{ name: "probe", make: () => probe }, makeSeat("valor-sim")], { auctionType: "Vickrey", seed: 5 });
  const simPlays = probe.plays.filter((p) => p.player !== probe.seat);
  assert.ok(simPlays.length > 0);
  for (const p of simPlays) assert.ok(p.word.length >= 3);
  // Every sim play directly follows a sim win in the same round.
  assert.ok(probe.results.filter((r) => r.winner !== null && r.winner !== probe.seat).length >= simPlays.length);
});

test("external bids above balance are rejected; words are validated", () => {
  const probe = new Probe(() => 1000, () => ["QX", "ZZZZ"]);
  const res = runMatch([{ name: "probe", make: () => probe }, makeSeat("greedy")], { auctionType: "Vickrey", seed: 2 });
  const s = res.seats[0]!;
  assert.equal(s.lettersWon, 0);
  assert.equal(s.rejectedBids, res.auctions);
  assert.equal(s.rejectedWords, 2 * res.auctions);
});

test("same seed => same tile sequence regardless of the bots' behaviour", () => {
  const a = new Probe(() => 0);
  const b = new Probe((v) => v.balances[1]! > 5 ? 3 : 0);
  runMatch([makeSeat("greedy"), { name: "a", make: () => a }], { auctionType: "Vickrey", seed: 77 });
  runMatch([makeSeat("random"), { name: "b", make: () => b }], { auctionType: "Vickrey", seed: 77 });
  assert.deepEqual(a.views.map((v) => v.letter), b.views.map((v) => v.letter));
  assert.deepEqual(a.start.rack, b.start.rack);
});
