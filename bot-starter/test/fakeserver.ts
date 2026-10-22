// In-memory stand-in for the SpacetimeDB module (lib.rs rules) exposing the
// LiveConn surface, so the live adapter can be exercised end to end without
// the SDK or the network. One match: our bot plus module sims.

import { sharedIndex } from "../src/game/dictionary.ts";
import {
  type AuctionType,
  BAG_DISTRIBUTION,
  N_LETTERS,
  STARTING_RACK_SIZE,
  letterAt,
  letterIndex,
  wordReward,
} from "../src/game/letters.ts";
import { Rng } from "../src/game/rng.ts";
import type { SimStrategy } from "../src/game/types.ts";
import { resolveAuction, simBid } from "../sim/engine.ts";
import type {
  TournamentEntryRow,
  TournamentRow,
  AuctionRow,
  BotRow,
  LiveBot,
  LiveConn,
  MatchRow,
  ParticipantRow,
  RackRow,
  ResultRow,
  WordRow,
} from "../src/live/adapter.ts";

export const ME_IDENTITY = { me: true };

interface Holding {
  botId: bigint;
  letter: string;
  count: number;
}

export class FakeServer implements LiveConn {
  readonly matchId = 7n;
  private rng: Rng;
  private bag = BAG_DISTRIBUTION.slice();
  private bagTotal = 98;
  private seq = 100n;
  private bids: { id: bigint; botId: bigint; amount: number }[] = [];
  private holdings: Holding[] = [];
  private bots: BotRow[] = [];
  private parts: ParticipantRow[] = [];
  private auctions: AuctionRow[] = [];
  private results: ResultRow[] = [];
  private words: WordRow[] = [];
  readonly tournaments: TournamentRow[] = [];
  readonly entries: TournamentEntryRow[] = [];
  registerCalls = 0;
  /** Per-match config (setMatchmakerConfig): auction window. */
  auctionMs = 1000n;
  private match: MatchRow;
  /** Every reducer error, as the SDK would report it. */
  readonly errors: string[] = [];
  /** Observers (the bots under test) and whether to emit the new auction before the result. */
  bots_: LiveBot[] = [];
  auctionFirst = false;
  /** Reject every word our bot submits (to exercise the safe-bid path). */
  failWords = false;
  /** Auctions we called submitBid on, and auctions where a bid of ours was standing at close. */
  readonly bidCalls = new Set<bigint>();
  readonly bidsAtClose = new Set<bigint>();

  readonly meBotId: bigint;
  readonly auctionType: AuctionType;
  readonly sims: SimStrategy[];

  constructor(meBotId: bigint, auctionType: AuctionType, sims: SimStrategy[], seed: number) {
    this.meBotId = meBotId;
    this.auctionType = auctionType;
    this.sims = sims;
    this.rng = new Rng(seed);
    this.match = {
      id: this.matchId,
      status: { tag: "Running" },
      currentRound: 0,
      bagTotal: 98,
      auctionType: { tag: auctionType },
      auctionDurationMs: 1000n,
      startingRackSize: 5,
    };
  }

  // ---------------------------------------------------------------- LiveConn

  db: LiveConn["db"] = {
    bot: { id: { find: (id) => this.bots.find((b) => b.id === id) } },
    botCredential: {
      iter: () => this.bots.map((b) => ({ identity: b.id === this.meBotId ? ME_IDENTITY : {}, botId: b.id, connected: true })),
      identity: {
        find: (identity) =>
          identity === (ME_IDENTITY as never) ? { identity, botId: this.meBotId, connected: true } : undefined,
      },
    },
    matchState: { id: { find: (id) => (id === this.matchId ? { ...this.match } : undefined) } },
    matchParticipant: { iter: () => this.parts.map((p) => ({ ...p })), id: { find: (id) => { const p = this.parts.find((x) => x.id === id); return p && { ...p }; } } },
    auction: { iter: () => this.auctions.slice() },
    auctionResult: {
      iter: () => this.results.slice(),
      auctionId: { find: (id) => this.results.find((r) => r.auctionId === id) },
    },
    wordPlay: { iter: () => this.words.slice() },
    myRack: {
      iter: (): RackRow[] =>
        this.holdings.filter((h) => h.botId === this.meBotId && h.count > 0).map((h) => ({ matchId: this.matchId, letter: h.letter, count: h.count })),
    },
    lobby: { iter: () => [] },
    lobbyMember: { iter: () => [] },
    tournament: { iter: () => this.tournaments.map((t) => ({ ...t })) },
    tournamentEntry: { iter: () => this.entries.map((e) => ({ ...e })) },
  };

  reducers: LiveConn["reducers"] = {
    submitBid: ({ auctionId, amount }) => {
      this.bidCalls.add(auctionId);
      const a = this.auctions.find((x) => x.id === auctionId);
      const p = this.parts.find((x) => x.botId === this.meBotId);
      const amt = Number(amount);
      if (amt < 0) return this.fail("Bid must be non-negative");
      if (!a || a.status.tag !== "Open") return this.fail("Auction closed");
      if (!p || Number(p.balance) < amt) return this.fail("Insufficient balance");
      this.bids = this.bids.filter((b) => b.botId !== this.meBotId);
      this.bids.push({ id: this.seq++, botId: this.meBotId, amount: amt });
    },
    submitWord: ({ matchId, word }) => {
      if (this.failWords) return this.fail(`word ${word} rejected (test)`);
      if (matchId !== this.matchId || this.match.status.tag !== "Running") return this.fail("Match not running");
      const w = word.toUpperCase();
      if (w.length < 2 || !/^[A-Z]+$/.test(w) || !sharedIndex().isWord(w)) return this.fail(`'${w}' is not in the dictionary`);
      if (!this.playWord(this.meBotId, w)) return this.fail(`Not enough letters for ${w}`);
    },
    joinLobby: () => undefined,
    // index.ts:818-832 + tournament.ts:109-117
    registerForTournament: ({ tournamentId }) => {
      this.registerCalls++;
      const t = this.tournaments.find((x) => x.id === tournamentId);
      if (!t) return this.fail("Unknown tournament");
      if (t.status.tag !== "Registration") return this.fail("Tournament is not taking registrations");
      if (this.entries.some((e) => e.tournamentId === tournamentId && e.botId === this.meBotId)) return Promise.resolve();
      this.entries.push({ id: this.seq++, tournamentId, botId: this.meBotId, swissPoints: 0, eliminated: false, totalScore: 0n });
      return Promise.resolve();
    },
  };

  private fail(msg: string): Promise<void> {
    this.errors.push(msg);
    return Promise.reject(new Error(msg));
  }

  // ------------------------------------------------------------ module logic

  private draw(): string | null {
    if (this.bagTotal === 0) return null;
    let i = this.rng.int(this.bagTotal);
    for (let c = 0; c < N_LETTERS; c++) {
      if (i < this.bag[c]!) {
        this.bag[c]!--;
        this.bagTotal--;
        this.match.bagTotal = this.bagTotal;
        return letterAt(c);
      }
      i -= this.bag[c]!;
    }
    return null;
  }

  private give(botId: bigint, letter: string) {
    const h = this.holdings.find((x) => x.botId === botId && x.letter === letter);
    if (h) h.count++;
    else this.holdings.push({ botId, letter, count: 1 });
  }

  private playWord(botId: bigint, w: string): boolean {
    const need = new Map<string, number>();
    for (const ch of w) need.set(ch, (need.get(ch) ?? 0) + 1);
    for (const [ch, n] of need) {
      const h = this.holdings.find((x) => x.botId === botId && x.letter === ch);
      if (!h || h.count < n) return false;
    }
    for (const [ch, n] of need) this.holdings.find((x) => x.botId === botId && x.letter === ch)!.count -= n;
    const reward = BigInt(wordReward(w));
    const p = this.parts.find((x) => x.botId === botId)!;
    p.balance += reward;
    p.score += reward;
    const row: WordRow = { id: this.seq++, matchId: this.matchId, botId, word: w, totalReward: reward };
    this.words.push(row);
    for (const b of this.bots_) b.onWordInsert(row);
    return true;
  }

  private rack(botId: bigint): number[] {
    const r = new Array<number>(N_LETTERS).fill(0);
    for (const h of this.holdings) if (h.botId === botId) r[letterIndex(h.letter)]! += h.count;
    return r;
  }

  private openAuction(letter: string) {
    this.match.currentRound++;
    const a: AuctionRow = { id: this.seq++, matchId: this.matchId, letter, status: { tag: "Open" } };
    this.auctions.push(a);
    this.bids = [];
    for (const p of this.parts) {
      const b = this.bots.find((x) => x.id === p.botId)!;
      if (!b.isSimulated) continue;
      const amount = simBid(b.strategy.tag as SimStrategy, letterIndex(letter), Number(p.balance));
      if (amount > 0) this.bids.push({ id: this.seq++, botId: p.botId, amount });
    }
    return a;
  }

  /** start_match_with: roster = our bot at `mySeat` plus the sims. */
  start(mySeat: number): void {
    const roster: bigint[] = this.sims.map((_, i) => 1000n + BigInt(i));
    roster.splice(mySeat, 0, this.meBotId);
    this.bots.push({ id: this.meBotId, name: "me", isSimulated: false, strategy: { tag: "Human" } });
    this.sims.forEach((s, i) => this.bots.push({ id: 1000n + BigInt(i), name: `${s}-${i}`, isSimulated: true, strategy: { tag: s } }));
    for (const botId of roster) this.parts.push({ id: this.seq++, matchId: this.matchId, botId, balance: 100n, score: 0n });
    for (const botId of roster) for (let k = 0; k < STARTING_RACK_SIZE; k++) this.give(botId, this.draw()!);
    const a = this.openAuction(this.draw()!);
    for (const b of this.bots_) {
      for (const p of this.parts) b.onParticipantInsert(p);
      b.onAuctionInsert(a);
    }
  }

  /** createTournament (index.ts:779-814): opens registration. */
  openTournament(id: bigint, auctionType: AuctionType = "Vickrey"): void {
    this.tournaments.push({ id, status: { tag: "Registration" }, matchSize: 6, auctionType: { tag: auctionType } });
  }

  get running(): boolean {
    return this.match.status.tag === "Running";
  }

  /** auction_tick: close the open auction and open the next (or end). */
  tick(): void {
    const a = this.auctions.at(-1)!;
    if (this.bids.some((b) => b.botId === this.meBotId)) this.bidsAtClose.add(a.id);
    const seats = this.parts.map((p) => p.botId);
    const bids = this.bids.map((b) => ({ player: seats.indexOf(b.botId), amount: b.amount }));
    const { winner, paid } = resolveAuction(bids, this.auctionType);
    const winnerId = winner === null ? null : seats[winner]!;
    if (winnerId !== null) {
      const p = this.parts.find((x) => x.botId === winnerId)!;
      p.balance -= BigInt(paid);
      this.give(winnerId, a.letter);
    }
    a.status = { tag: "Closed" };
    const res: ResultRow = { auctionId: a.id, matchId: this.matchId, letter: a.letter, winnerBotId: winnerId ?? undefined, paid: BigInt(paid) };
    this.results.push(res);
    const old = { ...this.match };
    let next: AuctionRow | null = null;
    const simWinner = winnerId !== null && this.bots.find((b) => b.id === winnerId)!.isSimulated;
    // Emit the result now unless testing the reversed callback order.
    if (!this.auctionFirst) for (const b of this.bots_) b.onResultInsert(res);
    if (simWinner) {
      const w = sharedIndex().longestWord(this.rack(winnerId!), 3);
      if (w) this.playWord(winnerId!, w);
    }
    const letter = this.draw();
    if (letter === null) {
      this.match.status = { tag: "Ended" };
      if (this.auctionFirst) for (const b of this.bots_) b.onResultInsert(res);
      for (const b of this.bots_) b.onMatchUpdate(old, { ...this.match });
      return;
    }
    next = this.openAuction(letter);
    for (const b of this.bots_) b.onAuctionInsert(next);
    if (this.auctionFirst) for (const b of this.bots_) b.onResultInsert(res);
  }

  myScore(): number {
    return Number(this.parts.find((p) => p.botId === this.meBotId)!.score);
  }

  scores(): number[] {
    return this.parts.map((p) => Number(p.score));
  }
}
