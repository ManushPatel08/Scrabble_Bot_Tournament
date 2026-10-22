// Patches src/module_bindings (generated from the published module source)
// to the schema the live `scrabblebot` database actually runs. The live
// module is newer than any published commit: it dropped two match_state
// columns, added round-robin/finals columns to the tournament tables and
// reordered the tournament enums. The SDK decodes rows positionally, so
// without this the bot can't read match_state at all.
//
//   node scripts/sync-live-bindings.mjs     (idempotent; re-run after `npm run generate`)
//   node scripts/check-live-schema.mjs      (verifies the result against the server)
//
// Only the files below change; everything else in the bindings already matches.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "module_bindings");
let changed = 0;

/** Replace `from` with `to` in a file unless `to` is already there. */
function patch(file, from, to) {
  const p = path.join(dir, file);
  const src = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  if (src.includes(to)) return;
  if (!src.includes(from)) throw new Error(`${file}: expected text not found:\n${from}`);
  fs.writeFileSync(p, src.replace(from, to));
  changed++;
}

// match_state: live has no auction_duration_ms / starting_rack_size.
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

console.log(changed ? `patched ${changed} binding section(s)` : "bindings already synced");
