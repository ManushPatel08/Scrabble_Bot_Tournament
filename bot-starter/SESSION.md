# Current live session — October 24, 2026 (America/Los_Angeles)

The user's requested fresh registration is **Manush / LetterSharkPro**:
team **70**, bot **76**. Old LetterSharkPro bot 70/team 64 was already
deleted before this session. Do not create another registration or delete
anything. The existing login successfully created the requested team.

## Operations

- Repository: `C:\Users\Manush\Desktop\Scrabblebot\scrabblebot`, branch
  `scrabblebot-bot`. Change only `bot-starter/`.
- The only launcher is recorded in `logs/runner-state.json` (PID, process
  start time, log file, and experiment; no secrets). Initially PID 93488.
- Casual-match log: `logs/codex-live.log`; startup output/errors:
  `logs/codex-launch.out.log`, `logs/codex-launch.err.log`.
- The hidden launcher is `run.ps1 -BotName LetterSharkPro -Team Manush
  -Bot LetterSharkPro -NewToken -LogFile logs\codex-live.log`.
- Use `powershell -NoProfile -ExecutionPolicy Bypass -File
  scripts/restart-live.ps1 -IfDown` to recover a stopped launcher. It
  refuses to start a duplicate and checks the recorded process identity.
- A deliberate restart waits up to 100 seconds for a match boundary:
  `& .\scripts\restart-live.ps1 -ParamsB '{"futureWinBias":1,"contestPricePrior":1,"contestBudget":3}'`.
  Without ParamsB it clears all experimental overrides.
- Tokens remain only in the launcher/child environment. Never display,
  persist, inspect process environments for, or commit credentials. The
  token helper checks the exact requested team/bot and fails on mismatch.
- Never call admin/tick reducers, subscribe to all tables, inspect another
  team's private tables, or run cooperating/second bots. Public SQL only
  for field analysis. The authenticated `my_team` view is our own account.

## Experiment evidence and decision rules

The shipped default is unchanged: samples 96, priorByRivals 1.3,
contestFrac 1.2, contestBudget 2, mu0 0.5, autoPlayLen 7.

Experiments 90–93 rejected exact late valuation, historical price floors
alone, and alternative-first-word valuation. All new switches default off.

Experiment 94 found the candidate `futureWinBias=1, contestPricePrior=1,
contestBudget=3`: held-out matches #1202–1741 (93 matches × 4 seeds),
mean place **3.11 vs 3.22**, wins **19.6% vs 18.0%**, score **80.7 vs
80.0**. Paired place difference **-0.108 +/- 0.159** (approximate 95%
interval, clustered by match). This initially qualified for further checks.
Historical priors were frozen using outcomes through #1200, not holdout
outcomes. Experiments 95/96 provide full-set confirmation and sensitivity
to proportional rival score adjustment; that adjustment is approximate,
not a causal simulator. **The candidate was rejected before a live trial**:
full-set confirmation (340 matches x 4 seeds) was 2.96 vs 2.96 mean place,
wins 20.4% vs 21.3%, score 83.5 vs 84.0. The recent-subset sensitivity
was favorable (3.06 vs 3.21) but did not overturn the full-set regression.
No live A/B was started; the default is running alone. Do not retry it.

Check `logs/runner-state.json` before any future live A/B.
Score with `node scripts/ab-live.mjs logs/codex-live.log --since 1741`.
Only labelled fresh-start matches count; old unlabelled baseline matches
are excluded automatically. Do not mix a different trial into this log.

- At least 25 completed matches **per arm** before adoption or ordinary
  rejection. Adopt only if B improves mean place by >=0.4, wins at least
  as often per match, and does not reduce mean score. Drop B if its mean
  place is >=0.4 worse. If inconclusive, continue to 45 per arm and require
  >=0.25 better mean place with noninferior wins and score; otherwise drop.
- A runtime/safety regression is grounds to stop B immediately. Never
  describe a replay-only gain or a small live sample as proven improvement.
- Adoption changes both DEFAULT_PARAMS and VERSIONS.final, adds the live
  evidence to RESULTS.md, passes typecheck/tests, commits and pushes to
  `tournament scrabblebot-bot:main`, then restarts with no B overrides.
- If no A/B is active, an improvement check may investigate one genuinely
  new hypothesis, preserving defaults and using <=4 simulation workers.
  Do not repeat experiments 84–96 or the already rejected ideas in
  RESULTS.md. Save every result, require >=0.08 replay place improvement
  with noninferior wins/score before another live trial, and inspect
  SLOW/LATE/Auction closed log entries after each replay. Never overlap
  simulation jobs. Keep a running live trial isolated from new experiments.

## Tournament handoff

At **21:00 PT Saturday October 24**, stop A/B tests and all simulations;
use `& .\scripts\restart-live.ps1 -Tournament`. This clears overrides and
starts the shipped default with `-NoLobby` and `logs/tournament.log`.
Do not restart during an active tournament match. The bot automatically
registers when a tournament takes registrations; verify the registration
log and public `tournament_entry` for bot 76. At session start the public
tournament table was empty, so no registration could be verified yet.

Health checks: at :13/:43, check processes, log freshness/last 40 lines,
public tournament and entry rows, and public team_member count for team
70. Improvement checks: :28/:58. Notify only for meaningful adoption,
rejection, bot failure/recovery, tournament status changes, the 21:00
handoff, or required user action. Stop scheduled work after the tournament.

## Data and validation

- `scripts/auction-study.mjs` studied all 1,761 completed matches and
  119,748 auction results at its snapshot. Its Markdown report lists every
  winner and 100 possible late word-completion swings. The full public
  auction archive is in ignored `sim/replay/public-auction-study.json`.
  A purchase followed by a word is a review candidate, not causal proof.
- `scripts/replay-data.mjs` now handles retired bot identities, excludes
  unfinished matches and missing rival top bids, and snapshots public data
  in a handful of bounded queries. It includes both live log files.
- Replay results cluster seeds within matches for uncertainty; seeds are
  not independent new matches. There are 340 archived own matches in the
  initial fixed comparison set. Do not change the dataset mid-comparison.
- Final typecheck and all 69 tests passed, including latency p99 <100 ms.
  The boundary restart was exercised successfully; new launcher PID 98628
  (always consult runner-state.json, since a later recovery can change it).
- Saved finite heartbeat ids: `scrabblebot-health-and-tournament-status`,
  `scrabblebot-measured-improvement-checks`, and
  `scrabblebot-9-pm-tournament-handoff`. Stop them after the tournament.
