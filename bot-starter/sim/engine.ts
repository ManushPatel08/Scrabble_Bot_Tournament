// Headless replica of one ScrabbleBot match, following the tournament
// ("Calhacks") version of the module: spacetimedb/src/game.ts at upstream
// commit 3064b36. (The earlier Rust lib.rs behaved the same except for the
// two points marked NEW.)
//
// Reproduced exactly:
//  - 98-tile bag, uniform draws; `rackSize` tiles (default 5, admin-set via
//    setMatchmakerConfig) dealt per bot in participant order before the first
//    auction (game.ts:236-327, 672-693)
//  - sims bid inside the auction-opening transaction with their balance at
//    that moment; NEW: each sim bid is base + a uniform jitter in [-2, 2],
//    floored at 1 and capped at balance (game.ts:697-752)
//  - only bids > 0 count; highest wins; NEW: equal bids are shuffled, so ties
//    are random (game.ts:483-488)
//  - Vickrey: single bidder pays min(1, bid), else the second-highest bid;
//    first-price: own bid (game.ts:490-502)
//  - unsold letters are discarded (nothing returns them to the bag)
//  - a sim that wins immediately plays its longest >=3-letter word,
//    lexicographic tie-break (game.ts:541-543, 777-797; dictionary.ts:69-106)
//  - the match ends in the same step that closes the auction after which the
//    bag is empty, so the final letter can't be played by external bots
//    (game.ts:545-557)
//  - word rules: >=2 letters, A-Z, in ENABLE, owned; reward floors
//    base*num/den into balance and score (index.ts:684-716, game.ts:598-670)
//  - placings shared on equal scores (tournament.ts:385-386, game.ts:432)
//
// Timing is abstracted to "decide during the auction window": every external
// bot sees the state at auction open, plays words, then bids.

import { WordIndex, sharedIndex } from "../src/game/dictionary.ts";
import {
  AUCTION_RESERVE,
  type AuctionType,
  BAG_DISTRIBUTION,
  BAG_SIZE,
  type Counts,
  LETTER_VALUES,
  N_LETTERS,
  STARTING_BALANCE,
  STARTING_RACK_SIZE,
  VOWELS,
  canSpell,
  emptyCounts,
  letterAt,
  wordReward,
} from "../src/game/letters.ts";
import { Rng } from "../src/game/rng.ts";
import type { AuctionOutcome, Policy, SimStrategy, WordPlayed } from "../src/game/types.ts";

export interface SeatSpec {
  name: string;
  /** External bot (connects through the public API). */
  make?: () => Policy;
  /** Module-driven sim bot. */
  sim?: SimStrategy;
  /** Registered but never connected (visible to others via bot_credential.connected). */
  offline?: boolean;
}

export interface MatchOptions {
  auctionType: AuctionType;
  seed: number;
  index?: WordIndex;
  /** Tiles dealt to each bot (matchmaker config, default 5). */
  rackSize?: number;
  /** Record per-decision wall time (ms) for external seats. */
  timings?: boolean;
  /** Call prepareNext() after each decision, like the live client (true = all seats, or seat names). */
  prepare?: boolean | string[];
  /** Seats whose bids always insert before the others (a faster network); they win ties. */
  priority?: string[];
  /** Test hook: ground truth at each auction open (before bots act). */
  observe?: (o: { round: number; bag: Counts; dealt: Counts[]; racks: Counts[] }) => void;
}

export interface SeatResult {
  name: string;
  score: number;
  balance: number;
  /** 1 = first place. */
  rank: number;
  lettersWon: number;
  spent: number;
  wordsPlayed: number;
  rejectedWords: number;
  rejectedBids: number;
  unplayedTiles: number;
  decisionMs: number[];
}

export interface MatchResult {
  seats: SeatResult[];
  auctions: number;
  unsold: number;
}

/** How far a sim's bid wanders either side of its base (game.ts:697-699). */
export const SIM_BID_JITTER = 2;

/** A sim's base bid before jitter (game.ts:709-725). */
export function simBaseBid(strategy: SimStrategy, letter: number): number {
  const value = LETTER_VALUES[letter]!;
  if (strategy === "Cheapskate") return value - 1;
  if (strategy === "ValueBidder") return value;
  return value + (VOWELS[letter] ? 4 : 2);
}

/** game.ts:703-727: max(min(max(base + jitter, 1), balance), 0); jitter in [-2, 2]. */
export function simBid(strategy: SimStrategy, letter: number, balance: number, jitter = 0): number {
  return Math.max(Math.min(Math.max(simBaseBid(strategy, letter) + jitter, 1), balance), 0);
}

export interface Bid {
  player: number;
  amount: number;
}

/**
 * game.ts:483-502. Bids <= 0 are ignored. The module shuffles the bids and
 * then stable-sorts by amount, so equal bids land in random order: pass
 * `rng` to do the same (without it, ties go to the earlier bid in `bids`).
 */
export function resolveAuction(
  bids: readonly Bid[],
  auctionType: AuctionType,
  rng?: Rng,
): { winner: number | null; paid: number } {
  const positive = bids.filter((b) => b.amount > 0);
  if (rng) rng.shuffle(positive);
  const sorted = positive.sort((a, b) => b.amount - a.amount); // stable
  if (sorted.length === 0) return { winner: null, paid: 0 };
  const top = sorted[0]!;
  if (auctionType === "FirstPrice") return { winner: top.player, paid: top.amount };
  const paid = sorted.length === 1 ? Math.min(AUCTION_RESERVE, top.amount) : sorted[1]!.amount;
  return { winner: top.player, paid };
}

interface Player {
  spec: SeatSpec;
  policy: Policy | null;
  rack: Counts;
  balance: number;
  score: number;
  lettersWon: number;
  spent: number;
  wordsPlayed: number;
  rejectedWords: number;
  rejectedBids: number;
  decisionMs: number[];
}

export function runMatch(specs: SeatSpec[], opt: MatchOptions): MatchResult {
  const index = opt.index ?? sharedIndex();
  const root = new Rng(opt.seed);
  // Separate streams: the tile sequence depends only on the seed, not on
  // what the bots do (common random numbers across strategy variants).
  const bagRng = root.fork(1);
  const orderRng = root.fork(2);
  const policySeedRng = root.fork(3);
  const simRng = root.fork(4); // sims' bid jitter
  const tieRng = root.fork(5); // the module's shuffle before sorting bids

  const bag = BAG_DISTRIBUTION.slice();
  let bagTotal = BAG_SIZE;
  const draw = (): number => {
    if (bagTotal === 0) return -1;
    let idx = bagRng.int(bagTotal);
    for (let c = 0; c < N_LETTERS; c++) {
      if (idx < bag[c]!) {
        bag[c]!--;
        bagTotal--;
        return c;
      }
      idx -= bag[c]!;
    }
    throw new Error("bag accounting");
  };

  const players: Player[] = specs.map((spec) => ({
    spec,
    policy: null,
    rack: emptyCounts(),
    balance: STARTING_BALANCE,
    score: 0,
    lettersWon: 0,
    spent: 0,
    wordsPlayed: 0,
    rejectedWords: 0,
    rejectedBids: 0,
    decisionMs: [],
  }));
  const n = players.length;

  for (const p of players) {
    for (let k = 0; k < (opt.rackSize ?? STARTING_RACK_SIZE); k++) {
      const c = draw();
      if (c < 0) break;
      p.rack[c]!++;
    }
  }
  const dealt = players.map((p) => p.rack.slice());

  const names = specs.map((s) => s.name);
  const simStrategies = specs.map((s) => s.sim ?? null);
  const external: number[] = [];
  players.forEach((p, i) => {
    if (p.spec.sim) return;
    if (!p.spec.make) throw new Error(`seat ${p.spec.name} has neither make nor sim`);
    p.policy = p.spec.make();
    external.push(i);
    p.policy.onMatchStart({
      seat: i,
      nPlayers: n,
      names,
      simStrategies,
      auctionType: opt.auctionType,
      rack: p.rack.slice(),
      seed: policySeedRng.nextU32(),
      offline: specs.map((s) => !!s.offline),
    });
  });

  const broadcastWord = (w: WordPlayed) => {
    for (const i of external) players[i]!.policy!.onWordPlayed(w);
  };
  const playWord = (i: number, raw: string): WordPlayed | null => {
    const p = players[i]!;
    const word = String(raw).toUpperCase();
    if (word.length < 2 || !/^[A-Z]+$/.test(word) || !index.isWord(word) || !canSpell(p.rack, word)) {
      p.rejectedWords++;
      return null;
    }
    for (let k = 0; k < word.length; k++) p.rack[word.charCodeAt(k) - 65]!--;
    const reward = wordReward(word);
    p.balance += reward;
    p.score += reward;
    p.wordsPlayed++;
    return { player: i, word, reward };
  };

  let letter = draw();
  if (letter < 0) throw new Error("Bag empty");
  let round = 1;
  let auctions = 0;
  let unsold = 0;

  for (;;) {
    auctions++;
    const bids: { player: number; amount: number }[] = [];
    // Sims bid inside the opening transaction (earliest insert ids).
    for (let i = 0; i < n; i++) {
      const s = players[i]!.spec.sim;
      if (!s) continue;
      const jitter = simRng.int(2 * SIM_BID_JITTER + 1) - SIM_BID_JITTER;
      const amount = simBid(s, letter, players[i]!.balance, jitter);
      if (amount > 0) bids.push({ player: i, amount });
    }

    opt.observe?.({ round, bag: bag.slice(), dealt, racks: players.map((p) => p.rack.slice()) });
    const balancesAtOpen = players.map((p) => p.balance);
    const scoresAtOpen = players.map((p) => p.score);
    let order = orderRng.shuffle(external.slice());
    if (opt.priority) {
      const first = order.filter((i) => opt.priority!.includes(players[i]!.spec.name));
      order = [...first, ...order.filter((i) => !first.includes(i))];
    }
    const plays: WordPlayed[] = [];
    for (const i of order) {
      const p = players[i]!;
      const t0 = opt.timings ? performance.now() : 0;
      const dec = p.policy!.onAuction({
        round,
        letter: letterAt(letter),
        bagTotal,
        rack: p.rack.slice(),
        balances: balancesAtOpen,
        scores: scoresAtOpen,
      });
      if (opt.timings) p.decisionMs.push(performance.now() - t0);
      if (opt.prepare === true || (Array.isArray(opt.prepare) && opt.prepare.includes(p.spec.name)))
        (p.policy as { prepareNext?: () => void }).prepareNext?.();
      for (const w of dec.words) {
        const played = playWord(i, w);
        if (played) plays.push(played);
      }
      const amount = Math.floor(Number(dec.bid) || 0);
      if (amount <= 0) continue;
      if (amount > p.balance) {
        p.rejectedBids++;
        continue;
      }
      bids.push({ player: i, amount });
    }
    for (const w of plays) broadcastWord(w);

    const { winner, paid } = resolveAuction(bids, opt.auctionType, tieRng);
    if (winner !== null) {
      const w = players[winner]!;
      if (w.balance >= paid) {
        w.balance -= paid;
        w.spent += paid;
        w.rack[letter]!++;
        w.lettersWon++;
      }
    } else {
      unsold++;
    }
    const outcome: AuctionOutcome = { round, letter: letterAt(letter), winner, paid };
    for (const i of external) players[i]!.policy!.onAuctionResult(outcome);

    if (winner !== null && players[winner]!.spec.sim) {
      const w = index.longestWord(players[winner]!.rack, 3);
      if (w) {
        const played = playWord(winner, w);
        if (played) broadcastWord(played);
      }
    }

    letter = draw();
    if (letter < 0) break;
    round++;
  }

  // Shared places: 1 + number of players with a strictly higher score
  // (tournament.ts:385-386; game.ts:432 shares wins between tied leaders).
  const order = players.map((_, i) => i).sort((a, b) => players[b]!.score - players[a]!.score);
  const rank = new Array<number>(n);
  order.forEach((i) => (rank[i] = 1 + players.filter((q) => q.score > players[i]!.score).length));

  return {
    auctions,
    unsold,
    seats: players.map((p, i) => ({
      name: p.spec.name,
      score: p.score,
      balance: p.balance,
      rank: rank[i]!,
      lettersWon: p.lettersWon,
      spent: p.spent,
      wordsPlayed: p.wordsPlayed,
      rejectedWords: p.rejectedWords,
      rejectedBids: p.rejectedBids,
      unplayedTiles: p.rack.reduce((a, b) => a + b, 0),
      decisionMs: p.decisionMs,
    })),
  };
}
