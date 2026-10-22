// The shipped strategy. The live client (index.ts) and the simulator both
// drive an Agent; this file pins its configuration and keeps the starter's
// decideBid / chooseWord entry points.

import type { WordIndex } from "./game/dictionary.ts";
import { countsFromMap, letterIndex, type Counts } from "./game/letters.ts";
import { Agent } from "./strategy/agent.ts";
import type { Params } from "./strategy/params.ts";
import { VERSIONS } from "./strategy/versions.ts";

/** Final configuration (tuned in sim/tune.ts; see RESULTS.md). */
export const FINAL_PARAMS: Partial<Params> = VERSIONS.final ?? {};

export function createAgent(name = "final", index?: WordIndex, over: Partial<Params> = {}): Agent {
  return new Agent({ ...FINAL_PARAMS, ...over }, name, index);
}

export interface BidContext {
  agent: Agent;
  letter: string; // letter being auctioned, e.g. "Q"
  myBalance: number;
  myRack: Map<string, number>;
  balances: readonly number[];
  scores: readonly number[];
}

/** Bid for the current letter (0 = skip). The agent must have seen the auction open. */
export function decideBid(ctx: BidContext): number {
  const rack: Counts = countsFromMap(ctx.myRack);
  const balances = ctx.balances.slice();
  balances[ctx.agent.t.seat] = ctx.myBalance;
  return ctx.agent.decideBid(letterIndex(ctx.letter), rack, balances, ctx.scores);
}

export interface WordContext {
  agent: Agent;
  myRack: Map<string, number>;
  balances: readonly number[];
}

/** Words to play now, in order (empty = hold). */
export function chooseWord(ctx: WordContext): string[] {
  return ctx.agent.chooseWords(countsFromMap(ctx.myRack), ctx.balances.slice());
}
