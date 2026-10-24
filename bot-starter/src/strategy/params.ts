// Tunable strategy parameters. Every component can be switched off so the
// simulator can measure what each one is worth (see RESULTS.md).

export interface Params {
  // --- letter valuation ---
  /** 0 = face-value heuristic, 1 = Monte Carlo marginal value. */
  mcValuation: number;
  /** Face-value heuristic: value = faceMult * face + faceAdd. */
  faceMult: number;
  faceAdd: number;
  /** Monte Carlo samples of future acquisitions per round. */
  samples: number;
  /** Prior share of future auctions we expect to win, and its pseudo-count. */
  winPrior: number;
  winPriorWeight: number;
  /** Use only this many recent auctions to estimate future win share (0 = whole match). */
  winHistoryWindow: number;
  /** 1 = scale winPrior by 6 / active players in matches with more than 6 (big bracket matches). */
  winPriorScale: number;
  /**
   * Blend weight (0 = off) of our share of the money held by active non-sim
   * players into the expected share of future auctions: when the rivals have
   * run dry we will win most of what is left, and the other way round.
   */
  moneyShareWeight: number;
  /**
   * 0 = off. Otherwise the prior share of future auctions is
   * priorByRivals / (1 + active non-sim opponents): about 1/6 at a table of
   * six real bots, 1/2 against one rival and four sims (the module's sims
   * rarely contest a wanted letter). Live all-human tables (2026-10-23):
   * LetterShark won about 15% of auctions, not the fixed 35% prior, so it
   * overvalued speculative letters early and ran out of money.
   */
  priorByRivals: number;
  /**
   * 0 = off. In the first two thirds of a match, cap a bid at this share of
   * the balance unless the letter is worth more right now (words playable
   * with it today). Live 2026-10-23: LetterShark bid 55 of 100 on a round-2
   * Z, and 28 on a round-6 K, then ran dry before its words completed.
   */
  bidCapFrac: number;
  /**
   * 0 = off. Coins to keep for the last third of the match: before it, a bid
   * may not take the balance below lateReserve, scaled down linearly to 0 as
   * the last third begins, unless the letter is worth that much right now
   * (words playable with it today). Live all-human tables (786 player-matches,
   * 2026-10-23): letters won in the last third were the strongest predictor
   * of place (8+ late letters: 43% wins; 0-1: 4%).
   */
  lateReserve: number;
  /**
   * 0 = off. In the last third of the match the money price falls linearly
   * to this multiple of the formula by the final auction, so leftover coins
   * (worthless at the end) are bid away. Live 2026-10-23: LetterShark ended
   * with 36 coins on average while the best bots bid ~20 in the last third.
   */
  endMuScale: number;
  /**
   * 0 = off. Before the last third, cap a bid at this multiple of the
   * match's median winning price (12 until 5 prices are known), unless the
   * letter is worth more right now (words playable with it today). The
   * Monte Carlo value treats future letters as free, which flatters rare
   * letters that need many others (live: 37 for a round-2 K, 48 for a Z).
   */
  marketCap: number;
  /**
   * 0 = off. Vickrey: for any letter worth something to us, bid at least
   * this fraction of the match's median winning price (12 until 5 prices are
   * known), within the per-auction budget (2x balance / usable auctions
   * left). We pay the runner-up's bid, so uncontested letters come cheap.
   * Live 2026-10-24: LetterShark won 10-11 letters a match while the leaders
   * won 13-18, mostly at 11-13 each; 53% of our mid-game losses were by
   * 5 coins or less.
   */
  contestFrac: number;
  /** contestFrac budget: at most this many times balance / usable auctions left per letter. */
  contestBudget: number;
  /** Blend contest floors with frozen historical per-letter winning bids (0 = off, 1 = full). */
  contestPricePrior: number;
  /** Extra currency reservation for a tile that completes an immediately cashable long word (0 = off). */
  completionCredit: number;
  /**
   * Cap (coins) on bids for J, Q, X and Z before the last third of the match
   * (0 = off). The live leaders buy them late, at about half the early price.
   */
  premiumCap: number;
  /** Cap on future letters per sample (keeps evaluation cheap). */
  horizonCap: number;
  /**
   * Selection effect: weight future draws by (share of the letter in 7-8
   * letter words / share in the bag) ^ futureBias, since we buy the letters
   * that fit words (0 = uniform draws).
   */
  futureBias: number;
  /** Weight future samples by historical own per-letter acquisition rates (0 = off). */
  futureWinBias: number;
  /** Blend fixed future acquisition counts with binomial samples (0 = fixed, 1 = full uncertainty). */
  futureCountNoise: number;
  /** 1 = sample futures from the tracked unseen pool; 0 = from the full 98-tile bag. */
  trackBag: number;
  /** Final auction: 2 = exact best partition, 1 = greedy partition, 0 = no special play-out. */
  endPlayout: number;
  /** Use exact word-set values in the last this many usable auctions (0 = off). */
  endgameExact: number;
  /** Try this many first words in each future's value estimate (0 = greedy). */
  valuationBranches: number;
  /** Blend future marginal value with marginal points spellable now (0 = future model only). */
  immediateValueWeight: number;

  // --- money (shadow price mu: score points per unit of currency) ---
  mu0: number;
  /** mu scales with (auctions remaining / total) ^ muTimeExp. */
  muTimeExp: number;
  /** mu scales with (refBalance / balance) ^ muBalExp. */
  muBalExp: number;
  refBalance: number;
  /** First-price overrides for mu0 / muTimeExp (0 = use the Vickrey values). */
  fpMu0: number;
  fpMuTimeExp: number;
  /** Vickrey muTimeExp in 2-bot matches (e.g. the tournament final); 0 = same as muTimeExp. */
  duelMuTimeExp: number;
  /** mu0 in 2-bot matches, both modes (0 = the mode's usual mu0). */
  duelMu0: number;
  /** Use the duel settings (duelMuTimeExp, leaderTaxDuel, duelMu0) when active players <= this. */
  duelMaxN: number;
  /** First-price: 1 = assume we lose ties (slower network), so a tied bid counts as a loss. */
  tieLoss: number;
  /** First-price: 1 = also bid one above the score leader's typical winning bid when still worth it. */
  fpOutbid: number;
  /** First-price: add this to the model's optimal bid (beats equal bids from like-minded bots). */
  fpPlus: number;
  /** Adaptive pacing: log-mu step per unit of relative overspend (0 = off). */
  paceRate: number;
  /**
   * 0 = formula mu. 1 = market mu: from recent (value, price) pairs, the
   * value-per-currency threshold at which buying every better letter would
   * spend the current balance over the remaining auctions, blended with
   * the formula.
   */
  moneyModel: number;
  /** Weight (pseudo-observations) of the formula mu in the market blend. */
  marketPrior: number;
  /** Recent auctions used by the market model. */
  marketWindow: number;
  /**
   * moneyModel 1, Vickrey: price to win an auction a rival won, as a multiple
   * of what it paid (1 = paid + 1). The winner's own bid is only published
   * after the match; in the live archive it averages about 1.35x the price.
   */
  marketLossMult: number;

  // --- auction format ---
  /** 1 = use predicted sim bids / bid shading in first-price. */
  formatAware: number;
  /** First-price fallback shading factor when no opponent data. */
  fpShade: number;
  /**
   * First-price model of the best external bid: 0 = pooled over all
   * external bidders; 1 = per opponent (each one's own winning bids,
   * capped by its public balance), multiplied together.
   */
  fpModel: number;

  // --- play timing ---
  /** Words at least this long are played as soon as they exist. */
  autoPlayLen: number;
  /** Score 7+ word choices by immediate cash plus this weight on future rack value (0 = greedy). */
  wordLookahead: number;
  /** Below this balance, cash only spare tiles while preserving a long word completed by the current tile (0 = off). */
  protectedCashBelow: number;
  /** 1 = cash shorter words when money is worth more than the lost flexibility. */
  cashTiming: number;
  /** Shortest word considered for early cashing. */
  cashMinLen: number;

  // --- opponent modeling ---
  /**
   * Anti-tax (Vickrey): when the prices we pay keep landing just under our
   * own bids (someone is shadowing us), shade bids down to this fraction of
   * value (1 = off). Detection uses the mean paid/bid ratio of recent wins.
   */
  taxShade: number;
  /** Mean paid/bid ratio over recent wins above which we count as taxed. */
  taxRatio: number;
  /** Vickrey bid jitter: multiplicative noise amplitude (0 = off). */
  bidJitter: number;
  /**
   * Vickrey leader tax (0 = off): bid at least this fraction of the score
   * leader's estimated reservation for the letter (their value on the rack we
   * can reconstruct, at their balance), so they pay close to full value or we
   * take the letter at their price.
   */
  leaderTax: number;
  /** Leader tax used in 2-bot matches (the tournament final); 0 = use leaderTax. */
  leaderTaxDuel: number;
  /** Weight on keeping letters from the leader (0 = off). */
  denial: number;
  /** Leader must be within this many points of us (or ahead) to be denied. */
  denialMargin: number;
  /** Vickrey: bid the top sim's (tie-winning) bid on letters we don't want. */
  priceDrive: number;
}

export const DEFAULT_PARAMS: Params = {
  mcValuation: 1,
  faceMult: 2,
  faceAdd: 1,
  samples: 96,
  winPrior: 0.35,
  winPriorWeight: 10,
  winHistoryWindow: 0,
  winPriorScale: 0,
  moneyShareWeight: 0,
  priorByRivals: 1.3,
  bidCapFrac: 0,
  lateReserve: 0,
  endMuScale: 0,
  marketCap: 0,
  contestFrac: 1.2,
  contestBudget: 2,
  contestPricePrior: 0,
  completionCredit: 0,
  premiumCap: 0,
  horizonCap: 20,
  futureBias: 0,
  futureWinBias: 0,
  futureCountNoise: 0,
  trackBag: 1,
  endPlayout: 2,
  endgameExact: 0,
  valuationBranches: 0,
  immediateValueWeight: 0,
  mu0: 0.5,
  muTimeExp: 0.7,
  muBalExp: 0.5,
  refBalance: 100,
  fpMu0: 0,
  fpMuTimeExp: 1,
  duelMuTimeExp: 1,
  duelMu0: 0,
  duelMaxN: 2,
  tieLoss: 0,
  fpOutbid: 0,
  fpPlus: 1,
  paceRate: 0.01,
  moneyModel: 0,
  marketPrior: 8,
  marketWindow: 30,
  marketLossMult: 1,
  formatAware: 1,
  fpShade: 0.7,
  fpModel: 0,
  autoPlayLen: 7,
  wordLookahead: 0,
  protectedCashBelow: 0,
  cashTiming: 0,
  cashMinLen: 4,
  taxShade: 1,
  taxRatio: 0.75,
  bidJitter: 0,
  leaderTax: 0,
  leaderTaxDuel: 0.85,
  denial: 0,
  denialMargin: 20,
  priceDrive: 0,
};

export function withParams(over: Partial<Params> = {}): Params {
  return { ...DEFAULT_PARAMS, ...over };
}
