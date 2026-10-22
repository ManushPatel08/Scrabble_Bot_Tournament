// Per-match bookkeeping from public events plus our own rack.
//
// Unseen pool = 98-tile distribution
//             - my 5 dealt tiles
//             - every auctioned letter (won or discarded — all are revealed
//               when their auction opens; unsold tiles never return)
//             - opponents' dealt tiles proven by their word plays
// It holds exactly the bag plus the opponents' still-hidden dealt tiles.
// The bag is a uniformly random subset of it of size `bagTotal`.

import {
  type AuctionType,
  BAG_DISTRIBUTION,
  type Counts,
  N_LETTERS,
  STARTING_RACK_SIZE,
  emptyCounts,
  letterIndex,
} from "../game/letters.ts";
import type { AuctionOutcome, MatchStart, SimStrategy, WordPlayed } from "../game/types.ts";

export interface PriceObs {
  round: number;
  letter: number;
  winner: number | null;
  paid: number;
  /** Our own bid in that auction (0 if none). */
  myBid: number;
}

export class MatchTracker {
  seat = -1;
  n = 0;
  auctionType: AuctionType = "Vickrey";
  sims: (SimStrategy | null)[] = [];
  offline: boolean[] = [];
  /** Bag + opponents' unrevealed dealt tiles. */
  unseen: Counts = emptyCounts();
  unseenTotal = 0;
  /** Cumulative letters won at auction / played in words, per player. */
  won: Counts[] = [];
  played: Counts[] = [];
  /** Dealt tiles each player has provably used (played beyond what they won). */
  dealtUsed: Counts[] = [];
  /** Tiles left in the bag after the current auction's letter was drawn. */
  bagTotal = 0;
  round = 0;
  currentLetter = -1;
  history: PriceObs[] = [];
  wins: number[] = [];
  private myBidThisRound = 0;
  /** Dealt-rack size, taken from our own deal (5 today, lib.rs:27). */
  dealtSize = STARTING_RACK_SIZE;
  /** Auctions in this match as observed (round + tiles left); 0 until seen. */
  private observedTotal = 0;

  start(m: MatchStart): void {
    this.seat = m.seat;
    this.n = m.nPlayers;
    this.auctionType = m.auctionType;
    this.sims = m.simStrategies.slice();
    this.offline = m.offline ? m.offline.slice() : new Array<boolean>(m.nPlayers).fill(false);
    this.unseen = BAG_DISTRIBUTION.slice();
    for (let c = 0; c < N_LETTERS; c++) this.unseen[c]! -= m.rack[c]!;
    this.unseenTotal = this.unseen.reduce((a, b) => a + b, 0);
    this.won = Array.from({ length: this.n }, emptyCounts);
    this.played = Array.from({ length: this.n }, emptyCounts);
    this.dealtUsed = Array.from({ length: this.n }, emptyCounts);
    this.wins = new Array<number>(this.n).fill(0);
    this.history = [];
    // Derive rule constants from what we observe, so a module change to the
    // deal size or auction count doesn't silently skew the strategy.
    this.dealtSize = m.rack.reduce((a, b) => a + b, 0) || STARTING_RACK_SIZE;
    this.observedTotal = 0;
    this.bagTotal = 98 - this.dealtSize * this.n;
    this.round = 0;
  }

  /** Call exactly once per auction, when it opens (or before replaying its result). */
  openAuction(round: number, letter: string, bagTotal: number): void {
    this.round = round;
    this.bagTotal = bagTotal;
    if (round + bagTotal > this.observedTotal) this.observedTotal = round + bagTotal;
    this.currentLetter = letterIndex(letter);
    this.removeUnseen(this.currentLetter, 1);
    this.myBidThisRound = 0;
  }

  noteMyBid(amount: number): void {
    this.myBidThisRound = amount;
  }

  result(r: AuctionOutcome): void {
    const c = letterIndex(r.letter);
    if (r.winner !== null) {
      this.won[r.winner]![c]!++;
      this.wins[r.winner]!++;
    }
    this.history.push({ round: r.round, letter: c, winner: r.winner, paid: r.paid, myBid: this.myBidThisRound });
  }

  word(w: WordPlayed): void {
    const p = w.player;
    for (let k = 0; k < w.word.length; k++) {
      const c = w.word.charCodeAt(k) - 65;
      this.played[p]![c]!++;
      if (p === this.seat) continue;
      const need = this.played[p]![c]! - this.won[p]![c]!;
      if (need > this.dealtUsed[p]![c]!) {
        this.removeUnseen(c, need - this.dealtUsed[p]![c]!);
        this.dealtUsed[p]![c] = need;
      }
    }
  }

  private removeUnseen(c: number, k: number): void {
    const d = Math.min(k, this.unseen[c]!);
    this.unseen[c]! -= d;
    this.unseenTotal -= d;
  }

  /** Letters player p is known to still hold (excludes unknown dealt tiles). */
  knownRack(p: number): Counts {
    const r = emptyCounts();
    for (let c = 0; c < N_LETTERS; c++) r[c] = Math.max(0, this.won[p]![c]! - this.played[p]![c]!);
    return r;
  }

  /** Number of p's dealt tiles not yet revealed. */
  hiddenCount(p: number): number {
    if (p === this.seat) return 0;
    return Math.max(0, this.dealtSize - this.dealtUsed[p]!.reduce((a, b) => a + b, 0));
  }

  /**
   * True if player p is known or inferred to be inactive: offline at match
   * start, or (after 20 auctions) a non-sim that has neither won a letter nor
   * played a word.
   */
  inactive(p: number): boolean {
    if (p === this.seat) return false;
    if (this.offline[p]) return true;
    if (this.sims[p] || this.history.length < 20) return false;
    return this.wins[p] === 0 && this.played[p]!.every((x) => x === 0);
  }

  /** Participants still in play (including us). */
  activeN(): number {
    let k = 0;
    for (let p = 0; p < this.n; p++) if (!this.inactive(p)) k++;
    return k;
  }

  /** Probability the next drawn tile is letter c. */
  drawProb(c: number): number {
    return this.unseenTotal > 0 ? this.unseen[c]! / this.unseenTotal : 0;
  }

  /** Future auctions whose letter can still be played (the final one can't). */
  usableFutureAuctions(): number {
    return Math.max(0, this.bagTotal - 1);
  }

  isFinalAuction(): boolean {
    return this.bagTotal === 0;
  }

  totalAuctions(): number {
    return this.observedTotal || 98 - this.dealtSize * this.n;
  }
}
