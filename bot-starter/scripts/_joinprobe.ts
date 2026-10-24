import { DbConnection } from "../src/module_bindings/index.js";
import { BASE_QUERIES, botQueries } from "../src/live/queries.ts";
const me = 8n;
const t0 = Date.now();
const ev: string[] = [];
DbConnection.builder().withUri("https://maincloud.spacetimedb.com").withDatabaseName("scrabblebot")
  .onConnect((conn) => {
    conn.db.matchParticipant.onUpdate((_c, o, n) => { if (o.score !== n.score || o.balance !== n.balance) ev.push(`upd bot${n.botId} m${n.matchId} score ${o.score}->${n.score} bal ${o.balance}->${n.balance}`); });
    conn.db.matchParticipant.onInsert((_c, n) => ev.push(`ins bot${n.botId} m${n.matchId}`));
    conn.db.matchParticipant.onDelete((_c, n) => ev.push(`del bot${n.botId} m${n.matchId}`));
    conn.db.wordPlay.onInsert((_c, w) => ev.push(`word bot${w.botId} m${w.matchId} ${w.word}`));
    let auctions = 0, results = 0;
    conn.db.auction.onInsert(() => auctions++);
    conn.db.auctionResult.onInsert(() => results++);
    conn.subscriptionBuilder().onApplied(() => {
      ev.length = 0;
      setTimeout(() => {
        const parts = Array.from(conn.db.matchParticipant.iter()).filter((p) => p.matchId === 63n).map((p) => `bot${p.botId}=${p.score}`);
        console.log(`after ${Math.round((Date.now() - t0) / 1000)} s: auctions+${auctions} results+${results}; cache m63: ${parts.join(" ")}`);
        const counts: Record<string, number> = {};
        for (const e of ev) { const k = e.split(" ").slice(0, 2).join(" "); counts[k] = (counts[k] ?? 0) + 1; }
        console.log(JSON.stringify(counts));
        console.log(ev.filter((e) => !e.includes("bot8")).slice(0, 12).join("\n"));
        conn.disconnect();
      }, 25000);
    }).subscribe([...BASE_QUERIES, ...botQueries(me)]);
  }).build();
