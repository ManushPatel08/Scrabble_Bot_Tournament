// Ships a set of parameters into the defaults: rewrites the matching
// `key: value,` lines in DEFAULT_PARAMS (src/strategy/params.ts) and in the
// shared block of src/strategy/versions.ts, so that `final` and the live
// bot without overrides use them. Prints every change; refuses unknown keys.
//
//   node scripts/ship-params.mjs '{"rolloutBid":1,"rolloutSamples":48}'
//   node scripts/ship-params.mjs --dry '{"rolloutBid":1}'
//   node scripts/ship-params.mjs --file scripts/ultra-params.json

import fs from "node:fs";

const dry = process.argv.includes("--dry");
// --file <path> avoids shell quoting (PowerShell 5.1 mangles JSON passed to native programs).
const fileArg = process.argv.indexOf("--file");
const json = fileArg !== -1 ? fs.readFileSync(process.argv[fileArg + 1], "utf8") : process.argv.find((a) => a.startsWith("{"));
if (!json) throw new Error("Pass the parameters as one JSON object or --file <path>");
const params = JSON.parse(json);
for (const [k, v] of Object.entries(params)) if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${k}: numbers only`);

const files = ["src/strategy/params.ts", "src/strategy/versions.ts"];
for (const file of files) {
  let text = fs.readFileSync(file, "utf8");
  for (const [k, v] of Object.entries(params)) {
    const re = new RegExp(`^(  ${k}: )(-?[0-9.]+)(,)$`, "m");
    const m = text.match(re);
    if (!m) throw new Error(`${file}: no default line for ${k}; nothing written`);
    if (m[2] !== String(v)) {
      console.log(`${file}: ${k} ${m[2]} -> ${v}`);
      text = text.replace(re, `$1${v}$3`);
    } else console.log(`${file}: ${k} already ${v}`);
  }
  if (!dry) fs.writeFileSync(file, text);
}
console.log(dry ? "dry run; nothing written" : "written; run npm run typecheck and the tests, then commit");
