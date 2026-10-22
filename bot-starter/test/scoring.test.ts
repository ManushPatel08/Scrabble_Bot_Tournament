// Scoring checked against the module's math (letters.rs + lib.rs:2326-2332).
// Expected values below were computed by hand from letter_value() and
// length_multiplier() — not from our implementation.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BAG_DISTRIBUTION,
  BAG_SIZE,
  LETTER_VALUES,
  baseScore,
  lengthMultiplier,
  rewardFor,
  wordReward,
} from "../src/game/letters.ts";
import { sharedIndex } from "../src/game/dictionary.ts";

// [word, base (hand sum), reward = floor(base * num / den)]
const CASES: [string, number, number][] = [
  ["AA", 2, 2], //            1+1, x1
  ["JO", 9, 9], //            8+1, x1
  ["XU", 9, 9], //            8+1, x1
  ["CAT", 5, 5], //           3+1+1, x1
  ["DOG", 5, 5], //           2+1+2, x1
  ["ZAX", 19, 19], //         10+1+8, x1
  ["FAX", 13, 13], //         4+1+8, x1
  ["TREE", 4, 6], //          4 * 3/2
  ["BEAD", 7, 10], //         7 * 3/2 = 10.5 -> 10 (floor)
  ["WAXY", 17, 25], //        17 * 3/2 = 25.5 -> 25
  ["QUIZ", 22, 33], //        22 * 3/2
  ["JINX", 18, 27], //        18 * 3/2
  ["HOUSE", 8, 16], //        8 * 2
  ["QUEEN", 14, 28], //       14 * 2
  ["VIVID", 12, 24], //       4+1+4+1+2 = 12, x2
  ["RETAIN", 6, 15], //       6 * 5/2
  ["EQUATE", 15, 37], //      15 * 5/2 = 37.5 -> 37
  ["BRONZE", 17, 42], //      3+1+1+1+10+1 = 17, * 5/2 = 42.5 -> 42
  ["RETAINS", 7, 21], //      7 * 3
  ["JUKEBOX", 27, 81], //     8+1+5+1+3+1+8 = 27, x3
  ["MUZJIKS", 29, 87], //     3+1+10+8+1+5+1 = 29, x3
  ["STRENGTH", 12, 36], //    1+1+1+1+1+2+1+4 = 12, x3
  ["OXYPHENBUTAZONE", 41, 123], // 15 letters, x3
];

test("letter values match letters.rs:1-12", () => {
  const expect: Record<string, number> = {
    A: 1, E: 1, I: 1, O: 1, U: 1, L: 1, N: 1, S: 1, T: 1, R: 1,
    D: 2, G: 2, B: 3, C: 3, M: 3, P: 3, F: 4, H: 4, V: 4, W: 4, Y: 4,
    K: 5, J: 8, X: 8, Q: 10, Z: 10,
  };
  for (const [ch, v] of Object.entries(expect)) assert.equal(LETTER_VALUES[ch.charCodeAt(0) - 65], v, ch);
});

test("bag is the 98-tile distribution of letters.rs:14-42", () => {
  assert.equal(BAG_DISTRIBUTION.reduce((a, b) => a + b, 0), BAG_SIZE);
  assert.equal(BAG_SIZE, 98);
  assert.deepEqual(
    [...BAG_DISTRIBUTION],
    [9, 2, 2, 4, 12, 2, 3, 2, 9, 1, 1, 4, 2, 6, 8, 2, 1, 6, 4, 6, 4, 2, 2, 1, 2, 1],
  );
  const faceTotal = BAG_DISTRIBUTION.reduce((a, n, i) => a + n * LETTER_VALUES[i]!, 0);
  assert.equal(faceTotal, 187);
});

test("length multipliers match letters.rs:47-55", () => {
  const expect: [number, [number, number]][] = [
    [0, [1, 1]], [1, [1, 1]], [2, [1, 1]], [3, [1, 1]], [4, [3, 2]],
    [5, [2, 1]], [6, [5, 2]], [7, [3, 1]], [8, [3, 1]], [15, [3, 1]], [28, [3, 1]],
  ];
  for (const [len, m] of expect) assert.deepEqual(lengthMultiplier(len), m, `len ${len}`);
});

for (const [word, base, reward] of CASES) {
  test(`score ${word} = ${reward}`, () => {
    assert.ok(sharedIndex().isWord(word), `${word} should be in ENABLE`);
    assert.equal(baseScore(word), base);
    assert.equal(wordReward(word), reward);
    assert.equal(reward - base >= 0, true); // bonus = total - base is never negative
  });
}

test("integer division floors exactly like i64 (odd bases at 4 and 6 letters)", () => {
  for (let base = 1; base <= 60; base++) {
    assert.equal(rewardFor(base, 4), (base * 3 - ((base * 3) % 2)) / 2);
    assert.equal(rewardFor(base, 6), (base * 5 - ((base * 5) % 2)) / 2);
    assert.equal(rewardFor(base, 5), base * 2);
    assert.equal(rewardFor(base, 9), base * 3);
    assert.equal(rewardFor(base, 3), base);
  }
});
