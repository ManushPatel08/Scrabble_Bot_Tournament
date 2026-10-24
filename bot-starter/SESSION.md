# Current live session — October 24, 2026 (America/Los_Angeles)

The current registration is **Manush3 / LetterSharkPro: team 80, bot 86**.
It was created at 07:40 PT on October 24 through the normal account flow
(`scripts/replace-registration.ts`), on the user's explicit request in the
Claude session ("Register another fresh one"). Bot 84 / team 78 (Manush2)
was stopped at a match boundary first, after 15 matches: 3 wins, total score
1173. Its archives are `logs/retired-84-registration.json` and
`logs/retired-84-live.log`. Bots 76/70 and 70/64 are historical. Do not
create another registration, revive a retired bot, or delete anything
without another explicit request from the user.

**Controller: Claude Code is the sole controller (since 07:40 PT, user
instruction "take access of everything").** All three Codex automations
(`~/.codex/automations/scrabblebot-*/automation.toml`) were set to
`status = "PAUSED"`, and each prompt was replaced with a no-op stand-down
instruction. The originals are backed up in the Claude session scratchpad.
A process watcher saw no Codex-spawned process at the 07:43 health slot.
Do not reactivate them while Claude controls the bot.

Current configuration: **interleaved live A/B on bot 86, trial 2, from
match #2565** (08:30 PT). A is the shipped default (no BOT_PARAMS); B is
`BOT_PARAMS_B={"cashTiming":1,"cashMinLen":2,"cashBelow":12,"futureAffordable":1}`
(experiments 109-110: cash short words only when nearly broke, and cap the
Monte Carlo futures by what the balance can buy). Score it with
`node scripts/ab-live.mjs logs/manush3-live.log --since 2565`
(`runner-state.json` carries `trialSince`; `scripts/health.mjs` uses it).
Trial 1 (#2332-2563, B = futureCountNoise 1) ended inconclusive at 21 per
arm: A 3.24 / 24% / 79, B 3.00 / 24% / 80. The same log holds both trials,
so never score it without `--since`. Shipped defaults are unchanged.
Consult `logs/runner-state.json` before every action.

## Operations

- Repository: `C:\Users\Manush\Desktop\Scrabblebot\scrabblebot`, branch
  `scrabblebot-bot`. Change only `bot-starter/`.
- `logs/runner-state.json` records the only launcher (PID, process start
  time, log file and experiment; no secrets). Latest launch: PID 101640,
  start 2026-10-24T15:30:01.8595739Z.
- A 20-minute process watcher (07:41-08:01) saw no Codex-spawned process
  across the 07:43 and 07:58 slots, and the Codex thread's last update
  stayed at 07:38:03. The pause holds.
- Casual-match log: `logs/manush3-live.log`. Startup output and errors:
  `logs/codex-launch.out.log` and `logs/codex-launch.err.log`. The file
  names are historical; Claude now launches through the same helper.
- The hidden launcher runs `run.ps1 -BotName LetterSharkPro -Team Manush3
  -Bot LetterSharkPro -NewToken -LogFile logs\manush3-live.log`, with
  `BOT_PARAMS_B={"futureCountNoise":1}` inherited in memory.
- Upstream (origin/main, not deployed by us) added a
  `start_new_bot_version` reducer that resets a bot's rating without
  deleting the team. The live server already reports OpenSkill mu/sigma in
  `bot_stats`. If the user asks for another fresh rating, check whether that
  reducer is live before using replace-registration.
- Use `powershell -NoProfile -ExecutionPolicy Bypass -File
  scripts/restart-live.ps1 -IfDown` to recover a stopped launcher. It
  refuses to start a duplicate, checks the recorded process identity, and
  restores saved ParamsA/ParamsB and tournament mode.
- A deliberate restart waits up to 100 seconds for a match boundary:
  `& .\scripts\restart-live.ps1 -ParamsB '{"futureCountNoise":1}'` (the
  current A/B; `-ParamsA` sets the A arm's overrides).
- `-StopOnly` stops the verified launcher at a match boundary and records
  `stoppedAtUtc`. replace-registration requires this.
  A deliberate restart without ParamsA/ParamsB clears experimental overrides;
  `-IfDown` preserves them. Never confuse these two paths.
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
That acquisition/price candidate never entered a live A/B. Do not retry it.

## Current candidate: uncertain future acquisition counts

After the user explicitly requested more tweaks, experiments 97–101 tested
five new mechanisms: future-aware word selection, credit for long-word
completion cash, recent-auction win-share windows, immediate-score blends,
and binomial future acquisition counts. The first four failed the replay
bar. All switches remain off in the shipped defaults.

**Candidate B is `{"futureCountNoise":1}` only.** Each MC future samples
the number of usable future auctions won from a binomial distribution
using the current win-share estimate, then draws that many unseen tiles
up to the existing horizon cap. The old model fixes every sample's count
to the rounded expected number. No opponent bids/private data are used.

Confirmation, experiment 103: **340 matches x 4 seeds**, default vs B:
mean place **2.96 vs 2.86**, wins **21.3% vs 23.0%**, score **84.0 vs
85.4**; paired place change **-0.099 +/- 0.076** (approximate 95%,
clustered by match). Independent fresh-match check, experiment 104:
**31 matches x 8 seeds**, place **3.05 vs 2.85**, wins **15.7% vs
19.8%**, score **82.7 vs 85.6**; paired change **-0.198 +/- 0.148**.
Seeds are repeated samples of the same matches, not new opponents.

The retired bot 76's live A/B **started at fresh match #1988**, after excluding the startup
resume of #1983. Launcher PID 89244; `runner-state.json` is authoritative.
Experiment 105 passed: 408 decisions, bid p99 21.44 ms / max 24.0 ms.
The trial ended at replacement with **23 completed games per arm**:
A/default 4 wins, mean place 3.04, mean score 80; B/noise=1 5 wins,
mean place 3.17, mean score 79. **Inconclusive**, below the minimum sample
size; do not cherry-pick earlier intermediate results. Archives are
`logs/retired-76-registration.json` and `logs/retired-76-live.log`.
Bot 84 then ran the candidate alone for 15 matches before it was replaced
(no A/B, so those matches are not evidence either way). **Bot 86 runs a
fresh interleaved A/B of the same question from its first match, #2332**
(A = shipped default, B = futureCountNoise 1). The gates below apply to
this trial alone. Do not pool it with the bot 76 trial (different time,
field and registration). All other switches stay at shipped defaults. Keep
the live A/B isolated from new experiments.

Power caveat: the per-match place SD is about 1.6, so at 45 per arm the
standard error of the difference is about 0.34. The live gate can only
detect large effects. The replay estimate for this candidate (about -0.1)
is far below what the live trial can resolve, so "inconclusive" is the
expected outcome unless the true effect is large.

Experiment 106, protected completion cash (`protectedCashBelow`), was
rejected and remains off. With noise=1, 340 matches x 2 seeds: baseline
22.4% wins / place 2.87 / score 85.3; threshold 10: 22.6% / 2.86 / 85.3;
20: 22.1% / 2.89 / 84.9; 40: 20.1% / 3.00 / 82.8. No meaningful gain.

Check `logs/runner-state.json` before any future live A/B.
The current trial: `node scripts/ab-live.mjs logs/manush3-live.log`.
The historical trial can be scored with
`node scripts/ab-live.mjs logs/retired-76-live.log --since 1988`.
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
  Do not repeat experiments 84–106 or the already rejected ideas in
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
log and public `tournament_entry` for **bot 86**. At 07:42 PT the public
`tournament` table was empty and bot 86 had no entry, so registration is
unconfirmed. The official format (upstream `docs/bot-guide.md`): Swiss
rounds scored by place, then the top bots by Swiss points play elimination
matches (last place out) until two remain, then 3 final games decided on
total score. The auction type is chosen by the admin per tournament (it may
be first-price), and lobbies are always Vickrey.

Health checks (Claude's own scheduled checks, replacing the paused Codex
ones): processes, log freshness and last lines, SLOW/LATE/Auction closed,
public tournament and entry rows, and the team 80 member count. Notify only
for meaningful adoption, rejection, bot failure or recovery, tournament
status changes, the 21:00 handoff, or required user action. Stop scheduled
work after the tournament.

## Data and validation

- `scripts/auction-study.mjs` studied all 1,761 completed matches and
  119,748 auction results at its snapshot. Its Markdown report lists every
  winner and 100 possible late word-completion swings. The full public
  auction archive is in ignored `sim/replay/public-auction-study.json`.
  A purchase followed by a word is a review candidate, not causal proof.
- `scripts/replay-data.mjs` now handles retired bot identities, excludes
  unfinished matches and missing rival top bids, and snapshots public data
  in a handful of bounded queries. By default it reads `logs/lobby.log`,
  `logs/codex-live.log` and the active log named in runner-state.json, and
  resolves our participant per match from `logs/registration-history.json`.
  The retired logs (`retired-76-live.log`, `retired-84-live.log`) are copies
  of codex-live.log and manush2-live.log, so don't pass both of a pair.
- Replay results cluster seeds within matches for uncertainty; seeds are
  not independent new matches. There are 340 archived own matches in the
  initial fixed comparison set. Do not change the dataset mid-comparison.
- An earlier baseline typecheck and all 69 tests passed, including latency
  p99 <100 ms. Later candidate changes passed targeted tests; the most
  recent protected-cash changes passed typecheck and 10 hardening tests.
  Do not describe the full expanded suite as passed without running it.
  The boundary stop and launch for the new registration succeeded; always
  consult runner-state.json, since recovery can change the launcher PID.
- 07:44 PT: `npm run typecheck` was clean, and the 16 tests in
  `test/agent.test.ts`, `test/hardening.test.ts` and `test/tracker.test.ts`
  passed. The full suite was not run then.
- The Codex heartbeat ids `scrabblebot-health-and-tournament-status`,
  `scrabblebot-measured-improvement-checks` and
  `scrabblebot-9-pm-tournament-handoff` are PAUSED, with no-op prompts.
