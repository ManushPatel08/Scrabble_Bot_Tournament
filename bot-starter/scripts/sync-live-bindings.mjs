// Keeps src/module_bindings matched to the schema the live `scrabblebot`
// database runs. The SDK decodes rows by column position, so a binding that
// is off by one column can't read that table at all.
//
// The server has run two schemas:
//   - "calhacks": the published module (upstream 3064b36: Swiss rounds, a
//     cut, elimination, a best-of-3 final). `npm run generate` and the
//     checked-in web bindings produce this one.
//   - "roundrobin": an unpublished module the database ran until it was
//     reset on 2026-10-23 (round robin plus finals; RULES.md).
// This script asks the server which one it runs (public schema, read-only)
// and patches the bindings toward it, in either direction.
//
//   node scripts/sync-live-bindings.mjs [--to calhacks|roundrobin]   (idempotent)
//   node scripts/check-live-schema.mjs                               (verifies the result)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "module_bindings");
/** [file, calhacks text, roundrobin text] */
const PATCHES = [];
function patch(file, calhacks, roundrobin) {
  PATCHES.push([file, calhacks, roundrobin]);
}

// match_state: the roundrobin schema has no auction_duration_ms / starting_rack_size.
patch(
  "match_state_table.ts",
  `  endedAt: __t.option(__t.timestamp()).name("ended_at"),
  auctionDurationMs: __t.u64().name("auction_duration_ms"),
  startingRackSize: __t.u32().name("starting_rack_size"),
});`,
  `  endedAt: __t.option(__t.timestamp()).name("ended_at"),
});`,
);
patch(
  "types.ts",
  `  endedAt: __t.option(__t.timestamp()),
  auctionDurationMs: __t.u64(),
  startingRackSize: __t.u32(),
});
export type Match = `,
  `  endedAt: __t.option(__t.timestamp()),
});
export type Match = `,
);

// tournament: four u32 columns between ended_at and winner_bot_id.
patch(
  "tournament_table.ts",
  `  endedAt: __t.option(__t.timestamp()).name("ended_at"),
  winnerBotId:`,
  `  endedAt: __t.option(__t.timestamp()).name("ended_at"),
  desiredMinMatchesPerBot: __t.u32().name("desired_min_matches_per_bot"),
  actualMatchesPerBot: __t.u32().name("actual_matches_per_bot"),
  finalsSize: __t.u32().name("finals_size"),
  currentFinalsMatch: __t.u32().name("current_finals_match"),
  winnerBotId:`,
);
patch(
  "types.ts",
  `  endedAt: __t.option(__t.timestamp()),
  winnerBotId: __t.option(__t.u64()),
});
export type Tournament = `,
  `  endedAt: __t.option(__t.timestamp()),
  desiredMinMatchesPerBot: __t.u32(),
  actualMatchesPerBot: __t.u32(),
  finalsSize: __t.u32(),
  currentFinalsMatch: __t.u32(),
  winnerBotId: __t.option(__t.u64()),
});
export type Tournament = `,
);

// tournament_entry: total_score became round_robin_wins + round_robin_total_score.
patch(
  "tournament_entry_table.ts",
  `  totalScore: __t.i64().name("total_score"),`,
  `  roundRobinWins: __t.u32().name("round_robin_wins"),
  roundRobinTotalScore: __t.i64().name("round_robin_total_score"),`,
);
patch(
  "types.ts",
  `  eliminated: __t.bool(),
  totalScore: __t.i64(),`,
  `  eliminated: __t.bool(),
  roundRobinWins: __t.u32(),
  roundRobinTotalScore: __t.i64(),`,
);

// tournament_match: finals bookkeeping after phase.
patch(
  "tournament_match_table.ts",
  `  get phase() {
    return TournamentPhase;
  },
});`,
  `  get phase() {
    return TournamentPhase;
  },
  finalsMatchNumber: __t.u32().name("finals_match_number"),
  replayOfFinalsMatch: __t.option(__t.u32()).name("replay_of_finals_match"),
});`,
);
patch(
  "types.ts",
  `  get phase() {
    return TournamentPhase;
  },
});
export type TournamentMatch = `,
  `  get phase() {
    return TournamentPhase;
  },
  finalsMatchNumber: __t.u32(),
  replayOfFinalsMatch: __t.option(__t.u32()),
});
export type TournamentMatch = `,
);

// Enums decode by variant index, so the order must match the server exactly.
patch(
  "types.ts",
  `  Final: __t.unit(),
});
export type TournamentPhase = `,
  `  Final: __t.unit(),
  RoundRobin: __t.unit(),
  FinalReplay: __t.unit(),
});
export type TournamentPhase = `,
);
patch(
  "types.ts",
  `  Registration: __t.unit(),
  ForceEnded: __t.unit(),
});`,
  `  Registration: __t.unit(),
  RoundRobin: __t.unit(),
  FinalsReady: __t.unit(),
  FinalsRunning: __t.unit(),
  FinalsIntermission: __t.unit(),
  FinalsTieReplay: __t.unit(),
  Crowned: __t.unit(),
});`,
);

// ---------------------------------------------------------------- apply

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

/** Which schema the server runs, from its public schema; null if unreachable. */
async function liveVariant() {
  const host = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
  const db = process.env.STDB_DB ?? "scrabblebot";
  try {
    const res = await fetch(`${host}/v1/database/${db}/schema?version=9`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const schema = await res.json();
    const entry = schema.tables.find((t) => t.name === "tournament_entry");
    const cols = schema.typespace.types[entry.product_type_ref].Product.elements.map((e) => e.name?.some ?? e.name);
    return cols.includes("round_robin_wins") ? "roundrobin" : "calhacks";
  } catch (e) {
    console.error(`sync skipped: couldn't fetch the ${db} schema from ${host} (${e.message})`);
    return null;
  }
}

const target = arg("to") ?? (await liveVariant());
if (target === null) {
  process.exitCode = 2;
} else {
  if (target !== "calhacks" && target !== "roundrobin") throw new Error(`unknown schema ${target}`);
  let changed = 0;
  for (const [file, calhacks, roundrobin] of PATCHES) {
    const [from, to] = target === "roundrobin" ? [calhacks, roundrobin] : [roundrobin, calhacks];
    const p = path.join(dir, file);
    const src = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
    if (src.includes(to)) continue;
    if (!src.includes(from)) throw new Error(`${file}: expected text not found:\n${from}`);
    fs.writeFileSync(p, src.replace(from, to));
    changed++;
  }
  console.log(
    changed ? `patched ${changed} binding section(s) to the ${target} schema` : `bindings already match the ${target} schema`,
  );
}
