# ScrabbleBot bot

A tournament bot for [ScrabbleBot](../README.md), plus the headless simulator
and tuner used to build it.

- [RULES.md](RULES.md) has the game rules verified line by line against
  `spacetimedb/src/lib.rs`, and lists where the README and docs are wrong.
- [RESULTS.md](RESULTS.md) has simulation results, the rationale for each
  strategy component, and the gain each one measurably produced.

Requires **Node ≥ 22.18**. The simulator, tests and tuner use Node's built-in
TypeScript support and test runner, so they need no `npm install`. Only the
live bot needs the npm dependencies.

## Layout

| Path | What |
|---|---|
| `src/index.ts` | Live client glue: SDK connection, subscription, reconnect |
| `src/live/adapter.ts` | Live match logic: per-match sessions, event ordering, restart replay, reducer calls. It is SDK-free, so `test/live.test.ts` drives it with a fake server |
| `run.ps1` | Windows launcher: checks the bindings against the live schema, hidden token prompt, keeps the PC awake, restarts the bot on a crash |
| `src/live/queries.ts` | Subscription queries: the bot's own slice of the live tables |
| `scripts/` | `get-token.ts` (bot token without the website), `check-live-schema.mjs` / `sync-live-bindings.mjs` (keep the bindings matched to the live server), `sub-probe.ts` (subscription size for a bot id) |
| `src/strategy.ts` | The shipped configuration (`FINAL_PARAMS`), plus `decideBid` / `chooseWord` |
| `src/strategy/agent.ts` | The strategy: valuation, money, bidding, play timing |
| `src/strategy/tracker.ts` | Exact bag / unseen-tile tracking and opponent racks from public events |
| `src/strategy/params.ts`, `versions.ts` | Tunable parameters and the frozen earlier versions v1–v7 |
| `src/game/` | Scoring (`letters.ts`), dictionary index and word search (`dictionary.ts`), RNG, shared types |
| `sim/engine.ts` | Headless replica of one match (auction, payment, scoring, end conditions) |
| `sim/baselines/` | Baseline opponents. `starter-strategy.ts` is the unmodified original starter; `strong.ts` holds the adversaries built on our own agent (shadow, late, outbid, jitter) |
| `sim/run.ts`, `compare.ts`, `tune.ts`, `trace.ts`, `latency.ts`, `evaluate.ts`, `threats.ts` | CLIs, described below |
| `sim/experiments/` | Raw output of every experiment cited in RESULTS.md |
| `test/` | Unit tests (`node --test`). `fakeserver.ts` is an in-memory stand-in for the module that implements the `lib.rs` rules |

## Simulator

```bash
cd bot-starter
# 1,000 six-bot matches against the baseline field, both payment modes
node sim/run.ts --field final,starter,greedy,overbidder,hoarder,random --matches 1000
# a real lobby: our bot plus five of the module's sims
node sim/run.ts --field final,brutus-sim,brutus-sim:maverick-sim,valor-sim,valor-sim:hagrid-sim,cheapo-sim --mode vickrey
# self-play: final against its five most recent earlier versions
node sim/run.ts --field final,v2,v3,v4,v5,v6 --matches 1000
# a pool: sample 6 of these per match
node sim/run.ts --pool all --seats 6 --matches 5000 --timings
```

Options:
- `--matches N`
- `--mode vickrey|first|both`
- `--seed S`
- `--workers W` (defaults to the core count minus 2; `SIM_WORKERS=N` sets it for every tool)
- `--timings` (adds latency columns)

A seat is written `name` or `name:label`. The label lets two copies of one
strategy be told apart.

Strategy names:
- `final`
- `v1`…`v7`
- `agent`: the current defaults
- `aggr`, `cons`, `nocash`: style variants
- `starter`, `greedy`, `overbidder`, `hoarder`, `random`: baselines
- `clone`, `shadow`, `denier`, `snowball`, `late`, `outbid`, `jitter`: strong adversaries (our agent plus one exploit); `sniper`, `allin`: held-out styles
- `botlike`, `botlike-lo`, `botlike-hi`: the strongest live opponent (sim/baselines/live.ts), at 1, 0.7 and 1.4 times its bids
- `cheapo-sim`, `valor-sim`, `brutus-sim`: the module's own sims

Other tools:

```bash
node sim/trace.ts 3 Vickrey                      # round-by-round trace of one match
node sim/compare.ts --variants '[{"label":"a"},{"label":"b","mu0":0.3}]' --fields self-v,league-f
node sim/latency.ts 60                           # decision latency with precompute on
node sim/threats.ts --only shadow,slow,mixed      # final vs 5 copies of an adversary, slow network, mixed pool
npm test                                         # unit tests (67)
npm run typecheck                                # tsc over src/, sim/, test/, scripts/ (needs npm install + bindings)
```

To reproduce every table in RESULTS.md, run `node sim/evaluate.ts --matches 1000`.
That takes about 10 minutes on 24 cores. Use `--only base,lobby,self,robust,duel,big`
to run one part at a time, and `--prepare` to include the live client's
between-round precompute (about twice as slow; the results are the same).

### Adversarial harness

`node sim/threats.ts [--only a,b] [--matches 300] [--cand final] [--params '{...}']`
seats the candidate against five copies of one adversary in both payment
modes and reports its win rate, mean rank and score next to the best
opponent's. Scenarios: each adversary name, `slow` (five clones whose bids
always insert first, so they win every tie), `mixed` and `big` (6- and
8-bot draws from all adversaries) and `duel-<name>`. Run one simulation job
at a time: each uses every core and loads the dictionary per worker, and
several in parallel can exhaust memory.

## Tuner

```bash
node sim/tune.ts --iters 8 --cands 8 --matches 400 [--start '{"mu0":0.5}'] [--keys mu0,muTimeExp]
```

The tuner runs an iterated best response with a hall of fame. Each candidate
plays:
- against 5 copies of the incumbent;
- against a league of earlier champions, style variants, baselines and sims;
- against the baseline field;
- in a real sim lobby.

It plays all four in both payment modes, on identical seeds. It accepts a
candidate only if it clearly beats the incumbent. The log goes to
`sim/tune-log.md`. Accepted settings get frozen into
`src/strategy/versions.ts`.

## Live bot

The bot targets the tournament version of the module (upstream `3064b36`,
SpacetimeDB 2.12), with its bindings patched to the schema the live
`scrabblebot` database actually runs. That module is newer than any
published commit (round robin plus finals); see
[RULES.md](RULES.md#the-live-server-runs-a-newer-unpublished-module).

**Getting a token (no website needed).** The team page that used to mint
tokens isn't reachable, so `scripts/get-token.ts` runs the module's own
credential flow: as you, it creates your team and bot (first time only) and
mints a single-use code; then a brand-new identity redeems the code and
becomes a credential for your bot. That identity's token is copied to the
clipboard, never printed or saved.

```powershell
spacetime login                                              # once; opens the browser
npm run get-token -- --team "<team name>" --bot "<bot name>" # first time
npm run get-token                                            # any later token for the same bot
```

Team names are 1–48 characters, bot names 1–32, and both must be unused.
Each run adds one more credential to your bot; old tokens keep working.
There is no rename. To start over with new names (only while the bot isn't
in a tournament under way), run `spacetime call scrabblebot leave_team`:
as the last member, that deletes the team, the bot and all its tokens.
Then run `get-token` again with the new names.

**Windows (recommended): the launcher.**

```powershell
cd bot-starter
powershell -ExecutionPolicy Bypass -File .\run.ps1 -BotName <your bot name>
```

It asks for the token with hidden input, so the token never reaches disk,
the screen or your shell history. It keeps Windows awake while the bot
runs, restarts the bot if it crashes, and stops on a missing or invalid
token or on Ctrl+C. It runs `npm install` on first use.

Options:
- `-NoLobby`: skip casual lobbies.
- `-NoTournament`: don't register for tournaments.
- `-Quiet`: one log line per match.
- `-FromClipboard`: take the token from the clipboard, where
  `npm run get-token` puts it, and clear the clipboard. The token is never
  displayed.
- `-LogFile logs\name.log`: also append timestamped log lines to a file.
  The token is never logged, and `logs/` is gitignored.

Tournament day, in a window of its own:

```powershell
powershell -ExecutionPolicy Bypass -File .\run.ps1 -BotName LetterShark -NewToken -NoLobby -LogFile logs\tournament.log
```

`-NewToken` mints a fresh token with your `spacetime login` (`get-token
--pipe`) and passes it straight into the bot, without the clipboard.

**Any shell.**

```bash
cd bot-starter
npm install
BOT_NAME=<name> BOT_TOKEN=<token> npm start
```

What the bot does by itself:
- **Tournaments:** entry is opt-in on the tournament module. The bot calls
  `registerForTournament` for every tournament that is taking
  registrations: at startup, and every 3 s after that. It logs its
  standing (round-robin wins and total score on the live module) and any
  elimination. Set `AUTO_TOURNAMENT=0` to turn this off.
- **Lobbies:** it joins the open lobby and rejoins after each match. It
  doesn't try while held for a tournament, because the module refuses
  entrants then. Set `AUTO_LOBBY=0` to turn this off.
- **Logs:** one line per auction, plus a summary at match end. Set
  `LOG_ROUNDS=0` for quieter logs.
- **Per-match settings:** it reads each auction's window from the auction
  row (`closesAt − opensAt`; admin-configurable, 250 ms–10 s) and infers
  the rack size from what it observes. It bids within milliseconds and uses
  the rest of the window to precompute the next round. On windows under
  800 ms it skips the precompute so it can never delay a bid.
- **Offline opponents:** registered bots that aren't connected are still
  seated in tournament matches. The bot detects them from
  `botCredential.connected`, and treats one live opponent plus offline
  seats as a 2-bot match.
- **Memory:** it never subscribes to whole tables. The live database keeps
  every match ever played (about 11 million public rows on 2026-10-22), and
  subscribing to all of it crashed Node with an out-of-memory error. It
  subscribes to the small tables first, then only to its own slice: its rack,
  entries and lobbies, and the rows of its own matches, joined through
  `match_participant` (`src/live/queries.ts`). Each match's participants
  get a plain `match_id = X` subscription of their own, opened at match
  start: a self-join never delivered other bots' score updates (RULES.md
  S1). For a new bot that loads in about 0.15 s with a 15 MB heap; the
  heaviest bot before the reset (783 matches) loaded in 0.6 s with 117 MB.
  `npx tsx scripts/sub-probe.ts <bot id>` measures it (read-only,
  anonymous).
- **Timing:** each decision takes 5–25 ms. The precompute for the next
  round runs in 15 ms slices that yield to incoming messages and is dropped
  as soon as an auction arrives, so it can't delay a bid. Each round's log
  line shows how long the auction's message waited (`waited N ms`); over
  150 ms is flagged `SLOW` even with `LOG_ROUNDS=0`. Don't run the
  simulator on the same machine during the tournament.
- **Resilience:**
  - It reconnects with backoff after a disconnect.
  - If it restarts mid-match, it replays the match's public history.
  - Event handlers are guarded, so an exception is logged rather than fatal.
  - If a bid relies on rewards from words played the same round, a bid it
    can already afford is placed first, so a failed word can't lose the
    auction.

**Lobby play.** `node scripts/lobby-report.mjs --bot <name>` prints a bot's
live record from the public tables: wins, places, scores and head-to-head
margins against every bot it met. Lobby games feed the public
`auction_top_bid_archive` (RULES.md S4), which shows every winning bid, so
other teams can study a bot's bidding from them. Play enough lobby games to
check the bot, then run it with `-NoLobby` until the tournament: it stays
connected and still registers when registration opens.

Notes:
- **The token** is read only from `BOT_TOKEN`. It is never written to disk
  or logged; `.token-*` files are gitignored anyway. Get one with
  `npm run get-token` (above).
- **Bindings:** the 2.12 bindings in `src/module_bindings/` (gitignored)
  were exported from upstream's checked-in web bindings, which the 2.12 CLI
  generated from `3064b36`. The SDK decodes rows by column position, so
  they must match the live server exactly: `npm run check-schema` compares
  every table and enum (names and types, in order) with the live schema,
  and `npm run sync-bindings` patches the known differences (4 tables, 2
  enums). `run.ps1` does both before every start; `npm run generate`
  regenerates from source and then syncs. The SDK is `spacetimedb` 2.12.0,
  the same version upstream's lockfile pins.
