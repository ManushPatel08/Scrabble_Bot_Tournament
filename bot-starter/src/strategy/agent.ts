// The ScrabbleBot strategy. One Agent per match; it implements the Policy
// interface used by both the live client and the simulator.
//
// Per auction:
//  1. update the tracker (unseen pool, opponents' racks, prices)
//  2. sample S possible futures F_s = the letters we may still win, drawn
//     from the unseen pool (common random numbers for every comparison
//     below)
//  3. chooseWords: play words now when the money is worth more than the
//     flexibility lost by committing the letters (the final auction plays
//     out the optimal partition of the whole rack)
//  4. decideBid: marginal value of the letter in score points
//     v = mean_s [G(R+L+F_s) - G(R+F_s)]   (G = greedy word-set value)
//     converted to currency with the shadow price of money mu, then
//     adjusted for the payment rule (Vickrey: bid value; first-price: best
//     response to predicted sim bids and the observed external bids)

import { type WordIndex, sharedIndex } from "../game/dictionary.ts";
import {
  BAG_DISTRIBUTION,
  type Counts,
  LETTER_VALUES,
  N_LETTERS,
  VOWELS,
  letterIndex,
  wordReward,
} from "../game/letters.ts";
import { Rng } from "../game/rng.ts";
import type {
  AuctionOutcome,
  AuctionView,
  Decision,
  MatchStart,
  Policy,
  WordPlayed,
} from "../game/types.ts";
import { type Params, withParams } from "./params.ts";
import { MatchTracker } from "./tracker.ts";
import { HISTORICAL_WIN_PRICES, HISTORICAL_WIN_WEIGHTS } from "./market-prices.ts";
import { priceQuantile, rolloutBid } from "./rollout.ts";

let letterWeights: number[] | null = null;

/** Share of each letter in 7-8 letter words divided by its share of the bag. */
function wordLetterWeights(idx: WordIndex): number[] {
  if (letterWeights) return letterWeights;
  const inWords = new Array<number>(N_LETTERS).fill(0);
  let total = 0;
  for (let s = 0; s < idx.nSigs; s++) {
    const len = idx.sigLen[s]!;
    if (len < 7 || len > 8) continue;
    for (let c = 0; c < N_LETTERS; c++) inWords[c]! += idx.sigCounts[s * N_LETTERS + c]!;
    total += len;
  }
  letterWeights = inWords.map((n, c) => Math.max(0.05, n / total / (BAG_DISTRIBUTION[c]! / 98)));
  return letterWeights;
}

function rackKey(r: Counts): string {
  return String.fromCharCode(...r);
}

/** How far a sim's bid wanders either side of its base (game.ts:697-699). */
export const SIM_BID_JITTER = 2;

/**
 * A sim's bid with a given jitter (game.ts:703-727): base + jitter, floored
 * at 1, capped at balance. Strategy and balance are public (`bot.strategy`,
 * `matchParticipant.balance`); only the jitter, uniform in [-2, 2], is not.
 */
export function predictSimBid(strategy: string, letter: number, balance: number, jitter = 0): number {
  const value = LETTER_VALUES[letter]!;
  let base: number;
  if (strategy === "Cheapskate") base = value - 1;
  else if (strategy === "ValueBidder") base = value;
  else base = value + (VOWELS[letter] ? 4 : 2);
  return Math.max(Math.min(Math.max(base + jitter, 1), balance), 0);
}

/**
 * P(our first-price bid b beats every sim), over the sims' jitter. Equal
 * bids are resolved at random (game.ts:485-488), so a tie counts half.
 */
export function simBeatProb(sims: readonly { strategy: string; balance: number }[], letter: number, b: number): number {
  let p = 1;
  for (const sim of sims) {
    let q = 0;
    for (let j = -SIM_BID_JITTER; j <= SIM_BID_JITTER; j++) {
      const v = predictSimBid(sim.strategy, letter, sim.balance, j);
      q += v <= 0 || v < b ? 1 : v === b ? 0.5 : 0;
    }
    p *= q / (2 * SIM_BID_JITTER + 1);
  }
  return p;
}

export interface Timing {
  wordMs: number;
  bidMs: number;
}

export class Agent implements Policy {
  readonly name: string;
  readonly p: Params;
  readonly t = new MatchTracker();
  private idx: WordIndex;
  private rng = new Rng(1);
  private futures: Counts[] = [];
  private valuationBag = 0;
  private partitionValues = new Map<string, number>();
  /** Market model: our value for each auctioned letter and the price it took. */
  private market: { v: number; p: number }[] = [];
  private lastValue = -1;
  private lastBid = 0;
  /** Adaptive pacing state: log multiplier on mu, and this round's budget target. */
  private logPace = 0;
  private paceTarget = 0;
  /** Wall time of the last chooseWords / decideBid calls. */
  timing: Timing = { wordMs: 0, bidMs: 0 };
  /** Rack after this round's plays (what we hold if we lose the auction). */
  private lastRack: Counts | null = null;
  /** Precomputed by prepareNext() for the next round (live only). */
  private prepared: { key: string; futures: Counts[]; values: number[] | null; partition: string[] | null } | null =
    null;
  /** Letter values valid for this round's futures and the rack with this key. */
  private valueCache: { key: string; values: number[] } | null = null;

  constructor(params: Partial<Params> = {}, name = "agent", index?: WordIndex) {
    this.p = withParams(params);
    this.name = name;
    this.idx = index ?? sharedIndex();
  }

  onMatchStart(m: MatchStart): void {
    this.t.start(m);
    this.rng = new Rng(m.seed);
    this.logPace = 0;
    this.paceTarget = 0;
    this.lastRack = null;
    this.market = [];
    this.lastValue = -1;
    this.lastBid = 0;
    this.prepared = null;
    this.valueCache = null;
    this.lastBalances = null;
  }

  onAuctionResult(r: AuctionOutcome): void {
    this.t.result(r);
    if (this.lastValue >= 0) {
      // Price we would have had to pay for this letter.
      let price: number;
      if (r.winner === null) price = 1;
      else if (r.winner === this.t.seat) price = Math.max(1, r.paid);
      else if (this.t.auctionType === "Vickrey")
        price =
          this.p.marketLossMult > 1
            ? Math.max(Math.round(r.paid * this.p.marketLossMult), this.lastBid + 1)
            : Math.max(r.paid, this.lastBid) + 1;
      else price = r.paid + 1;
      this.market.push({ v: this.lastValue, p: price });
      this.lastValue = -1;
    }
    // Pacing: nudge mu up when we spend faster than balance/remaining
    // auctions, down when slower, so the money runs out near the end.
    if (this.p.paceRate > 0 && this.paceTarget > 0) {
      const spend = r.winner === this.t.seat ? r.paid : 0;
      this.logPace += (this.p.paceRate * (spend - this.paceTarget)) / Math.max(1, this.paceTarget);
      this.logPace = Math.max(-3, Math.min(3, this.logPace));
    }
  }

  onWordPlayed(w: WordPlayed): void {
    this.t.word(w);
  }

  onAuction(v: AuctionView): Decision {
    const t = this.t;
    t.openAuction(v.round, v.letter, v.bagTotal);
    const rack = v.rack.slice();
    const balances = v.balances.slice();
    this.lastBalances = balances;
    const key = rackKey(rack);
    const prep = this.prepared;
    this.prepared = null;
    this.valueCache = null;
    if (prep && prep.key === key) {
      // Rack unchanged since prepareNext(): reuse its futures and values.
      this.futures = prep.futures;
      this.evMemo.clear();
      if (prep.values) this.valueCache = { key, values: prep.values };
      this.preparedPartition = prep.partition;
    } else {
      this.sampleFutures(rack);
      this.preparedPartition = null;
    }

    let t0 = performance.now();
    const words = this.chooseWords(rack, balances);
    this.timing.wordMs = performance.now() - t0;

    t0 = performance.now();
    const usable = t.isFinalAuction() ? 0 : t.usableFutureAuctions() + 1;
    this.paceTarget = usable > 0 ? balances[t.seat]! / usable : 0;
    const bid = this.decideBid(letterIndex(v.letter), rack, balances, v.scores);
    this.timing.bidMs = performance.now() - t0;

    t.noteMyBid(bid);
    this.lastBid = bid;
    this.lastRack = rack;
    return { words, bid };
  }

  private preparedPartition: string[] | null = null;

  /**
   * Live client calls this after submitting its bid, using the idle part of
   * the 1 s window: samples next round's futures and values every possible
   * next letter for the rack we keep if we lose, and precomputes the final
   * play-out when the next auction is the last one. The next onAuction then
   * only does lookups when the rack hasn't changed.
   */
  prepareNext(): void {
    for (const _ of this.prepareSteps()) {
      // run to completion (simulator, latency harness)
    }
  }

  /**
   * prepareNext() in slices: yields after each unit of work (one letter's
   * value) so the live client can hand the event loop back to incoming
   * messages, and drop the rest if the next auction arrives first. The
   * result is stored only once every slice has run. On 2026-10-23 the
   * single-block version (p99 ~0.4 s, longer under load) held up the next
   * auction's message long enough for bids to arrive after it closed.
   */
  *prepareSteps(): Generator<void, void, void> {
    const t = this.t;
    if (!this.lastRack || t.isFinalAuction()) return;
    const rack = this.lastRack.slice();
    const nextIsFinal = t.bagTotal === 1;
    const savedBag = t.bagTotal;
    // Pretend one more tile has been drawn so futureCount() sees next round.
    t.bagTotal -= 1;
    this.sampleFutures(rack);
    t.bagTotal = savedBag;
    const futures = this.futures;
    yield;
    let values: number[] | null = null;
    if (!nextIsFinal && this.p.mcValuation) {
      const base = this.expectedValue(rack);
      yield;
      values = new Array<number>(N_LETTERS);
      for (let c = 0; c < N_LETTERS; c++) {
        rack[c]!++;
        values[c] = Math.max(0, this.expectedValue(rack) - base);
        rack[c]!--;
        yield;
      }
    }
    const partition = nextIsFinal ? this.idx.bestPartition(rack, 2, 300_000, 250).words : null;
    this.prepared = { key: rackKey(rack), futures, values, partition };
  }

  // ---------------------------------------------------------------- futures

  /** Expected share of future auctions we win. */
  winShare(): number {
    const t = this.t;
    const done = t.history.length;
    const active = t.activeN();
    let prior = this.p.winPriorScale && active > 6 ? (this.p.winPrior * 6) / active : this.p.winPrior;
    if (this.p.priorByRivals > 0) {
      let rivals = 0;
      for (let j = 0; j < t.n; j++) if (j !== t.seat && !t.inactive(j) && !t.sims[j]) rivals++;
      prior = Math.min(0.9, this.p.priorByRivals / (1 + rivals));
    }
    const recent = this.p.winHistoryWindow > 0 ? t.history.slice(-Math.max(1, Math.floor(this.p.winHistoryWindow))) : null;
    const wins = recent ? recent.filter((h) => h.winner === t.seat).length : t.wins[t.seat]!;
    const observations = recent ? recent.length : done;
    const hist = (wins + prior * this.p.winPriorWeight) / (observations + this.p.winPriorWeight);
    const w = this.p.moneyShareWeight;
    const bal = this.lastBalances;
    if (!w || !bal) return hist;
    // Our share of the money held by the bots that compete for letters (sims
    // bid by formula and rarely contest a wanted letter).
    let mine = 0;
    let all = 0;
    for (let j = 0; j < t.n; j++) {
      if (t.inactive(j) || (j !== t.seat && t.sims[j])) continue;
      const b = Math.max(0, bal[j] ?? 0);
      all += b;
      if (j === t.seat) mine = b;
    }
    return all > 0 ? hist + w * (mine / all - hist) : hist;
  }

  /** Balances at the last auction we saw (for winShare's money share). */
  private lastBalances: readonly number[] | null = null;

  /** Number of future letters per sample. */
  futureCount(): number {
    const k = Math.round(this.t.usableFutureAuctions() * this.winShare());
    return Math.max(0, Math.min(this.p.horizonCap, k, this.affordableLetters()));
  }

  /** Median price paid in this match so far (12 until 5 prices are known). */
  private medianPrice(): number {
    const paid = this.t.history.filter((h) => h.winner !== null && h.paid > 0).map((h) => h.paid).sort((a, b) => a - b);
    return paid.length >= 5 ? paid[paid.length >> 1]! : 12;
  }

  /**
   * futureAffordable: future letters our balance can buy at the match's
   * median price (Infinity when off). Monte Carlo futures are free letters,
   * so without this cap a broke bot still values its rack as if it will keep
   * winning auctions.
   */
  private affordableLetters(): number {
    if (!(this.p.futureAffordable > 0)) return Infinity;
    const balance = Math.max(0, this.lastBalances?.[this.t.seat] ?? 100);
    return Math.max(0, Math.round((this.p.futureAffordable * balance) / Math.max(1, this.medianPrice())));
  }

  /**
   * rolloutPriceAdapt: this match's price level relative to the archive,
   * from the prices paid so far against the archive medians of the same
   * letters (1 when off or fewer than 5 prices are known).
   */
  private rolloutPriceLevel(): number {
    const w = this.p.rolloutPriceAdapt;
    if (!(w > 0)) return 1;
    const t = this.t;
    const total = t.totalAuctions();
    let paid = 0;
    let expected = 0;
    let n = 0;
    t.history.forEach((h, i) => {
      if (h.winner === null || h.paid <= 0) return;
      paid += h.paid * 1.3;
      expected += priceQuantile(h.letter, Math.min(2, Math.floor((3 * i) / Math.max(1, total))), 0.5);
      n++;
    });
    if (n < 5 || expected <= 0) return 1;
    const ratio = Math.min(1.4, Math.max(0.7, paid / expected));
    return 1 + w * (ratio - 1);
  }

  /**
   * The rollout valuation decides at this table (enough active players).
   * Its word rules (finalPackWindow, lateCash, rackCap) follow the same
   * gate, since they were tuned with it and hurt on their own.
   */
  rolloutActive(): boolean {
    return this.p.rolloutBid > 0 && this.t.activeN() >= this.p.rolloutMinPlayers;
  }

  /** Unseen tiles that would give the rack an 8+ letter word (per-rack cache). */
  private extendCache: { key: string; bag: number; n: number } | null = null;

  extendingTiles(rack: Counts): number {
    const key = rackKey(rack);
    if (this.extendCache && this.extendCache.key === key && this.extendCache.bag === this.t.bagTotal) return this.extendCache.n;
    const whole = rack.slice();
    let n = 0;
    for (let c = 0; c < N_LETTERS; c++) {
      const left = this.t.unseen[c]!;
      if (left <= 0) continue;
      whole[c]!++;
      if (this.idx.bestRewardSig(whole, 8) !== -1) n += left;
      whole[c]!--;
    }
    this.extendCache = { key, bag: this.t.bagTotal, n };
    return n;
  }

  /** Per-rack cache of letterUsefulness(). */
  private usefulCache: { key: string; u: number[] } | null = null;

  /**
   * How much each letter advances the rack toward 7-8 letter words: for
   * every such word, its reward x decay^(letters still missing), shared out
   * over the missing letters. Used only to rank candidate future letters.
   */
  letterUsefulness(rack: Counts): number[] {
    const key = rackKey(rack);
    if (this.usefulCache?.key === key) return this.usefulCache.u;
    const idx = this.idx;
    const u = new Array<number>(N_LETTERS).fill(0);
    const decay = this.p.futureSelectDecay;
    for (let s = 0; s < idx.nSigs; s++) {
      const len = idx.sigLen[s]!;
      if (len < 7 || len > 8) continue;
      const base = s * N_LETTERS;
      let have = 0;
      for (let c = 0; c < N_LETTERS; c++) {
        const need = idx.sigCounts[base + c]!;
        if (need) have += Math.min(need, rack[c]!);
      }
      const missing = len - have;
      if (missing === 0 || missing > 6) continue;
      const w = (idx.sigReward[s]! * Math.pow(decay, missing)) / missing;
      for (let c = 0; c < N_LETTERS; c++) {
        const short = idx.sigCounts[base + c]! - rack[c]!;
        if (short > 0) u[c]! += w * short;
      }
    }
    this.usefulCache = { key, u };
    return u;
  }

  private sampleFutures(rack: Counts): void {
    const t = this.t;
    this.evMemo.clear();
    this.partitionValues.clear();
    this.valuationBag = t.bagTotal;
    const k = this.futureCount();
    const pool: number[] = [];
    // Without tracking, assume future tiles follow the full starting bag.
    const src = this.p.trackBag === 0 ? BAG_DISTRIBUTION : t.unseen;
    for (let c = 0; c < N_LETTERS; c++) for (let j = 0; j < src[c]!; j++) pool.push(c);
    const kk = Math.min(k, pool.length);
    const noise = Math.max(0, Math.min(1, this.p.futureCountNoise));
    const share = this.winShare();
    const auctions = t.usableFutureAuctions();
    const affordable = this.affordableLetters();
    const sampleSize = () => {
      let wins = 0;
      for (let i = 0; i < auctions; i++) if (this.rng.next() < share) wins++;
      return Math.max(0, Math.min(this.p.horizonCap, pool.length, affordable, Math.round((1 - noise) * k + noise * wins)));
    };
    this.futures = [];
    if (this.p.futureSelect > 1 && this.p.futureBias === 0 && this.p.futureWinBias === 0) {
      // We win the auctions we value most: draw more candidate letters than
      // we expect to win (never more than the auctions left) and keep the
      // most useful ones. Ties break by draw order, which is random.
      const useful = this.letterUsefulness(rack);
      const order: number[] = [];
      for (let s = 0; s < this.p.samples; s++) {
        const size = noise > 0 ? sampleSize() : kk;
        const seen = Math.min(Math.round(this.p.futureSelect * size), Math.max(auctions, size));
        const draw = Math.min(pool.length, Math.max(size, seen));
        for (let i = 0; i < draw; i++) {
          const j = i + this.rng.int(pool.length - i);
          const tmp = pool[i]!;
          pool[i] = pool[j]!;
          pool[j] = tmp;
        }
        order.length = 0;
        for (let i = 0; i < draw; i++) order.push(i);
        order.sort((a, b) => useful[pool[b]!]! - useful[pool[a]!]! || a - b);
        const f = new Array<number>(N_LETTERS).fill(0);
        for (let i = 0; i < size; i++) f[pool[order[i]!]!]!++;
        this.futures.push(f);
      }
      return;
    }
    if (this.p.futureBias > 0 || this.p.futureWinBias > 0) {
      // Weighted sampling without replacement (Efraimidis-Spirakis keys).
      const w = wordLetterWeights(this.idx);
      const weights = w.map((weight, c) => Math.pow(weight, this.p.futureBias) *
        Math.pow(HISTORICAL_WIN_WEIGHTS[c]!, this.p.futureWinBias));
      const keys = new Array<number>(pool.length);
      const order = pool.map((_, i) => i);
      for (let s = 0; s < this.p.samples; s++) {
        const size = noise > 0 ? sampleSize() : kk;
        for (let i = 0; i < pool.length; i++) keys[i] = Math.pow(this.rng.next(), 1 / weights[pool[i]!]!);
        order.sort((a, b) => keys[b]! - keys[a]!);
        const f = new Array<number>(N_LETTERS).fill(0);
        for (let i = 0; i < size; i++) f[pool[order[i]!]!]!++;
        this.futures.push(f);
      }
      return;
    }
    for (let s = 0; s < this.p.samples; s++) {
      const f = new Array<number>(N_LETTERS).fill(0);
      const size = noise > 0 ? sampleSize() : kk;
      for (let i = 0; i < size; i++) {
        const j = i + this.rng.int(pool.length - i);
        const tmp = pool[i]!;
        pool[i] = pool[j]!;
        pool[j] = tmp;
        f[pool[i]!]!++;
      }
      this.futures.push(f);
    }
  }

  /** Per-round memo of expectedValue by rack (futures are fixed within a round). */
  private evMemo = new Map<string, number>();

  /** Mean over futures of the greedy word-set value of rack + future. */
  private expectedValue(rack: Counts): number {
    const key = rackKey(rack);
    const hit = this.evMemo.get(key);
    if (hit !== undefined) return hit;
    const v = this.computeExpectedValue(rack);
    this.evMemo.set(key, v);
    return v;
  }

  private computeExpectedValue(rack: Counts): number {
    let sum = 0;
    const r = new Array<number>(N_LETTERS);
    for (const f of this.futures) {
      for (let c = 0; c < N_LETTERS; c++) r[c] = rack[c]! + f[c]!;
      if (this.p.endgameExact > 0 && this.valuationBag <= this.p.endgameExact) {
        const key = rackKey(r);
        let value = this.partitionValues.get(key);
        if (value === undefined) {
          value = this.idx.bestPartition(r, 2, 20_000, 10).reward;
          this.partitionValues.set(key, value);
        }
        sum += value;
      } else if (this.p.valuationBranches > 0) {
        const key = rackKey(r);
        let value = this.partitionValues.get(key);
        if (value === undefined) {
          value = this.idx.lookaheadValue(r, this.p.valuationBranches);
          this.partitionValues.set(key, value);
        }
        sum += value;
      } else sum += this.idx.greedyValue(r, 2);
    }
    return this.futures.length ? sum / this.futures.length : this.idx.greedyValue(rack, 2);
  }

  /** Marginal score value of adding `letter` to `rack`. */
  letterValue(letter: number, rack: Counts): number {
    if (this.t.isFinalAuction()) return 0; // can never be played (lib.rs:2231-2244)
    if (!this.p.mcValuation) return this.p.faceMult * LETTER_VALUES[letter]! + this.p.faceAdd;
    let future: number;
    if (this.valueCache && this.valueCache.key === rackKey(rack)) future = this.valueCache.values[letter]!;
    else {
      const base = this.expectedValue(rack);
      rack[letter]!++;
      const withL = this.expectedValue(rack);
      rack[letter]!--;
      future = Math.max(0, withL - base);
    }
    const weight = Math.max(0, Math.min(1, this.p.immediateValueWeight));
    if (weight === 0) return future;
    const before = this.idx.greedyValue(rack, 2);
    rack[letter]!++;
    const now = Math.max(0, this.idx.greedyValue(rack, 2) - before);
    rack[letter]!--;
    return (1 - weight) * future + weight * now;
  }

  // ------------------------------------------------------------------ money

  /** Shadow price of money in score points per unit of currency. */
  mu(balance: number): number {
    const formula = this.formulaMu(balance);
    if (this.p.moneyModel !== 1) return formula;
    const t = this.t;
    const m = t.isFinalAuction() ? 0 : t.usableFutureAuctions() + 1;
    const w = this.market.slice(-this.p.marketWindow);
    if (m === 0 || w.length === 0) return formula;
    // Buy the best value-per-price letters until the balance is spent.
    w.sort((a, b) => b.v / b.p - a.v / a.p);
    let cum = 0;
    let threshold = 0.02; // never binding: money is nearly worthless
    for (const x of w) {
      cum += x.p;
      if ((m * cum) / w.length >= balance) {
        threshold = Math.max(0.02, x.v / x.p);
        break;
      }
    }
    return (w.length * threshold + this.p.marketPrior * formula) / (w.length + this.p.marketPrior);
  }

  private formulaMu(balance: number): number {
    const t = this.t;
    const frac = (t.bagTotal + 1) / t.totalAuctions();
    const bal = Math.max(1, balance);
    const fp = t.auctionType === "FirstPrice";
    let mu0 = fp && this.p.fpMu0 > 0 ? this.p.fpMu0 : this.p.mu0;
    const duel = t.activeN() <= this.p.duelMaxN;
    if (duel && this.p.duelMu0 > 0) mu0 = this.p.duelMu0;
    const timeExp =
      fp && this.p.fpMuTimeExp > 0
        ? this.p.fpMuTimeExp
        : !fp && duel && this.p.duelMuTimeExp > 0
          ? this.p.duelMuTimeExp
          : this.p.muTimeExp;
    const end = this.p.endMuScale > 0 && frac < 1 / 3 ? this.p.endMuScale + (1 - this.p.endMuScale) * 3 * frac : 1;
    return (
      mu0 *
      Math.pow(frac, timeExp) *
      Math.pow(this.p.refBalance / bal, this.p.muBalExp) *
      Math.exp(this.logPace) *
      end
    );
  }

  // ------------------------------------------------------------------ words

  chooseWords(rack: Counts, balances: number[]): string[] {
    const t = this.t;
    const me = t.seat;
    const words: string[] = [];
    const play = (s: number) => {
      words.push(this.idx.sigWord[s]!);
      this.idx.subtract(rack, s);
      balances[me]! += this.idx.sigReward[s]!;
    };

    const wordRules = this.p.rolloutBid > 0 ? this.rolloutActive() : true;
    if ((t.isFinalAuction() || (wordRules && this.p.finalPackWindow > 0 && t.usableFutureAuctions() < this.p.finalPackWindow)) && this.p.endPlayout !== 0) {
      // Last chance to score: the match ends when this auction closes.
      const plan =
        this.p.endPlayout === 1
          ? this.idx.greedyPartition(rack, 2).words
          : (this.preparedPartition ?? this.idx.bestPartition(rack, 2, 300_000, 400).words);
      for (const w of plan) {
        words.push(w);
        for (let k = 0; k < w.length; k++) rack[w.charCodeAt(k) - 65]!--;
      }
      return words;
    }

    // Long words take the top multiplier already: play them.
    for (;;) {
      let s = this.idx.bestRewardSig(rack, this.p.autoPlayLen);
      if (s === -1) break;
      // hold7Ext: keep a 7-letter word when enough unseen tiles would grow it
      // (with the rest of the rack) into an 8+ letter word, there is time for
      // one to arrive, and we are not short of money. The public leaders'
      // extra points over us are almost entirely 8+ letter words.
      if (this.p.hold7Ext > 0 && this.idx.sigLen[s] === 7 && t.usableFutureAuctions() >= this.p.hold7MinLeft &&
          balances[me]! >= this.p.cashBelow && this.extendingTiles(rack) >= this.p.hold7Ext) break;
      if (this.p.wordLookahead > 0) {
        const choices = this.idx.playable(rack, this.p.autoPlayLen)
          .sort((a, b) => this.idx.sigReward[b]! - this.idx.sigReward[a]!).slice(0, 8);
        const cashWeight = 1 + this.mu(balances[me]!);
        let best = -Infinity;
        for (const candidate of choices) {
          this.idx.subtract(rack, candidate);
          const value = cashWeight * this.idx.sigReward[candidate]! + this.p.wordLookahead * this.expectedValue(rack);
          this.idx.add(rack, candidate);
          if (value > best) { best = value; s = candidate; }
        }
      }
      play(s);
    }

    // Late cash: near the end a held word rarely grows, and its coins can
    // still buy the remaining letters.
    if (wordRules && this.p.lateCashLen > 0 && t.usableFutureAuctions() < this.p.lateCashWindow) {
      for (;;) {
        const s = this.idx.bestRewardSig(rack, this.p.lateCashLen);
        if (s === -1) break;
        play(s);
      }
    }
    // Rack cap: a big rack is already a scoring set; cash it and rebuild.
    if (wordRules && this.p.rackCap > 0 && rack.reduce((a, b) => a + b, 0) >= this.p.rackCap) {
      for (const w of this.idx.bestPartition(rack, 2, 100_000, 100).words) {
        words.push(w);
        for (let k = 0; k < w.length; k++) rack[w.charCodeAt(k) - 65]!--;
        balances[me]! += wordReward(w);
      }
    }

    if (this.p.protectedCashBelow > 0 && balances[me]! < this.p.protectedCashBelow) {
      const spare = rack.slice();
      spare[t.currentLetter]!++;
      const target = this.idx.bestRewardSig(spare, this.p.autoPlayLen);
      if (target !== -1 && !this.idx.fits(rack, target)) {
        this.idx.subtract(spare, target);
        for (;;) {
          const s = this.idx.bestRewardSig(spare, 2);
          if (s === -1) break;
          this.idx.subtract(spare, s);
          play(s);
        }
      }
    }
    if (!this.p.cashTiming) return words;
    // Liquidity gates (both 0 = always on): cash only when nearly broke, or
    // only in the last few usable auctions, when a held word's chance of
    // growing is small and its money can still buy letters.
    if (this.p.cashBelow > 0 || this.p.cashLate > 0) {
      const broke = this.p.cashBelow > 0 && balances[me]! < this.p.cashBelow;
      const late = this.p.cashLate > 0 && t.usableFutureAuctions() <= this.p.cashLate;
      if (!broke && !late) return words;
    }
    // Cash a shorter word when its money is worth more than the expected
    // loss from committing its letters now.
    for (let guard = 0; guard < 2; guard++) {
      const cands = this.idx
        .playable(rack, this.p.cashMinLen)
        .sort((a, b) => this.idx.sigReward[b]! - this.idx.sigReward[a]!)
        .slice(0, 4);
      if (cands.length === 0) break;
      const hold = this.expectedValue(rack);
      const mu = this.mu(balances[me]!);
      let best = -1;
      let bestGain = 0;
      for (const s of cands) {
        const reward = this.idx.sigReward[s]!;
        this.idx.subtract(rack, s);
        const after = this.expectedValue(rack);
        this.idx.add(rack, s);
        const gain = reward * (1 + mu) + after - hold;
        if (gain > bestGain) {
          bestGain = gain;
          best = s;
        }
      }
      if (best === -1) break;
      play(best);
    }
    return words;
  }

  // -------------------------------------------------------------------- bid

  decideBid(letter: number, rack: Counts, balances: number[], scores: readonly number[]): number {
    const t = this.t;
    const balance = balances[t.seat]!;
    if (balance <= 0) return 0;
    let own = this.letterValue(letter, rack);
    if (this.p.foundationWeight > 0 && t.bagTotal > 1 && (t.bagTotal + 1) / t.totalAuctions() > 1 - this.p.earlyFloorFrac) {
      const tiles = rack.reduce((a, b) => a + b, 0);
      if (tiles < this.p.earlyFloorRack && this.idx.bestRewardSig(rack, this.p.autoPlayLen) === -1) {
        const u = this.letterUsefulness(rack);
        let sum = 0;
        let n = 0;
        for (let c = 0; c < N_LETTERS; c++) if (u[c]! > 0) { sum += u[c]!; n++; }
        if (n > 0 && sum > 0) own += (this.p.foundationWeight * u[letter]! * n) / sum;
      }
    }
    this.lastValue = own;
    const value = own + this.denialValue(letter, scores);
    let credit = 0;
    if (this.p.completionCredit > 0 && t.bagTotal > 1 && own > 0) {
      rack[letter]!++;
      const ready = this.idx.bestRewardSig(rack, this.p.autoPlayLen);
      rack[letter]!--;
      if (ready !== -1) credit = this.p.completionCredit * this.idx.sigReward[ready]!;
    }
    let reservation = value / this.mu(balance) + credit; // currency we'd pay at most
    let maxBid = value > 0 ? Math.min(balance, Math.floor(reservation)) : 0;
    if (this.rolloutActive() && !t.isFinalAuction() && t.usableFutureAuctions() >= this.p.rolloutMinLeft) {
      // Rollout valuation: the break-even price from played-out futures
      // replaces the static value / money-formula reservation.
      const r = rolloutBid(
        { idx: this.idx, rng: this.rng, unseen: t.unseen, rack, balance, letter, auctionsLeft: t.usableFutureAuctions(),
          round: t.totalAuctions() - t.bagTotal - 1, totalAuctions: t.totalAuctions(), usefulness: this.letterUsefulness(rack) },
        { samples: this.p.rolloutSamples, horizon: this.p.rolloutHorizon, grid: this.p.rolloutGrid, bidScale: this.p.rolloutBidScale, share: this.p.rolloutShare,
          pace: this.p.rolloutPace, priceScale: this.p.rolloutPriceScale * this.rolloutPriceLevel(), cashBelow: this.p.cashBelow, rackCap: this.p.rackCap,
          lateLen: this.p.lateCashLen, lateWindow: this.p.lateCashWindow, packWindow: this.p.finalPackWindow, terminalCoin: this.p.rolloutTerminalCoin },
      );
      reservation = r.bid;
      maxBid = r.bid;
      if (t.auctionType === "Vickrey") return maxBid;
    }
    const frac = (t.bagTotal + 1) / t.totalAuctions();
    if (maxBid > 0 && frac > 1 / 3 && (this.p.bidCapFrac > 0 || this.p.lateReserve > 0 || this.p.marketCap > 0)) {
      let cap = maxBid;
      if (this.p.marketCap > 0) {
        const paid = t.history.filter((h) => h.winner !== null && h.paid > 0).map((h) => h.paid).sort((a, b) => a - b);
        const median = paid.length >= 5 ? paid[paid.length >> 1]! : 12;
        cap = Math.min(cap, Math.ceil(this.p.marketCap * median));
      }
      if (this.p.bidCapFrac > 0) cap = Math.min(cap, Math.floor(this.p.bidCapFrac * balance));
      if (this.p.lateReserve > 0) {
        const reserve = this.p.lateReserve * Math.min(1, (frac - 1 / 3) * 1.5);
        cap = Math.min(cap, Math.floor(balance - reserve));
      }
      cap = Math.max(1, cap);
      if (maxBid > cap) {
        // Allow what the letter is worth today: words playable with it now.
        const before = this.idx.greedyValue(rack, 2);
        rack[letter]!++;
        const now = Math.max(0, this.idx.greedyValue(rack, 2) - before);
        rack[letter]!--;
        maxBid = Math.max(cap, Math.min(maxBid, Math.floor(now / this.mu(balance))));
      }
    }
    if (this.p.premiumCap > 0 && LETTER_VALUES[letter]! >= 8 && frac > 1 / 3) maxBid = Math.min(maxBid, this.p.premiumCap);
    if (t.auctionType === "Vickrey") {
      // A bid equal to the top sim's can't win (sims win ties, lib.rs:2142)
      // but makes that sim pay its full bid instead of the runner-up's.
      if (this.p.priceDrive && this.p.formatAware && !t.isFinalAuction()) {
        const sims = this.simMax(letter, balances);
        if (maxBid < sims && sims <= balance) return sims;
      }
      let bid = maxBid;
      if (this.p.contestFrac > 0 && value > 0 && !t.isFinalAuction()) {
        const paid = t.history.filter((h) => h.winner !== null && h.paid > 0).map((h) => h.paid).sort((a, b) => a - b);
        const median = paid.length >= 5 ? paid[paid.length >> 1]! : 12;
        const budget = Math.floor((this.p.contestBudget * balance) / Math.max(1, t.usableFutureAuctions() + 1));
        const weight = Math.max(0, Math.min(1, this.p.contestPricePrior));
        const stage = Math.min(2, Math.floor(3 * (1 - frac)));
        const target = (1 - weight) * this.p.contestFrac * median + weight * HISTORICAL_WIN_PRICES[stage]![letter]!;
        const floor = Math.min(Math.round(target), budget, balance);
        if (floor > bid) bid = floor;
      }
      if (this.p.earlyFloor > 0 && value > 0 && !t.isFinalAuction() && frac > 1 - this.p.earlyFloorFrac) {
        const tiles = rack.reduce((a, b) => a + b, 0);
        if (tiles < this.p.earlyFloorRack && this.idx.bestRewardSig(rack, this.p.autoPlayLen) === -1)
          bid = Math.max(bid, Math.min(this.p.earlyFloor, balance));
      }
      const taxFrac = t.activeN() <= this.p.duelMaxN && this.p.leaderTaxDuel > 0 ? this.p.leaderTaxDuel : this.p.leaderTax;
      if (taxFrac > 0 && !t.isFinalAuction() && t.bagTotal >= 3) {
        let leader = -1;
        for (let j = 0; j < t.n; j++) {
          if (j === t.seat || t.inactive(j)) continue;
          if (leader === -1 || scores[j]! > scores[leader]!) leader = j;
        }
        if (leader !== -1 && scores[leader]! >= scores[t.seat]!) {
          const est = this.letterValue(letter, t.knownRack(leader)) / this.mu(balances[leader]!);
          const tax = Math.floor(est * taxFrac);
          if (tax > bid && tax <= balance) bid = tax;
        }
      }
      if (this.p.taxShade < 1 && this.taxed()) bid = Math.floor(bid * this.p.taxShade);
      // Common letters return few points per coin (public archive: about
      // 0.23 for 1-point letters vs 0.6-1.0 for J/Q/X/Z); shade them while
      // coins still have a future.
      if (this.p.shadeLow < 1 && LETTER_VALUES[letter]! <= 2 && t.usableFutureAuctions() >= this.p.shadeLowWindow)
        bid = Math.floor(bid * this.p.shadeLow);
      if (this.p.bidJitter > 0 && bid > 0) {
        const f = 1 + (this.rng.next() * 2 - 1) * this.p.bidJitter;
        bid = Math.max(1, Math.min(balance, Math.round(bid * f)));
      }
      return bid;
    }
    if (maxBid <= 0) return 0;
    let fp = this.firstPriceBid(letter, reservation, maxBid, balances);
    // +1 beats the equal bids that like-minded bots produce; pointless against sims alone.
    if (fp > 0 && this.p.fpPlus > 0 && this.externalOpponents().length > 0) fp = Math.min(maxBid, fp + this.p.fpPlus);
    if (!this.p.fpOutbid || t.isFinalAuction()) return fp;
    // Leader counter-bid: one above the score leader's median winning bid
    // (scaled by letter value), when that is still within our reservation.
    let leader = -1;
    for (let j = 0; j < t.n; j++) if (j !== t.seat && (leader === -1 || scores[j]! > scores[leader]!)) leader = j;
    if (leader === -1) return fp;
    const ratios: number[] = [];
    for (const h of t.history) if (h.winner === leader) ratios.push(h.paid / (LETTER_VALUES[h.letter]! + 2));
    if (ratios.length < 3) return fp;
    ratios.sort((a, b) => a - b);
    const pred = Math.round(ratios[ratios.length >> 1]! * (LETTER_VALUES[letter]! + 2)) + 1;
    return pred > maxBid || pred <= fp ? fp : pred;
  }

  /** Mean paid/bid over our last 8 wins; the tax signature is a ratio near 1. */
  taxRatioRecent(): number {
    const t = this.t;
    let sum = 0;
    let n = 0;
    for (let i = t.history.length - 1; i >= 0 && n < 8; i--) {
      const h = t.history[i]!;
      if (h.winner !== t.seat || h.myBid <= 0) continue;
      sum += h.paid / h.myBid;
      n++;
    }
    return n >= 4 ? sum / n : 0;
  }

  private taxed(): boolean {
    return this.taxRatioRecent() >= this.p.taxRatio;
  }

  /**
   * Value of keeping `letter` from the leading opponent: their own marginal
   * value for it (on the rack we can reconstruct), weighted by how often they
   * win auctions.
   */
  denialValue(letter: number, scores: readonly number[]): number {
    if (!this.p.denial || this.t.isFinalAuction()) return 0;
    const t = this.t;
    let leader = -1;
    for (let j = 0; j < t.n; j++) {
      if (j === t.seat) continue;
      if (leader === -1 || scores[j]! > scores[leader]!) leader = j;
    }
    if (leader === -1 || scores[leader]! < scores[t.seat]! - this.p.denialMargin) return 0;
    const done = Math.max(1, t.history.length);
    const share = (t.wins[leader]! + 1) / (done + t.n);
    const theirs = this.letterValue(letter, t.knownRack(leader));
    return this.p.denial * theirs * share;
  }

  /** Highest unjittered bid among the sims in this match. */
  simMax(letter: number, balances: readonly number[]): number {
    let m = 0;
    this.t.sims.forEach((s, j) => {
      if (s && j !== this.t.seat) m = Math.max(m, predictSimBid(s, letter, balances[j]!));
    });
    return m;
  }

  /** Highest bid any sim in this match can make on this letter (jitter +2). */
  simMaxPossible(letter: number, balances: readonly number[]): number {
    let m = 0;
    this.t.sims.forEach((s, j) => {
      if (s && j !== this.t.seat) m = Math.max(m, predictSimBid(s, letter, balances[j]!, SIM_BID_JITTER));
    });
    return m;
  }

  private simSeats(balances: readonly number[]): { strategy: string; balance: number }[] {
    const out: { strategy: string; balance: number }[] = [];
    this.t.sims.forEach((s, j) => {
      if (s && j !== this.t.seat) out.push({ strategy: s, balance: balances[j]! });
    });
    return out;
  }

  private externalOpponents(): number[] {
    const out: number[] = [];
    for (let j = 0; j < this.t.n; j++) if (j !== this.t.seat && !this.t.sims[j]) out.push(j);
    return out;
  }

  /** P(max external bid < b) for this letter, from observed first-price winning bids. */
  private externalCdf(letter: number, b: number): number {
    const t = this.t;
    const scale = LETTER_VALUES[letter]! + 2;
    let below = 0;
    let n = 0;
    for (const h of t.history) {
      if (h.winner === null || h.winner === t.seat || t.sims[h.winner]) continue;
      const e = (h.paid / (LETTER_VALUES[h.letter]! + 2)) * scale;
      n++;
      if (e < b) below++;
      else if (e === b) below += this.p.tieLoss ? 0 : 0.5;
    }
    // Prior: max external bid uniform on [0, 2 * scale], worth 3 observations.
    const prior = Math.min(1, b / (2 * scale));
    return (below + 3 * prior) / (n + 3);
  }

  /**
   * P(every external opponent bids < b): product over opponents of each
   * one's empirical CDF of its own first-price winning bids (normalised by
   * letter value, uniform prior worth 2 observations). An opponent whose
   * public balance is below b can't outbid us.
   */
  private perOpponentCdf(letter: number, b: number, ext: number[], balances: readonly number[]): number {
    const t = this.t;
    const scale = LETTER_VALUES[letter]! + 2;
    const prior = Math.min(1, b / (2 * scale));
    let p = 1;
    for (const j of ext) {
      if (balances[j]! < b) continue;
      let below = 0;
      let n = 0;
      for (const h of t.history) {
        if (h.winner !== j) continue;
        const e = (h.paid / (LETTER_VALUES[h.letter]! + 2)) * scale;
        n++;
        if (e < b) below++;
        else if (e === b) below += 0.5;
      }
      p *= (below + 2 * prior) / (n + 2);
    }
    return p;
  }

  /**
   * First-price best response: the bid b maximising P(win | b) x
   * (reservation - b), where P(win) = P(every sim's jittered bid is lower)
   * x P(the best external bid is lower), ties counting half.
   */
  private firstPriceBid(letter: number, reservation: number, maxBid: number, balances: number[]): number {
    if (!this.p.formatAware) return Math.max(0, Math.floor(this.p.fpShade * reservation));
    const sims = this.simSeats(balances);
    const ext = this.externalOpponents();
    let best = 0;
    let bestEv = 0;
    for (let b = 1; b <= maxBid; b++) {
      const pSims = sims.length ? simBeatProb(sims, letter, b) : 1;
      if (pSims === 0) continue;
      const pExt = ext.length === 0 ? 1 : this.p.fpModel === 1 ? this.perOpponentCdf(letter, b, ext, balances) : this.externalCdf(letter, b);
      const ev = pSims * pExt * (reservation - b);
      if (ev > bestEv) {
        bestEv = ev;
        best = b;
      }
    }
    return best;
  }
}
