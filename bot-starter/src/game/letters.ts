// Game constants and scoring, mirrored from spacetimedb/src/letters.rs and
// spacetimedb/src/lib.rs. See RULES.md for citations.

export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const N_LETTERS = 26;

/** A multiset of letters: counts[i] is the number of ALPHABET[i]. */
export type Counts = number[];

// letters.rs:1-12
export const LETTER_VALUES: readonly number[] = [
  1, 3, 3, 2, 1, 4, 2, 4, 1, 8, 5, 1, 3, // A-M
  1, 1, 3, 10, 1, 1, 1, 1, 4, 4, 8, 4, 10, // N-Z
];

// letters.rs:14-42 (98 tiles, no blanks)
export const BAG_DISTRIBUTION: readonly number[] = [
  9, 2, 2, 4, 12, 2, 3, 2, 9, 1, 1, 4, 2, // A-M
  6, 8, 2, 1, 6, 4, 6, 4, 2, 2, 1, 2, 1, // N-Z
];

export const BAG_SIZE = 98;
export const STARTING_BALANCE = 100; // lib.rs:12
export const STARTING_RACK_SIZE = 5; // lib.rs:27
export const AUCTION_RESERVE = 1; // lib.rs:14
export const MIN_WORD_LENGTH = 2; // lib.rs:1341

export type AuctionType = "Vickrey" | "FirstPrice";

export const VOWELS: readonly boolean[] = Array.from(ALPHABET, (c) => "AEIOU".includes(c));

export function letterIndex(ch: string): number {
  return ch.charCodeAt(0) - 65;
}

export function letterAt(i: number): string {
  return ALPHABET[i]!;
}

export function emptyCounts(): Counts {
  return new Array<number>(N_LETTERS).fill(0);
}

export function countsOf(word: string): Counts {
  const c = emptyCounts();
  for (let i = 0; i < word.length; i++) c[word.charCodeAt(i) - 65]!++;
  return c;
}

export function countsFromMap(m: Map<string, number>): Counts {
  const c = emptyCounts();
  for (const [k, v] of m) c[letterIndex(k)]! += v;
  return c;
}

export function countsToMap(c: Counts): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < N_LETTERS; i++) if (c[i]! > 0) m.set(ALPHABET[i]!, c[i]!);
  return m;
}

export function countsToString(c: Counts): string {
  let s = "";
  for (let i = 0; i < N_LETTERS; i++) s += ALPHABET[i]!.repeat(c[i]!);
  return s;
}

export function totalCount(c: Counts): number {
  let n = 0;
  for (let i = 0; i < N_LETTERS; i++) n += c[i]!;
  return n;
}

/** True if `word` can be spelled from `rack` (multiset containment). */
export function canSpell(rack: Counts, word: string): boolean {
  const need = countsOf(word);
  for (let i = 0; i < N_LETTERS; i++) if (need[i]! > rack[i]!) return false;
  return true;
}

// letters.rs:47-55 — (numerator, denominator)
export function lengthMultiplier(len: number): [number, number] {
  if (len <= 3) return [1, 1];
  if (len === 4) return [3, 2];
  if (len === 5) return [2, 1];
  if (len === 6) return [5, 2];
  return [3, 1];
}

export function baseScore(word: string): number {
  let s = 0;
  for (let i = 0; i < word.length; i++) s += LETTER_VALUES[word.charCodeAt(i) - 65]!;
  return s;
}

/** lib.rs:2326-2331 — base * num / den with i64 (floor) division. */
export function rewardFor(base: number, len: number): number {
  const [num, den] = lengthMultiplier(len);
  return Math.floor((base * num) / den);
}

export function wordReward(word: string): number {
  return rewardFor(baseScore(word), word.length);
}
