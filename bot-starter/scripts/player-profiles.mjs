// Per-player profiles over all-human ended matches (public tables, anonymous
// identity, read-only): how each bot buys and plays, next to its results.
// Use it to see what the players who place well do differently.
//
//   node scripts/player-profiles.mjs [since match id] [min matches]

const H = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const SINCE = Number(process.argv[2] ?? 900);
const MIN = Number(process.argv[3] ?? 15);
const { token } = await (await fetch(`${H}/v1/identity`, { method: "POST" })).json();
const q = async (s) => { const r = await fetch(`${H}/v1/database/scrabblebot/sql`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: s }); return (await r.json())[0].rows; };
const LV = { A:1,B:3,C:3,D:2,E:1,F:4,G:2,H:4,I:1,J:8,K:5,L:1,M:3,N:1,O:1,P:3,Q:10,R:1,S:1,T:1,U:1,V:4,W:4,X:8,Y:4,Z:10 };
const bots = new Map((await q("SELECT id, name, is_simulated FROM bot")).map(([i, n, s]) => [i, { n, s }]));
const ended = new Set((await q("SELECT id, status FROM match_state")).filter(([id, st]) => st[0] === 2 && id >= SINCE).map(([id]) => id));
const group = (rows) => { const m = new Map(); for (const r of rows) { if (!ended.has(r[0])) continue; (m.get(r[0]) ?? m.set(r[0], []).get(r[0])).push(r); } return m; };
const parts = group(await q("SELECT match_id, bot_id, score, balance FROM match_participant"));
const res = group(await q("SELECT match_id, auction_id, letter, winner_bot_id, paid FROM auction_result"));
const words = group(await q("SELECT match_id, bot_id, word, total_reward, id FROM word_play"));

const prof = new Map(); // bot -> sums
const add = (b, f, v) => { const p = prof.get(b) ?? prof.set(b, { n: 0 }).get(b); p[f] = (p[f] ?? 0) + v; };
let nMatches = 0;
for (const [mid, ps] of parts) {
  if (ps.length < 4 || ps.some(([, b]) => bots.get(b)?.s)) continue;
  const rs = (res.get(mid) ?? []).sort((a, b) => a[1] - b[1]);
  if (rs.length < 30) continue;
  nMatches++;
  const N = rs.length;
  const scores = ps.map((p) => p[2]).sort((a, b) => b - a);
  for (const [, b, score, bal] of ps) {
    add(b, "n", 1);
    const place = 1 + scores.filter((s) => s > score).length;
    add(b, "place", place); add(b, "win", place === 1 ? 1 : 0); add(b, "top2", place <= 2 ? 1 : 0); add(b, "last", place === ps.length ? 1 : 0);
    add(b, "score", score); add(b, "left", bal);
    let letters = 0, paid = 0, rare = 0;
    rs.forEach(([, , letter, w, p], i) => {
      if (w[0] !== 0 || w[1] !== b) return;
      letters++; paid += p; if (LV[letter] >= 4) rare++;
      add(b, i < N / 3 ? "early" : i < (2 * N) / 3 ? "mid" : "late", 1);
    });
    add(b, "letters", letters); add(b, "paid", paid); add(b, "rare", rare);
    const ws = (words.get(mid) ?? []).filter((w) => w[1] === b);
    add(b, "words", ws.length); add(b, "long7", ws.filter((w) => w[2].length >= 7).length);
    add(b, "wordLen", ws.reduce((s, w) => s + w[2].length, 0));
  }
}
const rows = [...prof].filter(([, p]) => p.n >= MIN).map(([b, p]) => {
  const m = (f) => (p[f] ?? 0) / p.n;
  return { name: bots.get(b)?.n ?? `#${b}`, n: p.n, win: 100 * m("win"), top2: 100 * m("top2"), last: 100 * m("last"), place: m("place"), score: m("score"),
    letters: m("letters"), early: m("early"), mid: m("mid"), late: m("late"), avgPaid: (p.paid ?? 0) / Math.max(1, p.letters ?? 0), spent: m("paid"), left: m("left"),
    rare: m("rare"), words: m("words"), long7: m("long7"), wordLen: (p.wordLen ?? 0) / Math.max(1, p.words ?? 0), ppl: (p.score ?? 0) / Math.max(1, p.letters ?? 0) };
}).sort((a, b) => a.place - b.place);
console.log(`${nMatches} all-human matches since #${SINCE}; players with ${MIN}+ matches, best mean place first\n`);
console.log("| player | n | win% | top2% | last% | place | score | letters | early/mid/late | avg paid | spent | left | rare | words | 7+ | word len | pts/letter |");
console.log("|---|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|--:|--:|--:|--:|--:|");
for (const r of rows) console.log(`| ${r.name} | ${r.n} | ${r.win.toFixed(0)} | ${r.top2.toFixed(0)} | ${r.last.toFixed(0)} | ${r.place.toFixed(2)} | ${r.score.toFixed(0)} | ${r.letters.toFixed(1)} | ${r.early.toFixed(1)}/${r.mid.toFixed(1)}/${r.late.toFixed(1)} | ${r.avgPaid.toFixed(1)} | ${r.spent.toFixed(0)} | ${r.left.toFixed(0)} | ${r.rare.toFixed(1)} | ${r.words.toFixed(1)} | ${r.long7.toFixed(2)} | ${r.wordLen.toFixed(1)} | ${r.ppl.toFixed(1)} |`);
