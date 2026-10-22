// Adversaries modelled on what a strong, adaptive opponent could do. Each is
// our own Agent plus one exploit, so it is at least as capable as we are.
//
// shadow   — Vickrey leader tax: estimates the score leader's value for the
//            letter from their public rack and bids just under it, so the
//            leader pays close to full value every round.
// late     — hoards money for the first half (mu x3), then dominates (mu x0.4).
// outbid   — first-price: learns the leader's winning bids (public `paid`)
//            per letter and bids one more whenever that is still worth it.
// jitter   — randomises every bid by up to ±30% to be unpredictable.
// denier / snowball are parameter variants registered in sim/strategies.ts.

import { LETTER_VALUES, type Counts } from "../../src/game/letters.ts";
import { Agent } from "../../src/strategy/agent.ts";
import type { Params } from "../../src/strategy/params.ts";
import { VERSIONS } from "../../src/strategy/versions.ts";
import { Rng } from "../../src/game/rng.ts";

const FINAL = VERSIONS.v7!; // adversaries stay pinned to the pre-hardening final

function leaderOf(agent: Agent, scores: readonly number[]): number {
  const t = agent.t;
  let leader = -1;
  for (let j = 0; j < t.n; j++) {
    if (j === t.seat) continue;
    if (leader === -1 || scores[j]! > scores[leader]!) leader = j;
  }
  return leader;
}

export class ShadowAgent extends Agent {
  constructor(over: Partial<Params> = {}, name = "shadow") {
    super({ ...FINAL, ...over }, name);
  }
  override decideBid(letter: number, rack: Counts, balances: number[], scores: readonly number[]): number {
    const own = super.decideBid(letter, rack, balances, scores);
    const t = this.t;
    if (t.auctionType !== "Vickrey" || t.isFinalAuction() || t.bagTotal < 3) return own;
    const leader = leaderOf(this, scores);
    if (leader === -1 || scores[leader]! < scores[t.seat]!) return own;
    const theirs = this.letterValue(letter, t.knownRack(leader));
    const est = theirs / this.mu(balances[leader]!);
    const tax = Math.floor(est * 0.85);
    const balance = balances[t.seat]!;
    if (tax <= own || tax > balance) return own;
    return tax;
  }
}

export class LateAgent extends Agent {
  constructor(over: Partial<Params> = {}, name = "late") {
    super({ ...FINAL, paceRate: 0, ...over }, name);
  }
  override mu(balance: number): number {
    const t = this.t;
    const frac = (t.bagTotal + 1) / t.totalAuctions();
    return super.mu(balance) * (frac > 0.5 ? 3 : 0.4);
  }
}

export class OutbidAgent extends Agent {
  constructor(over: Partial<Params> = {}, name = "outbid") {
    super({ ...FINAL, ...over }, name);
  }
  override decideBid(letter: number, rack: Counts, balances: number[], scores: readonly number[]): number {
    const own = super.decideBid(letter, rack, balances, scores);
    const t = this.t;
    if (t.auctionType !== "FirstPrice" || t.isFinalAuction()) return own;
    const leader = leaderOf(this, scores);
    if (leader === -1) return own;
    const ratios: number[] = [];
    for (const h of t.history) if (h.winner === leader) ratios.push(h.paid / (LETTER_VALUES[h.letter]! + 2));
    if (ratios.length < 3) return own;
    ratios.sort((a, b) => a - b);
    const pred = Math.round(ratios[ratios.length >> 1]! * (LETTER_VALUES[letter]! + 2)) + 1;
    const reservation = this.letterValue(letter, rack) / this.mu(balances[t.seat]!);
    if (pred > reservation || pred > balances[t.seat]! || pred <= own) return own;
    return pred;
  }
}

export class JitterAgent extends Agent {
  private jrng = new Rng(7);
  constructor(over: Partial<Params> = {}, name = "jitter") {
    super({ ...FINAL, ...over }, name);
  }
  override onMatchStart(m: Parameters<Agent["onMatchStart"]>[0]): void {
    super.onMatchStart(m);
    this.jrng = new Rng(m.seed ^ 0x1234);
  }
  override decideBid(letter: number, rack: Counts, balances: number[], scores: readonly number[]): number {
    const own = super.decideBid(letter, rack, balances, scores);
    if (own <= 0) return own;
    const f = 1 + (this.jrng.next() - 0.5) * 0.6;
    return Math.max(1, Math.min(balances[this.t.seat]!, Math.round(own * f)));
  }
}
