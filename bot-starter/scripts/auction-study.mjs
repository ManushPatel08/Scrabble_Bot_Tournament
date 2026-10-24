// Anonymous, public, read-only study. Archives every completed match winner
// and winning bid, with a shortlist of possible late word-completion swings.
import fs from "node:fs";
import path from "node:path";

const host = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const db = process.env.STDB_DB ?? "scrabblebot";
const { token } = await (await fetch(`${host}/v1/identity`, { method: "POST" })).json();
const sql = async (q) => {
  const r = await fetch(`${host}/v1/database/${db}/sql`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: q });
  if (!r.ok) throw new Error(`Public query failed: ${r.status}`);
  return (await r.json())[0].rows;
};
const bots = new Map((await sql("SELECT id, name, is_simulated FROM bot")).map(([id, name, sim]) => [id, { name, sim }]));
for (const [id, name] of [[61, "LetterSharkX (retired)"], [70, "LetterSharkPro (retired)"]]) bots.set(id, { name, sim: false });
const ended = new Set((await sql("SELECT id, status FROM match_state")).filter(([, s]) => s[0] === 2).map(([id]) => id));
const group = (rows) => {
  const out = new Map();
  for (const [mid, ...r] of rows) {
    if (!ended.has(mid)) continue;
    if (!out.has(mid)) out.set(mid, []);
    out.get(mid).push(r);
  }
  return out;
};
const parts = group(await sql("SELECT match_id, bot_id, score, balance FROM match_participant"));
const results = group(await sql("SELECT match_id, auction_id, letter, winner_bot_id, paid, closed_at FROM auction_result"));
const tops = group(await sql("SELECT match_id, auction_id, top_bid FROM auction_top_bid_archive"));
const words = group(await sql("SELECT match_id, bot_id, word, total_reward, played_at FROM word_play"));
const all = [], prices = new Map(), swings = [];
let human = 0, auctions = 0, ties = 0;
const name = (id) => bots.get(id)?.name ?? `bot #${id}`;
for (const [mid, ps] of [...parts].sort((a, b) => a[0] - b[0])) {
  const sorted = ps.slice().sort((a, b) => b[1] - a[1]);
  if (sorted.length < 2) continue;
  const rs = (results.get(mid) ?? []).sort((a, b) => a[0] - b[0]);
  const ts = new Map(tops.get(mid) ?? []);
  const ws = (words.get(mid) ?? []).sort((a, b) => a[3][0] - b[3][0]);
  const isHuman = ps.length >= 4 && ps.every(([id]) => !bots.get(id)?.sim);
  const tied = sorted[0][1] === sorted[1][1];
  const winners = sorted.filter(([, score]) => score === sorted[0][1]).map(([id]) => id);
  const row = { matchId: mid, allHuman: isHuman, seats: ps.length, winners: winners.map(name), score: sorted[0][1], margin: sorted[0][1] - sorted[1][1],
    participants: ps.map(([id, score, balance]) => ({ botId: id, name: name(id), score, balance })),
    auctions: rs.map(([id, letter, winner, paid, at], i) => ({ auctionId: id, round: i + 1, letter, winner: winner[0] === 0 ? winner[1] : null,
      winnerName: winner[0] === 0 ? name(winner[1]) : null, paid, topBid: ts.get(id) ?? null, closedAt: at[0] })),
    words: ws.map(([id, word, reward, at]) => ({ botId: id, word, reward, playedAt: at[0] })) };
  all.push(row); auctions += rs.length;
  if (!isHuman) continue;
  if (tied) { ties++; continue; }
  human++;
  for (const a of row.auctions) {
    if (a.topBid === null || a.winner === null) continue;
    const stage = a.round <= rs.length / 3 ? 0 : a.round <= 2 * rs.length / 3 ? 1 : 2;
    const key = `${a.letter}:${stage}`;
    if (!prices.has(key)) prices.set(key, []);
    prices.get(key).push(a.topBid);
    // A near-term word using the bought letter is only a possible completion:
    // unknown dealt letters and alternative word choices prevent causal proof.
    if (!winners.includes(a.winner) || stage !== 2) continue;
    const next = row.words.find((w) => w.botId === a.winner && w.playedAt >= a.closedAt && w.playedAt - a.closedAt <= 5_000_000 && w.word.includes(a.letter));
    if (next && next.reward > row.margin) swings.push({ mid, bot: a.winnerName, margin: row.margin, round: a.round, letter: a.letter,
      bid: a.topBid, paid: a.paid, word: next.word, reward: next.reward });
  }
}
const quantile = (xs, p) => { const a = xs.slice().sort((a, b) => a - b); return a[Math.floor((a.length - 1) * p)]; };
const lines = ["# Public auction study", "", `Snapshot ${new Date().toISOString()}: ${all.length} completed matches, ${auctions} auction results, ${human} all-human sole-winner matches (${ties} tied matches excluded from price study).`, "",
  "Winning bids are descriptive; they are published after matches and are never read from a live private bid table.", "", "## Price to beat, by letter and match third", "",
  "| Letter | Early median (n) | Middle median (n) | Late median (n) |", "|---|---:|---:|---:|"];
for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") lines.push(`| ${ch} | ${[0, 1, 2].map((stage) => { const a = prices.get(`${ch}:${stage}`) ?? []; return a.length ? `${quantile(a, .5)} (${a.length})` : "—"; }).join(" | ")} |`);
lines.push("", "## Potential late auction swings", "", "A winning purchase followed within five seconds by a word using that letter, where the word reward exceeds the final winning margin. These are review candidates, not causal proof: initial racks and alternative words are unknown.", "",
  "| Match | Winner | Margin | Round | Tile | Winning bid | Paid | Next word | Reward |", "|---|---|---:|---:|---|---:|---:|---|---:|");
for (const s of swings.sort((a, b) => a.margin - b.margin || b.reward - a.reward).slice(0, 100)) lines.push(`| ${s.mid} | ${s.bot} | ${s.margin} | ${s.round} | ${s.letter} | ${s.bid} | ${s.paid} | ${s.word} | ${s.reward} |`);
lines.push("", "## Every completed match winner", "", "| Match | Human table | Winner(s) | Score | Margin |", "|---|---|---|---:|---:|");
for (const m of all) lines.push(`| ${m.matchId} | ${m.allHuman ? "yes" : "no"} | ${m.winners.join(", ")} | ${m.score} | ${m.margin} |`);
fs.mkdirSync("sim/replay", { recursive: true });
fs.writeFileSync("sim/replay/public-auction-study.json", JSON.stringify({ generatedAt: new Date().toISOString(), matches: all, prices: Object.fromEntries(prices), swings }));
const out = "sim/experiments/91-public-auction-study.md";
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, lines.join("\n") + "\n");
console.log(`${all.length} completed matches, ${auctions} auctions, ${human} all-human sole winners, ${swings.length} potential late swings; wrote ${out}`);
