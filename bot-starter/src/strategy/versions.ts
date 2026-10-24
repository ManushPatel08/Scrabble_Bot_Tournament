// Frozen parameter sets for each version of the strategy, oldest first.
// Each is a complete Params object so later changes to DEFAULT_PARAMS can't
// alter an earlier version. Self-play pits `final` against v1..v5.

import type { Params } from "./params.ts";

const COMMON: Params = {
  mcValuation: 1,
  faceMult: 2,
  faceAdd: 1,
  samples: 24,
  winPrior: 0.35,
  winPriorWeight: 10,
  winPriorScale: 0,
  horizonCap: 20,
  futureBias: 0,
  trackBag: 1,
  endPlayout: 2,
  mu0: 1,
  muTimeExp: 1,
  muBalExp: 0.5,
  refBalance: 100,
  fpMu0: 0,
  fpMuTimeExp: 0,
  duelMuTimeExp: 0,
  duelMu0: 0,
  duelMaxN: 2,
  tieLoss: 0,
  fpOutbid: 0,
  fpPlus: 0,
  paceRate: 0,
  moneyModel: 0,
  marketPrior: 8,
  marketWindow: 30,
  formatAware: 0,
  fpShade: 0.7,
  fpModel: 0,
  autoPlayLen: 7,
  cashTiming: 0,
  cashMinLen: 4,
  taxShade: 1,
  taxRatio: 0.75,
  bidJitter: 0,
  leaderTax: 0,
  leaderTaxDuel: 0,
  denial: 0,
  denialMargin: 20,
  priceDrive: 0,
};

export const VERSIONS: Record<string, Params> = {
  // v1: face-value bids (2 x face + 1), plays 7+ words, plays out at the end.
  v1: { ...COMMON, mcValuation: 0 },
  // v2: Monte Carlo marginal letter values.
  v2: { ...COMMON },
  // v3: + play timing (cash shorter words when money beats flexibility).
  v3: { ...COMMON, cashTiming: 1 },
  // v4: + format awareness (sim bid prediction, first-price best response)
  //     and cheaper money (mu0 0.5) after the first sensitivity sweep.
  v4: { ...COMMON, cashTiming: 1, formatAware: 1, mu0: 0.5 },
  // v5: first tuner champion (sim/tune-log.md, iteration 1): hold short words
  //     for long ones instead of cashing them, light budget pacing, and
  //     price-driving the sims in Vickrey.
  v5: { ...COMMON, formatAware: 1, mu0: 0.5, cashTiming: 0, paceRate: 0.0791, priceDrive: 1 },
  // v6: v5 + 48 Monte Carlo samples (more accurate letter values) +
  //     gentler pacing (0.01). Price-driving and denial dropped: no
  //     measurable gain (RESULTS.md).
  v6: { ...COMMON, formatAware: 1, mu0: 0.5, cashTiming: 0, paceRate: 0.01, samples: 48 },
  // v7: v6 with per-mode money prices: Vickrey spends earlier (time
  //     exponent 0.7, but 1.0 in 2-bot matches like the tournament final),
  //     first-price values money lower (mu0 0.35).
  v7: {
    ...COMMON,
    formatAware: 1,
    mu0: 0.5,
    muTimeExp: 0.7,
    fpMu0: 0.35,
    fpMuTimeExp: 1,
    duelMuTimeExp: 1,
    cashTiming: 0,
    paceRate: 0.01,
    samples: 48,
  },
  // final: v7 hardened against strong adaptive opponents (RESULTS.md,
  //        "Adversarial evaluation"): first-price bids go one above the
  //        model optimum when external bots are present (wins the ties that
  //        like-minded bots produce), and 2-bot matches tax the leader
  //        (bid at least 85% of the opponent's estimated reservation).
  //        Under the tournament module's rules (random ties, jittered sims)
  //        first-price uses the same money price as Vickrey (mu0 0.5): the
  //        cheaper 0.35 lost in the league and baseline fields (RESULTS.md).
  //        2026-10-23: 96 Monte Carlo samples instead of 48 (better in all
  //        five fields at 400 matches each, RESULTS.md; decisions stay
  //        well inside the live window).
  //        Shipped by src/strategy.ts.
  final: {
    ...COMMON,
    formatAware: 1,
    mu0: 0.5,
    muTimeExp: 0.7,
    fpMu0: 0,
    fpMuTimeExp: 1,
    duelMuTimeExp: 1,
    cashTiming: 0,
    paceRate: 0.01,
    samples: 96,
    fpPlus: 1,
    leaderTaxDuel: 0.85,
  },
};
