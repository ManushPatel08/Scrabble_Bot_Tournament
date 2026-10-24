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
| interleaved: default vs mu0 0.435, #1000-1008 | 2 / 2 | | | too short; replaced |
| interleaved: default vs **priorByRivals 1.3 + contestFrac 1.2**, #1009-1207 | 20 / 19 | 25% / 26% | 2.95 / **2.47** (0 last places) | **shipped** 2026-10-24 03:20 (market replay 2.82 vs 2.96) |
| LetterSharkPro: interleaved default vs contestFrac 1.4 + contestBudget 3, #1290-1426 | 15 / 15 | 20% / 13% | **2.93** / 3.20 | dropped early (replay gain was only 0.03) |

Until the contestFrac trial, the default (priorByRivals 1.0) beat every interleaved variant. Only the change that made the bot more cautious early held up live; every
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
turn them into more long words. LetterSharkX matched the "rest" column
(11.7 letters, 32 coins left), which pointed at bidding market-level on more
letters, not at caps or reserves (both lost live). That is what contestFrac
does (bid at least 1.2x the match's median price on any letter the bot has
any use for, within 2x its fair money share), and it was the first
"buy more" change to win live (table above).

`scripts/player-profiles.mjs` profiles every player the same way (334
all-human matches since #900, 15+ matches each). The best mean places
belong to bots that buy 13-15 letters at or below the market price and
finish with 11-25 coins: postturing (2.26: 15.2 letters at 11.7 each, 15
left), Nijello (2.50: 6.3 of its 13.1 letters in the last third), Doppio
(2.61: 4.5/4.5/4.5 by phase, 11 left). Bots that hoard (MagnusBot 64 left,
PathAndLight 55, hinsonloo 52) finish near last. LetterSharkX sat at 3.07
with 11.7 letters and 32 left; the shipped config buys about one letter
more and leaves about 3 coins less in the replay.

The market replay is conservative about buying: when the candidate takes a
letter a rival actually won, the rival keeps its recorded words and score.
So it understates "buy more" changes (contestFrac 1.2 replayed at +0.14
places and measured +0.48 live), and a candidate that replays as no worse
while buying more letters and leaving less money is still worth a live
trial. Experiment 83 (253 matches x 4 seeds, against the shipped config at
2.86): contestFrac 1.4 + contestBudget 3 at 2.83 with 12.0 letters and 28.7
coins left; endMuScale 0.5-0.7 spends down to 27 coins but places the same;
mu0 0.45 is worse (3.00); priorByRivals 1.5, futureBias 0.5 and horizonCap
12 are no better.

## Why LetterSharkPro dipped after its start (2026-10-24 morning)

LetterSharkPro placed 2.58 on average in its first 19 matches (default
alone) and 2.92 over the next 26. Table strength didn't change (opponents'
own mean place 3.79 vs 3.66; about 1.1 of the top-10 bots per table). The
dip came from the contestFrac 1.4 variant (3.20 over 15 matches) and noise:
the default arm in the same period placed 2.69-2.93, inside its ±0.35 error.
At tables with 3+ of the top-10 bots we place 4.0 on average (4 matches).

`scripts/match-diagnostics.mjs` puts our bid on every auction next to the
winning bid, with what we bought and never played. Over 34 matches:

| We placed | n | score | letters (early/mid/late) | coins left | 7+ words | table winner's letters |
|---|--:|--:|---|--:|--:|--:|
| 1st | 11 | 108 | 14.6 (3.9/5.3/5.5) | 24 | 2.1 | (us) |
| 2nd-3rd | 9 | 83 | 12.7 (3.4/5.0/4.2) | 19 | 1.9 | 14.9 |
| 4th+ | 14 | 69 | 10.1 (2.7/4.4/2.9) | 36 | 1.2 | 16.8 |

Losses are matches where rivals outbid us, so we buy about 10 letters,
make one 7-letter word instead of two, and finish with unspent money (worth
nothing at the end). We almost never hold letters we can't use (0.4 per
match). The winning bid averages 1.35x the price paid (archive: 18 vs 13),
so the price signal visible during a match runs about 30% low.

How the leaders bid (public winning bids since #900): postturing (best
mean place, 2.26) bids flat, about 12 on vowels and 1-point letters, 17 on
2-3 points and 22 on 4-5 points, and buys J/Q/X/Z mostly in the last third
for about 16. We pay about 32 for early J/Q/X/Z and buy fewer early vowels.

Market replay (285 matches x 4 seeds; shipped config 2.86), experiments
84-88. Nothing beats the shipped config by the 0.08 bar:

| Idea | Best variant | Mean place |
|---|---|--:|
| Faster pacing toward spending everything (paceRate 0.03-0.12) | 0.03 | 2.93 (buys fewer letters) |
| Market money model, with lost auctions priced at 1.35-1.7x paid (marketLossMult) | 1.35 | 2.95 |
| Cash 4-6 letter words early (cashTiming) | min length 6 | 3.26 |
| Auto-play 6-letter words | | 3.57 |
| Cap J/Q/X/Z bids before the last third (premiumCap 15-30) | 30 | 2.97 |
| More Monte Carlo samples (160) | | 2.87 |
| mu0 0.55-0.6, muTimeExp 0.6-0.8, muBalExp 0.3-0.8 | muBalExp 0.8 | 2.83 |

The shipped config sits at the optimum of every money and timing knob
against the recorded market. postturing's flat bidding works for its own
word engine; capping our early premium bids or cashing words early costs
ours places. The default runs alone into the tournament unless a candidate
clears the replay bar.

## Fresh Manush registration and follow-up analysis (2026-10-24)

At the user's request, created **Manush / LetterSharkPro**, team 70 / bot
76. The previous LetterSharkPro registration (bot 70 / team 64) had already
been removed; no existing team or bot was deleted in this session. The new
bot began playing at 05:28 PT using the shipped default. This is a fresh
registration with the existing strategy, not a claim of a new trained model.

`scripts/auction-study.mjs` read all 1,761 completed matches and 119,748
public auction results at its snapshot. Experiment 91 lists every match
winner, per-letter winning-bid medians by match phase, and 100 candidate
late word-completion swings. The complete auction/word archive is saved
locally under ignored `sim/replay/`. A purchased tile followed by a word
is a review candidate, not proof that the purchase caused the win: initial
rival racks and alternative word choices are unknown. For example, in
match 1188 SookraBot won a late Q with bid 33, paid 27, subsequently played
CLIQUEY for 63, and won by 1 point.

The replay data builder now resolves both current and retired bot ids,
excludes unfinished matches and missing rival top bids, and loads a bounded
public snapshot in bulk. This recovered the retired LetterSharkPro history
for 340 own completed all-human matches. Replay seeds now begin with the
live adapter's seed convention. Error estimates average seeds within each
match before calculating paired uncertainty: seeds are not independent
new match observations. The optional proportional rival-score adjustment
is a sensitivity model only, not a causal replay.

All new strategy switches remain **off**. Experiments 90–96:

| Hypothesis | Sample | Default vs candidate mean place | Win / score evidence | Decision |
|---|---|---|---|---|
| Exact word-set values in final 3/8/12 auctions | 340 matches x 2 seeds | 2.93 vs 2.93 (all) | default 22.1% wins; variants 22.1/21.9/21.6% | reject |
| Per-letter, phase-specific historical price floor | 93 recent held-out matches x 4 seeds | 3.22 vs 3.19 best | wins unchanged at 18.0%; score 80.0 vs 80.2 | too small; reject |
| Try 2 or 3 first words in MC word-set valuation | 93 matches x 2 seeds | 3.09 vs 3.15 / 3.21 | 2 branches: wins 19.4% vs 21.5%, score 81.1 vs 81.7, but place uncertainty includes regression | reject |
| Future samples reflect historical own letter acquisition, crossed with letter-price floors | 93 held-out matches x 4 seeds | 3.22 vs 3.11 | wins 18.0% vs 19.6%; score 80.0 vs 80.7; paired place change -0.108 +/- 0.159 (approx 95%) | confirm before live |
| Same acquisition/price candidate, full-set confirmation | 340 matches x 4 seeds | 2.96 vs 2.96 | wins **21.3% vs 20.4%**; score **84.0 vs 83.5** | **reject; no live A/B** |
| Same candidate, recent-set sensitivity with 0.5 rival adjustment | 93 matches x 4 seeds | 3.21 vs 3.06 | wins 18.0% vs 21.2%; fixed opponent bids, approximate score correction | does not overturn full-set regression |

Historical price priors used public all-human six-player matches #500–1200
(701 matches); acquisition weights used 247 own matches through #1200,
smoothed with 40 pooled-prior observations per letter. Neither used the
held-out outcomes to construct its priors. Multiple variants were explored,
so these are exploratory comparisons, not confirmatory significance tests.

The shipped parameters are unchanged. The launcher now refuses a requested
team/bot mismatch or failed credential mint. `scripts/restart-live.ps1`
checks the recorded launcher PID and creation time, refuses duplicate
starts, waits for a match boundary, stops only its process tree, clears
overrides, and keeps credentials in memory. `SESSION.md` records live
operations and the finite health/improvement schedules plus the 21:00 PT
tournament handoff. There was no public tournament at startup; automatic
registration remains enabled and must be verified when registration opens.

Validation: `npm run typecheck` and all **69 tests** passed, including
decision latency p99 <100 ms, dictionary search/partition correctness,
experimental affordability/final-tile checks, and complete live-adapter
matches in both auction formats. PowerShell syntax and duplicate-start
checks passed. The actual boundary restart successfully reconnected the
same bot 76 with no overrides; it resumed the next match from public history.
At 05:51 PT the public stats were rating 1430, 19 matches, 3 wins and 1,654
total points (87.1 mean). These are early default-only results, not evidence
that one of the rejected changes improved live performance. Team 70 had
one member, and the tournament and entry tables were still empty.

## Further strategy experiments and the uncertainty candidate (2026-10-24)

Five additional mechanisms were implemented as off-by-default switches and
tested on the same 340 archived live matches. Experiment 97–101 screening
used two seeds per match; the control was 22.1% wins, mean place 2.93,
mean score 84.5. Multiple variants were explored, so confirmation matters.

| Mechanism | Best observed setting | Mean place | Wins | Mean score | Decision |
|---|---|---:|---:|---:|---|
| Choose long words using immediate cash plus remaining-rack future value | wordLookahead 1 | 2.92 | 21.9% | 84.4 | negligible; off |
| Extra bid reservation for a tile completing an immediately cashable long word | completionCredit 0.1 | 2.93 | 22.8% | 84.2 | score fell; larger credits clearly worse; off |
| Estimate future win share from a recent auction window | winHistoryWindow 36 | 2.93 | 22.4% | 84.1 | score fell; windows 12/24 worse; off |
| Blend future marginal values with points spellable now | immediateValueWeight 0.25 | 3.15 | 19.4% | 81.3 | worse; larger weights substantially worse; off |
| Sample the number of future acquisitions, rather than fix every sample to its rounded expectation | futureCountNoise 1 | 2.87 | 22.4% | 85.3 | confirm |

The last model samples usable future auction wins from a binomial
distribution with the agent's current estimated win share. Each MC sample
then draws that many tiles from the tracked unseen pool, capped by the
existing horizon. This captures uncertainty in acquisition count, rather
than only uncertainty about which letters are acquired. The fixed-count
model remains the shipped default; only the experimental B arm uses the
new model. Half-strength uncertainty (0.5) was worse in the screen.

Confirmation, experiment 103, **340 matches x 4 seeds**:

| Policy | Win rate | Mean place | Mean score | Tiles bought | Coins left |
|---|---:|---:|---:|---:|---:|
| default | 21.3% | 2.96 | 84.0 | 11.5 | 31.0 |
| futureCountNoise 1 | **23.0%** | **2.86** | **85.4** | 11.9 | 29.5 |

Paired place change: **-0.099 +/- 0.076** (approximate 95% interval,
clustered by match). A separate check used **31 fresh matches #1741–1899 x
8 seeds**, collected before testing this candidate (experiment 104):

| Policy | Win rate | Mean place | Mean score | Tiles bought | Coins left |
|---|---:|---:|---:|---:|---:|
| default | 15.7% | 3.05 | 82.7 | 10.5 | 33.9 |
| futureCountNoise 1 | **19.8%** | **2.85** | **85.6** | 11.2 | 30.6 |

Paired place change: **-0.198 +/- 0.148** (same clustering). These are
replay estimates, not measured live gains. Rival bids and scores stay
fixed, and the 8 seeds are not 8 independent sets of opponents.

Typecheck and 15 targeted strategy/tracker tests passed, covering budget
bounds, final-tile behavior, word selection, current-value cache behavior,
reproducible random counts, and bag conservation. Candidate latency with
live precompute enabled (experiment 105, 6 matches / 408 decisions / max
observed rack 13): bid p99 **21.44 ms**, max **24.0 ms**, word p99
**0.02 ms**. Precompute remains sliced in the live adapter. The latency
CLI now accepts parameter overrides to check experimental settings.

The same Manush / LetterSharkPro bot 76 was restarted with only
`BOT_PARAMS_B={"futureCountNoise":1}` for an alternating live trial. No
shipped defaults changed. A PowerShell 7 JSON-date conversion discrepancy
in the restart PID check was fixed by comparing DateTime values; duplicate
checks passed in PowerShell 5.1 and 7 before the actual restart. A match
resumed during startup is excluded from A/B scoring. Follow SESSION.md for
the trial's first labelled match, minimum sample sizes, and stop/adopt rules.

### Trial closure and requested replacement (2026-10-24 07:22 PT)

The user explicitly requested a fresh replacement. The old bot was stopped
at a match boundary, its public statistics and exact trial log archived,
and its owner used the normal leave/create flow. No second bot was run and
no team-membership restriction was bypassed. The current registration is
**Manush2 / LetterSharkPro, team 78 / bot 84**. Preserve this identity;
another replacement requires another explicit user request.

The final archived bot 76 trial had **23 completed games per arm**:

| Arm | Completed | Wins | Mean place | Mean score |
|---|---:|---:|---:|---:|
| A: shipped default | 23 | 4 | 3.04 | 80 |
| B: futureCountNoise 1 | 23 | 5 | 3.17 | 79 |

This is **inconclusive**, below the 25-per-arm minimum. Earlier favorable
intermediate summaries do not replace the final tally. Archives are
`logs/retired-76-registration.json` and `logs/retired-76-live.log`.
The new bot runs standalone `BOT_PARAMS={"futureCountNoise":1}` with no
active A/B, based on promising replay evidence, **not proven live adoption**.
Shipped defaults and `VERSIONS.final` keep the new model off. Fresh rating
and early match outcomes are not a before/after strategy comparison.

The restart helper now restores saved A/B configuration on `-IfDown`, uses
the current saved team/bot names, and supports an explicit `-StopOnly`
maintenance path. A deliberate restart without ParamsA/ParamsB clears
overrides; tournament mode also clears them. Historical data builders now
resolve the actual own participant ID per match when retired registrations
share a bot name. Do not drop old bot 76's data merely because bot 84 has
the same name.

### Experiment 106: protected completion cash — rejected

Hypothesis: when liquidity is low, reserve the rack letters for a long
word that specifically requires the auctioned tile, then cash words made
only from spare letters. This differs from indiscriminately cashing short
words, but still needs measured evidence. `protectedCashBelow` defaults to
zero, and the live bot has not enabled it.

Fixed dataset: 340 archived matches x 2 seeds. Every variant includes
`futureCountNoise=1`, so the comparison isolates protected cash:

| Threshold | Wins | Mean place | Mean score | Coins left |
|---|---:|---:|---:|---:|
| 0: configured baseline | 22.4% | 2.87 | 85.3 | 29.6 |
| 10 | 22.6% | 2.86 | 85.3 | 29.4 |
| 20 | 22.1% | 2.89 | 84.9 | 29.3 |
| 40 | 20.1% | 3.00 | 82.8 | 28.6 |

Paired mean-place changes, averaging seeds within each match:
10: -0.009 +/- 0.016; 20: +0.015 +/- 0.029; 40: +0.132 +/- 0.055
(approximate 95% intervals). The best setting is far below the required
0.08 improvement; larger settings regress. **Reject; keep off; no live
trial.** Raw report: `sim/experiments/106-protected-completion-cash.md`.

### Second requested replacement and a fresh A/B (2026-10-24 07:40 PT)

In a new Claude session, the user explicitly asked for another fresh
LetterSharkPro. Bot 84 / team 78 (Manush2) was stopped at a match boundary
after 15 matches with `futureCountNoise=1` alone (3 wins, total 1173,
78.2 per match). That configuration ran without a control arm, so those
matches are not evidence about the candidate. The normal leave/create flow
created **Manush3 / LetterSharkPro, team 80 / bot 86**. Archives:
`logs/retired-84-registration.json`, `logs/retired-84-live.log`.

Bot 86 runs a fresh interleaved A/B from its first match (#2332): A is the
shipped default, B is `futureCountNoise=1`. It is scored separately from the
inconclusive bot 76 trial. The live gate has low power. With a per-match
place SD of about 1.6, 45 matches per arm give a standard error of about
0.34 on the difference, so the expected replay effect (about -0.1) cannot
be confirmed live. Only a large effect in either direction can be.

Field context at 07:42 PT, from public `bot_stats`, all-human bots with 10+
matches, ranked by OpenSkill mu − 3σ:

| Bot | Matches | Win % | Mean score |
|---|--:|--:|--:|
| Chinese Dante | 452 | 35 | 93.5 |
| Nijello | 285 | 38 | 92.1 |
| Doppio | 321 | 32 | 92.0 |
| postturing | 56 | 30 | 85.9 |
| our retired 61 / 70 / 76 | 94 / 90 / 95 | 19 / 21 / 20 | 82.6 / 80.1 / 81.1 |

Our registrations have won about 20% of all-human matches, against 32-38%
for the three leaders. Closing that gap needs a structural change, not
another ±0.1-place parameter adjustment.

### Where the leaders' points come from (562 all-human 6-seat matches, #1200-1761)

Public archive (`sim/replay/public-auction-study.json`). Points per match,
by word length:

| Player | Place | Letters (e/m/l) | 2-3 / 4 / 5 / 6 / 7 / 8+ letter words, pts | ≤6-letter pts cashed before the last auction | End-partition pts | Auctions with < 8 coins |
|---|--:|---|---|--:|--:|--:|
| Doppio | 2.34 | 14.0 (4.4/4.3/5.4) | 3/2/4/11/51/**24** | 20.1 | 0.3 | 0.4 |
| Nijello | 2.38 | 12.8 (4.2/3.5/5.1) | 2/4/5/12/43/**25** | 14.9 | 10.1 | 0.8 |
| Chinese Dante | 2.48 | 12.1 (4.5/4.3/3.2) | 2/2/4/9/**65**/11 | 2.2 | 15.2 | 4.0 |
| postturing | 2.57 | 14.5 (5.6/3.2/5.7) | 2/2/4/10/44/**27** | 14.7 | 4.7 | 1.6 |
| **ours** (61/70/76) | 3.22 | 11.1 (3.0/4.6/3.5) | 2/2/4/9/53/9 | **0.0** | 17.9 | 3.7 |

- Our end-of-match balance (about 31) is mostly *not* unspent money. It
  includes the final partition's word rewards (about 18), which are credited
  when the match closes. Truly unspent money is about 12, the same as the
  leaders'.
- The score gap with Doppio, Nijello and postturing is almost entirely
  **8+ letter words** (24-27 vs 9 points). Only 10-19% of their 8-letter
  words extend a 7-letter word they already held. They build eight
  directly. Holding every 7-letter word (auto8, experiment 81) lost.
- The other gap is volume: 12-14.5 letters vs 11.1, at the same price per
  letter. In our 116 recent matches (bots 76/84/86, own logs plus public
  results) we lost **about 14 auctions per match by 1-3 coins** (5.3 early,
  5.5 mid, 3.1 late), and about 15 more by 4-6.
- In 28% of our matches we spend 5+ late auctions (from about 82% of the
  match) with under 8 coins, holding letters that are cashed only in the
  final partition (29 points on average in those matches). Mean place there
  is 3.59 vs 2.90 otherwise. This is a correlation, not a measured cause.
- J/Q/X/Z are not the problem. We buy 0.67 per match at 32.7 and use 95% of
  them (58% in 7+ letter words), in line with the leaders.

### Experiment 107: selection-aware futures — rejected

Hypothesis: we win the auctions we value most, so uniform Monte Carlo
futures understate a half-built long word. `futureSelect` draws this many
times the expected future wins from the unseen pool, then keeps the
letters that most advance the rack toward 7-8 letter words
(`letterUsefulness`). The default is 0 (off). Fixed set, 340 matches x 2
seeds:

| Variant | Wins | Mean place | Score | Letters | Paired place change |
|---|--:|--:|--:|--:|--:|
| default | 22.1% | 2.93 | 84.5 | 11.5 | |
| select 1.5 | 19.3% | 3.11 | 82.0 | 10.3 | +0.19 ± 0.14 |
| select 2 | 17.6% | 3.17 | 80.3 | 9.9 | +0.24 ± 0.14 |
| select 3 | 12.6% | 3.60 | 73.4 | 9.2 | +0.67 ± 0.14 |

Monotonically worse. Monte Carlo futures are free letters, so a future
that already fits the rack makes the auctioned letter look redundant, and
the bot buys fewer letters. That is the opposite of the measured deficit.
Lesson: any change that makes futures richer or more relevant lowers
current values. Changes that raise purchases must work on the money side or
on the auctioned letter's own value. Raw output:
`sim/experiments/107-selection-futures-screen.md`.

### Experiment 108: is "bid more" hidden by the replay's rival bias? No

This is a measurement check, not a re-adoption: earlier buy-more variants
were rerun with the rival-score adjustment off (0) and on (1). Fixed set,
340 x 2:

| Variant | Place (adj 0) | Paired change | Place (adj 1) | Paired change | Letters | Coins left |
|---|--:|--:|--:|--:|--:|--:|
| default | 2.93 | | 2.89 | | 11.5 | 31.1 |
| mu0 0.45 | 2.96 | +0.03 ± 0.11 | 2.95 | +0.06 ± 0.11 | 11.3 | 30.2 |
| mu0 0.40 | 3.20 | +0.28 ± 0.13 | 3.16 | +0.27 ± 0.14 | **10.8** | 31.6 |
| contestFrac 1.5, budget 3 | 2.91 | -0.02 ± 0.02 | 2.87 | -0.02 ± 0.02 | 11.8 | 28.1 |
| endMuScale 0.5 | 2.97 | +0.04 ± 0.04 | 2.92 | +0.03 ± 0.05 | 11.6 | 27.1 |

A cheaper money price buys **fewer** letters. Higher bids overpay for early
letters, and the money runs out before the mid- and late-game letters the
leaders win. The rival adjustment does not change any conclusion. Money is
genuinely scarce for us, so the leaders' extra letters come from more
*spendable income*, not higher bids. Spendable income is the points scored
before the final auction: about 61 for us vs about 95 for Doppio.

### Experiments 109-110: cash short words when nearly broke — **first candidate to clear the bar on screen, confirmation and holdout**

Mechanism (all off by default): `cashBelow` gates the existing
`cashTiming` rule so that shorter words (down to `cashMinLen` 2) are cashed
only while the balance is below the threshold; `futureAffordable` caps the
Monte Carlo future letters at `balance / median price`, so a broke bot
stops valuing its rack as if it will keep winning. `cashLate` (time gate
only) was also tried and lost.

Screen (109), 340 x 2: afford1 -0.08 ± 0.10; cashBroke12 -0.10 ± 0.04;
cashBroke12+afford1 -0.17 ± 0.10; cashLate15 +0.09; afford2 +0.01.

Confirmation (110), fixed set 340 x 4 seeds, and the frozen holdout
#1905-2409 (92 matches x 8 seeds, built at 08:05 PT before any screening):

| Variant | Fixed: place / wins / score | Paired change | Holdout: place / wins / score | Letters | Coins left |
|---|---|--:|---|--:|--:|
| default | 2.96 / 21.3% / 84.0 | | 3.31 / 18.5% / 77.3 | 11.5 | 31.0 |
| cashBelow 8 | 2.85 / 23.5% / 85.7 | -0.11 ± 0.03 | 3.18 / 20.5% / 78.9 | 12.0 | 26.5 |
| cashBelow 12 | 2.84 / 23.0% / 85.7 | -0.12 ± 0.04 | 3.19 / 20.9% / 78.7 | 12.2 | 23.8 |
| cashBelow 16 | 2.91 / 21.5% / 84.6 | -0.05 ± 0.04 | 3.26 / 20.2% / 77.7 | 12.2 | 22.2 |
| **cashBelow 12 + futureAffordable 1** | **2.80 / 24.6% / 86.3** | **-0.16 ± 0.08** | **3.09 / 22.0% / 80.4** | 12.3 | 24.3 |
| cashBelow 12, min len 3 | 2.83 / 22.9% / 85.8 | -0.13 ± 0.04 | | 12.2 | 23.8 |

The combination buys 0.8 more letters per match and leaves 7 fewer coins,
which is the direction the public leaders' profiles point. It is a replay
result, with the usual limits (rivals' bids and scores fixed). It went to
a live A/B on bot 86 as `BOT_PARAMS_B={"cashTiming":1,"cashMinLen":2,
"cashBelow":12,"futureAffordable":1}` at about 08:35 PT. The previous B
(`futureCountNoise` 1) ended **inconclusive at 21 completed matches per
arm** (#2332-2563): A 3.24 / 24% wins / 79, B 3.00 / 24% / 80. The user asked for
larger changes, so the trial slot was given to the larger measured effect.
Raw: `sim/experiments/109-liquidity-screen.md`,
`sim/experiments/110-liquidity-confirm.md`.

### Experiment 111: hold a 7-letter word for an 8 — no effect, rejected

The leaders' edge is 8+ letter words, and 76 of our last 131 7-letter
plays had 16+ unseen tiles that would have extended the word (with the
rest of the rack) to 8+. `hold7Ext` holds the 7 while that count is at
least the threshold, 6+ usable auctions remain, and the balance is not
below `cashBelow` (so the cash-when-broke rule still fires). 340 x 2:

| Variant | Wins | Place | Score | Letters | Paired vs default |
|---|--:|--:|--:|--:|--:|
| default | 22.1% | 2.93 | 84.5 | 11.5 | |
| B (cashBelow 12 + afford 1) | 25.4% | 2.76 | 86.3 | 12.3 | -0.17 ± 0.10 |
| B + hold 16 / 24 / 32 | 25.4 / 26.0 / 25.1% | 2.76 / 2.78 / 2.77 | 86.3 / 86.2 / 86.3 | 12.0-12.2 | -0.17 / -0.14 / -0.15 |
| hold 24 alone | 21.8% | 2.93 | 84.5 | 11.4 | 0.00 ± 0.05 |

Holding delays the 7's cash by about as much as the occasional 8 gains;
the net is zero at every threshold. The leaders' 8-letter words are not
reachable by holding our 7s. They come from buying the extra letters
first (14 vs 11 per match), which the liquidity candidate addresses.
Kept off. Raw: `sim/experiments/111-hold7-screen.md`.

### Experiment 112: money knobs stacked on the liquidity candidate

With cash returning mid-game, do the earlier "buy more" settings behave
differently? 340 x 2, all rows include B (cashBelow 12 + afford 1):

| Added to B | Wins | Place | Score | Letters | Coins left | Paired vs default |
|---|--:|--:|--:|--:|--:|--:|
| nothing (B) | 25.4% | 2.76 | 86.3 | 12.3 | 24.6 | -0.17 ± 0.10 |
| contestFrac 1.4, budget 3 | 25.0% | 2.74 | 86.8 | 12.9 | 19.7 | -0.19 ± 0.10 |
| contestFrac 1.6, budget 3 | 25.1% | 2.73 | 86.9 | 12.9 | 18.7 | -0.19 ± 0.10 |
| endMuScale 0.5 | 24.4% | 2.78 | 86.2 | 12.7 | 17.5 | -0.15 ± 0.10 |
| mu0 0.45 | 24.3% | 2.83 | 86.0 | 12.3 | 23.3 | -0.10 ± 0.11 |
| priorByRivals 1.1 | 22.1% | 2.85 | 85.7 | 12.3 | 24.2 | -0.08 ± 0.11 |
| cashBelow 16 instead of 12 | 23.5% | 2.84 | 85.1 | 12.3 | 23.3 | -0.09 ± 0.10 |

The contest floor adds about 0.02-0.03 places on top of B, inside the
noise, and contestFrac 1.4 + budget 3 lost its own live trial earlier
(2.93 vs 3.20 over 15 per arm). Cheaper money and a lower prior still
hurt even with B. Holdout (92 x 8): default 3.31, B 3.09 (-0.22 ± 0.11),
B + contest 1.4/3 3.02 (-0.29 ± 0.11), B + contest 1.6/3 3.01 (-0.29 ±
0.11), with wins 23.5% vs 22.0% and 0.7 more letters. The increment over
B is consistent across both datasets (about 0.07) but inside the noise of
each. The earlier live loss of contestFrac 1.4 happened without liquidity;
running dry is exactly what B fixes, so the old result may not transfer.
**B2 = B + contestFrac 1.6 + contestBudget 3** is the next trial candidate,
to be tested against B (not against the default) after trial 2 settles.
B stays as the live arm for now.

Experiment 113 measured B2 against B directly (340 x 4): place 2.77 vs
2.80, wins 24.9% vs 24.6%, score 86.8 vs 86.3, letters 12.9 vs 12.3,
paired **-0.026 ± 0.019**. contestFrac 2.0 is the same; budget 4 gives it
back (13.2 letters, 15.8 coins left, 0.000 ± 0.030). The increment is
real in replay but far too small for a live trial to resolve. Treat B2 as
"stack on B if B is adopted", not as a separate live candidate.
Raw: `sim/experiments/113-b2-confirm.md`.

### Live trial 2 verdict (bot 86, #2565-2800, 09:29 PT): **B rejected**

| Arm | Completed | Wins | Last places | Mean place | Mean score |
|---|--:|--:|--:|--:|--:|
| A: shipped default | 25 | 2 | 1 | **3.20** | 78 |
| B: cashBelow 12 + futureAffordable 1 | 25 | 3 | 4 | 3.88 | 76 |

B is 0.68 places worse at the 25-per-arm gate (threshold 0.4), so it is
dropped as pre-registered. The difference is about 1.6 standard errors,
so this is not proof that B is harmful, but it is clearly not the large
live gain the user needs, and the replay's +0.17-0.22 did not show up.
Live behaviour matched the design (B cashed 0.3 short words per game
mid-match, A none), so this is a strategy result, not a bug. Lesson for
the replay: changes to *when we cash* alter our own future purchases,
which the replay models, but also what rivals can buy and how they bid
afterwards, which it does not. Treat cash-timing replay gains as
unreliable. `cashBelow`/`futureAffordable` stay off. The bot runs the
shipped default alone from about 09:30 PT until the next candidate.

### Experiment 115: Lambi Lambiii's mechanisms in our engine

The user shared bot #77's write-up (mean place 2.1-2.45 live). Its
distinct rules were added as switches: `shadeLow` (bids on 1-2 point
letters x0.8 except in the last 12 auctions), `lateCashLen`/`lateCashWindow`
(play any 5+ letter word in the last 12), `finalPackWindow` (exact packing
in the last 3), `rackCap` (cash at 11+ tiles). Its cash-when-broke trigger
is `cashBelow`. 340 x 2, on top of B and on the default:

| Variant | Wins | Place | Score | Letters | Paired vs default |
|---|--:|--:|--:|--:|--:|
| B | 25.4% | 2.76 | 86.3 | 12.3 | -0.17 ± 0.10 |
| B + shade 0.8 | 26.2% | 2.80 | 86.5 | 11.5 | -0.12 ± 0.12 |
| B + late cash 5+ in last 12 | 22.1% | 2.96 | 83.5 | 12.3 | +0.03 ± 0.10 |
| B + pack in last 3 | 23.5% | 2.83 | 85.0 | 12.1 | -0.10 ± 0.10 |
| B + rack cap 11 | 25.4% | 2.76 | 86.3 | 12.3 | -0.17 ± 0.10 (never triggers) |
| B + shade + late cash + pack | 20.7% | 3.07 | 82.1 | 11.2 | +0.14 ± 0.11 |
| default + shade 0.8 | 23.1% | 2.88 | 85.0 | 10.8 | -0.05 ± 0.12 |

Nothing transfers. Lambi's rules correct a valuation that over-bids on
common letters; ours already under-buys them, so shading just buys 0.7
fewer. Late cashing and early packing cost us the final-partition points.
`shadeLow 0.8` went to live trial 3 anyway (09:33 PT): the replay is
neutral, Lambi's live evidence is strong (3.0 to 2.1 over 40 games), and
the replay cannot see what rivals do with the cheap letters we stop
taking. All switches stay off in the shipped defaults.

### The recent field (577 all-human 6-seat matches since #2300)

Public data, current bot versions. Long words are **identical** between
Lambi Lambiii and us (7-letter 1.33 vs 1.34 per match, 8+ 0.19 vs 0.19),
and so are points per letter bought (7.5 vs 7.4). The 16-point gap is
volume and timing:

| Player | Place | Score | Letters e/m/l | Winning bid e/m/l | Short-word pts cashed mid-match | Points held to the final partition | Unspent |
|---|--:|--:|---|---|--:|--:|--:|
| Lambi Lambiii | 2.16 | 94 | 12.5 = 5.2/4.0/3.3 | 20.5/17.1/17.6 | 22.0 | 0.2 | 10 |
| Nijello | 2.40 | 91 | 12.3 = 3.6/3.1/5.6 | 14.6/15.8/21.5 | 15.9 | 10.3 | 10 |
| Chinese Dante | 2.47 | 90 | 12.0 = 3.5/5.3/3.1 | 19.9/16.2/17.2 | 0.9 | 13.8 | 9 |
| LetterSharkPro | 3.31 | 78 | 10.5 = 2.7/4.6/3.3 | 18.2/17.4/18.7 | 3.1 | 13.8 | 16 |

Score = coins spent + leftover − 100 (identity), so scoring more means
spending more, which needs coins back earlier. Lambi buys 5 letters in
the first third and refinances with 22 points of short words; Chinese
Dante holds like us but buys 3.5 early letters. We buy 2.7.

### Experiment 116: a flat early "foundation" floor — rejected decisively

`earlyFloor`: in the first third, while the rack holds fewer than 11
tiles and no 7-letter word, bid at least 18 or 22 on any letter with
positive value; combined with the rack cap, late cash and cash-when-broke
rules to copy Lambi's loop. 340 x 2:

| Variant | Wins | Place | Score | Letters | Paired vs default |
|---|--:|--:|--:|--:|--:|
| default | 22.1% | 2.93 | 84.5 | 11.5 | |
| floor 18 | 4.1% | 4.66 | 55.8 | 11.2 | +1.73 ± 0.15 |
| floor 22 | 2.9% | 4.96 | 52.1 | 9.8 | +2.03 ± 0.15 |
| floor 18/22 + rack cap 11 + late cash 5 (+ cash below 8) | 2.4-2.6% | 4.7-5.0 | 52-55 | 10-11.5 | +1.8 to +2.1 |

A flat floor wins every contested early letter at the rivals' price and is
broke by mid-match; the cash rules cannot refinance a rack of random
letters. Lambi's early buying works because its valuation is selective
(lookahead to words 1-2 letters away, capped at 60% of balance). Copying
behaviour without the valuation behind it fails. All off.

### Experiment 117: selective foundation value — rejected

`foundationWeight` adds points, under the same early/small-rack
conditions, in proportion to the letter's usefulness toward 7-8 letter
words (`letterUsefulness`, relative to the average useful letter). 340 x 2:
weight 1 place 3.31 (+0.39 ± 0.12), weight 2 3.49 (+0.56), weight 4 3.95
(+1.03); the rack cap changes nothing. Monotonically worse: any additive
early value makes the bot overpay for letters whose completions the Monte
Carlo already prices. Off.

### Live trial 3 (shadeLow 0.8) and the fourth registration (09:55 PT)

Trial 3 reached 9 per arm when the user asked for a new bot: A 3.33 / 0
wins / 81, B 3.89 / 1 win / 77. Inconclusive with a negative trend; the
shading stays off. At the user's explicit request ("Start a new bot with
strongest variant"), bot 86 was stopped at a match boundary (110 matches,
17 wins, archives `logs/retired-86-*`) and **Manush4 / LetterSharkPro,
team 89 / bot 95** was created through the normal flow. It runs
`futureCountNoise=1` alone: replay -0.10 ± 0.08 (340 x 4) and -0.20 ±
0.15 (31 x 8); pooled live over two interleaved trials, 44 per arm each,
3.08 vs 3.14 for the default. That is the best total evidence of any
variant, and still not a proven live gain. Shipping it into the defaults
for the tournament is the user's decision.

Summary of the day's live trials (all on the same bot, interleaved,
against the same field): nothing beat the shipped default by the gate,
and the one candidate the replay liked most lost by 0.68. Replay effects
of 0.1-0.2 places are below what the live gate can resolve in an hour,
and at least one such effect did not transfer at all.

## Rollout valuation (experiments 118-120, 2026-10-24 10:00-11:00 PT)

The user shared Lambi Lambiii's planner description (bot #77, mean place
2.2): a one-step rollout that plays sampled futures out to the end of the
match with a hand-written "future me", pairs the pass and win branches on
the same future, and bids where the averaged gain curve crosses zero.
`src/strategy/rollout.ts` implements that inside our engine, behind
`rolloutBid` (default 0):

- Futures: the next H auction letters from the tracker's unseen pool, and
  a highest-rival-bid price for each from `rival-prices.ts`, frozen
  quantiles of the public archive's winning bids by letter and game third
  (through #1761; never live bids). H = 66 plays the whole match out.
- Future me: cashes 7+ letter words, the whole rack at 11+ tiles, 5+
  letter words in the last 12 auctions, everything in the last 3, and a
  word when below 8 coins; it buys each letter by bidding the price
  quantile that wins a target share (`rolloutShare` 0.18), raised for
  letters that fit its rack (`letterUsefulness`) and for a letter that
  completes a 7+ word. The live bot uses the same word rules through
  `rackCap 11, cashBelow 8, lateCashLen 5 / lateCashWindow 12,
  finalPackWindow 3`, so coins saved by passing are spent as the bot
  would spend them. The first version, with Lambi's face-value bidding
  rule, reproduced the bias its authors describe (86 for a round-1 Z).
- Bid: 1, the letter's archive quantiles and the balance form the price
  grid; the mean of score(win at p) - score(pass) over the samples is
  interpolated to its zero crossing.

| Dataset | Variant | Wins | Mean place | Last | Score | Letters | Coins left | Paired vs default |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| 340 x 1 seed (118) | default | 21.5% | 2.93 | 5.9% | 84.7 | 11.4 | 32.1 | |
| | rollout, 24 samples | 22.6% | 2.73 | 3.5% | 86.3 | 12.9 | 13.0 | -0.20 ± 0.15 |
| | rollout, 48 samples | 27.1% | 2.54 | 1.5% | 88.9 | 13.0 | 12.7 | **-0.39 ± 0.15** |
| | 24 samples, share 0.25 | 25.6% | 2.70 | 3.5% | 87.6 | 13.1 | 11.7 | -0.23 ± 0.15 |
| | 24 samples, share 0.12 | 17.1% | 3.07 | 4.7% | 80.7 | 11.6 | 21.7 | +0.14 |
| | 24 samples, prices x1.15 | 19.7% | 2.95 | 2.9% | 82.6 | 12.7 | 9.1 | +0.02 |
| | 24 samples, horizon 20 | 17.6% | 2.97 | 3.8% | 82.4 | 12.4 | 13.1 | +0.04 |
| | word rules alone, static valuation | 17.9% | 3.10 | 6.8% | 81.4 | 11.7 | 24.6 | +0.17 ± 0.09 |
| 340 x 2 seeds (119) | default | 22.1% | 2.93 | 6.3% | 84.5 | 11.5 | 31.1 | |
| | rollout, 48 samples | 26.5% | 2.57 | 1.6% | 88.7 | 12.9 | 13.0 | see file |
| | rollout, 96 samples | 27.5% | 2.53 | 1.9% | 89.8 | 13.0 | 13.3 | -0.40 ± 0.12 |
| | 96 samples, share 0.22 | | 2.47 | | | | | -0.46 ± 0.12 |
| **Holdout #1905-2409, 92 x 4 seeds (120)** | default | 19.0% | 3.29 | 10.3% | 77.8 | 10.1 | 32.2 | |
| | **rollout, 48 samples** | **27.7%** | **2.71** | **3.3%** | **85.3** | 12.3 | 12.8 | **-0.57 ± 0.21** |
| | rollout, 96 samples | 29.6% | 2.58 | 2.7% | 86.6 | 12.3 | 12.5 | -0.70 ± 0.22 |
| | 96 samples, share 0.22 | 27.4% | 2.61 | 2.2% | 86.3 | 12.3 | 12.3 | -0.67 ± 0.21 |

96 samples beat 48 on both sets (by 0.04 and 0.13 places; bid p99 116 ms,
max 129 ms, still far inside the window). The live trial keeps 48 so its
games stay comparable; if the rollout is adopted, ship 96 samples.

The holdout was frozen at 08:05 PT, before any of today's screening, and
is the first independent set on which a candidate's gain *grew* rather
than shrank. Live trial 4 started at 10:44 PT on bot 95: A = the running
`futureCountNoise 1`, B = the rollout configuration merged over it
(`rolloutBid 1, rolloutSamples 48, rolloutHorizon 66, rackCap 11,
cashBelow 8, lateCashLen 5, lateCashWindow 12, finalPackWindow 3`).
The usual gates apply: 25 per arm, adopt at >= 0.4 better with
noninferior wins and score; a replay effect of 0.4-0.6 is the first one
today that the live gate can actually resolve.

Tuning on top of the rollout (experiment 121, 340 x 1 seed, paired
against the running B = 48 samples, share 0.18): share 0.22 -0.05 ± 0.10,
share 0.25 -0.04 ± 0.10, prices x0.9 -0.05 ± 0.11, no late cash -0.03 ±
0.08, cash below 12 +0.02 ± 0.09, rack cap 10 +0.04 ± 0.07; shading has
no effect because the rollout returns its bid before the shading step.
The valuation is robust to these knobs; none is 0.15 better, so none
replaces the live B.

Experiment 122 (340 x 1 seed, paired against the same B): per-table price
adaptation is harmful (`rolloutPriceAdapt` 1: +0.38 ± 0.12; 0.5: +0.13 ±
0.10; the paid x1.3 estimate overstates the level and future me then buys
too little); slower pacing (`rolloutPace` 60) +0.27 ± 0.10; the terminal
coin value is irrelevant at the full horizon (identical); turning the live
cash-when-broke rule on (`cashTiming 1, cashMinLen 2` with `cashBelow 8`,
so the bot matches its own future me) -0.047 ± 0.043; 96 samples with
share 0.22 -0.10 ± 0.10; **share 0.22 with prices x0.9 -0.18 ± 0.11**
(30.3% wins, 92.0 score, 13.5 letters). The last is above the 0.15 queue
threshold and goes to confirmation (experiment 124) before it can become
the next live B.

Experiment 124 confirms it. Paired against the live B (48 samples, share
0.18): fixed set 340 x 2 seeds, share 0.22 + prices x0.9 **-0.185 ± 0.077**
(31.3% wins, 91.9 score, 13.5 letters, 10.0 coins left), the same with 96
samples -0.168 ± 0.077; holdout 92 x 4 seeds, 2.57 vs 2.71 (-0.14 ± 0.11)
at 48 samples and 2.52 (-0.20 ± 0.12) at 96. That is the queued next B
("rollout B2": 96 samples, share 0.22, prices x0.9), pending the outcome
of live trial 4 for the rollout family as a whole.

### Live trial 4 at 30 per arm: what the rollout actually does at the table

Public per-game data for the trial's own games (bot 95, #3236+):

| Arm | Games | Place | Wins | Score | Letters e/m/l | Paid/letter | Short-word pts mid-match | Final-partition pts | Unspent | 7+ / 8+ words | Zero bids per game |
|---|--:|--:|--:|--:|---|--:|--:|--:|--:|--:|--:|
| A: noise1 (static) | 32 | 2.63 | 31% | 92 | 12.7 = 2.7/5.3/4.8 | 13.1 | 0.0 | 16.3 | 9.4 | 1.81 / 0.25 | 2.3 |
| B: rollout 48 | 31 | 2.55 | 13% | 88 | 12.8 = **6.5/4.6/1.6** | 13.9 | 13.7 | 0.1 | 11.0 | 1.84 / 0.13 | **9.3** |

Same number of letters, opposite timing. The rollout front-loads (6.5
early letters, like Lambi) and then stalls: 1.6 late letters and 9.3
zero bids a game, 11 coins unspent. With few auctions left, one more
letter rarely changes its playouts, so win and pass look alike and it
passes; the static model's late valuation (money nearly worthless, so
any letter that improves the final partition is bought) wins 4.8 late
letters. The replay rewarded the rollout's early buying and did not
punish the late stall enough, which is the likely source of the
replay-live gap. Hybrid under test (experiment 127): rollout while at
least `rolloutMinLeft` usable auctions remain, static valuation after.
The live trial continues to 45 unchanged; at 30 per arm B is equal on
place and behind on wins, so adoption of the 48-sample rollout as it
stands is unlikely.

### Live trial 4 verdict (bot 95, #3236-~3900, 14:05 PT): **rollout rejected**

| Arm | Completed | Wins | Last places | Mean place | Mean score |
|---|--:|--:|--:|--:|--:|
| A: futureCountNoise 1 | 71 | 20 (28%) | 4 | **2.80** | **87** |
| B: rollout, 48 samples | 71 | 6 (8%) | 0 | 2.99 | 83 |

B is 0.19 places worse with a third of the wins, so it fails the 45-game
gate and was rolled back at 14:05 PT (bot 95 now runs futureCountNoise 1
alone). B never finished last, so it is steadier, but it almost never wins:
the early-buying, late-stalling profile seen at 30 per arm held. The
replay had put it 0.36-0.57 places *ahead*. This is the second candidate
today (after the liquidity rule) where a large replay gain reversed
live, so the replay is biased in a specific direction: it rewards buying
early at the recorded prices, because rivals cannot react, and it does
not charge for the letters we stop buying late. Late-static hybrid
(experiment 127, `rolloutMinLeft` 12/20): worse than the plain rollout in
replay (+0.08 / +0.22), not trialled.

**Rule for the rest of the day: no new live trial on replay evidence
alone for buy-timing changes; require a mechanism visible in the live
behaviour of the top bots (public archive) and check the candidate's
early/mid/late purchase profile in replay against theirs.**

## The leaders' techniques (public archive #2000-4287) and what transferred

Four analyses of 2,288 recent games (notes and scripts in
`research_notes/Top bot strategies from match history/`, synthesis in
`reports/Top bot strategies from match history.md`, both outside the
repository): postturing bids on a capped ladder {8,10,12,15,20,25} and
treats playable words as a bank (holds at 30+ coins, cashes below ~16);
Nijello uses a low-noise per-letter schedule, a fit bonus, a late ramp
that ends all-in, and plays a held 7+ only when **reward >= 28.3 + 0.63 x
balance** (89% of its 8+ words grew from a held 7); Chinese Dante plays
words exactly like us but bids 20/25 on early 3-5 point consonants and
hard on completers. All three win 31-36% of the auctions for a letter
that completes a 7 on their rack; we win 14.7%.

Replay screens on the live configuration (`futureCountNoise 1`), fixed
set 340 x 2 seeds (experiments 128-129):

| Added rule | Place | Paired change | Wins | Score | Letters |
|---|--:|--:|--:|--:|--:|
| none (live) | 2.87 | | 22.4% | 85.3 | 12.0 |
| **Nijello cash threshold 28 / 0.63** | **2.41** | **-0.46 ± 0.10** | **30.6%** | **92.2** | 11.5 |
| threshold 22 / 0.5 | 2.52 | -0.35 ± 0.09 | 28.8% | 91.2 | 11.7 |
| threshold 35 / 0.75 | 2.52 | -0.35 ± 0.11 | 28.7% | 91.2 | 11.2 |
| threshold 28 / 0.63, always cash in last 8 | 2.42 | -0.45 ± 0.10 | 30.0% | 92.2 | 11.6 |
| threshold + late all-in 6 | 2.43 | -0.44 ± 0.10 | 29.6% | 92.0 | 11.9 |
| threshold + completion floor min(25, 0.4 x reward) | 2.87 | -0.00 ± 0.11 | 22.2% | 85.2 | 12.5 |
| late all-in 6 alone | 2.88 | +0.01 ± 0.02 | 22.5% | 84.9 | 12.2 |
| completion floor 20 | 3.19 | +0.32 ± 0.10 | 17.2% | 80.9 | 12.1 |
| Dante consonant floors 20/25 (+ cheap cap 12) | 3.23-3.25 | +0.36 to +0.38 | 18-19% | 79-80 | 10.8 |
| all Dante rules (+ late all-in) | 3.35-3.36 | +0.48 to +0.49 | 17% | 78 | 11.1-11.3 |

Holdout #1905-2409 (92 x 4 seeds): live 3.14 / 19.6% / 79.7; **threshold
28 / 0.63: 2.88 / 23.4% / 83.0**; 22 / 0.5: 2.92; 35 / 0.75: 2.95; with
late all-in 2.91. The threshold is the first candidate today whose gain
does not come from buying more letters (it buys 0.5 fewer), so it cannot
be the replay's early-buying bias that reversed the two earlier
candidates live. Bidding harder on completers, the analyses' top pick,
cancels it: once 7s are held, many letters complete a better 7 and the
floor overpays for them. Two bugs found by the synthesis are fixed
(completer = beats the rack's own best 7; late all-in only on a real
gain). Live trial 5 (from #8286): A = live, B = threshold 28 / 0.63.
Raw: `sim/experiments/128-*`, `129-*`, duels `130-*`.

Experiment 130, simulator (150 matches per field; opponents unrelated to
the replay's recorded bids), win / mean rank / score / last / margin:

| Field | live (noise 1) | + threshold 28 / 0.63 |
|---|---|---|
| 2-bot final vs v7 | 74.0% / 1.26 / 285 / 26.7% / +65 | **88.7% / 1.11 / 308 / 11.3% / +94** |
| 2-bot final vs the shipped default | 50.0% / 1.50 / 248 / 50.0% / -3 | **70.0% / 1.30 / 277 / 30.7% / +37** |
| 2-bot final, first-price | 52.0% / 1.48 / 251 / 48.7% / +1 | **76.7% / 1.23 / 283 / 24.7% / +45** |
| 6-bot strong-bot table | 43.3% / 1.88 / 106 | **58.0% / 1.60 / 118** |
| 6-bot human-like pool | 42.7% / 2.01 / 99 | **52.7% / 1.81 / 107** |

Better in every field, by a wide margin in duels and first-price, so it
needs no player-count gate. This is the first candidate today on which
the replay, the holdout and the simulator all agree.

### Experiment 123: the rollout in tournament formats — **catastrophic in duels**

`sim/compare.ts`, 200 matches per cell, default vs the live B (rollout,
48 samples), win / mean rank / score / last / margin over the best rival:

| Field | default | rollout |
|---|---|---|
| 2-bot final vs v7 (Vickrey) | **81.0% / 1.19 / 291 / +76** | 19.5% / 1.80 / 197 / **-110** |
| 2-bot final vs the shipped default | 49.5% / 1.50 / 250 / 0 | **7.0%** / 1.93 / 179 / -152 |
| 2-bot final, first-price | 54.0% / 1.46 / 254 / +5 | 8.5% / 1.92 / 180 / -121 |
| 6-bot league, first-price | 36.5% / 1.97 / 104 | **46.5% / 1.72 / 107** |
| 6-bot strong-bot table | **39.5% / 1.92 / 106** | 25.0% / 2.13 / 97 |
| 6-bot mixed human-like pool | **33.0% / 2.19 / 94** | 22.5% / 2.35 / 90 |

With per-table price adaptation (`rolloutPriceAdapt` 1) the duels improve
but stay far behind the default (36.5% / -23 vs v7; 23.5% vs the default)
and the strong six-bot tables get worse (11.5% / 2.65), so adaptation is
rejected on this ground too.

The rollout's prices and win share come from six-player tables. In a duel
the real prices are far lower and we should win about half the auctions,
so the planner's future me buys almost nothing, the pass branch looks
fine, and the bot passes on everything while the rival sweeps. The
simulator's six-player opponents are weaker than the live field (RESULTS,
"Live trials"), so the two six-bot losses are a caution rather than a
verdict; the live A/B is the arbiter there. The duel result is not noise.
**`rolloutMinPlayers` (default 4) now disables the rollout below four
active players**, so the final and small bracket tables use the static
valuation and the duel leader tax that won those cells. The live lobby
(always six players) is unaffected. Raw:
`sim/experiments/123-rollout-tournament-fields.md`.

The word rules alone are harmful; the rollout valuation is what carries
the gain, and it needs the full horizon and enough samples (the bid is
the zero crossing of a noisy curve). The profile of the result, 13
letters and 12 coins left, is the public leaders' profile. Decision
latency with 48 samples: bid p50 29 ms, p99 75 ms, max 84 ms (96 samples:
p99 116 ms). Holdout: `sim/experiments/120-rollout-holdout-s48.md`.

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
