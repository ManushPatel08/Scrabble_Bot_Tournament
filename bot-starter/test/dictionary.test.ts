// Word finder vs brute force over the full wordlist.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWordlist, sharedIndex } from "../src/game/dictionary.ts";
import {
  BAG_DISTRIBUTION,
  type Counts,
  N_LETTERS,
  canSpell,
  countsOf,
  emptyCounts,
  countsToMap,
  wordReward,
} from "../src/game/letters.ts";
import { Rng } from "../src/game/rng.ts";
import { chooseWord as starterChooseWord } from "../sim/baselines/starter-strategy.ts";

const words = loadWordlist();
const idx = sharedIndex();

function randomRack(rng: Rng, size: number): Counts {
  const pool: number[] = [];
  BAG_DISTRIBUTION.forEach((n, c) => {
    for (let k = 0; k < n; k++) pool.push(c);
  });
  rng.shuffle(pool);
  const r = emptyCounts();
  for (let k = 0; k < size; k++) r[pool[k]!]!++;
  return r;
}

function brutePlayable(rack: Counts, minLen: number): string[] {
  return words.filter((w) => w.length >= minLen && canSpell(rack, w));
}

test("wordlist loads every ENABLE word (CRLF-safe)", () => {
  assert.equal(words.length, 172820);
  assert.ok(idx.isWord("AARDVARK"));
  assert.ok(idx.isWord("jo"));
  assert.ok(!idx.isWord("QI")); // ENABLE predates QI/ZA: Q is hard to place
  assert.ok(!idx.isWord("QX"));
  assert.ok(!idx.isWord("A")); // module requires >= 2 letters
});

test("playable/bestWord/longestWord agree with brute force on 150 random racks", () => {
  const rng = new Rng(42);
  for (let t = 0; t < 150; t++) {
    const rack = randomRack(rng, 2 + (t % 13));
    for (const minLen of [2, 3, 7]) {
      const brute = brutePlayable(rack, minLen);
      const sigs = idx.playable(rack, minLen);
      const fromIdx = new Set<string>();
      for (const s of sigs) fromIdx.add(idx.sigWord[s]!.split("").sort().join(""));
      const fromBrute = new Set(brute.map((w) => w.split("").sort().join("")));
      assert.deepEqual([...fromIdx].sort(), [...fromBrute].sort(), `signatures, minLen ${minLen}`);

      const bestReward = brute.reduce((m, w) => Math.max(m, wordReward(w)), 0);
      const b = idx.bestWord(rack, minLen);
      assert.equal(b === -1 ? 0 : idx.sigReward[b], bestReward);

      // Module/starter tie-break: longest, then lexicographically first.
      const longest = brute.reduce<string | null>(
        (best, w) => (best === null || w.length > best.length || (w.length === best.length && w < best) ? w : best),
        null,
      );
      assert.equal(idx.longestWord(rack, minLen), longest);
    }
  }
});

test("fast longestWord(rack, 2) equals the unmodified starter chooseWord", () => {
  // Same dictionary prep as the starter's index.ts:109-116.
  const dict = words.slice().sort((a, b) => b.length - a.length);
  const rng = new Rng(7);
  for (let t = 0; t < 40; t++) {
    const rack = randomRack(rng, 3 + (t % 10));
    assert.equal(idx.longestWord(rack, 2), starterChooseWord({ myRack: countsToMap(rack), dictionary: dict }));
  }
});

function brutePartition(rack: Counts, cands: string[]): number {
  let best = 0;
  for (let i = 0; i < cands.length; i++) {
    const w = cands[i]!;
    if (!canSpell(rack, w)) continue;
    const r = rack.slice();
    for (const ch of w) r[ch.charCodeAt(0) - 65]!--;
    best = Math.max(best, wordReward(w) + brutePartition(r, cands.slice(i)));
  }
  return best;
}

test("bestPartition is optimal (vs exhaustive search) on 60 random racks of 4-9 tiles", () => {
  const rng = new Rng(99);
  for (let t = 0; t < 60; t++) {
    const rack = randomRack(rng, 4 + (t % 6));
    const cands = brutePlayable(rack, 2);
    const p = idx.bestPartition(rack);
    assert.equal(p.reward, brutePartition(rack, cands));
    // The returned words are real, disjoint and add up.
    const used = emptyCounts();
    let sum = 0;
    for (const w of p.words) {
      assert.ok(idx.isWord(w));
      sum += wordReward(w);
      const c = countsOf(w);
      for (let i = 0; i < N_LETTERS; i++) used[i]! += c[i]!;
    }
    for (let i = 0; i < N_LETTERS; i++) assert.ok(used[i]! <= rack[i]!);
    assert.equal(sum, p.reward);
  }
});

test("word search is fast on large racks (< 50 ms)", () => {
  const rng = new Rng(5);
  let worst = 0;
  for (let t = 0; t < 30; t++) {
    const rack = randomRack(rng, 20 + (t % 11));
    const t0 = performance.now();
    idx.bestWord(rack, 2);
    idx.longestWord(rack, 2);
    worst = Math.max(worst, performance.now() - t0);
  }
  assert.ok(worst < 50, `worst ${worst.toFixed(1)} ms`);
});
