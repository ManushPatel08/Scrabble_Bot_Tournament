// Live A/B: a bot's record in finished matches before and after a switch
// point (public tables, anonymous identity), split into all-human tables and
// tables with sims.
//
//   node scripts/ab-report.mjs --bot LetterShark --from 257 --switch 278 [--to <id>]

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const host = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const db = process.env.STDB_DB ?? "scrabblebot";
const botName = arg("bot", "LetterShark");
const from = Number(arg("from", "0"));
const sw = Number(arg("switch", "0"));
const to = Number(arg("to", "1e12"));

const { token } = await (await fetch(`${host}/v1/identity`, { method: "POST" })).json();
async function sql(q) {
  const res = await fetch(`${host}/v1/database/${db}/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: q,
  });
  if (!res.ok) throw new Error(`${q}: HTTP ${res.status}`);
  return (await res.json())[0].rows;
}
const bots = new Map((await sql("SELECT id, name, is_simulated FROM bot")).map(([id, name, sim]) => [id, { name, sim }]));
const me = [...bots].find(([, b]) => b.name === botName)?.[0];
if (me === undefined) throw new Error(`no bot named ${botName}`);
const mine = (await sql(`SELECT match_id FROM match_participant WHERE bot_id = ${me}`))
  .map(([m]) => m)
  .filter((m) => m >= from && m <= to)
  .sort((a, b) => a - b);

const arms = { before: { human: [], sims: [] }, after: { human: [], sims: [] } };
for (const m of mine) {
  const [st] = await sql(`SELECT status FROM match_state WHERE id = ${m}`);
  if (st[0][0] !== 2) continue; // Ended only
  const ps = await sql(`SELECT bot_id, score FROM match_participant WHERE match_id = ${m}`);
  const my = ps.find(([b]) => b === me)[1];
  const rank = 1 + ps.filter(([, s]) => s > my).length;
  const allHuman = ps.every(([b]) => !bots.get(b)?.sim);
  arms[m < sw ? "before" : "after"][allHuman ? "human" : "sims"].push({ m, rank, n: ps.length, score: my });
}
const fmt = (xs) => {
  if (!xs.length) return "n=0";
  const mean = (f) => xs.reduce((a, x) => a + f(x), 0) / xs.length;
  const wins = xs.filter((x) => x.rank === 1).length;
  const last = xs.filter((x) => x.rank === x.n).length;
  return `n=${xs.length} wins ${wins} (${((100 * wins) / xs.length).toFixed(0)}%) last ${last} mean rank ${mean((x) => x.rank).toFixed(2)} mean score ${mean((x) => x.score).toFixed(0)}`;
};
console.log(`${botName}: matches #${from}..#${sw - 1} (before) vs #${sw}.. (after)`);
for (const arm of ["before", "after"]) {
  console.log(`  ${arm.padEnd(6)} all-human: ${fmt(arms[arm].human)}`);
  console.log(`  ${"".padEnd(6)} with sims: ${fmt(arms[arm].sims)}`);
}
