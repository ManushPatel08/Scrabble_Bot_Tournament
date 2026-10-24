// ENABLE dictionary index: a trie over sorted-letter signatures.
//
// Every anagram class ("signature", e.g. AEINRST for RETAINS/STAINER/...) has
// the same length and base score, so it has the same reward. The trie lets a
// DFS over a rack visit only sub-multisets that are prefixes of some real
// signature, which is far smaller than the 2^n sub-multisets of the rack.

import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { type Counts, N_LETTERS, baseScore, rewardFor } from "./letters.ts";

export function defaultWordlistPath(): string {
  return (
    process.env.WORDLIST_PATH ??
    fileURLToPath(new URL("../../../spacetimedb/wordlist.txt", import.meta.url))
  );
}

/** Loads the wordlist the module embeds; tolerant of CRLF checkouts. */
export function loadWordlist(path: string = defaultWordlistPath()): string[] {
  const text = fs.readFileSync(path, "utf8");
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const w = raw.trim().toUpperCase();
    if (w.length >= 2 && /^[A-Z]+$/.test(w)) out.push(w);
  }
  return out;
}

export interface Partition {
  words: string[];
  reward: number;
  /** False if the exact search hit its budget and fell back to greedy. */
  exact: boolean;
}

export class WordIndex {
  readonly nWords: number;
  readonly nSigs: number;
  /** Lexicographically smallest word of each anagram class. */
  readonly sigWord: string[] = [];
  readonly sigLen: Int32Array;
  readonly sigBase: Int32Array;
  readonly sigReward: Int32Array;
  /** sigCounts[s * 26 + i] = count of letter i in signature s. */
  readonly sigCounts: Uint8Array;
  /** Bitmask of letters present in signature s. */
  readonly sigMask: Int32Array;

  private readonly wordSet: Set<string>;
  private readonly firstChild: Int32Array;
  private readonly nextSibling: Int32Array;
  private readonly nodeLetter: Uint8Array;
  private readonly nodeSig: Int32Array;

  // DFS scratch
  private out: number[] = [];
  private minLen = 2;
  private maxLen = 99;

  constructor(words: readonly string[]) {
    this.nWords = words.length;
    this.wordSet = new Set(words);

    // Words arrive in lex order, so the first word seen per signature is the
    // lexicographically smallest one (the module's tie-break, dictionary.rs:69-107).
    const sigId = new Map<string, number>();
    const sigKeys: string[] = [];
    const sorted = [...words].sort();
    for (const w of sorted) {
      const key = w.split("").sort().join("");
      if (!sigId.has(key)) {
        sigId.set(key, sigKeys.length);
        sigKeys.push(key);
        this.sigWord.push(w);
      }
    }
    const n = sigKeys.length;
    this.nSigs = n;
    this.sigLen = new Int32Array(n);
    this.sigBase = new Int32Array(n);
    this.sigReward = new Int32Array(n);
    this.sigCounts = new Uint8Array(n * N_LETTERS);
    this.sigMask = new Int32Array(n);
    let totalChars = 0;
    for (let s = 0; s < n; s++) {
      const key = sigKeys[s]!;
      const base = baseScore(key);
      this.sigLen[s] = key.length;
      this.sigBase[s] = base;
      this.sigReward[s] = rewardFor(base, key.length);
      let mask = 0;
      for (let i = 0; i < key.length; i++) {
        const c = key.charCodeAt(i) - 65;
        this.sigCounts[s * N_LETTERS + c]!++;
        mask |= 1 << c;
      }
      this.sigMask[s] = mask;
      totalChars += key.length;
    }

    // Build the trie by inserting signatures in sorted order, so a node's
    // children are appended in ascending letter order.
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) =>
      sigKeys[a]! < sigKeys[b]! ? -1 : sigKeys[a]! > sigKeys[b]! ? 1 : 0,
    );
    const cap = totalChars + 1;
    const firstChild = new Int32Array(cap).fill(-1);
    const nextSibling = new Int32Array(cap).fill(-1);
    const lastChild = new Int32Array(cap).fill(-1);
    const nodeLetter = new Uint8Array(cap);
    const nodeSig = new Int32Array(cap).fill(-1);
    let nodes = 1;
    for (const s of order) {
      const key = sigKeys[s]!;
      let node = 0;
      for (let i = 0; i < key.length; i++) {
        const c = key.charCodeAt(i) - 65;
        const last = lastChild[node]!;
        if (last !== -1 && nodeLetter[last] === c) {
          node = last;
          continue;
        }
        const fresh = nodes++;
        nodeLetter[fresh] = c;
        if (last === -1) firstChild[node] = fresh;
        else nextSibling[last] = fresh;
        lastChild[node] = fresh;
        node = fresh;
      }
      nodeSig[node] = s;
    }
    this.firstChild = firstChild.slice(0, nodes);
    this.nextSibling = nextSibling.slice(0, nodes);
    this.nodeLetter = nodeLetter.slice(0, nodes);
    this.nodeSig = nodeSig.slice(0, nodes);

    // Max reward of any signature in each subtree, for branch-and-bound.
    // Children always have higher ids than parents, so one reverse pass works.
    const sub = new Int32Array(nodes);
    for (let v = nodes - 1; v >= 0; v--) {
      let m = this.nodeSig[v]! >= 0 ? this.sigReward[this.nodeSig[v]!]! : 0;
      for (let ch = this.firstChild[v]!; ch !== -1; ch = this.nextSibling[ch]!) if (sub[ch]! > m) m = sub[ch]!;
      sub[v] = m;
    }
    this.subtreeMax = sub;
  }

  private readonly subtreeMax: Int32Array;
  private bbBest = 0;
  private bbSig = -1;
  private bbMin = 2;
  private bbExcluded: ReadonlySet<number> | undefined;

  /**
   * Highest reward of a single playable word (>= minLen letters), via
   * branch-and-bound on the subtree maxima. Returns the signature id or -1;
   * ties resolve to the first found (not the lexicographic rule).
   */
  bestRewardSig(rack: Counts, minLen = 2, excluded?: ReadonlySet<number>): number {
    this.bbBest = 0;
    this.bbSig = -1;
    this.bbMin = minLen;
    this.bbExcluded = excluded;
    this.bb(0, 0, rack);
    return this.bbSig;
  }

  private bb(node: number, depth: number, r: Counts): void {
    for (let ch = this.firstChild[node]!; ch !== -1; ch = this.nextSibling[ch]!) {
      if (this.subtreeMax[ch]! <= this.bbBest) continue;
      const c = this.nodeLetter[ch]!;
      if (r[c] === 0) continue;
      r[c]!--;
      const s = this.nodeSig[ch]!;
      if (s !== -1 && !this.bbExcluded?.has(s) && depth + 1 >= this.bbMin && this.sigReward[s]! > this.bbBest) {
        this.bbBest = this.sigReward[s]!;
        this.bbSig = s;
      }
      this.bb(ch, depth + 1, r);
      r[c]!++;
    }
  }

  /** Total reward of greedily taking the highest-reward word until none fits. */
  greedyValue(rack: Counts, minLen = 2): number {
    const r = rack.slice();
    let total = 0;
    for (;;) {
      const s = this.bestRewardSig(r, minLen);
      if (s === -1) return total;
      total += this.sigReward[s]!;
      this.subtract(r, s);
    }
  }

  /** Try several first words before finishing greedily; includes the greedy plan. */
  lookaheadValue(rack: Counts, width = 2): number {
    const excluded = new Set<number>();
    const first: number[] = [];
    for (let k = 0; k < Math.min(4, width); k++) {
      const s = this.bestRewardSig(rack, 2, excluded);
      if (s === -1) break;
      first.push(s);
      excluded.add(s);
    }
    let best = 0;
    const r = rack.slice();
    for (const s of first) {
      this.subtract(r, s);
      best = Math.max(best, this.sigReward[s]! + this.greedyValue(r, 2));
      this.add(r, s);
    }
    return best;
  }

  isWord(word: string): boolean {
    return this.wordSet.has(word.toUpperCase());
  }

  /** All signatures spellable from `rack` with minLen <= length <= maxLen. */
  playable(rack: Counts, minLen = 2, maxLen = 99): number[] {
    this.out = [];
    this.minLen = minLen;
    this.maxLen = maxLen;
    const r = rack.slice();
    this.dfs(0, 0, r);
    return this.out;
  }

  private dfs(node: number, depth: number, r: number[]): void {
    if (depth >= this.maxLen) return;
    for (let ch = this.firstChild[node]!; ch !== -1; ch = this.nextSibling[ch]!) {
      const c = this.nodeLetter[ch]!;
      if (r[c] === 0) continue;
      r[c]!--;
      const s = this.nodeSig[ch]!;
      if (s !== -1 && depth + 1 >= this.minLen) this.out.push(s);
      this.dfs(ch, depth + 1, r);
      r[c]!++;
    }
  }

  /**
   * Longest playable word, ties broken lexicographically — the rule used by
   * the module's sims (find_best_playable) and by the starter's chooseWord.
   */
  longestWord(rack: Counts, minLen = 2): string | null {
    let best: string | null = null;
    let bestLen = 0;
    for (const s of this.playable(rack, minLen)) {
      const len = this.sigLen[s]!;
      const w = this.sigWord[s]!;
      if (len > bestLen || (len === bestLen && w < best!)) {
        best = w;
        bestLen = len;
      }
    }
    return best;
  }

  /** Highest-reward single word (ties: fewer letters, then lexicographic). */
  bestWord(rack: Counts, minLen = 2, maxLen = 99): number {
    let best = -1;
    for (const s of this.playable(rack, minLen, maxLen)) {
      if (best === -1) {
        best = s;
        continue;
      }
      const d = this.sigReward[s]! - this.sigReward[best]!;
      if (
        d > 0 ||
        (d === 0 &&
          (this.sigLen[s]! < this.sigLen[best]! ||
            (this.sigLen[s] === this.sigLen[best] && this.sigWord[s]! < this.sigWord[best]!)))
      )
        best = s;
    }
    return best;
  }

  fits(rack: Counts, s: number): boolean {
    const o = s * N_LETTERS;
    const sc = this.sigCounts;
    for (let i = 0; i < N_LETTERS; i++) if (sc[o + i]! > rack[i]!) return false;
    return true;
  }

  subtract(rack: Counts, s: number): void {
    const o = s * N_LETTERS;
    for (let i = 0; i < N_LETTERS; i++) rack[i]! -= this.sigCounts[o + i]!;
  }

  add(rack: Counts, s: number): void {
    const o = s * N_LETTERS;
    for (let i = 0; i < N_LETTERS; i++) rack[i]! += this.sigCounts[o + i]!;
  }

  /**
   * Maximum-total-reward set of disjoint words from `rack` (letters may be
   * left over). Exact memoised search: the lowest letter present is either
   * discarded or used by some word containing it. Falls back to greedy when
   * the state budget is exceeded.
   */
  bestPartition(rack: Counts, minLen = 2, budget = 200_000, deadlineMs = Infinity): Partition {
    const deadline = performance.now() + deadlineMs;
    const cands = this.playable(rack, minLen);
    if (cands.length === 0) return { words: [], reward: 0, exact: true };
    const byLetter: number[][] = Array.from({ length: N_LETTERS }, () => []);
    for (const s of cands) {
      const m = this.sigMask[s]!;
      for (let c = 0; c < N_LETTERS; c++) if (m & (1 << c)) byLetter[c]!.push(s);
    }
    const memo = new Map<string, number>();
    const choice = new Map<string, number>(); // -1 = drop lowest letter
    let states = 0;
    let aborted = false;
    const r = rack.slice();
    const solve = (): number => {
      const key = String.fromCharCode(...r);
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
      if (aborted) return 0;
      if (++states > budget || ((states & 1023) === 0 && performance.now() > deadline)) {
        aborted = true;
        return 0;
      }
      let c = 0;
      while (c < N_LETTERS && r[c] === 0) c++;
      if (c === N_LETTERS) {
        memo.set(key, 0);
        return 0;
      }
      r[c]!--;
      let best = solve();
      r[c]!++;
      let pick = -1;
      for (const s of byLetter[c]!) {
        if (!this.fits(r, s)) continue;
        this.subtract(r, s);
        const v = this.sigReward[s]! + solve();
        this.add(r, s);
        if (v > best) {
          best = v;
          pick = s;
        }
      }
      if (!aborted) {
        memo.set(key, best);
        choice.set(key, pick);
      }
      return best;
    };
    const total = solve();
    if (aborted) return this.greedyPartition(rack, minLen);
    const words: string[] = [];
    const cur = rack.slice();
    for (;;) {
      const key = String.fromCharCode(...cur);
      if (!choice.has(key)) break;
      const pick = choice.get(key)!;
      if (pick === -1) {
        let c = 0;
        while (cur[c] === 0) c++;
        cur[c]!--;
      } else {
        words.push(this.sigWord[pick]!);
        this.subtract(cur, pick);
      }
    }
    return { words, reward: total, exact: true };
  }

  /** Repeatedly takes the highest-reward word. */
  greedyPartition(rack: Counts, minLen = 2): Partition {
    const r = rack.slice();
    const words: string[] = [];
    let reward = 0;
    for (;;) {
      const s = this.bestWord(r, minLen);
      if (s === -1) break;
      words.push(this.sigWord[s]!);
      reward += this.sigReward[s]!;
      this.subtract(r, s);
    }
    return { words, reward, exact: false };
  }
}

let shared: WordIndex | null = null;

/** Process-wide index over the module's wordlist (built once, ~1 s). */
export function sharedIndex(): WordIndex {
  if (!shared) shared = new WordIndex(loadWordlist());
  return shared;
}
