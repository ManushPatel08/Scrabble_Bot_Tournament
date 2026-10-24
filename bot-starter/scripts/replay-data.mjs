// Builds the market-replay dataset (sim/replay.ts) from our live logs and the
// public tables (anonymous identity, read-only). For every match our bot
// played from the start, it records:
//   - our dealt rack (only our log knows it),
//   - every auction's letter and the highest bid from everyone else: the
//     winner's top bid when a rival won (auction_top_bid_archive), the price
//     we paid when we won (the runner-up's bid in Vickrey),
//   - who won each auction and the rivals' word plays, in order,
//   - every player's final score.
//
//   node scripts/replay-data.mjs [--log logs/lobby.log] [--since 257] [--out sim/replay/matches.json]

import fs from "node:fs";
import path from "node:path";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const logFile = arg("log", "logs/lobby.log");
const since = Number(arg("since", "257"));
const out = arg("out", "sim/replay/matches.json");
const host = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const db = process.env.STDB_DB ?? "scrabblebot";

// Fresh starts only ("joined at round" means a restart mid-match).
const starts = new Map(); // matchId -> { name, rack }
for (const line of fs.readFileSync(logFile, "utf8").split("\n")) {
  const m = line.match(/\[([^\]]+)\] match (\d+): seat \d+\/\d+, Vickrey, \d+ ms auctions, rack ([A-Z]*) \(\d+ dealt\)/);
  if (m && !line.includes("joined at round")) starts.set(Number(m[2]), { name: m[1], rack: m[3] });
}

const { token } = await (await fetch(`${host}/v1/identity`, { method: "POST" })).json();
async function sql(q) {
  const res = await fetch(`${host}/v1/database/${db}/sql`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: q });
  if (!res.ok) throw new Error(`${q}: HTTP ${res.status}`);
  return (await res.json())[0].rows;
}
const some = (opt) => (opt[0] === 0 ? opt[1] : null);
const bots = new Map((await sql("SELECT id, name, is_simulated FROM bot")).map(([id, name, sim]) => [id, { name, sim }]));
const idOf = (name) => [...bots].find(([, b]) => b.name === name)?.[0];

const matches = [];
for (const [matchId, start] of [...starts].sort((a, b) => a[0] - b[0])) {
  if (matchId < since) continue;
  const me = idOf(start.name);
  if (me === undefined) continue;
  const parts = (await sql(`SELECT id, bot_id, score FROM match_participant WHERE match_id = ${matchId}`)).sort((a, b) => a[0] - b[0]);
  if (parts.length < 2 || !parts.some((p) => p[1] === me)) continue;
  const res = (await sql(`SELECT auction_id, letter, winner_bot_id, paid, closed_at FROM auction_result WHERE match_id = ${matchId}`)).sort((a, b) => a[0] - b[0]);
  if (res.length < 30) continue;
  const tops = new Map((await sql(`SELECT auction_id, top_bid FROM auction_top_bid_archive WHERE match_id = ${matchId}`)).map(([a, t]) => [a, t]));
  const words = (await sql(`SELECT id, bot_id, word, total_reward, played_at FROM word_play WHERE match_id = ${matchId}`)).sort((a, b) => a[0] - b[0]);
  const seatOf = new Map(parts.map((p, i) => [p[1], i]));
  const auctions = res.map(([aid, letter, winner, paid, closed]) => {
    const w = some(winner);
    // Highest bid among the others: what our bid had to beat.
    const maxOther = w === null ? 0 : w === me ? paid : (tops.get(aid) ?? paid);
    return { letter, winner: w === null ? null : seatOf.get(w), paid, maxOther, closedAt: closed[0] };
  });
  matches.push({
    matchId,
    me: seatOf.get(me),
    names: parts.map((p) => bots.get(p[1])?.name ?? String(p[1])),
    sims: parts.map((p) => !!bots.get(p[1])?.sim),
    scores: parts.map((p) => p[2]),
    rack: start.rack,
    auctions,
    words: words.map(([, b, word, reward, at]) => ({ player: seatOf.get(b), word, reward, at: at[0] })),
  });
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(matches));
const human = matches.filter((m) => !m.sims.some(Boolean)).length;
console.log(`wrote ${matches.length} matches (${human} all-human) to ${out}`);
