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
  /** 1 = scale winPrior by 6 / active players in matches with more than 6 (big bracket matches). */
  winPriorScale: number;
  /** Cap on future letters per sample (keeps evaluation cheap). */
  horizonCap: number;
  /**
   * Selection effect: weight future draws by (share of the letter in 7-8
   * letter words / share in the bag) ^ futureBias, since we buy the letters
   * that fit words (0 = uniform draws).
   */
  futureBias: number;
  /** 1 = sample futures from the tracked unseen pool; 0 = from the full 98-tile bag. */
  trackBag: number;
  /** Final auction: 2 = exact best partition, 1 = greedy partition, 0 = no special play-out. */
  endPlayout: number;

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
  winPriorScale: 0,
  horizonCap: 20,
  futureBias: 0,
  trackBag: 1,
  endPlayout: 2,
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
  formatAware: 1,
  fpShade: 0.7,
  fpModel: 0,
  autoPlayLen: 7,
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
