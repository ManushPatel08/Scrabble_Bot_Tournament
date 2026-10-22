// Live-match logic, independent of the SpacetimeDB SDK so it can be tested
// against a fake server (test/live.test.ts). `LiveConn` is the subset of the
// generated DbConnection this bot uses. Names match the bindings that
// SpacetimeDB 2.12 generates for the tournament module (upstream commit
// 3064b36): table handles and index accessors are camelCase
// (`conn.db.matchState`, `auctionResult.auctionId`), rows use camelCase
// fields, enums are `{ tag }`, and reducers return promises.

import type { WordIndex } from "../game/dictionary.ts";
import { type Counts, countsToString, emptyCounts, letterIndex } from "../game/letters.ts";
import type { AuctionType, SimStrategy } from "../game/types.ts";
import type { Agent } from "../strategy/agent.ts";
import { createAgent } from "../strategy.ts";

type Tag<T extends string> = { tag: T };

export interface BotRow { id: bigint; name: string; isSimulated: boolean; strategy: Tag<string> }
export interface CredRow { identity: unknown; botId: bigint; connected: boolean }
export interface MatchRow {
  id: bigint;
  status: Tag<string>;
  currentRound: number;
  bagTotal: number;
  auctionType: Tag<string>;
  /** Per-match settings from the matchmaker config (schema.ts:284-285). */
  auctionDurationMs?: bigint;
  startingRackSize?: number;
}
export interface ParticipantRow { id: bigint; matchId: bigint; botId: bigint; balance: bigint; score: bigint }
export interface AuctionRow { id: bigint; matchId: bigint; letter: string; status: Tag<string> }
export interface ResultRow { auctionId: bigint; matchId: bigint; letter: string; winnerBotId?: bigint | null; paid: bigint }
export interface WordRow { id: bigint; matchId: bigint; botId: bigint; word: string; totalReward: bigint }
export interface RackRow { matchId: bigint; letter: string; count: number }
export interface LobbyRow { id: bigint; status: Tag<string> }
export interface LobbyMemberRow { lobbyId: bigint; botId: bigint }
export interface TournamentRow { id: bigint; status: Tag<string>; matchSize: number; auctionType: Tag<string> }
export interface TournamentEntryRow {
  id: bigint;
  tournamentId: bigint;
  botId: bigint;
  swissPoints: number;
  eliminated: boolean;
  totalScore: bigint;
}

interface Iter<R> {
  iter(): Iterable<R>;
}

export interface LiveConn {
  db: {
    bot: { id: { find(id: bigint): BotRow | undefined } };
    botCredential: Iter<CredRow> & { identity: { find(identity: never): CredRow | undefined } };
    matchState: { id: { find(id: bigint): MatchRow | undefined } };
    matchParticipant: Iter<ParticipantRow> & { id: { find(id: bigint): ParticipantRow | undefined } };
    auction: Iter<AuctionRow>;
    auctionResult: Iter<ResultRow> & { auctionId: { find(id: bigint): ResultRow | undefined } };
    wordPlay: Iter<WordRow>;
    myRack: Iter<RackRow>;
    lobby: Iter<LobbyRow>;
    lobbyMember: Iter<LobbyMemberRow>;
    tournament: Iter<TournamentRow>;
    tournamentEntry: Iter<TournamentEntryRow>;
  };
  reducers: {
    submitBid(a: { auctionId: bigint; amount: bigint }): unknown;
    submitWord(a: { matchId: bigint; word: string }): unknown;
    joinLobby(a: Record<string, never>): unknown;
    registerForTournament(a: { tournamentId: bigint }): unknown;
  };
}

export interface LiveOptions {
  name: string;
  index: WordIndex;
  autoLobby: boolean;
  /** Register for any tournament that is taking registrations (entry is opt-in). */
  autoRegister: boolean;
  logRounds: boolean;
  log: (...a: unknown[]) => void;
  /** Schedules work after the current transaction's callbacks (setImmediate live). */
  defer: (f: () => void) => void;
}

interface PendingResult { auctionId: bigint; letter: string; winner: bigint | null; paid: number; round: number }
interface PendingWord { id: bigint; botId: bigint; word: string; reward: number }

interface Session {
  matchId: bigint;
  agent: Agent;
  seatOf: Map<bigint, number>;
  botIds: bigint[];
  /** matchParticipant primary keys, for O(1) balance/score lookups. */
  rowIds: bigint[];
  /** This match's auction window (ms). */
  auctionMs: number;
  pendingResults: PendingResult[];
  pendingWords: PendingWord[];
  seenResults: Set<bigint>;
  seenWords: Set<bigint>;
  handledAuctions: Set<bigint>;
  roundOfAuction: Map<bigint, number>;
  /** Last auction we decided on (its result is looked up directly as a fallback). */
  lastAuction: bigint | null;
}

/** Below this auction window the between-round precompute is skipped. */
const MIN_PREPARE_WINDOW_MS = 800;

/** Fire a reducer call; reducers return a promise that rejects on reducer errors. */
function fire(log: LiveOptions["log"], what: string, call: () => unknown, onError?: () => void): void {
  try {
    const r = call() as { catch?: (f: (e: unknown) => void) => void } | undefined;
    r?.catch?.((e) => {
      log(`${what} failed:`, e instanceof Error ? e.message : String(e));
      onError?.();
    });
  } catch (e) {
    log(`${what} threw:`, e instanceof Error ? e.message : String(e));
    onError?.();
  }
}

export class LiveBot {
  myBotId: bigint | null = null;
  readonly sessions = new Map<bigint, Session>();
  /** Matches we participate in (from matchParticipant inserts). */
  readonly myMatches = new Set<bigint>();
  /** Per-match summary lines, for logs and tests. */
  readonly finished: { matchId: bigint; place: number; of: number; score: number }[] = [];
  /** Tournaments we have asked to enter (cleared on failure so we retry). */
  readonly registering = new Set<bigint>();
  private conn: LiveConn;
  private o: LiveOptions;

  constructor(conn: LiveConn, opts: LiveOptions) {
    this.conn = conn;
    this.o = opts;
  }

  /** Swap in a new connection after a reconnect (sessions survive). */
  setConnection(conn: LiveConn): void {
    this.conn = conn;
  }

  /** Subscription applied: resolve our bot, enter tournaments, pick up running matches, queue for the lobby. */
  onApplied(identity: unknown): boolean {
    const cred = this.conn.db.botCredential.identity.find(identity as never);
    if (!cred) return false;
    this.myBotId = cred.botId;
    for (const p of this.conn.db.matchParticipant.iter()) if (p.botId === this.myBotId) this.myMatches.add(p.matchId);
    this.checkTournaments();
    for (const a of this.conn.db.auction.iter()) if (a.status.tag === "Open") this.onAuctionOpen(a.id, a.matchId, a.letter);
    this.joinLobby();
    return true;
  }

  /** Periodic housekeeping (every few seconds): tournament entry and the lobby. */
  tick(): void {
    this.guard("tick", () => {
      this.checkTournaments();
      this.joinLobby();
    });
  }

  // ------------------------------------------------------------ table events

  /** Auctions whose decision is queued but not yet made (they pre-empt precompute). */
  private pendingOpens = 0;
  /** Errors caught in event handlers (logged; the bot keeps running). */
  errors = 0;

  /** Runs an event handler; an exception is logged instead of killing the bot. */
  private guard(what: string, f: () => void): void {
    try {
      f();
    } catch (e) {
      this.errors++;
      this.o.log(`error in ${what}:`, e instanceof Error ? (e.stack ?? e.message) : String(e));
    }
  }

  onParticipantInsert(p: ParticipantRow): void {
    this.guard("participant insert", () => {
      if (this.myBotId !== null && p.botId === this.myBotId) this.myMatches.add(p.matchId);
    });
  }

  onAuctionInsert(a: AuctionRow): void {
    // Defer until every row callback of this transaction (the previous
    // result, sims' word plays, balances) has been applied.
    if (a.status.tag !== "Open") return;
    this.pendingOpens++;
    this.o.defer(() => {
      this.pendingOpens--;
      this.guard(`auction ${a.id}`, () => this.onAuctionOpen(a.id, a.matchId, a.letter));
    });
  }

  onResultInsert(r: ResultRow): void {
    this.guard("result insert", () => {
      const s = this.sessions.get(r.matchId);
      if (s) this.queueResult(s, r.auctionId, r.letter, r.winnerBotId ?? null, Number(r.paid), 0);
    });
  }

  onWordInsert(w: WordRow): void {
    this.guard("word insert", () => {
      const s = this.sessions.get(w.matchId);
      if (s) this.queueWord(s, w.id, w.botId, w.word, Number(w.totalReward));
    });
  }

  onMatchUpdate(old: MatchRow, neu: MatchRow): void {
    this.guard("match update", () => {
      if (old.status.tag !== "Ended" && neu.status.tag === "Ended") {
        this.onMatchEnded(neu.id);
        this.joinLobby();
      }
    });
  }

  /** A tournament row changed: register if it opened for registration. */
  onTournamentChange(t: TournamentRow): void {
    this.guard("tournament change", () => {
      this.o.log(`tournament ${t.id}: ${t.status.tag} (${t.auctionType.tag}, tables of ${t.matchSize})`);
      this.checkTournaments();
    });
  }

  /** Our tournament entry changed: log standings progress. */
  onEntryChange(e: TournamentEntryRow): void {
    this.guard("entry change", () => {
      if (e.botId !== this.myBotId) return;
      this.o.log(
        `tournament ${e.tournamentId}: swiss points ${e.swissPoints}, total score ${e.totalScore}` +
          (e.eliminated ? ", ELIMINATED" : ""),
      );
    });
  }

  /**
   * Between-round precompute, yielding to any queued auction decision (so
   * a concurrent match's bid is never delayed), skipped if this match has
   * moved on to a newer auction, or if the auction window is too short.
   */
  private schedulePrepare(sess: Session, auctionId: bigint, tries = 0): void {
    if (sess.auctionMs < MIN_PREPARE_WINDOW_MS) return;
    this.o.defer(() => {
      if (sess.lastAuction !== auctionId || !this.sessions.has(sess.matchId)) return;
      if (this.pendingOpens > 0 && tries < 50) return this.schedulePrepare(sess, auctionId, tries + 1);
      this.guard("prepareNext", () => sess.agent.prepareNext());
    });
  }

  // ------------------------------------------------------------ tournaments

  /** Tournament entry is opt-in (index.ts:818-832): register for any open one. */
  checkTournaments(): void {
    if (!this.o.autoRegister || this.myBotId === null) return;
    const db = this.conn.db;
    for (const t of db.tournament.iter()) {
      if (t.status.tag !== "Registration" || this.registering.has(t.id)) continue;
      const entered = Array.from(db.tournamentEntry.iter()).some((e) => e.tournamentId === t.id && e.botId === this.myBotId);
      if (entered) continue;
      this.registering.add(t.id);
      this.o.log(`registering for tournament ${t.id}`);
      fire(
        this.o.log,
        `register for tournament ${t.id}`,
        () => this.conn.reducers.registerForTournament({ tournamentId: t.id }),
        () => this.registering.delete(t.id),
      );
    }
  }

  /** Still in contention in a tournament under way: the module keeps us out of lobbies (tournament.ts:41-53). */
  private heldForTournament(): boolean {
    const db = this.conn.db;
    for (const e of db.tournamentEntry.iter()) {
      if (e.botId !== this.myBotId || e.eliminated) continue;
      for (const t of db.tournament.iter()) {
        if (t.id !== e.tournamentId) continue;
        const tag = t.status.tag;
        if (tag === "Swiss" || tag === "Bracket" || tag === "Final") return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- helpers

  private rackFor(matchId: bigint): Counts {
    const r = emptyCounts();
    for (const h of this.conn.db.myRack.iter()) if (h.matchId === matchId) r[letterIndex(h.letter)]! += h.count;
    return r;
  }

  private participantsOf(matchId: bigint): ParticipantRow[] {
    return Array.from(this.conn.db.matchParticipant.iter())
      .filter((p) => p.matchId === matchId)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  private startSession(matchId: bigint): Session | null {
    const db = this.conn.db;
    const parts = this.participantsOf(matchId);
    const seat = parts.findIndex((p) => p.botId === this.myBotId);
    const m = db.matchState.id.find(matchId);
    if (seat === -1 || !m) return null;
    const botIds = parts.map((p) => p.botId);
    const names = botIds.map((id) => db.bot.id.find(id)?.name ?? String(id));
    const sims = botIds.map((id): SimStrategy | null => {
      const b = db.bot.id.find(id);
      if (!b || !b.isSimulated) return null;
      const tag = b.strategy.tag;
      return tag === "Cheapskate" || tag === "ValueBidder" || tag === "Aggressive" ? tag : null;
    });
    const auctionType: AuctionType = m.auctionType.tag === "FirstPrice" ? "FirstPrice" : "Vickrey";
    const auctionMs = Number(m.auctionDurationMs ?? 1000n);
    // Offline = a non-sim bot none of whose credentials is connected.
    const online = new Set<bigint>();
    for (const c of db.botCredential.iter()) if (c.connected) online.add(c.botId);
    const offline = botIds.map((id, i) => i !== seat && !sims[i] && !online.has(id));

    // Past events: only when joining mid-match (e.g. after a restart).
    // Skipped on round 1 so the first bid isn't delayed by a table scan.
    const fresh = m.currentRound <= 1;
    const results = fresh
      ? []
      : Array.from(db.auctionResult.iter())
          .filter((r) => r.matchId === matchId)
          .sort((a, b) => (a.auctionId < b.auctionId ? -1 : 1));
    const words = fresh
      ? []
      : Array.from(db.wordPlay.iter())
          .filter((w) => w.matchId === matchId)
          .sort((a, b) => (a.id < b.id ? -1 : 1));

    // Dealt rack = current rack - letters we won + letters we played.
    const dealt = this.rackFor(matchId);
    for (const r of results) if (r.winnerBotId === this.myBotId) dealt[letterIndex(r.letter)]!--;
    for (const w of words) if (w.botId === this.myBotId) for (const ch of w.word) dealt[letterIndex(ch)]!++;
    for (let c = 0; c < 26; c++) dealt[c] = Math.max(0, dealt[c]!);

    const agent = createAgent(this.o.name, this.o.index);
    agent.onMatchStart({
      seat,
      nPlayers: parts.length,
      names,
      simStrategies: sims,
      auctionType,
      rack: dealt,
      seed: Number(matchId % 2147483647n) ^ 0x51ab,
      offline,
    });
    const s: Session = {
      matchId,
      agent,
      seatOf: new Map(botIds.map((id, i) => [id, i])),
      botIds,
      rowIds: parts.map((p) => p.id),
      auctionMs,
      pendingResults: [],
      pendingWords: [],
      seenResults: new Set(),
      seenWords: new Set(),
      handledAuctions: new Set(),
      roundOfAuction: new Map(),
      lastAuction: null,
    };
    results.forEach((r, i) => this.queueResult(s, r.auctionId, r.letter, r.winnerBotId ?? null, Number(r.paid), i + 1));
    for (const w of words) this.queueWord(s, w.id, w.botId, w.word, Number(w.totalReward));
    this.sessions.set(matchId, s);
    this.o.log(
      `match ${matchId}: seat ${seat}/${parts.length}, ${auctionType}, ${auctionMs} ms auctions, ` +
        `rack ${countsToString(dealt)}${m.startingRackSize !== undefined ? ` (${m.startingRackSize} dealt)` : ""}, ` +
        `opponents ${names.filter((_, i) => i !== seat).join(", ")}` +
        (offline.some(Boolean) ? `, offline: ${names.filter((_, i) => offline[i]).join(", ")}` : "") +
        (fresh ? "" : ` (joined at round ${m.currentRound}, replayed ${results.length} auctions)`),
    );
    return s;
  }

  private queueResult(s: Session, auctionId: bigint, letter: string, winner: bigint | null, paid: number, round: number) {
    if (s.seenResults.has(auctionId)) return;
    s.seenResults.add(auctionId);
    s.pendingResults.push({ auctionId, letter, winner, paid, round });
  }

  private queueWord(s: Session, id: bigint, botId: bigint, word: string, reward: number) {
    if (s.seenWords.has(id)) return;
    s.seenWords.add(id);
    s.pendingWords.push({ id, botId, word, reward });
  }

  /** Feed queued public events to the agent: results first, then words. */
  private flush(s: Session, bagTotal: number) {
    s.pendingResults.sort((a, b) => (a.auctionId < b.auctionId ? -1 : 1));
    for (const r of s.pendingResults) {
      // Replayed history: the agent never saw this auction open, so reveal
      // its letter to the tracker first.
      if (!s.handledAuctions.has(r.auctionId)) s.agent.t.openAuction(r.round, r.letter, bagTotal);
      const winner = r.winner === null ? null : (s.seatOf.get(r.winner) ?? null);
      s.agent.onAuctionResult({ round: s.roundOfAuction.get(r.auctionId) ?? r.round, letter: r.letter, winner, paid: r.paid });
    }
    s.pendingResults = [];
    s.pendingWords.sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const w of s.pendingWords) {
      const player = s.seatOf.get(w.botId);
      if (player !== undefined) s.agent.onWordPlayed({ player, word: w.word, reward: w.reward });
    }
    s.pendingWords = [];
  }

  onAuctionOpen(auctionId: bigint, matchId: bigint, letter: string): void {
    if (this.myBotId === null) return;
    const db = this.conn.db;
    let s = this.sessions.get(matchId);
    if (!s) {
      if (!this.myMatches.has(matchId)) return;
      s = this.startSession(matchId) ?? undefined;
      if (!s) return;
    }
    if (s.handledAuctions.has(auctionId)) return;
    const m = db.matchState.id.find(matchId);
    if (!m || m.status.tag !== "Running") return;
    // Fallback in case the previous result's callback hasn't fired yet.
    if (s.lastAuction !== null) {
      const prev = db.auctionResult.auctionId.find(s.lastAuction);
      if (prev) this.queueResult(s, prev.auctionId, prev.letter, prev.winnerBotId ?? null, Number(prev.paid), 0);
    }
    this.flush(s, m.bagTotal);
    s.handledAuctions.add(auctionId);
    s.lastAuction = auctionId;

    const t0 = performance.now();
    const rows = s.rowIds.map((id) => db.matchParticipant.id.find(id));
    const balances = rows.map((p) => Number(p?.balance ?? 0n));
    const scores = rows.map((p) => Number(p?.score ?? 0n));
    const round = m.currentRound;
    s.roundOfAuction.set(auctionId, round);
    const decision = s.agent.onAuction({ round, letter, bagTotal: m.bagTotal, rack: this.rackFor(matchId), balances, scores });
    const confirmed = balances[s.seatOf.get(this.myBotId)!] ?? 0;
    const bid = (amount: number) =>
      fire(this.o.log, `bid ${amount}`, () => this.conn.reducers.submitBid({ auctionId, amount: BigInt(amount) }));
    // If the bid relies on rewards from this round's words, place a bid we
    // can already afford first: a word that fails would otherwise make the
    // full bid exceed our balance and the server would reject it outright.
    if (decision.words.length > 0 && decision.bid > confirmed && confirmed > 0) bid(confirmed);
    // Words next: reducers from one client run in order, so the full bid is
    // checked against the balance after these rewards land.
    for (const word of decision.words) fire(this.o.log, `word ${word}`, () => this.conn.reducers.submitWord({ matchId, word }));
    if (decision.bid > 0) bid(decision.bid);
    const ms = performance.now() - t0;
    if (this.o.logRounds) {
      this.o.log(
        `m${matchId} r${round} bag ${m.bagTotal} '${letter}' bid ${decision.bid}` +
          (decision.words.length ? ` play ${decision.words.join(",")}` : "") +
          ` (${ms.toFixed(1)} ms)`,
      );
    }
    // Use the rest of the window for next round's heavy lifting.
    this.schedulePrepare(s, auctionId);
  }

  private onMatchEnded(matchId: bigint): void {
    const s = this.sessions.get(matchId);
    if (!s) return;
    const db = this.conn.db;
    const parts = this.participantsOf(matchId).sort((a, b) => (b.score > a.score ? 1 : b.score < a.score ? -1 : 0));
    const me = parts.find((p) => p.botId === this.myBotId);
    // Shared places, as the tournament scores them (tournament.ts:385-386).
    const place = 1 + parts.filter((p) => me !== undefined && p.score > me.score).length;
    this.finished.push({ matchId, place, of: parts.length, score: Number(me?.score ?? 0n) });
    this.o.log(
      `match ${matchId} ended: place ${place}/${parts.length}, score ${me?.score ?? "?"} — ` +
        parts.map((p) => `${db.bot.id.find(p.botId)?.name ?? p.botId}=${p.score}`).join(" "),
    );
    this.sessions.delete(matchId);
  }

  private inRunningMatch(): boolean {
    for (const p of this.conn.db.matchParticipant.iter()) {
      if (p.botId !== this.myBotId) continue;
      if (this.conn.db.matchState.id.find(p.matchId)?.status.tag === "Running") return true;
    }
    return false;
  }

  joinLobby(): void {
    if (!this.o.autoLobby || this.myBotId === null || this.inRunningMatch() || this.heldForTournament()) return;
    const open = Array.from(this.conn.db.lobby.iter()).find((l) => l.status.tag === "Open");
    const already =
      open !== undefined &&
      Array.from(this.conn.db.lobbyMember.iter()).some((lm) => lm.lobbyId === open.id && lm.botId === this.myBotId);
    if (already) return;
    this.o.log("joining lobby");
    fire(this.o.log, "join_lobby", () => this.conn.reducers.joinLobby({}));
  }
}
