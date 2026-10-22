// Behaviours added by the adversarial hardening (RESULTS.md, "Adversarial
// evaluation"): first-price +1 only when external bots are present, and the
// leader tax only in 2-bot matches.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "../src/strategy/agent.ts";
import { VERSIONS } from "../src/strategy/versions.ts";
import { countsOf, letterIndex } from "../src/game/letters.ts";
import type { AuctionView, MatchStart } from "../src/game/types.ts";

const FINAL = VERSIONS.final!;

function start(a: Agent, n: number, sims: (MatchStart["simStrategies"][number])[], auctionType: MatchStart["auctionType"]) {
  a.onMatchStart({
    seat: 0,
    nPlayers: n,
    names: Array.from({ length: n }, (_, i) => `p${i}`),
    simStrategies: sims,
    auctionType,
    rack: countsOf("AEINR"),
    seed: 5,
  });
}

function view(n: number, letter: string, balances?: number[], scores?: number[]): AuctionView {
  return {
    round: 10,
    letter,
    bagTotal: 40,
    rack: countsOf("AEINR"),
    balances: balances ?? new Array<number>(n).fill(90),
    scores: scores ?? new Array<number>(n).fill(20),
  };
}

test("first-price: +1 over the model only when an external opponent is present", () => {
  // Sims only: no extra +1 (the jitter model already prices the sims exactly).
  const sims: MatchStart["simStrategies"][number][] = [null, "Aggressive", "Aggressive", "ValueBidder", "ValueBidder", "Cheapskate"];
  const simsOnly = new Agent(FINAL, "a");
  const simsOnlyNoPlus = new Agent({ ...FINAL, fpPlus: 0 }, "a0");
  start(simsOnly, 6, sims, "FirstPrice");
  start(simsOnlyNoPlus, 6, sims, "FirstPrice");
  assert.equal(simsOnly.onAuction(view(6, "E")).bid, simsOnlyNoPlus.onAuction(view(6, "E")).bid);

  // External opponents: the bid is one above what fpPlus=0 would give.
  const withPlus = new Agent(FINAL, "b");
  const noPlus = new Agent({ ...FINAL, fpPlus: 0 }, "c");
  for (const a of [withPlus, noPlus]) start(a, 6, [null, null, null, null, null, null], "FirstPrice");
  const b1 = withPlus.onAuction(view(6, "T")).bid;
  const b0 = noPlus.onAuction(view(6, "T")).bid;
  assert.ok(b0 > 0);
  assert.equal(b1, b0 + 1);
});

test("leader tax applies in 2-bot Vickrey matches, not in 6-bot ones", () => {
  const scores2 = [10, 40]; // opponent leads
  const duel = new Agent(FINAL, "d");
  const duelNoTax = new Agent({ ...FINAL, leaderTaxDuel: 0 }, "e");
  for (const a of [duel, duelNoTax]) start(a, 2, [null, null], "Vickrey");
  // The leader holds UETZAL, so Q (QUETZAL, 75 points) is worth far more to them than
  // to us (AEINR has no U for a Q). With equal balances the tax binds and is affordable.
  for (const a of [duel, duelNoTax]) a.t.won[1] = countsOf("UETZAL");
  const taxed = duel.onAuction(view(2, "Q", [150, 150], scores2)).bid;
  const plain = duelNoTax.onAuction(view(2, "Q", [150, 150], scores2)).bid;
  assert.ok(taxed > plain, `tax ${taxed} should exceed plain ${plain}`);

  const six = new Agent(FINAL, "f");
  const sixNoTax = new Agent({ ...FINAL, leaderTaxDuel: 0 }, "g");
  for (const a of [six, sixNoTax]) {
    start(a, 6, [null, null, null, null, null, null], "Vickrey");
    a.t.won[1] = countsOf("UETZAL");
  }
  const s6 = [10, 40, 5, 5, 5, 5];
  assert.equal(six.onAuction(view(6, "Q", undefined, s6)).bid, sixNoTax.onAuction(view(6, "Q", undefined, s6)).bid);
});

test("leader tax never exceeds balance and is off on the final auction", () => {
  const a = new Agent(FINAL, "h");
  start(a, 2, [null, null], "Vickrey");
  a.t.won[1] = countsOf("UETZAL");
  const poor = a.onAuction({ ...view(2, "Q", [3, 90], [10, 40]) }).bid;
  assert.ok(poor <= 3);
  const last = a.onAuction({ ...view(2, "Q", [90, 90], [10, 40]), round: 88, bagTotal: 0 }).bid;
  assert.equal(last, 0);
});
