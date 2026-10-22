// Diagnostic: subscribes anonymously (read-only) with the queries a given
// bot would use and reports row counts, heap and time. No token needed.
//
//   npx tsx scripts/sub-probe.ts <bot id>

import { DbConnection } from "../src/module_bindings/index.js";
import { BASE_QUERIES, botQueries } from "../src/live/queries.ts";

const HOST = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const DB_NAME = process.env.STDB_DB ?? "scrabblebot";
const botId = BigInt(process.argv[2] ?? "0");
const t0 = performance.now();

DbConnection.builder()
  .withUri(HOST)
  .withDatabaseName(DB_NAME)
  .onConnect((conn) => {
    conn
      .subscriptionBuilder()
      .onApplied(() => {
        const db = conn.db;
        const n = (it: { iter(): Iterable<unknown> }) => Array.from(it.iter()).length;
        console.log(
          `bot ${botId}: ${Math.round(performance.now() - t0)} ms, heap ${Math.round(process.memoryUsage().heapUsed / 1e6)} MB;`,
          `credentials ${n(db.botCredential)}, bots ${n(db.bot)}, tournaments ${n(db.tournament)}, entries ${n(db.tournamentEntry)},`,
          `lobbies ${n(db.lobby)}, lobby members ${n(db.lobbyMember)}, matches ${n(db.matchState)}, participants ${n(db.matchParticipant)},`,
          `auctions ${n(db.auction)}, results ${n(db.auctionResult)}, words ${n(db.wordPlay)}`,
        );
        conn.disconnect();
      })
      .onError((ctx) => {
        console.log("subscription error:", (ctx as { event?: unknown }).event ?? ctx);
        conn.disconnect();
        process.exitCode = 1;
      })
      .subscribe([...BASE_QUERIES, ...botQueries(botId)]);
  })
  .onConnectError((_ctx, e) => {
    console.log("connect error:", e.message);
    process.exitCode = 1;
  })
  .build();
