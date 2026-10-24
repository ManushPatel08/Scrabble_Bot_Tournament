// Compares the generated bindings in src/module_bindings with the schema of
// the database the bot will actually connect to. A row type that doesn't
// match the server column for column makes the SDK misread that table, so
// run this before a tournament:
//
//   node scripts/check-live-schema.mjs [--db scrabblebot] [--host https://maincloud.spacetimedb.com]
//
// Read-only: it fetches the public schema (GET .../schema) and nothing else.
// Exit code 0 = every table and enum the bindings decode matches (names and
// types, in order); 1 = mismatch; 2 = couldn't fetch the schema.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const host = arg("host", process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com");
const db = arg("db", process.env.STDB_DB ?? "scrabblebot");
const bindDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "module_bindings");

let schema;
try {
  const res = await fetch(`${host}/v1/database/${db}/schema?version=9`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  schema = await res.json();
} catch (e) {
  // Exit code 2 = couldn't check (offline, wrong host), not a mismatch.
  console.error(`schema check skipped: couldn't fetch the ${db} schema from ${host} (${e.message})`);
  process.exitCode = 2;
}
if (schema) check(schema);

function check(schema) {
  const types = schema.typespace.types;
  const nm = (n) => (n && n.some !== undefined ? n.some : n);
  const deref = (t) => (t && t.Ref !== undefined ? deref(types[t.Ref]) : t);
  const snake = (c) => c.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
  const pascal = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  let bad = 0;

  // A column type as a short string: u32, option(u64), timestamp, MatchStatus...
  const typeName = (t) => {
    if (t.Ref !== undefined) {
      const named = schema.types.find((x) => x.ty === t.Ref);
      if (named) return named.name.name;
      return typeName(types[t.Ref]);
    }
    if (t.Sum) {
      const v = t.Sum.variants;
      if (v.length === 2 && nm(v[0].name) === "some") return `option(${typeName(v[0].algebraic_type)})`;
      return "sum";
    }
    if (t.Product) {
      const f = t.Product.elements.map((e) => nm(e.name));
      if (f[0] === "__timestamp_micros_since_unix_epoch__") return "timestamp";
      if (f[0] === "__identity__") return "identity";
      if (f[0] === "__time_duration_micros__") return "timeDuration";
      return "product";
    }
    if (t.Array) return `array(${typeName(t.Array)})`;
    return Object.keys(t)[0].toLowerCase();
  };
  // The same for a bindings column: `__t.option(__t.u32()).name("x")` -> option(u32).
  const bindType = (expr) =>
    expr
      .replace(/\.(name|index)\([^)]*\)|\.(primaryKey|unique|autoInc)\(\)/g, "")
      .replace(/__t\./g, "")
      .replace(/\(\)/g, "");

  // Tables: column names and types, in order.
  const live = {};
  const liveTypes = {};
  for (const tb of schema.tables) {
    const els = types[tb.product_type_ref].Product.elements;
    live[tb.name] = els.map((e) => nm(e.name));
    liveTypes[tb.name] = els.map((e) => typeName(e.algebraic_type));
  }
  for (const f of fs.readdirSync(bindDir).filter((f) => f.endsWith("_table.ts"))) {
    const table = f.replace(/_table\.ts$/, "");
    if (!live[table]) continue; // views (my_rack, ...) aren't in the tables list
    const lines = fs.readFileSync(path.join(bindDir, f), "utf8").split("\n");
    const start = lines.findIndex((l) => l.includes("__t.row({"));
    const cols = [];
    const colTypes = [];
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      let m = line.match(/^  get (\w+)\(\)/);
      if (m) {
        // `get status() { return MatchStatus; }` or `return AuctionType.name("auction_type");`
        const ret = (lines[i + 1] || "").match(/return (\w+)(?:\.name\("(\w+)"\))?/);
        cols.push(ret?.[2] ?? snake(m[1]));
        colTypes.push(ret?.[1] ?? "?");
        continue;
      }
      m = line.match(/^  (\w+): (__t\..*?),\s*$/);
      if (m) {
        const n2 = m[2].match(/\.name\("(\w+)"\)/);
        cols.push(n2 ? n2[1] : snake(m[1]));
        colTypes.push(bindType(m[2]));
      }
    }
    const ok =
      live[table].length === cols.length &&
      live[table].every((c, i) => c === cols[i] && liveTypes[table][i] === colTypes[i]);
    if (!ok) {
      bad++;
      const fmt = (ns, ts) => ns.map((c, i) => `${c}:${ts[i]}`).join(", ");
      console.log(
        `MISMATCH table ${table}\n  live:     ${fmt(live[table], liveTypes[table])}\n  bindings: ${fmt(cols, colTypes)}`,
      );
    }
  }

  // Enums used by table columns: variant order (rows encode the variant index).
  const typesTs = fs.readFileSync(path.join(bindDir, "types.ts"), "utf8");
  const seen = new Set();
  for (const tb of schema.tables) {
    for (const e of types[tb.product_type_ref].Product.elements) {
      const d = deref(e.algebraic_type);
      if (!d?.Sum) continue;
      const variants = d.Sum.variants.map((v) => nm(v.name));
      if (variants.includes("some") && variants.includes("none")) continue;
      if (variants.includes("Interval")) continue; // ScheduleAt
      const key = variants.join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      // Find the bindings enum whose variants match these names (case-insensitively, first letter).
      const want = variants.map(pascal);
      const enums = [...typesTs.matchAll(/export const (\w+) = __t\.enum\("\w+", \{([\s\S]*?)\}\);/g)].map((m) => ({
        name: m[1],
        variants: [...m[2].matchAll(/^\s*(\w+): __t\.unit\(\)/gm)].map((x) => x[1]),
      }));
      const match = enums.find((en) => en.variants.join("|") === want.join("|"));
      if (!match) {
        bad++;
        const near = enums.find((en) => en.variants.some((v) => want.includes(v)) && en.variants.length > 1);
        console.log(
          `MISMATCH enum ${tb.name}.${nm(e.name)}\n  live:     ${want.join(", ")}\n  bindings: ${near ? `${near.name}: ${near.variants.join(", ")}` : "(none)"}`,
        );
      }
    }
  }

  // Reducers the bot calls: names and argument lists.
  const needed = { submit_bid: ["auction_id", "amount"], submit_word: ["match_id", "word"], join_lobby: [], register_for_tournament: ["tournament_id"] };
  for (const [r, args] of Object.entries(needed)) {
    const lr = schema.reducers.find((x) => x.name === r);
    // The TypeScript module names parameters in camelCase; only the order matters on the wire.
    const got = lr ? lr.params.elements.map((e) => snake(nm(e.name))) : null;
    if (!got || got.join(",") !== args.join(",")) {
      bad++;
      console.log(`MISMATCH reducer ${r}: live ${got ? `(${got.join(", ")})` : "missing"}, bot expects (${args.join(", ")})`);
    }
  }

  console.log(bad ? `${bad} mismatch(es): run node scripts/sync-live-bindings.mjs` : `bindings match the live ${db} schema`);
  // exitCode rather than process.exit(): exiting while fetch's sockets are still
  // closing trips a libuv assertion on Windows.
  process.exitCode = bad ? 1 : 0;
}
