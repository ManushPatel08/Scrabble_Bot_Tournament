// Compares candidate parameter variants across opponent fields with common
// random numbers (every variant sees the same seeds).
//
//   node sim/compare.ts --variants '[{"label":"default"},{"label":"mu.5","mu0":0.5}]' \
//        --fields self-v,self-f,league-v --matches 1000

import { runBatch, rows } from "./batch.ts";
import { FIELDS, fieldSpec } from "./fields.ts";
import "./strategies.ts";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : process.argv[i + 1]!;
}

const variants = JSON.parse(arg("variants", '[{"label":"default"}]')) as ({ label: string } & Record<string, number>)[];
const fields = arg("fields", "base-v,base-f,lobby-v,self-v,self-f,league-v,league-f").split(",");
const matches = Number(arg("matches", "1000"));
const seed = Number(arg("seed", "1"));

const header = ["variant", ...fields.map((f) => `${f} win/rank/score`)];
console.log(`| ${header.join(" | ")} |`);
console.log(`|${header.map(() => "---").join("|")}|`);
for (const v of variants) {
  const { label, ...params } = v;
  const cells: string[] = [];
  for (const f of fields) {
    const res = await runBatch(fieldSpec(FIELDS[f]!, params, matches, seed));
    const r = rows(res).find((x) => x.name === "cand")!;
    cells.push(`${(100 * r.winRate).toFixed(1)}% / ${r.meanRank.toFixed(2)} / ${r.meanScore.toFixed(1)}`);
  }
  console.log(`| ${label} | ${cells.join(" | ")} |`);
}
