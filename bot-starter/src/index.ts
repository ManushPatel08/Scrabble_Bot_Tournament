// ScrabbleBot live client (tournament module, SpacetimeDB 2.12).
//
//   BOT_NAME=<name> BOT_TOKEN=<token> npm start
//
// The token is read only from the BOT_TOKEN environment variable. It is never
// written to disk or logged. Get one with `npm run get-token` (README).
//
// Optional env: STDB_HOST, STDB_DB, AUTO_LOBBY=0 (don't join casual lobbies),
// AUTO_TOURNAMENT=0 (don't register for tournaments; by default the bot
// enters every tournament that is taking registrations, since entry is
// opt-in), LOG_ROUNDS=0 (quieter logs).
//
// This file is only SDK glue: the match logic lives in src/live/adapter.ts
// (tested against a fake server in test/live.test.ts), which runs one Agent
// (src/strategy/agent.ts) per match.

import fs from "node:fs";
import { DbConnection, type ErrorContext } from "./module_bindings/index.js";
import { Identity } from "spacetimedb";
import { sharedIndex } from "./game/dictionary.ts";
import { LiveBot, type LiveConn } from "./live/adapter.ts";
import { BASE_QUERIES, botQueries, matchQueries } from "./live/queries.ts";

const HOST = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const DB_NAME = process.env.STDB_DB ?? "scrabblebot";
const BOT_NAME = process.env.BOT_NAME ?? "bot";

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error(`[${BOT_NAME}] BOT_TOKEN is not set. Get a token with 'npm run get-token', then run:`);
  console.error(`  BOT_NAME=${BOT_NAME} BOT_TOKEN=<token> npm start`);
  process.exit(2); // configuration error: run.ps1 doesn't restart on code 2
}

/** LOG_FILE: also append each log line, timestamped, to this file (the token is never logged). */
const LOG_FILE = process.env.LOG_FILE;
function toFile(line: string) {
  if (!LOG_FILE) return;
  try {
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}
`);
  } catch {
    // a full disk or locked file must never stop the bot
  }
}
const fmt = (a: unknown[]) =>
  a
    .map((x) =>
      typeof x === "string"
        ? x
        : x instanceof Error
          ? x.message
          : JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    )
    .join(" ");
/** BOT_PARAMS: JSON parameter overrides, e.g. {"priorByRivals":1} (for live trials). */
let PARAMS: Record<string, number> = {};
try {
  PARAMS = process.env.BOT_PARAMS ? (JSON.parse(process.env.BOT_PARAMS) as Record<string, number>) : {};
} catch {
  console.error(`[${BOT_NAME}] BOT_PARAMS is not valid JSON; using the shipped configuration`);
}
/** BOT_PARAMS_B: a second set of overrides; matches alternate A/B (live experiments). */
let PARAMS_B: Record<string, number> | undefined;
try {
  PARAMS_B = process.env.BOT_PARAMS_B ? (JSON.parse(process.env.BOT_PARAMS_B) as Record<string, number>) : undefined;
} catch {
  console.error(`[${BOT_NAME}] BOT_PARAMS_B is not valid JSON; no A/B`);
}
const log = (...a: unknown[]) => {
  console.log(`[${BOT_NAME}]`, ...a);
  toFile(`[${BOT_NAME}] ${fmt(a)}`);
};
const logError = (...a: unknown[]) => {
  console.error(`[${BOT_NAME}]`, ...a);
  toFile(`[${BOT_NAME}] ERROR ${fmt(a)}`);
};
const index = sharedIndex(); // build the dictionary index before connecting (~0.3 s)
let bot: LiveBot | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let retryMs = 1000;
let stopping = false;
/** Per-match participant subscriptions on the current connection (src/live/queries.ts). */
let matchSubs = new Map<bigint, { ready: boolean; handle: { unsubscribe(): void } | null }>();

/**
 * Stop for good with an exit code (2 = configuration error, which run.ps1
 * doesn't restart). Closes the connection and lets Node exit by itself:
 * process.exit() with a WebSocket open trips a libuv assertion on Windows
 * and exits with 127 instead.
 */
function fatal(conn: DbConnection, code: number, ...msg: unknown[]) {
  logError(...msg);
  stopping = true;
  process.exitCode = code;
  if (tickTimer) clearInterval(tickTimer);
  conn.disconnect();
  setTimeout(() => process.exit(code), 5000).unref();
}

function onConnect(conn: DbConnection, identity: Identity, _token: string) {
  retryMs = 1000;
  log(`connected as ${identity.toHexString()}`);
  const live = conn as unknown as LiveConn;
  if (bot) bot.setConnection(live);
  else {
    bot = new LiveBot(live, {
      name: BOT_NAME,
      index,
      autoLobby: process.env.AUTO_LOBBY !== "0",
      autoRegister: process.env.AUTO_TOURNAMENT !== "0",
      logRounds: process.env.LOG_ROUNDS !== "0",
      log,
      defer: (f) => setImmediate(f),
      participantsReady: (m) => matchSubs.get(m)?.ready === true,
      params: PARAMS,
      paramsAlt: PARAMS_B,
    });
  }
  const b = bot;
  matchSubs = new Map(); // subscriptions don't survive a reconnect
  let myBotId: bigint | null = null;

  /** Subscribe to a match's participants; the session starts once they're in. */
  const watchMatch = (matchId: bigint) => {
    if (matchSubs.has(matchId) || conn.db.matchState.id.find(matchId)?.status.tag === "Ended") return;
    const entry: { ready: boolean; handle: { unsubscribe(): void } | null } = { ready: false, handle: null };
    matchSubs.set(matchId, entry);
    entry.handle = conn
      .subscriptionBuilder()
      .onApplied(() => {
        entry.ready = true;
        b.onMatchReady(matchId);
      })
      .onError(subscriptionFailed(`match ${matchId} participants`))
      .subscribe(matchQueries(matchId));
  };
  /** Drop a finished match's participants a little later (after the end-of-match summary). */
  const unwatchMatch = (matchId: bigint) =>
    setTimeout(() => {
      const entry = matchSubs.get(matchId);
      if (!entry) return;
      matchSubs.delete(matchId);
      try {
        entry.handle?.unsubscribe();
      } catch {
        // already gone with the connection
      }
    }, 15_000);

  // Never subscribeToAllTables(): the live database holds every match ever
  // played and would exhaust the heap (src/live/queries.ts). First the small
  // tables, to learn our bot id; then only our own slice.
  const subscriptionFailed = (what: string) => (ctx: unknown) =>
    fatal(conn, 1, `${what} subscription failed:`, (ctx as { event?: unknown }).event ?? ctx); // run.ps1 restarts
  conn
    .subscriptionBuilder()
    .onApplied(() => {
      const cred = conn.db.botCredential.identity.find(identity);
      if (!cred) {
        fatal(conn, 2, "this token is not a credential for any bot — get a fresh one with 'npm run get-token'");
        return;
      }
      myBotId = cred.botId;
      conn
        .subscriptionBuilder()
        .onApplied(() => {
          if (!b.onApplied(identity)) return;
          for (const p of conn.db.matchParticipant.iter()) if (p.botId === myBotId) watchMatch(p.matchId);
          log(`acting as bot '${conn.db.bot.id.find(b.myBotId!)?.name ?? "?"}' (id ${b.myBotId})`);
          if (tickTimer) clearInterval(tickTimer);
          tickTimer = setInterval(() => b.tick(), 3000);
        })
        .onError(subscriptionFailed("match"))
        .subscribe(botQueries(cred.botId));
    })
    .onError(subscriptionFailed("base"))
    .subscribe([...BASE_QUERIES]);

  conn.db.matchParticipant.onInsert((_ctx, p) => {
    if (p.botId === myBotId) watchMatch(p.matchId);
    b.onParticipantInsert(p);
  });
  conn.db.auction.onInsert((_ctx, a) => b.onAuctionInsert(a));
  conn.db.auctionResult.onInsert((_ctx, r) => b.onResultInsert(r));
  conn.db.wordPlay.onInsert((_ctx, w) => b.onWordInsert(w));
  conn.db.matchState.onUpdate((_ctx, old, neu) => {
    b.onMatchUpdate(old, neu);
    if (neu.status.tag === "Ended" && old.status.tag !== "Ended") unwatchMatch(neu.id);
  });
  conn.db.tournament.onInsert((_ctx, t) => b.onTournamentChange(t));
  conn.db.tournament.onUpdate((_ctx, _old, t) => b.onTournamentChange(t));
  conn.db.tournamentEntry.onInsert((_ctx, e) => b.onEntryChange(e));
  conn.db.tournamentEntry.onUpdate((_ctx, _old, e) => b.onEntryChange(e));
}

/** Reconnect with backoff; sessions survive, so a mid-match blip resumes. */
function reconnect(why: string) {
  if (stopping) return;
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  logError(`${why}; reconnecting in ${retryMs / 1000}s`);
  setTimeout(main, retryMs);
  retryMs = Math.min(30_000, retryMs * 2);
}

function main() {
  log(
    `connecting to ${DB_NAME} at ${HOST}` +
      (Object.keys(PARAMS).length ? ` with BOT_PARAMS ${JSON.stringify(PARAMS)}` : "") +
      (PARAMS_B ? `, alternating with BOT_PARAMS_B ${JSON.stringify(PARAMS_B)}` : ""),
  );
  DbConnection.builder()
    .withUri(HOST)
    .withDatabaseName(DB_NAME)
    .withToken(TOKEN)
    .onConnect(onConnect)
    .onConnectError((_ctx: ErrorContext, err: Error) => reconnect(`connect error: ${err.message}`))
    .onDisconnect(() => reconnect("disconnected"))
    .build();
}

main();
