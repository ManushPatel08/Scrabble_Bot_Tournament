// Behaviours added by the adversarial hardening (RESULTS.md, "Adversarial
// evaluation"): first-price +1 only when external bots are present, and the
// leader tax only in 2-bot matches.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "../src/strategy/agent.ts";
import { WordIndex, sharedIndex } from "../src/game/dictionary.ts";
import { VERSIONS } from "../src/strategy/versions.ts";
import { countsOf, letterIndex, wordReward } from "../src/game/letters.ts";
import type { AuctionView, MatchStart } from "../src/game/types.ts";

const FINAL = VERSIONS.final!;

test("word choice lookahead preserves a better scoring remainder", () => {
  const idx = sharedIndex();
  const outcome = (wordLookahead: number) => {
    const a = new Agent({ ...FINAL, wordLookahead }, "word-choice");
    start(a, 6, [null, null, null, null, null, null], "Vickrey");
    const rack = countsOf("GIINUEMPLOAQE");
    const d = a.onAuction({ ...view(6, "X"), rack, round: 67, bagTotal: 1, balances: [100, 100, 100, 100, 100, 100] });
    const remaining = rack.slice();
    for (const word of d.words) for (const ch of word) remaining[ch.charCodeAt(0) - 65]!--;
    return { words: d.words, value: d.words.reduce((s, w) => s + wordReward(w), 0) + idx.bestPartition(remaining).reward };
  };
  assert.deepEqual(outcome(0), { words: ["EQUIPAGE"], value: 69 });
  assert.deepEqual(outcome(1), { words: ["OPAQUING"], value: 74 });
});

test("completion credit targets cashable long words and expires before the last usable tile", () => {
  const bid = (completionCredit: number, letter: string, bagTotal: number, balance = 100) => {
    const a = new Agent({ ...FINAL, completionCredit, mcValuation: 0, faceMult: 1, faceAdd: 0, contestFrac: 0 }, "completion");
    start(a, 6, [null, null, null, null, null, null], "Vickrey");
    return a.onAuction({ ...view(6, letter), rack: countsOf("RETAIN"), round: 68 - bagTotal,
      bagTotal, balances: [balance, 100, 100, 100, 100, 100] }).bid;
  };
  assert.ok(bid(.25, "S", 40) > bid(0, "S", 40));
  assert.equal(bid(.25, "Q", 40), bid(0, "Q", 40));
  assert.equal(bid(.25, "S", 1), bid(0, "S", 1));
  assert.equal(bid(.25, "S", 0), 0);
  assert.ok(bid(10, "S", 40, 7) <= 7);
});

test("recent win-share estimates react to a market shift without losing prior smoothing", () => {
  const recent = new Agent({ ...FINAL, winHistoryWindow: 12 }, "recent");
  const whole = new Agent(FINAL, "whole");
  for (const a of [recent, whole]) {
    start(a, 6, [null, null, null, null, null, null], "Vickrey");
    for (let round = 1; round <= 36; round++) a.onAuctionResult({ round, letter: "A", winner: round <= 24 ? 1 : 0, paid: 10 });
  }
  assert.ok(recent.winShare() > whole.winShare());
  assert.ok(recent.winShare() < 1 && recent.winShare() > 0);
});

test("immediate valuation targets playable points even when futures are precomputed", () => {
  const idx = new WordIndex(["RETAIN", "RETAINS", "QUARTER"]);
  const a = new Agent({ ...FINAL, immediateValueWeight: 1, contestFrac: 0, samples: 8 }, "immediate", idx);
  start(a, 6, [null, null, null, null, null, null], "Vickrey");
  const rack = countsOf("RETAIN");
  const d = a.onAuction({ ...view(6, "S"), rack });
  assert.ok(d.bid > 0);
  a.onAuctionResult({ round: 10, letter: "S", winner: 1, paid: 12 });
  a.prepareNext();
  const next = a.onAuction({ ...view(6, "Q"), rack, round: 11, bagTotal: 39 });
  assert.equal(next.bid, 0); // In this dictionary, Q needs a future U to score.
  assert.deepEqual(rack, countsOf("RETAIN"));
});

test("uncertain acquisition counts remain reproducible for a fixed match seed", () => {
  const agents = ["one", "two"].map((name) => new Agent({ ...FINAL, futureCountNoise: 1, samples: 16 }, name));
  for (const a of agents) start(a, 6, [null, null, null, null, null, null], "Vickrey");
  assert.deepEqual(agents[0]!.onAuction(view(6, "S")), agents[1]!.onAuction(view(6, "S")));
});

test("protected cash uses only spare tiles and preserves the completing long word", () => {
  const idx = new WordIndex(["RETAIN", "RETAINS", "JO"]);
  const decide = (balance: number, letter: string, bagTotal = 40) => {
    const a = new Agent({ ...FINAL, futureCountNoise: 1, protectedCashBelow: 20, samples: 8 }, "protected", idx);
    start(a, 6, [null, null, null, null, null, null], "Vickrey");
    const rack = countsOf("RETAINJO");
    const d = a.onAuction({ ...view(6, letter), rack, bagTotal, balances: [balance, 100, 100, 100, 100, 100] });
    const after = rack.slice();
    for (const word of d.words) for (const ch of word) after[letterIndex(ch)]!--;
    assert.ok(after.every((n) => n >= 0));
    assert.ok(d.bid <= balance + d.words.reduce((s, w) => s + wordReward(w), 0));
    return { d, after };
  };
  const low = decide(5, "S");
  assert.deepEqual(low.d.words, ["JO"]);
  assert.deepEqual(low.after, countsOf("RETAIN"));
  assert.deepEqual(decide(30, "S").d.words, []);
  assert.deepEqual(decide(5, "Q").d.words, []);
  assert.equal(decide(5, "S", 0).d.bid, 0);
});

test("experimental valuation and market floors stay affordable and skip the final tile", () => {
  for (const auctionType of ["Vickrey", "FirstPrice"] as const) {
    for (const params of [
      { endgameExact: 8 }, { valuationBranches: 3 },
      { contestPricePrior: 1, contestBudget: 3 },
      { futureWinBias: 1, contestPricePrior: 1, contestBudget: 3 },
      { wordLookahead: 1 }, { completionCredit: .25 },
      { winHistoryWindow: 12 }, { immediateValueWeight: .5 },
      { futureCountNoise: 1 },
      { futureCountNoise: 1, protectedCashBelow: 20 },
      { rolloutBid: 1, rolloutSamples: 8, rolloutHorizon: 66, rackCap: 11, cashBelow: 8, lateCashLen: 5, lateCashWindow: 12, finalPackWindow: 3 },
      { rolloutBid: 1, rolloutSamples: 8, rolloutPriceAdapt: 1, shadeLow: 0.8 },
    ]) {
      const a = new Agent({ ...FINAL, ...params, samples: 8 }, "experiment");
      start(a, 6, [null, null, null, null, null, null], auctionType);
      for (const bagTotal of [40, 8, 3, 1, 0]) {
        const d = a.onAuction({ ...view(6, "Q"), rack: countsOf("GIINUEMPLOAQE"), bagTotal, balances: [12, 100, 100, 100, 100, 100] });
        assert.ok(Number.isInteger(d.bid) && d.bid >= 0 && d.bid <= 12 + d.words.reduce((s, w) => s + wordReward(w), 0));
        if (bagTotal === 0) assert.equal(d.bid, 0);
      }
    }
  }
});

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

test("cashBelow cashes short words only when nearly broke; futureAffordable caps futures by money", () => {
  const idx = new WordIndex(["RETAIN", "RETAINS", "JO", "FIZ"]);
  const decide = (params: Record<string, number>, balance: number, bagTotal = 40) => {
    const a = new Agent({ ...FINAL, ...params, samples: 8 }, "liquidity", idx);
    start(a, 6, [null, null, null, null, null, null], "Vickrey");
    const rack = countsOf("RETAINJO");
    const d = a.onAuction({ ...view(6, "S"), rack, bagTotal, balances: [balance, 100, 100, 100, 100, 100] });
    const after = rack.slice();
    for (const word of d.words) for (const ch of word) after[letterIndex(ch)]!--;
    assert.ok(after.every((n) => n >= 0));
    assert.ok(d.bid <= balance + d.words.reduce((s, w) => s + wordReward(w), 0));
    return { d, a };
  };
  const gate = { cashTiming: 1, cashMinLen: 2, cashBelow: 12 };
  assert.ok(decide(gate, 5).d.words.includes("JO")); // broke: short words are cashed (RETAIN may go too)
  assert.deepEqual(decide(gate, 30).d.words, []); // solvent: hold everything, as the shipped default does
  assert.ok(decide({ ...gate, cashBelow: 0 }, 30).d.words.length > 0); // no gate: the plain cashTiming rule cashes
  assert.equal(decide(gate, 5, 0).d.bid, 0); // final auction: never bid
  // Affordability: with 5 coins the futures hold at most 5 / median price letters.
  const broke = decide({ futureAffordable: 1 }, 5).a;
  assert.ok(broke.futureCount() <= 1);
  const rich = decide({ futureAffordable: 1 }, 100).a;
  assert.ok(rich.futureCount() >= 4);
  assert.equal(decide({ futureAffordable: 0 }, 5).a.futureCount(), decide({}, 5).a.futureCount());
});

test("hold7Ext keeps a 7-letter word only with many extensions, time left and money", () => {
  const idx = new WordIndex(["RETAINS", "GANISTER", "NITRATES", "JO"]);
  const words = (params: Record<string, number>, balance: number, bagTotal = 40) => {
    const a = new Agent({ ...FINAL, ...params, samples: 8 }, "hold7", idx);
    start(a, 6, [null, null, null, null, null, null], "Vickrey");
    return a.onAuction({ ...view(6, "Q"), rack: countsOf("RETAINS"), bagTotal, balances: [balance, 100, 100, 100, 100, 100] }).words;
  };
  // One-tile extensions: G (3 unseen) and T (6 unseen, none dealt to us) = 9 tiles.
  assert.deepEqual(words({}, 100), ["RETAINS"]);
  assert.deepEqual(words({ hold7Ext: 5 }, 100), []);
  assert.deepEqual(words({ hold7Ext: 10 }, 100), ["RETAINS"]);
  assert.deepEqual(words({ hold7Ext: 5 }, 100, 3), ["RETAINS"]); // too late for an 8 to arrive
  assert.deepEqual(words({ hold7Ext: 5, cashBelow: 12 }, 5), ["RETAINS"]); // broke: cash it
  assert.deepEqual(words({ hold7Ext: 5 }, 100, 0), ["RETAINS"]); // final auction: play out
});

test("shadeLow scales only 1-2 point letters, only while enough auctions remain", () => {
  const bid = (params: Record<string, number>, letter: string, bagTotal = 40) => {
    const a = new Agent({ ...FINAL, ...params, mcValuation: 0, faceMult: 2, faceAdd: 4, contestFrac: 0 }, "shade");
    start(a, 6, [null, null, null, null, null, null], "Vickrey");
    return a.onAuction({ ...view(6, letter), rack: countsOf("RETAIN"), bagTotal, balances: [100, 100, 100, 100, 100, 100] }).bid;
  };
  assert.ok(bid({ shadeLow: 0.8 }, "E") < bid({}, "E"));
  assert.equal(bid({ shadeLow: 0.8 }, "E"), Math.floor(bid({}, "E") * 0.8));
  assert.equal(bid({ shadeLow: 0.8 }, "Z"), bid({}, "Z")); // 10-point letter: never shaded
  assert.equal(bid({ shadeLow: 0.8 }, "D"), Math.floor(bid({}, "D") * 0.8)); // 2 points: shaded
  assert.equal(bid({ shadeLow: 0.8 }, "E", 10), bid({}, "E", 10)); // last 12 auctions: not shaded
  assert.equal(bid({ shadeLow: 0.8 }, "E", 0), 0);
});

test("rollout valuation: affordable, zero on the final auction, reproducible, and higher for a completing letter", () => {
  const R = { rolloutBid: 1, rolloutSamples: 16, rolloutHorizon: 66, rackCap: 11, cashBelow: 8, lateCashLen: 5, lateCashWindow: 12, finalPackWindow: 3 };
  const decide = (letter: string, rackStr: string, bagTotal: number, balance: number, seed = 11) => {
    const a = new Agent({ ...FINAL, ...R }, "rollout");
    a.onMatchStart({ seat: 0, nPlayers: 6, names: ["a", "b", "c", "d", "e", "f"], simStrategies: [null, null, null, null, null, null],
      auctionType: "Vickrey", rack: countsOf(rackStr.slice(0, 5)), seed, offline: [false, false, false, false, false, false] });
    for (let r = 1; r < 68 - bagTotal; r++) { a.t.openAuction(r, "A", 68 - r); a.onAuctionResult({ round: r, letter: "A", winner: 1, paid: 12 }); }
    return a.onAuction({ ...view(6, letter), rack: countsOf(rackStr), round: 68 - bagTotal, bagTotal, balances: [balance, 60, 60, 60, 60, 60] });
  };
  for (const [letter, rack, bag, bal] of [["N", "RETAI", 67, 100], ["Z", "RETAI", 67, 100], ["T", "DEEIPRU", 21, 23], ["O", "U", 3, 44]] as const) {
    const d = decide(letter, rack, bag, bal);
    assert.ok(d.bid >= 0 && d.bid <= bal + d.words.reduce((s, w) => s + wordReward(w), 0), `${letter} ${rack}: ${d.bid}`);
  }
  assert.equal(decide("E", "RETAI", 0, 100).bid, 0); // final auction: its tile can never be played
  assert.equal(decide("N", "RETAI", 67, 100).bid, decide("N", "RETAI", 67, 100).bid); // same seed, same bid
  assert.ok(decide("Z", "RETAI", 67, 100).bid > decide("E", "RETAI", 67, 100).bid); // a rare letter is worth more coins
  // Word rules that travel with the rollout: a 7+ word is still auto-played.
  const auto = decide("Q", "RETAINS", 40, 100).words;
  assert.equal(auto.length, 1);
  assert.equal(auto[0]!.length, 7); // the anagram class of RETAINS is played under its canonical word
});

test("rolloutMinPlayers: the rollout is used only at tables with enough active players", () => {
  const R = { rolloutBid: 1, rolloutSamples: 8, rolloutHorizon: 66, rackCap: 11, cashBelow: 8, lateCashLen: 5, lateCashWindow: 12, finalPackWindow: 3 };
  const bidAt = (n: number, params: Record<string, number>) => {
    const a = new Agent({ ...FINAL, ...params }, "gate");
    a.onMatchStart({ seat: 0, nPlayers: n, names: Array.from({ length: n }, (_, i) => "p" + i), simStrategies: Array(n).fill(null),
      auctionType: "Vickrey", rack: countsOf("RETAI"), seed: 5, offline: Array(n).fill(false) });
    return a.onAuction({ ...view(n, "Z"), rack: countsOf("RETAI"), round: 1, bagTotal: 98 - 5 * n - 1, balances: Array(n).fill(100), scores: Array(n).fill(0) }).bid;
  };
  assert.equal(bidAt(2, R), bidAt(2, { ...R, rolloutBid: 0 })); // duel: static valuation and leader tax, as shipped
  {
    // Duel, late in the match with a 5-letter word on the rack: the rollout's late-cash rule must stay off too.
    const words = (params: Record<string, number>) => {
      const a = new Agent({ ...FINAL, ...params }, "gate-words");
      a.onMatchStart({ seat: 0, nPlayers: 2, names: ["p0", "p1"], simStrategies: [null, null], auctionType: "Vickrey", rack: countsOf("RETAI"), seed: 5, offline: [false, false] });
      return a.onAuction({ ...view(2, "Z"), rack: countsOf("RETAIN"), round: 80, bagTotal: 8, balances: [100, 100], scores: [0, 0] }).words;
    };
    assert.deepEqual(words(R), words({})); // same as the shipped defaults
    assert.deepEqual(words(R), []);
    assert.deepEqual(words({ ...R, rolloutBid: 0 }), ["RATINE"]); // the word rules alone, ungated, would cash here
  }
  assert.notEqual(bidAt(6, R), bidAt(6, { ...R, rolloutBid: 0 })); // six players: the rollout decides
  assert.notEqual(bidAt(2, { ...R, rolloutMinPlayers: 2 }), bidAt(2, { ...R, rolloutBid: 0 })); // gate lowered: rollout in duels too
});

test("cash threshold holds a cheap 7 while rich and cashes it as money runs out; late all-in stays affordable", () => {
  const words = (params: Record<string, number>, balance: number, bagTotal = 40) => {
    const a = new Agent({ ...FINAL, ...params, samples: 8 }, "thresh");
    start(a, 6, [null, null, null, null, null, null], "Vickrey");
    return a.onAuction({ ...view(6, "Q"), rack: countsOf("RETAINS"), bagTotal, balances: [balance, 100, 100, 100, 100, 100] }).words;
  };
  const T = { cashThreshA: 28, cashThreshB: 0.63 };
  assert.equal(words({}, 100).length, 1); // shipped: play the 7 at once
  assert.deepEqual(words(T, 100), []); // a ~27-point 7 < 28 + 63: hold while rich
  assert.equal(words({ ...T, cashThreshA: 1, cashThreshB: 0 }, 100).length, 1); // a low bar plays it
  assert.equal(words(T, 100, 2).length, 1); // too late to hold
  const bid = (params: Record<string, number>, letter: string, bagTotal: number, balance: number) => {
    const a = new Agent({ ...FINAL, ...params, samples: 8 }, "allin");
    start(a, 6, [null, null, null, null, null, null], "Vickrey");
    return a.onAuction({ ...view(6, letter), rack: countsOf("RETAI"), bagTotal, balances: [balance, 100, 100, 100, 100, 100] }).bid;
  };
  assert.equal(bid({ lateAllIn: 6 }, "N", 3, 37), 37); // RETAIN is a word: worth everything late
  assert.equal(bid({ lateAllIn: 6 }, "N", 0, 37), 0); // never on the final auction
  assert.ok(bid({ lateAllIn: 6 }, "N", 30, 37) < 37); // not before the window
});

test("Dante opening: consonant floors early, cheap-letter cap, completion floor; all affordable", () => {
  const bid = (params: Record<string, number>, letter: string, rack: string, bagTotal: number, balance = 100) => {
    const a = new Agent({ ...FINAL, ...params, samples: 8 }, "dante");
    start(a, 6, [null, null, null, null, null, null], "Vickrey");
    return a.onAuction({ ...view(6, letter), rack: countsOf(rack), bagTotal, balances: [balance, 100, 100, 100, 100, 100] }).bid;
  };
  const D = { consonantFloor3: 20, consonantFloor4: 25 };
  assert.ok(bid(D, "H", "AEIOU", 60) >= 25); // early strong consonant
  assert.ok(bid(D, "B", "AEIOU", 60) >= 20);
  assert.ok(bid(D, "H", "AEIOUH", 60) >= 21 && bid(D, "H", "AEIOUH", 60) <= Math.max(21, bid({}, "H", "AEIOUH", 60))); // duplicate: floor 25 - 4
  assert.equal(bid(D, "H", "AEIOU", 20), bid({}, "H", "AEIOU", 20)); // not after the opening
  assert.ok(bid(D, "H", "AEIOU", 60, 12) <= 12); // never above balance
  assert.ok(bid({ completionFloor: 20 }, "S", "RETAIN", 40) >= 20); // completes RETAINS
  assert.ok(bid({ cheapCap: 12 }, "E", "QZXJV", 40) <= 12);
  assert.equal(bid({ ...D, completionFloor: 20, cheapCap: 12 }, "H", "AEIOU", 0), 0); // final auction
});
