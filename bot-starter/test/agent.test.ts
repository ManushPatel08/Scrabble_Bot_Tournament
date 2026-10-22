// Behavioural checks on the strategy inside simulated matches.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runMatch, type SeatSpec } from "../sim/engine.ts";
import { makeSeat } from "../sim/registry.ts";
import { Agent, simBeatProb } from "../src/strategy/agent.ts";
import { sharedIndex } from "../src/game/dictionary.ts";
import { letterIndex, wordReward } from "../src/game/letters.ts";
import type { AuctionOutcome, AuctionView, Decision } from "../src/game/types.ts";
import "../sim/strategies.ts";

interface Rec {
  v: AuctionView;
  d: Decision;
  simMax: number;
  outcome?: AuctionOutcome;
}

function recorded(params: object, recs: Rec[]): { seat: SeatSpec; agent: () => Agent } {
  let agent: Agent | null = null;
  return {
    agent: () => agent!,
    seat: {
      name: "me",
      make: () => {
        const a = new Agent(params, "me");
        agent = a;
        const on = a.onAuction.bind(a);
        const res = a.onAuctionResult.bind(a);
        a.onAuction = (v) => {
          const simMax = a.simMax(letterIndex(v.letter), v.balances);
          const d = on(v);
          recs.push({ v, d, simMax });
          return d;
        };
        a.onAuctionResult = (r) => {
          recs.at(-1)!.outcome = r;
          res(r);
        };
        return a;
      },
    },
  };
}

const LOBBY = ["brutus-sim", "brutus-sim:maverick-sim", "valor-sim", "valor-sim:hagrid-sim", "cheapo-sim"];

test("bids are within balance; nothing is bid on the unplayable final letter", () => {
  for (const auctionType of ["Vickrey", "FirstPrice"] as const) {
    for (let seed = 1; seed <= 6; seed++) {
      const recs: Rec[] = [];
      const { seat } = recorded({}, recs);
      runMatch([seat, ...["agent", "overbidder", "random", "brutus-sim", "greedy"].map((s) => makeSeat(s))], { auctionType, seed });
      for (const r of recs) {
        let bal = r.v.balances[0]!;
        for (const w of r.d.words) bal += wordReward(w);
        assert.ok(r.d.bid >= 0 && r.d.bid <= bal, `bid ${r.d.bid} > balance ${bal}`);
        assert.ok(Number.isInteger(r.d.bid));
      }
      assert.equal(recs.at(-1)!.v.bagTotal, 0);
      assert.equal(recs.at(-1)!.d.bid, 0);
    }
  }
});

test("final auction plays out the optimal word set of the whole rack", () => {
  const idx = sharedIndex();
  for (let seed = 1; seed <= 8; seed++) {
    const recs: Rec[] = [];
    const { seat } = recorded({}, recs);
    runMatch([seat, ...LOBBY.map((s) => makeSeat(s))], { auctionType: "Vickrey", seed });
    const last = recs.at(-1)!;
    const best = idx.bestPartition(last.v.rack, 2).reward;
    const got = last.d.words.reduce((a, w) => a + wordReward(w), 0);
    assert.equal(got, best);
  }
});

test("simBeatProb matches the jitter distribution", () => {
  const E = letterIndex("E"); // Aggressive: base 5 -> bids 3..7 with p = 1/5 each
  const one = [{ strategy: "Aggressive", balance: 100 }];
  assert.equal(simBeatProb(one, E, 3), (0 + 0.5) / 5);
  assert.equal(simBeatProb(one, E, 6), (3 + 0.5) / 5);
  assert.equal(simBeatProb(one, E, 8), 1);
  // Two independent sims multiply.
  const two = [...one, { strategy: "Aggressive", balance: 100 }];
  assert.equal(simBeatProb(two, E, 6), ((3 + 0.5) / 5) ** 2);
  // A broke sim never bids.
  assert.equal(simBeatProb([{ strategy: "Aggressive", balance: 0 }], E, 1), 1);
});

test("first-price against sims only: never bids above what beats every sim", () => {
  let wins = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const recs: Rec[] = [];
    const { seat, agent } = recorded({}, recs);
    runMatch([seat, ...LOBBY.map((s) => makeSeat(s))], { auctionType: "FirstPrice", seed });
    for (const r of recs) {
      if (r.d.bid <= 0) continue;
      const cap = agent().simMaxPossible(letterIndex(r.v.letter), r.v.balances) + 1;
      assert.ok(r.d.bid <= cap, `bid ${r.d.bid} > ${cap}: overpays`);
      if (r.outcome?.winner === 0) wins++;
    }
  }
  assert.ok(wins > 50);
});
