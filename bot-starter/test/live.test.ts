// The live adapter (src/live/adapter.ts) driven by a fake server that follows
// lib.rs: full matches, reversed callback order, and a mid-match restart.

import { test } from "node:test";
import assert from "node:assert/strict";
import { sharedIndex } from "../src/game/dictionary.ts";
import { LiveBot } from "../src/live/adapter.ts";
import { BASE_QUERIES, botQueries } from "../src/live/queries.ts";
import { FakeServer, ME_IDENTITY } from "./fakeserver.ts";
import type { SimStrategy } from "../src/game/types.ts";

const SIMS: SimStrategy[] = ["Aggressive", "Aggressive", "ValueBidder", "ValueBidder", "Cheapskate"];

function harness(server: FakeServer) {
  const queue: (() => void)[] = [];
  const logs: string[] = [];
  const bot = new LiveBot(server, {
    name: "test",
    index: sharedIndex(),
    autoLobby: true,
    autoRegister: true,
    logRounds: false,
    log: (...a) => logs.push(a.join(" ")),
    defer: (f) => queue.push(f),
  });
  server.bots_.push(bot);
  const drain = () => {
    while (queue.length) queue.shift()!();
  };
  return { bot, logs, drain };
}

function playOut(server: FakeServer, drain: () => void, until = Infinity) {
  drain();
  while (server.running && server.db.matchState.id.find(server.matchId)!.currentRound < until) {
    server.tick();
    drain();
  }
}

for (const auctionType of ["Vickrey", "FirstPrice"] as const) {
  for (const auctionFirst of [false, true]) {
    test(`full match via the live adapter (${auctionType}, ${auctionFirst ? "auction before result" : "result before auction"})`, () => {
      for (let seed = 1; seed <= 4; seed++) {
        const server = new FakeServer(42n, auctionType, SIMS, seed);
        server.auctionFirst = auctionFirst;
        const { bot, logs, drain } = harness(server);
        assert.ok(bot.onApplied(ME_IDENTITY));
        server.start(seed % 6);
        playOut(server, drain);
        assert.equal(server.running, false);
        assert.deepEqual(server.errors, [], "no rejected reducer calls");
        assert.equal(bot.finished.length, 1);
        const f = bot.finished[0]!;
        assert.equal(f.of, 6);
        assert.equal(f.place, 1, `expected to beat the sims: ${server.scores().join(",")}`);
        assert.ok(f.score > 100);
        assert.ok(!logs.some((l) => l.includes("failed") || l.includes("threw")));
        assert.equal(bot.errors, 0, "no handler errors");
      }
    });
  }
}

test("a bot restarted mid-match replays history and finishes cleanly", () => {
  const server = new FakeServer(42n, "Vickrey", SIMS, 9);
  const first = harness(server);
  assert.ok(first.bot.onApplied(ME_IDENTITY));
  server.start(2);
  playOut(server, first.drain, 30);
  // Crash: drop the first bot, start a fresh one on the same server.
  server.bots_.length = 0;
  const second = harness(server);
  assert.ok(second.bot.onApplied(ME_IDENTITY)); // picks up the open auction
  second.drain();
  const agent = [...second.bot.sessions.values()][0]!.agent;
  assert.equal(agent.t.history.length, 29, "replayed every closed auction");
  playOut(server, second.drain);
  assert.deepEqual(server.errors, []);
  assert.equal(second.bot.finished.length, 1);
  assert.equal(second.bot.finished[0]!.place, 1);
});

test("a word that fails never costs us the auction (safe bid placed first)", async () => {
  const server = new FakeServer(42n, "Vickrey", SIMS, 3);
  server.failWords = true;
  const { bot, logs, drain } = harness(server);
  assert.ok(bot.onApplied(ME_IDENTITY));
  server.start(1);
  drain(); // first auction: session created, normal decision
  server.tick();
  // Next decision relies on this round's word reward: bid 50 above our balance.
  const agent = [...bot.sessions.values()][0]!.agent;
  const balance = Number([...server.db.matchParticipant.iter()].find((p) => p.botId === 42n)!.balance);
  agent.onAuction = () => ({ words: ["CAT"], bid: balance + 50 });
  drain();
  const open = [...server.db.auction.iter()].at(-1)!;
  server.tick();
  await new Promise((r) => setImmediate(r)); // reducer errors are reported asynchronously
  assert.ok(logs.some((l) => l.includes(`bid ${balance + 50} failed`)), "the reward-reliant bid was rejected");
  assert.ok(server.bidsAtClose.has(open.id), "the safe bid was still standing");
  assert.equal(bot.errors, 0);
});

test("registers for a tournament taking registrations, at startup and when one opens later", () => {
  const server = new FakeServer(42n, "Vickrey", SIMS, 4);
  server.openTournament(7n);
  const { bot, drain } = harness(server);
  assert.ok(bot.onApplied(ME_IDENTITY));
  drain();
  assert.ok(server.entries.some((e) => e.tournamentId === 7n && e.botId === 42n), "entered tournament 7");
  // Idempotent: no second registration once entered.
  bot.tick();
  assert.equal(server.registerCalls, 1);
  // A tournament that opens later is picked up by the periodic tick.
  server.openTournament(8n, "FirstPrice");
  bot.tick();
  assert.ok(server.entries.some((e) => e.tournamentId === 8n && e.botId === 42n), "entered tournament 8");
  assert.equal(bot.errors, 0);
});

test("stays out of the lobby while held for a tournament under way", () => {
  const server = new FakeServer(42n, "Vickrey", SIMS, 4);
  server.openTournament(7n);
  let joins = 0;
  server.reducers.joinLobby = () => {
    joins++;
    return Promise.resolve();
  };
  const { bot, drain } = harness(server);
  assert.ok(bot.onApplied(ME_IDENTITY)); // registers, and (not held yet) joins the lobby
  drain();
  const before = joins;
  // Upstream's Swiss phase and every phase of the live round robin + finals.
  for (const tag of ["Swiss", "RoundRobin", "FinalsReady", "FinalsRunning", "FinalsIntermission", "FinalsTieReplay"]) {
    server.tournaments[0]!.status = { tag };
    bot.tick();
    assert.equal(joins, before, `no lobby join while in contention (${tag})`);
  }
  server.entries[0]!.eliminated = true;
  bot.tick();
  assert.equal(joins, before + 1, "rejoins the lobby once knocked out");
});

test("plays a full match with 250 ms auctions (precompute skipped)", () => {
  const server = new FakeServer(42n, "FirstPrice", SIMS, 6);
  server.auctionMs = 250n;
  const { bot, logs, drain } = harness(server);
  assert.ok(bot.onApplied(ME_IDENTITY));
  server.start(0);
  playOut(server, drain);
  assert.ok(logs.some((l) => l.includes("250 ms auctions")), "window read from the auction row");
  assert.equal(bot.finished.length, 1);
  assert.equal(bot.finished[0]!.place, 1);
  assert.equal(bot.errors, 0);
});

test("subscribes only to its own slice of the big tables", () => {
  const qs = botQueries(4097n);
  // Every per-match table is reached only through this bot's participations.
  for (const table of ["match_state", "match_participant", "auction", "auction_result", "word_play", "lobby", "lobby_member", "tournament_entry"]) {
    const q = qs.filter((x) => new RegExp(`FROM ${table}\\b`).test(x));
    assert.equal(q.length, 1, table);
    assert.match(q[0]!, /bot_id = 4097$/, table);
  }
  // Nothing global except the small tables.
  assert.deepEqual([...BASE_QUERIES].map((q) => q.replace("SELECT * FROM ", "")), ["bot_credential", "bot", "tournament"]);
});

test("waits for a match's participants before starting its session, then bids", () => {
  const server = new FakeServer(42n, "Vickrey", SIMS, 7);
  const ready = new Set<bigint>();
  const queue: (() => void)[] = [];
  const bot = new LiveBot(server, {
    name: "test",
    index: sharedIndex(),
    autoLobby: false,
    autoRegister: false,
    logRounds: false,
    log: () => {},
    defer: (f) => queue.push(f),
    participantsReady: (m) => ready.has(m),
  });
  server.bots_.push(bot);
  const drain = () => {
    while (queue.length) queue.shift()!();
  };
  assert.ok(bot.onApplied(ME_IDENTITY));
  server.start(0);
  drain();
  assert.equal(bot.sessions.size, 0, "no session before the participants are in");
  assert.equal(server.bidCalls.size, 0);
  ready.add(server.matchId);
  bot.onMatchReady(server.matchId);
  drain();
  assert.equal(bot.sessions.size, 1);
  assert.equal(server.bidCalls.size, 1, "bids on the auction that was already open");
});
