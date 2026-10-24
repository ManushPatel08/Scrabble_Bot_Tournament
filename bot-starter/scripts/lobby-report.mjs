// Live record of a bot from the public tables (read-only; an anonymous
// identity, no token): its finished matches, places, scores and head-to-head
// results against every other bot it met.
//
//   node scripts/lobby-report.mjs [--bot LetterShark] [--last 50]

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const host = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const db = process.env.STDB_DB ?? "scrabblebot";
const botName = arg("bot", "LetterShark");
const last = Number(arg("last", "1000"));

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

const bots = new Map((await sql("SELECT id, name, is_simulated FROM bot")).map(([id, name, sim]) => [id, { name, sim }]));
const me = [...bots].find(([, b]) => b.name === botName)?.[0];
if (me === undefined) throw new Error(`no bot named ${botName}`);

const mine = (await sql(`SELECT match_id FROM match_participant WHERE bot_id = ${me}`)).map(([m]) => m);
mine.sort((a, b) => a - b);
const rows = [];
for (const m of mine.slice(-last)) {
  // Enums come back as [variant index, payload]: status 0 Lobby, 1 Running, 2 Ended;
  // auction_type 0 FirstPrice, 1 Vickrey.
  const [state] = await sql(`SELECT status, auction_type FROM match_state WHERE id = ${m}`);
  if (state[0][0] !== 2) continue;
  const parts = await sql(`SELECT bot_id, score, balance FROM match_participant WHERE match_id = ${m}`);
  const myScore = parts.find(([b]) => b === me)[1];
  const place = 1 + parts.filter(([, s]) => s > myScore).length;
  rows.push({ m, auction: state[1][0] === 0 ? "first-price" : "vickrey", place, n: parts.length, myScore, parts });
}

if (rows.length === 0) {
  console.log(`${botName} (id ${me}): no finished matches yet`);
} else {
  const wins = rows.filter((r) => r.place === 1).length;
  const lastPlace = rows.filter((r) => r.place === r.n).length;
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(
    `${botName} (id ${me}): ${rows.length} finished matches, ${wins} wins (${((100 * wins) / rows.length).toFixed(1)}%), ` +
      `last place ${lastPlace}, mean place ${mean(rows.map((r) => r.place)).toFixed(2)}, mean score ${mean(rows.map((r) => r.myScore)).toFixed(1)}`,
  );
  // Head to head: matches where we finished above / below each opponent.
  const h2h = new Map();
  for (const r of rows) {
    for (const [b, s] of r.parts) {
      if (b === me) continue;
      const e = h2h.get(b) ?? { met: 0, above: 0, below: 0, diff: 0 };
      e.met++;
      if (r.myScore > s) e.above++;
      if (r.myScore < s) e.below++;
      e.diff += r.myScore - s;
      h2h.set(b, e);
    }
  }
  console.log("\nopponent                 type   met  we above  we below  mean margin");
  for (const [b, e] of [...h2h].sort((x, y) => y[1].met - x[1].met)) {
    const info = bots.get(b) ?? { name: String(b), sim: false };
    console.log(
      `${info.name.slice(0, 24).padEnd(24)} ${info.sim ? "sim  " : "human"} ${String(e.met).padStart(4)} ${String(e.above).padStart(9)} ${String(e.below).padStart(9)} ${(e.diff / e.met).toFixed(1).padStart(12)}`,
    );
  }
  console.log("\nrecent matches (newest last):");
  for (const r of rows.slice(-10)) {
    const line = r.parts
      .slice()
      .sort((a, b) => b[1] - a[1])
      .map(([b, s]) => `${bots.get(b)?.name ?? b}=${s}`)
      .join(" ");
    console.log(`  match ${r.m} (${r.auction}): place ${r.place}/${r.n} — ${line}`);
  }
}
