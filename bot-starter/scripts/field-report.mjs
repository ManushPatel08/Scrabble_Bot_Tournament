// The whole live field from the public tables (read-only; an anonymous
// identity, no token): every non-sim bot's record over recent finished
// matches, how it bids and spends, and how LetterShark does at all-human
// tables.
//
//   node scripts/field-report.mjs [--since <match id>] [--min 5] [--json out.json]

import fs from "node:fs";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const host = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const db = process.env.STDB_DB ?? "scrabblebot";
const since = Number(arg("since", "0"));
const minMatches = Number(arg("min", "5"));
const jsonOut = arg("json", "");

const { token } = await (await fetch(`${host}/v1/identity`, { method: "POST" })).json();
async function sql(q) {
  const res = await fetch(`${host}/v1/database/${db}/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: q,
  });
  if (!res.ok) throw new Error(`${q}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json())[0].rows;
}
const some = (opt) => (opt[0] === 0 ? opt[1] : null); // Option<T> comes back as [0, value] / [1, []]

const bots = new Map((await sql("SELECT id, name, is_simulated FROM bot")).map(([id, name, sim]) => [id, { name, sim }]));
// Enums come back as [variant index, payload]: status 2 = Ended.
const ended = (await sql("SELECT id, status FROM match_state"))
  .filter(([id, st]) => st[0] === 2 && id >= since)
  .map(([id]) => id)
  .sort((a, b) => a - b);

// Pull everything once per table, then group by match in memory.
const inSet = new Set(ended);
const byMatch = (rows, col) => {
  const m = new Map();
  for (const r of rows) {
    if (!inSet.has(r[col])) continue;
    if (!m.has(r[col])) m.set(r[col], []);
    m.get(r[col]).push(r);
  }
  return m;
};
const parts = byMatch(await sql("SELECT match_id, bot_id, score, balance FROM match_participant"), 0);
const results = byMatch(await sql("SELECT match_id, auction_id, letter, winner_bot_id, paid FROM auction_result"), 0);
const tops = new Map((await sql("SELECT auction_id, top_bid FROM auction_top_bid_archive")).map(([a, t]) => [a, t]));
const words = byMatch(await sql("SELECT match_id, bot_id, word, total_reward FROM word_play"), 0);

const stat = new Map();
const S = (b) => {
  if (!stat.has(b)) stat.set(b, { m: 0, wins: 0, last: 0, rank: 0, score: 0, left: 0, letters: 0, paid: 0, topWin: 0, nTop: 0, words: 0, wordLen: 0, humanTables: 0, humanWins: 0, humanRank: 0 });
  return stat.get(b);
};
const matchRows = [];
for (const m of ended) {
  const ps = parts.get(m) ?? [];
  if (ps.length === 0) continue;
  const humans = ps.filter(([, b]) => !bots.get(b)?.sim);
  const allHuman = humans.length === ps.length;
  const max = Math.max(...ps.map((p) => p[2]));
  const min = Math.min(...ps.map((p) => p[2]));
  for (const [, b, score, balance] of ps) {
    if (bots.get(b)?.sim) continue;
    const s = S(b);
    const rank = 1 + ps.filter((p) => p[2] > score).length;
    s.m++;
    s.rank += rank;
    s.score += score;
    s.left += balance;
    if (score === max) s.wins++;
    if (score === min) s.last++;
    if (allHuman) {
      s.humanTables++;
      s.humanRank += rank;
      if (score === max) s.humanWins++;
    }
  }
  for (const [, aid, letter, winner, paid] of results.get(m) ?? []) {
    const w = some(winner);
    if (w === null || bots.get(w)?.sim) continue;
    const s = S(w);
    s.letters++;
    s.paid += paid;
    const t = tops.get(aid);
    if (t !== undefined) {
      s.topWin += t;
      s.nTop++;
    }
  }
  for (const [, b, word] of words.get(m) ?? []) {
    if (bots.get(b)?.sim) continue;
    const s = S(b);
    s.words++;
    s.wordLen += word.length;
  }
  matchRows.push({ m, allHuman, n: ps.length, parts: ps.map(([, b, sc, bal]) => ({ bot: bots.get(b)?.name ?? b, score: sc, balance: bal })) });
}

const rowsOut = [...stat]
  .filter(([, s]) => s.m >= minMatches)
  .map(([b, s]) => ({
    name: bots.get(b)?.name ?? String(b),
    matches: s.m,
    winPct: (100 * s.wins) / s.m,
    lastPct: (100 * s.last) / s.m,
    meanRank: s.rank / s.m,
    meanScore: s.score / s.m,
    moneyLeft: s.left / s.m,
    lettersPerMatch: s.letters / s.m,
    meanPaid: s.paid / Math.max(1, s.letters),
    meanWinningBid: s.topWin / Math.max(1, s.nTop),
    wordsPerMatch: s.words / s.m,
    meanWordLen: s.wordLen / Math.max(1, s.words),
    humanTables: s.humanTables,
    humanWinPct: s.humanTables ? (100 * s.humanWins) / s.humanTables : NaN,
    humanRank: s.humanTables ? s.humanRank / s.humanTables : NaN,
  }))
  .sort((a, b) => a.meanRank - b.meanRank);

console.log(`${ended.length} finished matches since #${since}; bots with >= ${minMatches} matches, best mean rank first\n`);
console.log("bot                matches  win%  last%  rank  score  left  letters  paid  winbid  words  len  | all-human: n  win%  rank");
for (const r of rowsOut) {
  console.log(
    `${r.name.slice(0, 18).padEnd(18)} ${String(r.matches).padStart(7)} ${r.winPct.toFixed(0).padStart(5)} ${r.lastPct.toFixed(0).padStart(6)} ` +
      `${r.meanRank.toFixed(2).padStart(5)} ${r.meanScore.toFixed(0).padStart(6)} ${r.moneyLeft.toFixed(0).padStart(5)} ${r.lettersPerMatch.toFixed(1).padStart(8)} ` +
      `${r.meanPaid.toFixed(1).padStart(5)} ${r.meanWinningBid.toFixed(1).padStart(7)} ${r.wordsPerMatch.toFixed(1).padStart(6)} ${r.meanWordLen.toFixed(1).padStart(4)}  | ` +
      `${String(r.humanTables).padStart(12)} ${Number.isNaN(r.humanWinPct) ? "   -" : r.humanWinPct.toFixed(0).padStart(5)} ${Number.isNaN(r.humanRank) ? "   -" : r.humanRank.toFixed(2).padStart(5)}`,
  );
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ bots: rowsOut, matches: matchRows }, null, 2));
