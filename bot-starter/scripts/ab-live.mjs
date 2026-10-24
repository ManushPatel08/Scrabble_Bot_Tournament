// Scores an interleaved live A/B (BOT_PARAMS / BOT_PARAMS_B) from the bot's
// own log: every "match N: ... [variant X]" start line paired with its
// "match N ended: place P/K, score S" line. Matches joined mid-way carry no
// variant and are skipped.
//
//   node scripts/ab-live.mjs [logs/lobby.log] [--since <match id>]

import fs from "node:fs";

const file = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "logs/lobby.log";
const i = process.argv.indexOf("--since");
const since = i === -1 ? 0 : Number(process.argv[i + 1]);

const variantOf = new Map();
const arms = { A: [], B: [] };
for (const line of fs.readFileSync(file, "utf8").split("\n")) {
  let m = line.match(/match (\d+): seat .*\[variant ([AB])\]/);
  if (m) {
    variantOf.set(Number(m[1]), m[2]);
    continue;
  }
  m = line.match(/match (\d+) ended: place (\d+)\/(\d+), score (\d+)/);
  if (m) {
    const id = Number(m[1]);
    const v = variantOf.get(id);
    if (v && id >= since) arms[v].push({ id, place: Number(m[2]), n: Number(m[3]), score: Number(m[4]) });
  }
}
for (const [v, xs] of Object.entries(arms)) {
  if (!xs.length) {
    console.log(`variant ${v}: no finished matches yet`);
    continue;
  }
  const mean = (f) => xs.reduce((a, x) => a + f(x), 0) / xs.length;
  const wins = xs.filter((x) => x.place === 1).length;
  const sd = Math.sqrt(mean((x) => (x.place - mean((y) => y.place)) ** 2));
  console.log(
    `variant ${v}: n=${xs.length} wins ${wins} (${((100 * wins) / xs.length).toFixed(0)}%) ` +
      `last ${xs.filter((x) => x.place === x.n).length} mean place ${mean((x) => x.place).toFixed(2)} (±${(sd / Math.sqrt(xs.length)).toFixed(2)}) ` +
      `mean score ${mean((x) => x.score).toFixed(0)}`,
  );
}
