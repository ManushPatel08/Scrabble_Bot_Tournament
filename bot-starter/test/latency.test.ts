// Acceptance: decideBid and chooseWord return in < 100 ms at p99, including
// on the largest racks seen in simulation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { collect, pct } from "../sim/latency.ts";

test("decision latency p99 < 100 ms (all racks and the largest 5%)", () => {
  const s = collect(18);
  assert.ok(s.length > 1000);
  const big = s.slice().sort((a, b) => b.rack - a.rack).slice(0, Math.floor(s.length * 0.05));
  for (const set of [s, big]) {
    assert.ok(pct(set.map((x) => x.wordMs), 99) < 100, "chooseWord p99");
    assert.ok(pct(set.map((x) => x.bidMs), 99) < 100, "decideBid p99");
  }
});
