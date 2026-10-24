// Winners vs the rest of their table, over all-human matches (public tables,
// anonymous identity, read-only): letters bought by stage, prices, money left,
// words and points per letter. Ties are skipped.
//
//   node scripts/winners-report.mjs [since match id]

const SINCE = Number(process.argv[2] ?? 600);
const { token } = await (await fetch(`${H}/v1/identity`, { method: "POST" })).json();
const q = async (s) => { const r = await fetch(`${H}/v1/database/scrabblebot/sql`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: s }); return (await r.json())[0].rows; };
const LV = { A:1,B:3,C:3,D:2,E:1,F:4,G:2,H:4,I:1,J:8,K:5,L:1,M:3,N:1,O:1,P:3,Q:10,R:1,S:1,T:1,U:1,V:4,W:4,X:8,Y:4,Z:10 };
const bots = new Map((await q("SELECT id, name, is_simulated FROM bot")).map(([i, n, s]) => [i, { n, s }]));
const ended = new Set((await q("SELECT id, status FROM match_state")).filter(([id, st]) => st[0] === 2 && id >= SINCE).map(([id]) => id));
const group = (rows) => { const m = new Map(); for (const r of rows) { if (!ended.has(r[0])) continue; (m.get(r[0]) ?? m.set(r[0], []).get(r[0])).push(r); } return m; };
const parts = group(await q("SELECT match_id, bot_id, score, balance FROM match_participant"));
const res = group(await q("SELECT match_id, auction_id, letter, winner_bot_id, paid FROM auction_result"));
const tops = new Map((await q("SELECT auction_id, top_bid FROM auction_top_bid_archive")).map(([a, t]) => [a, t]));
const words = group(await q("SELECT match_id, bot_id, word, total_reward, id FROM word_play"));
const feats = ["score", "letters", "early", "mid", "late", "paid", "avgPaid", "avgWinBid", "left", "words", "long7", "long8", "ptsPerLetter", "rareLetters", "vowelShare", "firstWordAt"];
const sum = { win: {}, rest: {} }; let nw = 0, nr = 0, nMatches = 0;
for (const f of feats) { sum.win[f] = 0; sum.rest[f] = 0; }
for (const [m, ps] of parts) {
  if (ps.length < 5 || ps.some(([, b]) => bots.get(b).s)) continue;
  const rs = (res.get(m) ?? []).sort((a, b) => a[1] - b[1]); const n = rs.length; if (n < 50) continue;
  const ws = (words.get(m) ?? []).sort((a, b) => a[4] - b[4]);
  const max = Math.max(...ps.map((p) => p[2]));
  if (ps.filter((p) => p[2] === max).length > 1) continue; // skip ties
  nMatches++;
  for (const [, b, score, bal] of ps) {
    const f = { score, left: bal, letters: 0, early: 0, mid: 0, late: 0, paid: 0, winBid: 0, nTop: 0, rare: 0, vowels: 0 };
    rs.forEach((r, i) => { if ((r[3][0] === 0 ? r[3][1] : null) !== b) return; f.letters++; f.paid += r[4]; const t = tops.get(r[1]); if (t !== undefined) { f.winBid += t; f.nTop++; } const k = i < n / 3 ? "early" : i < (2 * n) / 3 ? "mid" : "late"; f[k]++; if (LV[r[2]] >= 4) f.rare++; if ("AEIOU".includes(r[2])) f.vowels++; });
    const mine = ws.filter((w) => w[1] === b);
    const firstIdx = mine.length ? ws.indexOf(mine[0]) / Math.max(1, ws.length) : 1;
    const v = { score, letters: f.letters, early: f.early, mid: f.mid, late: f.late, paid: f.paid, avgPaid: f.letters ? f.paid / f.letters : 0, avgWinBid: f.nTop ? f.winBid / f.nTop : 0, left: bal, words: mine.length, long7: mine.filter((w) => w[2].length >= 7).length, long8: mine.filter((w) => w[2].length >= 8).length, ptsPerLetter: score / Math.max(1, f.letters + 5), rareLetters: f.rare, vowelShare: f.letters ? f.vowels / f.letters : 0, firstWordAt: firstIdx };
    const side = score === max ? "win" : "rest";
    for (const k of feats) sum[side][k] += v[k];
    if (side === "win") nw++; else nr++;
  }
}
console.log(`${nMatches} all-human matches since #${SINCE} (ties skipped): winners vs the rest of their tables`);
console.log("feature".padEnd(14), "winner".padStart(8), "rest".padStart(8), "diff".padStart(8));
for (const k of feats) { const a = sum.win[k] / nw, b = sum.rest[k] / nr; console.log(k.padEnd(14), a.toFixed(2).padStart(8), b.toFixed(2).padStart(8), (a - b >= 0 ? "+" : "") + (a - b).toFixed(2).padStart(7)); }
