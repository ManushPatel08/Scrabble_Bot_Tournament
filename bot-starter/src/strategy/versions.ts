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
  winHistoryWindow: 0,
  winPriorScale: 0,
  moneyShareWeight: 0,
  priorByRivals: 0,
  bidCapFrac: 0,
  lateReserve: 0,
  endMuScale: 0,
  marketCap: 0,
  contestFrac: 0,
  contestBudget: 2,
  contestPricePrior: 0,
  completionCredit: 0,
  premiumCap: 0,
  horizonCap: 20,
  futureBias: 0,
  futureWinBias: 0,
  futureCountNoise: 0,
  futureSelect: 0,
  futureSelectDecay: 0.35,
  trackBag: 1,
  endPlayout: 2,
  endgameExact: 0,
  valuationBranches: 0,
  immediateValueWeight: 0,
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
  marketLossMult: 1,
  formatAware: 0,
  fpShade: 0.7,
  fpModel: 0,
  autoPlayLen: 7,
  wordLookahead: 0,
  protectedCashBelow: 0,
  cashTiming: 0,
  cashMinLen: 4,
  cashBelow: 0,
  cashLate: 0,
  futureAffordable: 0,
  shadeLow: 1,
  shadeLowWindow: 12,
  lateCashLen: 0,
  lateCashWindow: 12,
  finalPackWindow: 0,
  rackCap: 0,
  earlyFloor: 0,
  earlyFloorRack: 11,
  earlyFloorFrac: 0.34,
  foundationWeight: 0,
  rolloutBid: 0,
  rolloutSamples: 24,
  rolloutHorizon: 20,
  rolloutGrid: 6,
  rolloutBidScale: 1,
  rolloutPace: 40,
  rolloutShare: 0.18,
  rolloutPriceScale: 1,
  rolloutTerminalCoin: 0.4,
  rolloutPriceAdapt: 0,
  rolloutMinPlayers: 4,
  rolloutMinLeft: 0,
  consonantFloor3: 0,
  consonantFloor4: 0,
  consonantDup: 4,
  consonantPhase: 0.34,
  cheapCap: 0,
  completionFloor: 0,
  completionSlope: 1,
  completionLate: 10,
  cashThreshA: 0,
  cashThreshB: 0,
  cashThreshMinLeft: 4,
  lateAllIn: 0,
  hold7Ext: 0,
  hold7MinLeft: 6,
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
  //        2026-10-24: the prior share of future auctions follows the
  //        number of real rivals (priorByRivals 1.0): live all-human tables
  //        went from 22% wins / rank 3.28 to 50% / 2.25 (RESULTS.md).
  //        2026-10-24 03:50: priorByRivals 1.3 + contestFrac 1.2 (bid at least
  //        1.2x the match median price on any useful letter): market replay
  //        2.82 vs 2.96; live interleaved 16 vs 18 matches, mean place 2.31
  //        vs 3.11, no last places.
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
    priorByRivals: 1.3,
    contestFrac: 1.2,
  },
};
