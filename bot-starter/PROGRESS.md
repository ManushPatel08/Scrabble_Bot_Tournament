# Progress (updated 2026-10-23)

Work happens in the clone at `C:\Users\Manush\Desktop\Scrabblebot\scrabblebot`,
on branch `scrabblebot-bot`, merged with upstream's tournament version
(`3064b36`).

## Status: live as LetterShark, waiting for the tournament

**Right now (2026-10-23, 19:45 PT):** everything is done and the bot is **stopped** until the tournament. Start it Saturday evening (by about 10 PM PT, no later than 11:30 PM PT) with the commands under "Tournament day" below, and leave it running until the final ends. Lobby record before stopping: 24 wins in 32 matches; two of the losses were matches stopped midway for testing. The code is pushed to the private repo ManushPatel08/Cal_Hacks_Scrabble_Bot_Tournament (`main`); make it public after the final.

- **Event:** ScrabbleBot tournament, Cal Hacks 13.0, **12:00 AM Sunday**
  (Saturday night), live: Swiss rounds, a cut, elimination, then a
  best-of-3 final. Prizes: $1,024 / $512 / $256. **Public source code on
  GitHub is required to win.**
- **Server:** the `scrabblebot` database was reset on 2026-10-23 and runs
  the published module `3064b36` again, so RULES.md applies as written. The
  official site is https://scrabblebot.spacetimedb.com.
- **Our bot:** team **Team Manush**, bot **LetterShark** (id 8), created
  2026-10-23 with `npm run get-token`. It won its first 10 lobby matches
  (RESULTS.md → Live lobby record). Final config: 96 Monte Carlo samples.
- **Live fixes on 2026-10-23:** late bids (sliced precompute) and frozen
  opponent scores (per-match participant subscriptions). Both were
  verified live.
- **Checks:** `npm run typecheck` is clean and `npm test` passes. The live
  bot has run under heavy CPU load with no late bids.

## Tournament day

1. Run the bot in **its own window**, so it doesn't depend on any other
   program staying open:
   ```powershell
   cd C:\Users\Manush\Desktop\Scrabblebot\scrabblebot\bot-starter
   npm run get-token
   powershell -ExecutionPolicy Bypass -File .\run.ps1 -BotName LetterShark -FromClipboard -NoLobby -LogFile logs\tournament.log
   ```
   - `get-token` mints a fresh token onto the clipboard.
   - `-FromClipboard` moves the token into the bot and clears the clipboard.
   - `-NoLobby` stays out of casual games, which would put more of our bids
     into the public archive, but the bot still registers.
2. Start it **before registration opens**. Then check that the log shows
   `registering for tournament N`.
3. Keep the laptop plugged in, on a stable network, and don't run heavy
   programs (the simulator in particular) while matches are on.
4. Run **only one copy**. If it stops, run the same commands again; it
   resumes a match in progress.

## Watch for

- **Server changes:** `run.ps1` checks the live schema on every start
  (`npm run check-schema`). It patches the bindings itself
  (`scripts/sync-live-bindings.mjs`) and warns if the change is one it
  doesn't cover.
- **Upstream changes:** `git fetch` and `git log HEAD..origin/main`.
- **Lobby record:** `node scripts/lobby-report.mjs --bot LetterShark`.
