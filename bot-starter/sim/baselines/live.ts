// Models of opponents seen on the live server.
//
// botlike — "bot" (id 7) as of 2026-10-23. It bids a letter-specific share
//           of its current balance on almost every letter, whatever the
//           round or its rack (about 20%: 13-17 for common letters, 30-45
//           for J, Q, Y, Z), and builds long words. In Vickrey that wins
//           most letters at the runner-up's (our) lower price; the word
//           rewards refill its balance. It beat our first build 281-94 in
//           match 80. The shares below are its mean winning bid per letter
//           over its mean balance in its first 13 matches
//           (auction_top_bid_archive, rounds 1-40), so they lean high: they
//           come from the auctions it won. Words come from our own engine.

import { Agent } from "../../src/strategy/agent.ts";
import type { Params } from "../../src/strategy/params.ts";
import { VERSIONS } from "../../src/strategy/versions.ts";

const SHARE: readonly number[] = [
  // A     B     C     D     E     F     G     H     I     J     K     L     M
  0.22, 0.2, 0.23, 0.16, 0.22, 0.13, 0.15, 0.23, 0.18, 0.47, 0.18, 0.14, 0.17,
  // N     O     P     Q     R     S     T     U     V     W     X     Y     Z
  0.1, 0.15, 0.15, 0.32, 0.11, 0.15, 0.11, 0.2, 0.15, 0.26, 0.2, 0.36, 0.51,
];

export class BotLikeAgent extends Agent {
  private readonly scale: number;

  constructor(scale = 1, over: Partial<Params> = {}, name = "botlike") {
    super({ ...VERSIONS.final, ...over }, name);
    this.scale = scale;
  }

  override decideBid(letter: number, _rack: unknown, balances: number[]): number {
    const t = this.t;
    const balance = balances[t.seat]!;
    if (balance <= 0 || t.isFinalAuction()) return 0;
    // It spends what is left faster near the end (winning bid / balance
    // doubles over the last ~8 auctions in the data).
    const late = t.bagTotal < 8 ? 1 + (8 - t.bagTotal) / 8 : 1;
    return Math.max(1, Math.min(balance, Math.round(balance * SHARE[letter]! * this.scale * late)));
  }
}
