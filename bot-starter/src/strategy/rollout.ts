// Rollout valuation (off by default, `rolloutBid`): how many coins is this
// letter worth right now, measured by playing the rest of the match out.
//
// For each sampled future (the next H auction letters drawn from the unseen
// pool, and a highest-rival-bid price for each from the public archive's
// per-letter, per-third distribution), a hand-written "future me" plays the
// match out twice from the same future: once having passed on this letter,
// once having won it at price p, for a grid of prices p. The averaged gain
// curve D(p) = score(win at p) - score(pass) crosses zero at the break-even
// price, which is the Vickrey bid. Both branches share letters, prices and
// random draws, so the difference is far less noisy than two independent
// runs. Coins left when the match ends are worth nothing, as in the game.
//
// The estimate is only as good as "future me": it buys with a simple
// face-value-plus-completion rule and cashes words by the same rules the
// live bot uses when this valuation is on (rackCap, cashBelow, lateCash,
// finalPackWindow), so coins saved by passing are spent the way the bot
// would spend them.

import type { WordIndex } from "../game/dictionary.ts";
import { type Counts, LETTER_VALUES, N_LETTERS, VOWELS } from "../game/letters.ts";
import type { Rng } from "../game/rng.ts";
import { RIVAL_PRICES, RIVAL_PRICE_QUANTILES } from "./rival-prices.ts";

export interface RolloutSettings {
  samples: number;
  /** Future auctions played out per sample (the rest are valued by a terminal rule). */
  horizon: number;
  /** Price grid points between 1 and the balance (besides those two). */
  grid: number;
  /** Multiplier on future me's bids. */
  bidScale: number;
  /** Balance at which future me's pacing factor is 1 (linear below, capped above). */
  pace: number;
  /**
   * Share of future auctions future me aims to win: it bids the price
   * quantile that wins that often, raised for letters that fit its rack
   * (usefulness) and for letters that complete a 7+ letter word.
   */
  share: number;
  /** Multiplier on sampled rival prices (sensitivity). */
  priceScale: number;
  cashBelow: number;
  rackCap: number;
  lateLen: number;
  lateWindow: number;
  packWindow: number;
  /** Points per coin left when the horizon ends before the match does. */
  terminalCoin: number;
}

export interface RolloutState {
  idx: WordIndex;
  rng: Rng;
  /** Unseen pool, with the current letter already removed. */
  unseen: Counts;
  rack: Counts;
  balance: number;
  letter: number;
  /** Usable auctions after this one (the final auction's tile is unplayable). */
  auctionsLeft: number;
  /** Index of this auction (0-based) and the total, for the price model's thirds. */
  round: number;
  totalAuctions: number;
  /** How much each letter advances the current rack toward 7-8 letter words (Agent.letterUsefulness). */
  usefulness: readonly number[];
}

export interface RolloutResult {
  bid: number;
  /** The price grid and the mean gain of winning at each price. */
  grid: number[];
  gain: number[];
}

function stage(round: number, total: number): number {
  return Math.min(2, Math.floor((3 * round) / Math.max(1, total)));
}

/** A price drawn from the frozen quantiles by inverse transform with linear interpolation. */
export function samplePrice(letter: number, st: number, u: number, scale: number): number {
  const q = RIVAL_PRICES[st]![letter]!;
  const qs = RIVAL_PRICE_QUANTILES;
  let price: number;
  if (u <= qs[0]!) price = q[0]!;
  else if (u >= qs[qs.length - 1]!) price = q[q.length - 1]!;
  else {
    let i = 1;
    while (qs[i]! < u) i++;
    const f = (u - qs[i - 1]!) / (qs[i]! - qs[i - 1]!);
    price = q[i - 1]! + f * (q[i]! - q[i - 1]!);
  }
  return Math.max(1, Math.round(price * scale));
}

export function priceQuantile(letter: number, st: number, p: number): number {
  const q = RIVAL_PRICES[st]![letter]!;
  const qs = RIVAL_PRICE_QUANTILES;
  for (let i = 0; i < qs.length; i++) if (qs[i]! >= p) return q[i]!;
  return q[q.length - 1]!;
}

function tiles(rack: Counts): number {
  let n = 0;
  for (let c = 0; c < N_LETTERS; c++) n += rack[c]!;
  return n;
}

function vowels(rack: Counts): number {
  let n = 0;
  for (let c = 0; c < N_LETTERS; c++) if (VOWELS[c]) n += rack[c]!;
  return n;
}

/**
 * Plays one future out from a given rack and balance. `letters[i]` and
 * `prices[i]` describe future auction i; `left` counts usable auctions
 * including those. Returns the points scored during the rollout plus the
 * terminal value.
 */
function playOut(s: RolloutSettings, idx: WordIndex, rack: Counts, balance: number, letters: number[], prices: number[], left: number, endsInHorizon: boolean,
  shareOf: readonly number[], round: number, total: number): number {
  let score = 0;
  const play = (sig: number) => {
    const r = idx.sigReward[sig]!;
    idx.subtract(rack, sig);
    score += r;
    balance += r;
  };
  const playAll = () => {
    for (;;) {
      const sig = idx.bestRewardSig(rack, 2);
      if (sig === -1) break;
      play(sig);
    }
  };
  const words = (remaining: number) => {
    for (;;) {
      const sig = idx.bestRewardSig(rack, 7);
      if (sig === -1) break;
      play(sig);
    }
    if (remaining <= s.packWindow) {
      playAll();
      return;
    }
    if (s.rackCap > 0 && tiles(rack) >= s.rackCap) playAll();
    if (s.lateLen > 0 && remaining <= s.lateWindow) {
      for (;;) {
        const sig = idx.bestRewardSig(rack, s.lateLen);
        if (sig === -1) break;
        play(sig);
      }
    }
    if (s.cashBelow > 0 && balance < s.cashBelow) {
      const sig = idx.bestRewardSig(rack, 2);
      if (sig !== -1) play(sig);
    }
  };
  for (let i = 0; i < letters.length; i++) {
    const remaining = left - i;
    words(remaining);
    const l = letters[i]!;
    const price = prices[i]!;
    if (price > balance) continue;
    // Completion gain: the best 7+ word this letter would make right now.
    rack[l]!++;
    const sig7 = idx.bestRewardSig(rack, 7);
    rack[l]!--;
    const gain = sig7 === -1 ? 0 : idx.sigReward[sig7]!;
    // Future me buys each letter with a probability set by how well it fits
    // (its usefulness share), paced by its balance, by bidding the price
    // quantile that wins that often; a completing letter is worth its word.
    const pacing = Math.min(1.3, Math.max(0.3, balance / s.pace));
    const v = vowels(rack);
    const t = tiles(rack);
    const vowelAdj = VOWELS[l] ? (v < 2 ? 1.5 : 2 * v > t + 1 ? 0.5 : 1) : v === 0 && t >= 3 ? 0.7 : 1;
    const want = Math.min(0.7, Math.max(0.03, shareOf[l]! * pacing * vowelAdj));
    let bid = priceQuantile(l, stage(round + i + 1, total), want) * s.priceScale * s.bidScale;
    if (gain > 0) bid = Math.max(bid, 1.2 * gain * Math.min(1, pacing + 0.3));
    if (bid > price) {
      rack[l]!++;
      balance -= price;
    }
  }
  if (endsInHorizon) {
    playAll();
    return score;
  }
  // The match goes on past the horizon: the rack keeps its best packing and
  // the coins keep some buying power.
  return score + idx.greedyPartition(rack, 2).reward + s.terminalCoin * balance;
}

export function rolloutBid(st: RolloutState, s: RolloutSettings): RolloutResult {
  const { idx, rng } = st;
  const H = Math.max(0, Math.min(s.horizon, st.auctionsLeft));
  const endsInHorizon = H >= st.auctionsLeft;
  const stageNow = stage(st.round, st.totalAuctions);
  // Price grid for this letter: 1, the archive's quantiles, the balance.
  const gridSet = new Set<number>([1, st.balance]);
  const probs = [0.1, 0.25, 0.5, 0.75, 0.9, 0.95];
  for (let i = 0; i < Math.min(s.grid, probs.length); i++) {
    const p = Math.round(priceQuantile(st.letter, stageNow, probs[i]!) * s.priceScale);
    if (p >= 1 && p <= st.balance) gridSet.add(p);
  }
  const grid = [...gridSet].sort((a, b) => a - b);
  const gain = new Array<number>(grid.length).fill(0);
  // Future me's target win share per letter: the overall share, scaled by
  // usefulness relative to the average useful letter (letters with no use
  // toward long words are still bought occasionally for short words).
  let uSum = 0;
  let uN = 0;
  for (let c = 0; c < N_LETTERS; c++) if (st.usefulness[c]! > 0) { uSum += st.usefulness[c]!; uN++; }
  const uMean = uN > 0 ? uSum / uN : 1;
  const shareOf = new Array<number>(N_LETTERS);
  for (let c = 0; c < N_LETTERS; c++) shareOf[c] = s.share * Math.min(2.5, Math.max(0.25, st.usefulness[c]! / uMean));
  const pool: number[] = [];
  for (let c = 0; c < N_LETTERS; c++) for (let j = 0; j < st.unseen[c]!; j++) pool.push(c);
  const letters = new Array<number>(H);
  const prices = new Array<number>(H);
  for (let k = 0; k < s.samples; k++) {
    // Partial Fisher-Yates: the next H letters of this future.
    for (let i = 0; i < H && i < pool.length; i++) {
      const j = i + rng.int(pool.length - i);
      const tmp = pool[i]!;
      pool[i] = pool[j]!;
      pool[j] = tmp;
      letters[i] = pool[i]!;
      prices[i] = samplePrice(pool[i]!, stage(st.round + 1 + i, st.totalAuctions), rng.next(), s.priceScale);
    }
    const n = Math.min(H, pool.length);
    const ls = letters.slice(0, n);
    const ps = prices.slice(0, n);
    const pass = playOut(s, idx, st.rack.slice(), st.balance, ls, ps, st.auctionsLeft, endsInHorizon, shareOf, st.round, st.totalAuctions);
    for (let g = 0; g < grid.length; g++) {
      const rack = st.rack.slice();
      rack[st.letter]!++;
      gain[g]! += playOut(s, idx, rack, st.balance - grid[g]!, ls, ps, st.auctionsLeft, endsInHorizon, shareOf, st.round, st.totalAuctions) - pass;
    }
  }
  for (let g = 0; g < grid.length; g++) gain[g]! /= Math.max(1, s.samples);
  // Break-even: the largest price at which winning still gains, interpolated.
  let bid = 0;
  if (gain[0]! > 0) {
    bid = grid[grid.length - 1]!;
    for (let g = 1; g < grid.length; g++) {
      if (gain[g]! < 0) {
        const a = gain[g - 1]!;
        const b = gain[g]!;
        bid = grid[g - 1]! + ((grid[g]! - grid[g - 1]!) * a) / (a - b);
        break;
      }
    }
  }
  return { bid: Math.max(0, Math.min(st.balance, Math.floor(bid))), grid, gain };
}
