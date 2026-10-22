// ScrabbleBot live client (tournament module, SpacetimeDB 2.12).
//
//   BOT_NAME=<name> BOT_TOKEN=<token> npm start
//
// The token is read only from the BOT_TOKEN environment variable. It is never
// written to disk or logged. Get one from the team page on the live site.
//
// Optional env: STDB_HOST, STDB_DB, AUTO_LOBBY=0 (don't join casual lobbies),
// AUTO_TOURNAMENT=0 (don't register for tournaments; by default the bot
// enters every tournament that is taking registrations, since entry is
// opt-in), LOG_ROUNDS=0 (quieter logs).
//
// This file is only SDK glue: the match logic lives in src/live/adapter.ts
// (tested against a fake server in test/live.test.ts), which runs one Agent
// (src/strategy/agent.ts) per match.

import { DbConnection, type ErrorContext } from "./module_bindings/index.js";
import { Identity } from "spacetimedb";
import { sharedIndex } from "./game/dictionary.ts";
import { LiveBot, type LiveConn } from "./live/adapter.ts";

const HOST = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const DB_NAME = process.env.STDB_DB ?? "scrabblebot";
const BOT_NAME = process.env.BOT_NAME ?? "bot";

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error(`[${BOT_NAME}] BOT_TOKEN is not set. Generate a token on the team page and run:`);
  console.error(`  BOT_NAME=${BOT_NAME} BOT_TOKEN=<token> npm start`);
  process.exit(2); // configuration error: run.ps1 doesn't restart on code 2
}

const log = (...a: unknown[]) => console.log(`[${BOT_NAME}]`, ...a);
const index = sharedIndex(); // build the dictionary index before connecting (~0.3 s)
let bot: LiveBot | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let retryMs = 1000;

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
    });
  }
  const b = bot;

  conn
    .subscriptionBuilder()
    .onApplied(() => {
      if (!b.onApplied(identity)) {
        console.error(`[${BOT_NAME}] this token is not a credential for any bot — generate a fresh one on /team`);
        process.exit(2); // configuration error: run.ps1 doesn't restart on code 2
      }
      log(`acting as bot '${conn.db.bot.id.find(b.myBotId!)?.name ?? "?"}' (id ${b.myBotId})`);
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = setInterval(() => b.tick(), 3000);
    })
    .subscribeToAllTables();

  conn.db.matchParticipant.onInsert((_ctx, p) => b.onParticipantInsert(p));
  conn.db.auction.onInsert((_ctx, a) => b.onAuctionInsert(a));
  conn.db.auctionResult.onInsert((_ctx, r) => b.onResultInsert(r));
  conn.db.wordPlay.onInsert((_ctx, w) => b.onWordInsert(w));
  conn.db.matchState.onUpdate((_ctx, old, neu) => b.onMatchUpdate(old, neu));
  conn.db.tournament.onInsert((_ctx, t) => b.onTournamentChange(t));
  conn.db.tournament.onUpdate((_ctx, _old, t) => b.onTournamentChange(t));
  conn.db.tournamentEntry.onInsert((_ctx, e) => b.onEntryChange(e));
  conn.db.tournamentEntry.onUpdate((_ctx, _old, e) => b.onEntryChange(e));
}

/** Reconnect with backoff; sessions survive, so a mid-match blip resumes. */
function reconnect(why: string) {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  console.error(`[${BOT_NAME}] ${why}; reconnecting in ${retryMs / 1000}s`);
  setTimeout(main, retryMs);
  retryMs = Math.min(30_000, retryMs * 2);
}

function main() {
  log(`connecting to ${DB_NAME} at ${HOST}`);
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
