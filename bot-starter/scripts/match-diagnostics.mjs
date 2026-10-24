// Per-match diagnostics for our bot from our log plus the public tables
// (anonymous identity, read-only): our bid on every auction next to the
// winning bid, what we bought and paid by phase, which letters we never
// played, and how the table's winner did the same.
//
//   node scripts/match-diagnostics.mjs [--log logs/lobby.log] [--bot LetterSharkPro] [--since 1211]

import fs from "node:fs";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const H = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const BOT = arg("bot", "LetterSharkPro");
const SINCE = Number(arg("since", "1211"));
const RETIRED = { LetterShark: 8, LetterSharkX: 61, LetterSharkPro: 70 };
const LV = { A:1,B:3,C:3,D:2,E:1,F:4,G:2,H:4,I:1,J:8,K:5,L:1,M:3,N:1,O:1,P:3,Q:10,R:1,S:1,T:1,U:1,V:4,W:4,X:8,Y:4,Z:10 };

// From our log: dealt rack, variant, and our bid per round.
const ours = new Map();
for (const line of fs.readFileSync(arg("log", "logs/lobby.log"), "utf8").split("\n")) {
  let m = line.match(new RegExp(String.raw`\[${BOT}\] match (\d+): seat \d+/\d+, Vickrey, \d+ ms auctions, rack ([A-Z]*) \(\d+ dealt\)`));
  if (m && !line.includes("joined at round")) { ours.set(Number(m[1]), { rack: m[2], variant: line.match(/\[variant ([AB])\]/)?.[1] ?? "-", bids: [] }); continue; }
  m = line.match(new RegExp(String.raw`\[${BOT}\] m(\d+) r(\d+) bag \d+ '([A-Z])' bid (\d+)`));
  if (m && ours.has(Number(m[1]))) ours.get(Number(m[1])).bids[Number(m[2]) - 1] = Number(m[4]);
}

const { token } = await (await fetch(`${H}/v1/identity`, { method: "POST" })).json();
const q = async (s) => { const r = await fetch(`${H}/v1/database/scrabblebot/sql`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: s }); return (await r.json())[0].rows; };
const bots = new Map((await q("SELECT id, name FROM bot")).map(([i, n]) => [i, n]));
const me = [...bots].find(([, n]) => n === BOT)?.[0] ?? RETIRED[BOT];

const rows = [];
for (const [mid, o] of [...ours].sort((a, b) => a[0] - b[0])) {
  if (mid < SINCE) continue;
  const parts = await q(`SELECT bot_id, score, balance FROM match_participant WHERE match_id = ${mid}`);
  const matchMe = parts.some((p) => p[0] === me) ? me : RETIRED[BOT];
  if (!parts.some((p) => p[0] === matchMe)) continue;
  const res = (await q(`SELECT auction_id, letter, winner_bot_id, paid FROM auction_result WHERE match_id = ${mid}`)).sort((a, b) => a[0] - b[0]);
  if (res.length < 60) continue; // unfinished
  const tops = new Map((await q(`SELECT auction_id, top_bid FROM auction_top_bid_archive WHERE match_id = ${mid}`)).map(([a, t]) => [a, t]));
  const words = await q(`SELECT bot_id, word, total_reward FROM word_play WHERE match_id = ${mid}`);
  const scores = parts.map((p) => p[1]).sort((a, b) => b - a);
  const myScore = parts.find((p) => p[0] === matchMe)[1];
  const place = 1 + scores.filter((s) => s > myScore).length;
  const winnerId = parts.find((p) => p[1] === scores[0])[0];
  const N = res.length;
  const stat = (b) => {
    const won = res.filter((r) => r[2][0] === 0 && r[2][1] === b);
    const phase = [0, 0, 0];
    res.forEach((r, i) => { if (r[2][0] === 0 && r[2][1] === b) phase[i < N / 3 ? 0 : i < (2 * N) / 3 ? 1 : 2]++; });
    const ws = words.filter((w) => w[0] === b);
    return { letters: won.length, phase, paid: won.reduce((s, r) => s + r[3], 0), rare: won.filter((r) => LV[r[1]] >= 4).length,
      words: ws.map((w) => w[1]), pts: ws.reduce((s, w) => s + w[2], 0), left: parts.find((p) => p[0] === b)[2], wonLetters: won.map((r) => r[1]) };
  };
  const mine = stat(matchMe), win = stat(winnerId);
  // Letters we held and never played (dealt + won - played).
  const held = {}; for (const ch of o.rack + mine.wonLetters.join("")) held[ch] = (held[ch] ?? 0) + 1;
  for (const w of mine.words) for (const ch of w) held[ch]--;
  const unused = Object.entries(held).flatMap(([ch, n]) => Array(Math.max(0, n)).fill(ch)).join("");
  // Auctions we lost although our bid was within 3 of the winning bid, and what we overpaid vs value.
  let close = 0, closeVal = 0, lostRare = 0;
  res.forEach((r, i) => {
    const b = o.bids[i] ?? 0;
    if (r[2][0] === 0 && r[2][1] !== matchMe) {
      const top = tops.get(r[0]) ?? r[3];
      if (b > 0 && top - b <= 3) { close++; closeVal += LV[r[1]]; }
      if (LV[r[1]] >= 4 && b > 0) lostRare++;
    }
  });
  rows.push({ mid, v: o.variant, place, n: parts.length, score: myScore, winScore: scores[0], winner: bots.get(winnerId) ?? winnerId, mine, win, unused, close, closeVal, lostRare });
}

const f = (x) => x.toFixed(1);
console.log(`| match | var | place | score | winner (score) | our letters e/m/l | paid | left | words | unused | lost by <=3 | winner letters e/m/l | w paid | w left | winner words |`);
console.log(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
for (const r of rows) console.log(`| ${r.mid} | ${r.v} | ${r.place}/${r.n} | ${r.score} | ${r.winner} (${r.winScore}) | ${r.mine.letters} ${r.mine.phase.join("/")} | ${r.mine.paid} | ${r.mine.left} | ${r.mine.words.join(" ")} | ${r.unused} | ${r.close} | ${r.win.letters} ${r.win.phase.join("/")} | ${r.win.paid} | ${r.win.left} | ${r.win.words.join(" ")} |`);
const groups = { "won (1st)": rows.filter((r) => r.place === 1), "2nd-3rd": rows.filter((r) => r.place >= 2 && r.place <= 3), "4th+": rows.filter((r) => r.place >= 4) };
console.log(`\n| group | n | our score | letters | early/mid/late | paid | left | words | 7+ words | unused letters | unused face value | lost by <=3 | table winner letters | winner left |`);
console.log(`|---|--:|--:|--:|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|`);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
for (const [g, rs] of Object.entries(groups)) {
  if (!rs.length) continue;
  console.log(`| ${g} | ${rs.length} | ${f(mean(rs.map((r) => r.score)))} | ${f(mean(rs.map((r) => r.mine.letters)))} | ${[0, 1, 2].map((k) => f(mean(rs.map((r) => r.mine.phase[k])))).join("/")} | ${f(mean(rs.map((r) => r.mine.paid)))} | ${f(mean(rs.map((r) => r.mine.left)))} | ${f(mean(rs.map((r) => r.mine.words.length)))} | ${f(mean(rs.map((r) => r.mine.words.filter((w) => w.length >= 7).length)))} | ${f(mean(rs.map((r) => r.unused.length)))} | ${f(mean(rs.map((r) => [...r.unused].reduce((s, c) => s + LV[c], 0))))} | ${f(mean(rs.map((r) => r.close)))} | ${f(mean(rs.map((r) => r.win.letters)))} | ${f(mean(rs.map((r) => r.win.left)))} |`);
}
