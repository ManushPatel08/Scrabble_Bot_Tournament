# Simulation results

All numbers come from `bot-starter/sim/`. The README section has the
commands; raw outputs are in `sim/experiments/`.

- A "seat" is one bot in one match.
- Win rate means first place.
- Mean rank runs from 1 to N.
- SE is the standard error of the mean score.
- Comparisons that share a seed use common random numbers: the same tile
  sequences for every variant.

## Acceptance criteria (tournament module rules)

Every number below comes from the simulator updated to the tournament
version of the module (upstream `3064b36`): random ties and ±2 sim bid
jitter. See [Tournament module re-validation](#tournament-module-re-validation).

| Criterion | Result |
|---|---|
| RULES.md answers the 5 questions with citations | ✅ [RULES.md](RULES.md), re-verified against the TypeScript module, with 9 rule changes and 8 doc errors listed |
| Scoring matches the module on ≥ 20 hand-checked cases | ✅ 23 cases in `test/scoring.test.ts` (scoring is unchanged in the new module). All 65 tests pass (`npm test`) |
| Highest mean score and win rate against the baseline field, 1,000 matches, both modes | ✅ **Vickrey:** 98.2% wins, mean 183.2 (next best: overbidder, 1.9% and 56.6). **First-price:** 99.4% wins, mean 152.9 (next: hoarder 0.5% wins; overbidder 46.9 mean) |
| Self-play against 5 earlier versions wins > 1/6 | ✅ Against the 5 most recent (v3–v7): **Vickrey 29.9%** (1,000 matches), **first-price 29.3%** (300). v7 is next at 26.1% / 27.0% |
| decideBid / chooseWord p99 < 100 ms on the largest racks | ✅ With the live precompute on: decideBid p99 28 ms (32 ms on the largest 5% of racks); chooseWord p99 0.05 ms |
| `BOT_NAME=… BOT_TOKEN=… npm start` plays a full match | ✅ Live on the event server as **LetterShark** (Team Manush) since 2026-10-23, through `run.ps1`: it won all of its first 10 open-lobby matches, mean score 277 (see [Live lobby record](#live-lobby-record)). The first matches exposed two client bugs that the fake server couldn't (late bids, stale opponent scores), both fixed and re-verified live |
| README section on the simulator, tuner and live bot | ✅ [README.md](README.md) |

## Live lobby record

`node scripts/lobby-report.mjs --bot LetterShark` (public tables only).
Open lobbies are always Vickrey and are padded with the module's sims. The
only other human bot online on 2026-10-23 was "bot" (id 7).

| Date | Matches | Wins | Mean score | Mean margin over "bot" | Notes |
|---|---:|---:|---:|---:|---|
| 2026-10-23 (first 10) | 10 | 10 | 277 | +152 (6 meetings) | matches 62–67 on the first build, 68–71 after the fixes below |

What the first live matches found, and the fixes:

1. **Bids landing after the auction closed.** Every failed bid followed a
   precomputed decision: the between-round precompute ran as one block
   (p99 ~0.4 s idle, over 1 s with the simulator running), and the next
   auction's message waited behind it. The precompute now runs in 15 ms
   slices that yield to I/O and is dropped when an auction arrives. With
   16 simulator workers and the test suite running on the same machine,
   matches 69–71 had no late bids and no queue wait over 150 ms.
2. **Opponents' scores frozen at their first value.** A self-join
   subscription on `match_participant` never delivered other bots'
   updates (RULES.md S1), so the leader tax and every score-aware rule saw
   0s. Each match's participants now have their own subscription; the
   end-of-match summaries show real opponent scores again.

## Live trials against the human field (2026-10-23/24)

By late evening the lobby was all human bots (30+ registered; winning scores
rose from about 90 to 120-150 within hours as teams updated their bots).
Public data (`scripts/field-report.mjs`) showed LetterShark at all-human
tables assuming a 35% share of future auctions while winning about 15%,
overvaluing speculative letters early and running dry. Trials, in order
(`scripts/ab-report.mjs` for before/after, `scripts/ab-live.mjs` for the
interleaved ones, where matches alternate between two parameter sets):

| Trial | Matches | Wins | Mean place | Verdict |
|---|---:|---:|---:|---|
| baseline (prior 0.35), #257-277 | 18 | 22% | 3.28 | |
| **priorByRivals 1.0**, #278-310 | 16 | **50%** | **2.25** | **shipped** |
| + lateReserve 30 + endMuScale 0.5 | 8 | 25% | 2.50 | dropped |
| + bidCapFrac 0.3 | 11 | 27% | | dropped |
| interleaved: default vs mu0 0.4 | 11 / 9 | 27% / 33% | 3.27 / 3.00 | inconclusive |
| interleaved: default vs mu0 0.4 + marketCap 2 | 9 / 8 | 33% / 25% | 2.67 / 2.75 | even, dropped |
| interleaved: default vs contestFrac 0.8 + marketCap 2 | 7 / 6 | 14% / 17% | 2.86 / 3.50 | dropped (sims favoured it: 40.0% vs 35.8% at 400 matches) |
| interleaved: default vs priorByRivals 0.7 | 2 / 3 | | 3.00 / 3.33 | too short; replaced |
| interleaved: default vs mu0 0.7 + endMuScale 0.3 (late sweep) | 1 / 1 | | 2.00 / 6.00 | dropped: bid 54 for an H late, 38 for a round-1 Z |
| interleaved: default vs bidCapFrac 0.3, #523-551 | 5 / 5 | **40%** / 0% | **2.00** / 4.60 | dropped (about 4 SE apart) |

The default (priorByRivals 1.0) beat every interleaved variant. Only the change that made the bot more cautious early held up live; every
variant that bid more aggressively did worse live, even where the
simulator preferred it. The simulator's opponents bid less than the live
field, so they reward aggression that real rivals punish. The website
leaderboard rates lobby games only; the tournament's Swiss round 1 is
seeded randomly (tournament.ts), so lobby rating does not carry over.

## What match winners do (322 all-human matches, #600-924)

`node scripts/winners-report.mjs 600`: the winner of each match against the
other five at the same table.

| Feature | Winner | Rest | Difference |
|---|---:|---:|---:|
| Letters won | 14.1 | 10.7 | **+3.4** |
| ... in the first / middle / last third | 4.3 / 5.2 / 4.7 | 3.8 / 3.6 / 3.4 | +0.5 / +1.6 / +1.3 |
| Average price paid per letter | 13.2 | 13.5 | -0.3 |
| Average winning bid | 18.6 | 18.5 | +0.0 |
| Rare letters won (value 4+) | 2.4 | 1.6 | +0.8 |
| Points per letter (incl. 5 dealt) | 5.5 | 4.3 | +1.2 |
| Money left at the end | 23 | 27 | -4 |
| 7+ letter words | 1.8 | 1.3 | +0.5 |

Winners neither bid higher nor pay more per letter; they win more letters at
the market price, mostly mid- and late-game, including more rare letters, and
turn them into more long words. LetterSharkX matches the "rest" column
(10.6 letters, 34 coins left), which points at bidding market-level on more
letters, not at caps or reserves (both lost live).

## Live opponents and the tournament phases (2026-10-23)

**The strongest live opponent.** "bot" (id 7) beat LetterShark in 3 of
their first 12 lobby meetings, once 281-94 (match 80). Its public winning
bids (`auction_top_bid_archive`, 15 matches) show its pattern:
- It bids about **20% of its current balance on almost every letter**:
  13-17 for common letters, 30-45 for J, Q, Y, Z.
- In Vickrey that wins many letters at the runner-up's (often our) much
  lower price, and the word rewards refill its balance.
- It wastes almost nothing: 98% of the letters it won ended up in its
  words. LetterShark's rate is similar, 97%.

In match 80 LetterShark fell behind early. Expecting to win little, it
valued letters near zero, and from round 55 it bid 1 on everything with
47 currency left.

`sim/baselines/live.ts` models it as "botlike": a balance share per letter,
taken from those bids, plus our word engine. Against it (200 matches per
cell, `62-botlike.md`, `63-leadertax-multi.md`):

| Variant | livelobby-v win / margin | duelbot-v win / margin | strongbot-v win / rank | self-v win / rank |
|---|---|---|---|---|
| **final** | **94.5% / +139** | **89.5% / +169** | **38.5% / 2.09** | 21.0% / 3.27 |
| money cheaper (mu0 0.3) | 71.5% / +76 | 58.5% / +24 | 17.0% / 2.83 | |
| stickier win-share prior (weight 40) | 94.5% / +131 | 90.0% / +174 | 38.0% / 2.13 | |
| faster spend-down (pace 0.05) | 86.0% / +72 | 48.0% / −19 | 29.0% / 2.14 | |
| all three, milder | 84.0% / +77 | 58.5% / +16 | 24.0% / 2.46 | |
| leader tax 0.85 in every match | 93.5% / +143 | | 28.0% / 2.29 | 15.5% / 3.65 |
| leader tax 0.6 in every match | 94.5% / +134 | | 37.0% / 1.97 | 21.5% / 3.29 |

Spending more or faster loses heavily, and a multi-bot leader tax is
neutral at best. The final settings stay. The real "bot" sizes its bids
to its rack, unlike the model, so the live head-to-head (9-3) is the
better guide. Three of its wins came while the simulator was loading
this machine.

**The final (best of 3 two-bot games, aggregate score).** 200 duels per
cell, Vickrey (`61-duel-denial-tax.md`):

| Variant | vs v7 | vs final | vs denier |
|---|---|---|---|
| **final (leader tax 0.85 in duels)** | **72.5%** | **56.5%** | **67.0%** |
| no leader tax | 45.5% | 24.0% | 47.5% |
| leader tax 1.0 | 66.0% | 48.5% | 62.0% |
| zero-sum denial 0.5 | 65.5% | 51.5% | 59.5% |
| zero-sum denial 1.0 | 65.0% | 38.5% | 58.0% |

The leader tax is the single largest factor in duels. Valuing letters by
what they'd give the opponent, the zero-sum view, hurts.

**More Monte Carlo samples: adopted.** 96 samples instead of 48, 400 matches per cell on a fresh seed (`65-samples-confirm.md`; `64-samples-horizon.md` at 200 found the same):

| Samples | league-v win / rank | strongbot-v win / rank | duel7-v win / margin | self-v win / rank | base-v win |
|---|---|---|---|---|---|
| 48 (before) | 44.3% / 1.88 | 34.0% / 2.08 | 67.3% / +43 | 16.3% / 3.52 | 98.5% |
| **96 (final)** | **45.3% / 1.83** | **39.8% / 1.97** | **74.0% / +60** | **21.3% / 3.25** | **99.5%** |

It is better in every field. A longer horizon (30 future letters instead of 20) added nothing. Decision latency with 96 samples: decideBid p99 22 ms, max 42 ms (`node sim/latency.ts 40`). The precompute, p99 0.31 s, runs in slices.

**Budget-aware win share: not adopted.** In live match 124 both rival bots spent down to 0 while LetterShark kept 21 and let the sims take the last 11 letters for 2-7 each. `moneyShareWeight` blends our share of the money held by active non-sim players into the expected share of future auctions. 300 matches per cell (`66-money-share.md`), win rate:

| Weight | self-v | league-v | strongbot-v | aggrtable-v | livelobby-v | duel7-v |
|---|---|---|---|---|---|---|
| **0 (final)** | 16.7% | 42.0% | **39.7%** | 41.0% | **94.7%** | **79.7%** |
| 0.3 | 18.3% | **46.3%** | 32.0% | 42.0% | 95.0% | 78.3% |
| 0.6 | **20.3%** | **46.3%** | 36.0% | **43.7%** | 91.7% | 77.0% |

Gains in three fields are matched by losses in the other three, so it stays off (weight 0, kept for later study).

**Latency on the live server.** Per-round instrumentation:
- Auction messages arrive steadily: about 70 ms of jitter, with our clock
  about 0.5 s behind the server's.
- The network round trip to maincloud is about 100 ms.
- Reducer replies took 450-900 ms only while the simulator kept 20 threads
  busy on the same machine. That is enough to land bids after a 1 s auction
  closes, and to lose final-round words ("Match not running").

So nothing else may run on the bot's machine during the tournament.

## Tournament module re-validation

On 2026-10-21 upstream replaced the Rust module with a TypeScript "Calhacks"
version (`3064b36`). The simulator was updated to its rules. The two that
change play:
- **Ties are random** (`game.ts:485-488`).
- **Sim bids get uniform ±2 jitter** (`game.ts:697-747`).

First-price bidding now prices the sims over that jitter distribution
(`simBeatProb` in `src/strategy/agent.ts`) instead of assuming
"top sim + 1" always wins. The live client moved to SDK 2.12, and
registers itself for tournaments, since entry is now opt-in.

**What changed in `final` under the new rules.** Settings were rechecked
on 300–400 matches per cell (`50`, `54`):
- **First-price +1** (`fpPlus`): kept. Self-play 21.0% vs 16.7% without it;
  the league is neutral (rank 2.08 vs 2.07).
- **First-price money price**: changed from 0.35 to 0.5 (the Vickrey value).
  0.35 had won under the old rules, but with jittered sims it lost the
  league (36.3% vs 44.0% wins, rank 2.09 vs 1.91) and the baseline field
  (98.0% vs 100%). Measured on 1,000 matches, the change also raised the
  first-price baseline field from 97.4% to 99.4% wins (mean 135 → 153) and
  the sim lobby from 270 to 279.

**`final` under the tournament rules** (`51`–`53`, `55`–`60`):

| Field | Vickrey: win / rank | First-price: win / rank |
|---|---|---|
| Baseline field (1,000) | **98.2%** / 1.02 | **99.4%** / 1.01 |
| Sim lobby (1,000) | **100%** (mean 339) | **100%** (mean 279) |
| Self-play against v3–v7 | **29.9%** / 2.58 (1,000) | **29.3%** / 2.59 (300) |
| Robustness pool | **40.0%** / 1.98 (1,000) | **36.0%** / 2.12 (300), best rank |
| 2-bot final against v7 | **67.7%** / 1.32 | 48.0% / 1.52 (parity) |
| 8-bot bracket match | **34.0%** / 2.22, best rank | 27.0% / 2.54, best rank |
| 2-bot against the shadow (the exploit bot) | 47.3%, parity | 47.3%, parity |
| Mixed pool of v7-based adversaries | 17.3% / 3.04 | 18.3% / 3.09 |

The mixed-pool row is a field of near-copies: every adversary is v7 plus
one exploit, and in Vickrey 6-bot matches `final` plays exactly like v7.
So above-fair (16.7%) parity is the expected result. The "best opponent"
win rates in that pool (28–30%) are the maximum over 7 noisy labels, so
they're biased upward.

The sections below were measured before the module change, under the old
rules (insertion-order ties, deterministic sims). They justify each
component. The rule change re-tuned only the first-price money price.

## The final bot (`final` in `src/strategy/versions.ts`)

Each auction it does the following (`src/strategy/agent.ts`):

1. **Track.** It updates the unseen pool: 98 tiles, minus its own dealt
   rack, minus every auctioned letter, minus any opponent dealt tiles that
   their word plays prove. It also updates opponents' known racks and win
   counts (`src/strategy/tracker.ts`).
2. **Sample futures.** It draws 48 futures. Each is the set of letters it
   might still win: k = remaining usable auctions × its expected win
   share, capped at 20, drawn from the unseen pool. Every comparison that
   round reuses the same 48 futures.
3. **Words.** It plays any 7+ letter word as soon as one exists: the 3×
   multiplier is already maxed and the money funds bidding. It holds
   shorter words. In the final auction it plays the optimal word set of the
   whole rack. That auction is recognisable by `bag_total == 0`, and the
   match ends when it closes.
4. **Letter value** in score points: `v = mean_s[G(R+L+F_s) − G(R+F_s)]`,
   where G is the greedy word-set value of a rack.
5. **Money.** One unit of currency is worth
   `mu = mu0 × (auctions left / total)^e × (100 / balance)^0.5 × e^pace`
   points.
   - **mu0** = 0.5 in both modes.
   - **Time exponent e:** 0.7 in Vickrey, so the bot spends earlier; 1.0 in
     first-price, and in 2-bot Vickrey matches like the tournament final.
     A match counts as 2-bot when only one opponent is active; offline
     seats don't count (`botCredential.connected`, or inferred after 20
     auctions with no wins or words).
   - `pace` drifts by 0.01 per round toward spending balance / remaining
     auctions.
   - The bid's reservation price is `v / mu`.
6. **Bid by payment rule.**
   - **Vickrey:** bid the reservation price. In 2-bot matches, bid at least
     85% of the leading opponent's estimated reservation for the letter
     (the "leader tax"), when we can afford it.
   - **First-price:** pick the bid b that maximises
     P(win | b) × (reservation − b).
     - P(win) = P(every sim's jittered bid is lower) × P(the best external
       bid is lower), with ties counting half (ties are random).
     - Sim strategy and balance are public; only the ±2 jitter is unknown.
     - External bids are modelled from the external bidders' observed
       winning bids.
     - When external bots are present, the bid is raised by 1, which wins
       the equal bids that like-minded bots produce.

Between rounds, the live client calls `prepareNext()`. It values every
possible next letter and precomputes the final play-out, so the next bid is
usually a table lookup.

### Final bot in every field (1,000 matches per cell)

| Field | Vickrey: win / mean score / mean rank | First-price: win / mean score / mean rank |
|---|---|---|
| Baseline field (starter, greedy, overbidder, hoarder, random) | **98.8%** / 185.3 / 1.01 | **98.0%** / 151.2 / 1.02 |
| Real lobby (5 module sims) | **100%** / 358.0 / 1.00 | **100%** / 359.6 / 1.00 |
| Self-play against v2–v6 | **32.6%** / 87.2 / 2.42 | **38.4%** / 96.8 / 2.07 |
| Robustness pool (5 per match from v6, v5, v4, aggr, cons, overbidder, allin, sniper, brutus-sim, random, starter) | **47.9%** / 110.4 / 1.80 | **39.4%** / 94.9 / 2.06 |
| Duel (2 bots, 88 auctions, like the final) against v6 | 50.8% / 253.8 / 1.49 | **53.0%** / 246.7 / 1.47 |
| 8-bot bracket match (7 from the robustness pool) | **38.5%** / 81.3 / 2.15 | **33.1%** / 74.8 / 2.33 |

Full tables, including every opponent, are in `sim/experiments/23-…28-*.md`.
The earlier `final` (now v6) has its tables in `11-…15`.
`sniper` and `allin` were never used in tuning; they win 0–3%.
The between-round precompute doesn't change results. Measured on v6's
configuration, the Vickrey baseline field gave 98.5% / 180.8 with it
(`10-…`) and 98.2% / 180.8 without.

**The duel row.** In Vickrey duels, `final` and v6 play identically: both
use time exponent 1.0, so 50.8% is parity. With exponent 1.0, v6 beat v5
97.6% / 96.2% in duels (`15`). Exponent 0.7, which is better in 6- and
8-bot matches, *lost* duels to v6 44% to 56%. That is why 2-bot matches get
their own setting (`27`).

Caveats on the robustness and big-match rows:
- **The style variants share the final bot's code:** `cons` doubles the
  money price in both modes and `aggr` halves it. They are close
  relatives, so they test the money price more than different play styles.

## Components: why each exists and what it measurably gained

Ablations switch one component off, starting from the configuration at the
time. The results below come from 500-match runs on seed 31 (files
`05`–`07`), against 5 copies of the reference bot (self) and against the
league. The league is 5 per match drawn from the reference bot, v1, style
variants, the overbidder, random, Brutus/Maverick sims and the starter.
Standard errors are about ±1.7 percentage points in self-play and about
±2.1 in the league.

The reference was v5 + 48 samples with the old pacing (0.079) and
price-driving on. Pacing and price-driving were then settled by their own
runs (`08`, `09`).

| Component | Self V / F win (ref 17.0 / 16.0) | League V / F win (ref 36.8 / 38.8) | Verdict |
|---|---|---|---|
| Monte Carlo letter valuation → face-value bids | 1.0 / 2.2 | 8.4 / 11.0 | **Core: about +15 self, +28 league** |
| Holding short words → cashing them early | 1.6 / 4.2 | 5.6 / 7.6 | **Hold: about +13 self, +31 league** |
| Final-auction play-out → none | 8.0 / 9.6 | 22.4 / 26.6 | **Keep: about +8 self, +13 league** |
| Format awareness (first-price best response, sim prediction) → off | 17.0 / **5.6** | 36.8 / **20.2** | **Keep: +10 / +19 points in first-price** (no Vickrey effect, as expected) |
| 48 samples → 24 | 13.8 / 13.6 | 31.2 / 33.2 | **Keep 48: about +3 self, +6 league** |
| Money price mu0 0.5 → 1.0 | 15.8 / 12.2 | 31.8 / 34.6 | **Keep 0.5: +1 to +5** |
| Exact bag tracking → full-bag assumption | 15.6 / 15.2 (rank 3.53 / 3.64 vs 3.40 / 3.55) | 36.8 / 39.0 | **Keep: small (self-play rank about 0.1 better, +1.5 score)**, seen in two runs |
| Price-driving the sims → off | identical | identical | **Dropped:** no effect even in sim lobbies (`08`) |
| Denial of the leader's letters (0.5) | 14.8 / 16.8 vs 15.0 / 15.5 without | 33.2 / 37.8 vs 35.5 / 36.3 | **Dropped:** within noise, and doubles CPU (`04`, `03`) |

The pacing rate was settled on seed 77 at 500 matches (`08`, `09`):

| Pacing rate | League V / F win | Baseline field V / F win (score) |
|---|---|---|
| 0.079 (tuner's value) | 37.0 / 36.2 | 99.0 / 100.0 (167 / 178) |
| off | 45.2 / 42.0 | 95.0 / 98.0 (151 / 130) |
| **0.01 (final)** | **54.6 / 56.8** | 98.0 / 99.6 (179 / 167) |
| 0.02 | 52.8 / 50.4 | 99.6 / 99.8 (181 / 183) |
| 0.03 | 47.4 / 46.8 | 99.8 / 100.0 (179 / 187) |
| 0.04 | 46.8 / 43.4 | 99.6 / 100.0 (175 / 186) |

After the ablations, the money price was re-tuned per payment mode.
Vickrey and first-price wanted opposite changes (`17`, `18`), so each
mode was tuned on its own fields. Runs are 500 matches.

| Change | Fields (seed) | Before | After | Verdict |
|---|---|---|---|---|
| Vickrey time exponent 1.0 → 0.7 | self-v / league-v / base-v (43) | 15.0 / 39.6 / 98.4 | 20.6 / 43.0 / 98.4 | **Adopted** (also +11 / +3 on seed 41) |
| First-price mu0 0.5 → 0.35 | self-f / league-f / base-f (43) | 16.0 / 41.0 / 99.6 | 26.8 / 42.4 / 97.6 | **Adopted.** Rank sum 6.41 → 5.88 |
| First-price mu0 0.5 → 0.35 | same fields (47) | 15.6 / 41.4 / 99.4 | 27.0 / 41.4 / 98.4 | Confirmed: rank sum 6.34 → 5.95 |
| 2-bot Vickrey time exponent 0.7 → 1.0 | duel against v6 / against final (61) | 45.0 / 47.3 | 48.0 / 56.0 | **Adopted** (1.3 and 1.6 were worse) |
| Selection-biased futures (0.5 / 1.0) | self-v, self-f, league-v, league-f (53) | 16.0, 16.6, 41.2, 31.2 | 17.2 / 19.6, 16.2 / 15.2, 39.6 / 38.8, 37.0 / 35.0 | **Rejected:** mixed, ranks worse in 3 of 4 |
| Per-opponent first-price model (balance-capped) | self-f / league-f / base-f (59) | 20.8 / 30.8 / 98.4 | 31.6 / 30.0 / 94.6 | **Rejected:** wins only against its own copies |

**Rationale for each component.**

- **Fast word search** (`src/game/dictionary.ts`).
  - *What it is:* ENABLE's 172,820 words collapse into 156,473 anagram
    classes. Every word in a class has the same reward, so a trie over the
    sorted-letter signatures visits only sub-racks that start some real
    word.
  - *Speed:* the index builds in 0.26 s. Branch-and-bound on each subtree's
    best reward finds the top word on a 25-letter rack in 0.06 ms (plain
    DFS takes 0.35 ms). The greedy word-set value takes 0.07 ms.
  - *Why it matters:* this makes 96 rack evaluations per letter value
    affordable. It is verified against brute force over the whole wordlist
    (`test/dictionary.test.ts`). The exact best-partition search was checked
    against exhaustive search.

- **Exact bag tracking** (`src/strategy/tracker.ts`).
  - *What it is:* the pool is the 98 tiles minus our dealt rack, minus every
    auctioned letter (unsold ones are discarded, not returned), minus
    opponents' dealt tiles proven by their word plays. It is the bag plus
    opponents' unrevealed dealt tiles, and it is checked against the
    engine's ground truth every round (`test/tracker.test.ts`).
  - *Gain:* small but repeatable: about 0.1 better mean rank in self-play.
  - *Why it's small:* futures are random draws, so a slightly wrong pool
    mostly adds noise.

- **Letter valuation** (Monte Carlo marginal value).
  - *What it does:* a letter is worth what it adds to the word sets we can
    build with the letters we're likely to still win. That captures
    substitutes (a flexible rack makes any single letter cheap), hard
    letters (Q without U, since ENABLE has no QI or ZA) and the shrinking
    horizon late in the match.
  - *Gain:* the largest single component (face value: 1–11% wins).
  - *Samples:* 48 beat 24 by 3–6 points; 64 gave nothing more (`03`).
  - *Rejected — selection-biased futures:* weighting future draws toward
    letters common in 7–8 letter words, since the bot buys those. Results
    were mixed (`21`).

- **Money as a shadow price.**
  - *Why:* currency has no terminal value (`lib.rs:1699`, `lib.rs:2335`),
    so its worth is what it can still buy. That falls over time, and it is
    lower when the bot is rich.
  - *Biggest lever found:* the base level mu0. In the first sweep,
    lowering it from 1 to 0.5 raised wins against default copies from 17%
    to 67% (Vickrey) and from 16% to 85% (first-price) (`01`).
  - *Pacing:* gentle pacing (0.01 per round) adds a slow "bid more when
    you're not spending" drift. It lifts league wins by about 10–20 points
    over no pacing or the tuner's 0.079, while keeping the overbidder
    covered.
  - *Per-mode prices:* in Vickrey you pay the runner-up's bid, so spending
    early is cheap. In first-price you pay your own bid, and valuing money
    lower (mu0 0.35) wins more of the letters you need. 2-bot matches are
    the exception: one-on-one, the steeper Vickrey curve (1.0) wins, so the
    bot switches on player count.
  - *Rejected:* a market-based mu, the value-per-price threshold that
    would spend the balance, built from observed prices. It was worse,
    especially under first-price (10% vs 16% self-play) (`02`), so the
    simpler formula stays.

- **Auction-format awareness.**
  - *Detection:* the mode is read from `match_state.auction_type`. A
    sim's bid is a public, deterministic function of letter and balance
    (`bot.strategy`), and sims win ties.
  - *Vickrey:* truthful bidding of the reservation price is right.
  - *First-price:* the bot best-responds. Against sims alone it bids
    exactly the top sim's bid + 1. Against external bots it uses the
    observed distribution of their winning bids.
  - *Gain:* without this, first-price self-play falls from 16% to 6% and the
    league from 39% to 20%.

- **Opponent modeling.**
  - *What's used:* exact sim-bid prediction (above), opponents' known racks
    and win shares, and external bid distributions for first-price.
  - *Rejected — denial:* an extra bid for keeping a letter from a leader who
    needs it, valued on that leader's reconstructed rack. Within noise, and
    it doubles CPU.
  - *Rejected — price-driving:* in Vickrey, bidding exactly the top sim's
    bid when we don't want the letter, so the sim pays its full bid. It
    changed no outcome, because sims seldom run out of money.
  - *Rejected — per-opponent first-price model:* each opponent's own
    winning bids, capped by its public balance, multiplied together. It won
    against its own copies (+11 points) but lost to the league and the
    baselines (`22`).
  - All three rejections follow the "keep the simpler one" rule. All remain
    as switches in `params.ts`.

- **Play timing.** The tuner's biggest find was to hold short words for
  long ones, not cash them for money.
  - *Cashing early:* self-play wins fall to 2–4%, league to 6–8%.
  - *Auto-play length:* 7+ letter words, played immediately, is best
    (`02`). 6+ gives 9%, 8+ gives 13%, and holding everything to the end
    gives 3%, against 17% for 7+. Playing at 7 locks in the top multiplier
    and the cash funds more bidding.
  - *End play-out:* playing out the whole rack in the final auction (the
    last letter can never be played) is worth about +8 self-play and +13
    league points. The exact partition and a greedy one tie (`02`), because
    end-of-match racks are small. The exact one is kept: it is precomputed
    between rounds and time-capped at 400 ms.

- **Low latency.**
  - *Between rounds:* `prepareNext()` runs after the bid is sent (p50
    43 ms, p99 149 ms, inside the 1 s window). It values all 26 possible
    next letters with next round's futures and precomputes the final
    play-out.
  - *At the auction:* the decision is then usually a lookup: decideBid
    p50 0.01 ms, p99 11.4 ms (`29-final-latency.md`).
  - *Without precompute:* the whole per-auction decision is p99 25 ms
    (self-play table).

## How the parameters were found

1. **Sensitivity sweep** (`01`): the money price dominates everything else.
2. **Tuner** (`sim/tune.ts`, log `sim/tune-log.md`): an iterated best
   response with a hall of fame, evaluated in both modes against self, the
   league, baselines and lobbies.
   - Iteration 1 accepted "no early cashing + pacing 0.079 + price-driving",
     taking the objective J from 6.73 to 4.96. Self-play went from 18% to
     49%, the league from 20% to 50%, the baseline field from 83% to 100%.
   - Iterations 2–4 found nothing beyond noise, so tuning moved to
     structural tests.
3. **Structural comparisons** (`02`, `03`) and **ablations** (`04`–`09`).
   These found that the tuner's bundle carried passengers: price-driving
   did nothing and the pacing rate was too high. Fixing both produced v6.
4. **Per-mode re-tune** (`17`–`28`). The money price was re-tuned
   separately per payment mode and for 2-bot matches, producing `final`.
   Two further ideas were tested and rejected.

**Versions** (`src/strategy/versions.ts`): v1–v6 and `final` are frozen,
complete parameter sets over the shared code. They are not code snapshots,
so any component can be switched on or off by parameter.

| Version | What changed |
|---|---|
| v1 | Face-value bids |
| v2 | + Monte Carlo valuation |
| v3 | + early cashing |
| v4 | + format awareness, mu0 0.5 |
| v5 | Tuner champion |
| v6 | + 48 samples, pacing 0.01, no price-driving |
| v7 | + per-mode money price: Vickrey time exponent 0.7 (1.0 in 2-bot matches), first-price mu0 0.35 |
| final | v7 + first-price +1 when external bots are present, + 2-bot leader tax, + active-player detection (offline seats), and first-price mu0 back to 0.5 under the tournament rules |

## Adversarial evaluation: strong, adaptive opponents

The fields above are baselines, the module's sims and our own earlier
versions. Tournament opponents will be built by strong teams, so a second
pass tested the bot against opponents designed to exploit it. Each
adversary is our own agent (v7) plus one exploit, so it is at least as
capable as we are (`sim/baselines/strong.ts`, harness `sim/threats.ts`).

| Scenario | Adversary | What it does |
|---|---|---|
| Same approach, different calibration | `clone`, `aggr`, `cons` | our bot with other money prices |
| Leader tax (Vickrey) | `shadow` | estimates the leader's value from their public rack and bids 85% of it, so the leader pays near full value or loses the letter |
| Deny the leader | `denier` | bids extra on letters that complete the leader's words |
| Snowball | `snowball` | cashes words early and spends early |
| Late sniper | `late` | hoards money (mu ×3) for half the match, then dominates (mu ×0.4) |
| First-price counter-bid | `outbid` | learns the leader's winning bids (public `paid`) and bids one more |
| Faster network | engine `priority` | opponents' bids always insert first, so they win every tie |
| Unpredictable | `jitter` | ±30% noise on every bid |

### Before hardening (v7), 300 matches per cell

| Field | Vickrey: win / rank | First-price: win / rank | Verdict |
|---|---|---|---|
| 1 vs 5 clone | 15.3% / 3.62 | 12.0% / 3.78 | parity (fair share 16.7%) |
| 1 vs 5 shadow | 14.0% / 3.44 | 12.0% / 3.78 | parity |
| 1 vs 5 denier | 19.0% / 3.31 | 17.3% / 3.60 | parity+ |
| 1 vs 5 outbid | 15.3% / 3.62 | 11.0% / 3.62 | parity |
| 1 vs 5 jitter | 17.0% / 3.41 | 18.3% / 3.27 | parity |
| 1 vs 5 snowball | 91.3% / 1.13 | 21.3% / 3.51 | win |
| 1 vs 5 late | 100% / 1.00 | 88.0% / 1.14 | win |
| 5 clones that win every tie | 17.7% / 3.46 | **7.0% / 4.46** | **hole 1** |
| mixed pool of all adversaries | 21.3% / 3.07 | 18.0% / 3.30 | above fair, not top |
| 8-bot pool of all adversaries | 17.0% / 4.12 | 11.0% / 4.51 | mid-pack (fair 12.5%) |
| duel vs clone | 49.3% | 42.3% | parity |
| duel vs shadow | **28.0%** | 42.3% | **hole 2** |
| duel vs denier | 42.7% | 51.7% | slight loss |
| duel vs snowball / late | 93% / 100% | 98% / 83% | win |
| duel vs outbid | 49.3% | 60.3% | win |

Raw tables: `sim/experiments/30-33-*.md`.

### Diagnosis and fixes

**Hole 1: first-price ties.** Like-minded bots arrive at the same integer
bid from the same model, so ties are common, and a tie goes to whoever's
bid reached the server first (`lib.rs:2142`). Counting ties as losses in the
model did nothing (7.3%), because the model is built from *past* letters and
never sees the tie it is about to lose. Bidding one unit above the model's
optimum (`fpPlus`) fixed it: slow-network first-price 7.0% → **20.7%**
(best in the field), clones with random tie order 12.0% → 19.7%, self-play
11.7% → 25.7%, mixed pool 18% → 26%, 8-bot 11% → 20%. Its only cost is
overpaying by 1 in weak fields (lobby score 356 → 299 at 100% wins), so it
applies only when external bots are present (`34`, `38`, `42`).

**Hole 2: the 2-bot final.** The shadow doesn't win by taxing us (the
paid/bid signature is identical in normal and shadowed duels, 0.60 vs 0.62,
so a detector-based defence was dropped). It wins by bidding high on the
letters *we* want. A cheaper money price made it worse (18.7%), denial even
at 3× made it worse (26%), and the shadow's own rule as a parameter
(`leaderTax` 0.85) fixed it: duel vs shadow 28% → **47%** (parity against
the bot built to exploit us) and duel vs plain clone 49% → **69%**. In 6-bot
fields the same rule taxes weak leaders and bleeds money (baseline field
99% → 92%), so it is on only in 2-bot matches (`leaderTaxDuel`) (`35`,
`39`, `41`, `42`).

**Rejected again:** `fpOutbid` (counter-bidding the leader's winning bids)
lost first-price duels 42% → 34%; denial lost everywhere it was tried.

### After hardening (`final` = v7 + fpPlus + leaderTaxDuel)

See the acceptance table at the top and `43-final-verify.md` for the
re-run of every scenario above.

## Limits of the evidence

- **Timing is abstracted.** The simulator has every bot decide at auction
  open, and shuffles tie order among external bots. Real network latency
  and late bids aren't modelled. The live bot decides within about 25 ms of
  seeing the auction.
- **Real opponents are unknown.** The league is built from our own variants
  plus baselines and the module's sims. `sniper` and `allin` were held out
  as unseen styles. A strong human-designed bot could still behave unlike
  anything here.
- **A recurring trap: wins against copies don't transfer.** Several changes
  won big against copies of the current bot but were neutral or worse
  against the league and the baselines: per-opponent first-price model, a
  cheaper first-price money price than 0.35, and the Vickrey exponent 0.5.
  Changes were adopted only when the diverse fields agreed.
- **The live module's game code is unpublished.** The live database runs a
  newer module than any public commit (round robin plus finals; see
  [RULES.md](RULES.md#the-live-server-runs-a-newer-unpublished-module)).
  Its schema was checked, and the bindings now match it column for column.
  Its scoring, auction and sim rules are assumed unchanged from `3064b36`,
  because every reducer the bot calls kept its signature. The likely
  ranking (round-robin wins, then total score) is the objective the tuning
  already used.
- **Not yet run against the live server.** That step is the user's. See
  README → Live bot. The token helper's claim step was exercised against
  the live server with an invalid code (rejected as expected: "No such
  nonce").

## Baselines (checkpoint 2)

Opponent definitions are in `sim/baselines/policies.ts`. The module's own sims
(`cheapo-sim` = Cheapskate, `valor-sim` = ValueBidder, `brutus-sim` =
Aggressive) are driven inside the engine exactly as `lib.rs` drives them.

Reproduce:
```
node sim/run.ts --pool all --seats 6 --matches 5000 --mode both --timings
node sim/run.ts --field starter,greedy,overbidder,hoarder,random,starter:starter-2 --matches 5000
node sim/run.ts --field starter,cheapo-sim,cheapo-sim:snippet-sim,valor-sim,valor-sim:hagrid-sim,brutus-sim --matches 5000 --mode vickrey
```

### Pool of all 8 (6 sampled per match, 5,000 matches)

| Vickrey | seats | win rate | mean score (±SE) | mean rank | letters won | spent | words |
|---|---:|---:|---:|---:|---:|---:|---:|
| overbidder | 3764 | 89.6% | 99.0 ± 0.4 | 1.11 | 38.8 | 196 | 12.2 |
| brutus-sim | 3746 | 29.0% | 60.7 ± 0.5 | 2.07 | 22.1 | 93 | 7.2 |
| random | 3705 | 13.5% | 52.7 ± 0.3 | 2.02 | 27.4 | 145 | 9.0 |
| starter | 3767 | 0.0% | 11.3 ± 0.1 | 3.58 | 1.3 | 5 | 1.4 |
| greedy | 3747 | 0.0% | 9.8 ± 0.1 | 3.70 | 0.0 | 0 | 0.9 |
| hoarder | 3721 | 1.1% | 5.5 ± 0.3 | 4.92 | 1.4 | 6 | 0.1 |
| valor-sim | 3740 | 0.0% | 0.1 ± 0.0 | 5.27 | 0.0 | 0 | 0.0 |
| cheapo-sim | 3810 | 0.0% | 0.0 ± 0.0 | 5.30 | 0.0 | 0 | 0.0 |

| First-price | seats | win rate | mean score (±SE) | mean rank | letters won | spent | words |
|---|---:|---:|---:|---:|---:|---:|---:|
| brutus-sim | 3746 | 95.5% | 94.1 ± 0.3 | 1.05 | 38.6 | 186 | 12.1 |
| overbidder | 3764 | 4.1% | 47.8 ± 0.2 | 2.18 | 18.0 | 147 | 6.0 |
| hoarder | 3721 | 29.1% | 46.9 ± 0.9 | 3.34 | 10.0 | 40 | 1.2 |
| random | 3705 | 0.3% | 33.4 ± 0.2 | 2.85 | 15.2 | 133 | 5.3 |
| starter | 3767 | 4.7% | 26.0 ± 0.3 | 3.35 | 8.8 | 36 | 4.1 |
| greedy | 3747 | 0.0% | 9.8 ± 0.1 | 4.32 | 0.0 | 0 | 0.9 |
| valor-sim | 3740 | 0.0% | 1.0 ± 0.1 | 5.41 | 0.1 | 0 | 0.1 |
| cheapo-sim | 3810 | 0.0% | 0.6 ± 0.0 | 5.46 | 0.1 | 0 | 0.1 |

### Fixed baseline field (5 baselines + a second starter in the seat our bot will take)

| Vickrey | win rate | mean score | mean rank | letters won |
|---|---:|---:|---:|---:|
| overbidder | 98.8% | 110.3 ± 0.3 | 1.01 | 41.3 |
| random | 1.1% | 41.7 ± 0.1 | 2.02 | 22.8 |
| starter (×2) | 0.0% | 11.1 ± 0.1 | 4.05 | 1.3 |
| greedy | 0.0% | 9.7 ± 0.1 | 4.23 | 0.0 |
| hoarder | 0.1% | 3.1 ± 0.1 | 5.64 | 1.4 |

| First-price | win rate | mean score | mean rank | letters won |
|---|---:|---:|---:|---:|
| hoarder | 56.8% | 58.3 ± 0.3 | 1.90 | 12.6 |
| overbidder | 32.5% | 48.5 ± 0.2 | 2.07 | 17.6 |
| random | 3.4% | 31.8 ± 0.1 | 3.61 | 15.1 |
| starter (×2) | 3.3–4.0% | 30.8 ± 0.1 | 3.73 | 11.4 |
| greedy | 0.0% | 9.7 ± 0.1 | 5.95 | 0.0 |

### The stock starter in a real lobby (5 module sims, Vickrey)

| strategy | win rate | mean score | letters won |
|---|---:|---:|---:|
| brutus-sim | 100.0% | 145.6 ± 0.4 | 63.2 |
| starter | 0.0% | 16.6 ± 0.2 | 4.5 |
| valor/hagrid/cheapo/snippet sims | 0.0% | ≤ 0.8 | ≤ 0.1 |
