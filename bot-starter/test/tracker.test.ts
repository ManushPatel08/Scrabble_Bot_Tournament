// Bag tracker against the engine's ground truth.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runMatch, type SeatSpec } from "../sim/engine.ts";
import { makeSeat } from "../sim/registry.ts";
import { Agent } from "../src/strategy/agent.ts";
import { BAG_DISTRIBUTION, N_LETTERS, type Counts } from "../src/game/letters.ts";
import "../sim/strategies.ts";

test("unseen pool == bag + opponents' unrevealed dealt tiles, every round", () => {
  for (const auctionType of ["Vickrey", "FirstPrice"] as const) {
    for (let seed = 1; seed <= 12; seed++) {
      const me = new Agent({ samples: 4 }, "me");
      let checks = 0;
      const seats: SeatSpec[] = [
        { name: "me", make: () => me },
        makeSeat("brutus-sim"),
        makeSeat("greedy"),
        makeSeat("random"),
        makeSeat("agent"),
        makeSeat("valor-sim"),
      ];
      runMatch(seats, {
        auctionType,
        seed,
        observe: ({ round, bag, dealt }) => {
          if (round === 1) return; // tracker is updated when we see the auction
          const t = me.t;
          const truth: Counts = bag.slice();
          // The letter of the auction now opening was already drawn from `bag`;
          // our tracker removes it when we see the auction, so compare against
          // the state as of the previous auction: add it back below.
          for (let j = 0; j < 6; j++) {
            if (j === t.seat) continue;
            for (let c = 0; c < N_LETTERS; c++) {
              const hidden = dealt[j]![c]! - t.dealtUsed[j]![c]!;
              assert.ok(hidden >= 0, "tracker never over-attributes dealt tiles");
              truth[c]! += hidden;
            }
          }
          // The tracker's pool also still contains the letter just drawn for
          // this auction (it learns it in onAuction).
          const diff = t.unseen.map((u, c) => u - truth[c]!);
          assert.equal(diff.reduce((a, b) => a + b, 0), 1, `round ${round}: exactly one tile in flight`);
          assert.ok(diff.every((d) => d === 0 || d === 1));
          assert.equal(t.unseenTotal, t.unseen.reduce((a, b) => a + b, 0));
          checks++;
        },
      });
      assert.equal(checks, 67);
      // After the match: everything we never saw is exactly the opponents'
      // unrevealed dealt tiles (the bag is empty).
      const total = me.t.unseen.reduce((a, b) => a + b, 0);
      const hidden = [0, 1, 2, 3, 4, 5].filter((j) => j !== me.t.seat).reduce((a, j) => a + me.t.hiddenCount(j), 0);
      assert.equal(total, hidden);
    }
  }
});

test("tracker starts from the 98-tile distribution minus our dealt rack", () => {
  const me = new Agent({ samples: 2 }, "me");
  let first: Counts | null = null;
  runMatch([{ name: "me", make: () => me }, makeSeat("greedy")], {
    auctionType: "Vickrey",
    seed: 4,
    observe: ({ round, dealt }) => {
      if (round === 1) first = dealt[0]!;
    },
  });
  assert.ok(first);
  // 98 - 5 (ours) - 83 auctioned (2 bots: 98 - 10 = 88 auctions) ... check the
  // invariant instead: unseen + ours + auctioned letters = full bag.
  const auctioned = new Array<number>(N_LETTERS).fill(0);
  for (const h of me.t.history) auctioned[h.letter]!++;
  for (let c = 0; c < N_LETTERS; c++) {
    assert.equal(
      me.t.unseen[c]! + first![c]! + auctioned[c]! + me.t.dealtUsed[1]![c]!,
      BAG_DISTRIBUTION[c],
    );
  }
});
