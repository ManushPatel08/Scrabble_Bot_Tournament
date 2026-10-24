# Progress (updated 2026-10-23)

Work happens in the clone at `C:\Users\Manush\Desktop\Scrabblebot\scrabblebot`,
on branch `scrabblebot-bot`, merged with upstream's tournament version
(`3064b36`).

## Status: live as LetterShark, waiting for the tournament

**Right now (2026-10-24, 01:35 PT):** fresh start as **LetterSharkX** (bot id 61, team **Team Manush 2**), created at the user's request. The old LetterShark (id 8, Team Manush) could not be deleted: an unknown anonymous identity had joined that team (anyone can join any team by name), and a team is only deleted when its last member leaves. LetterSharkX runs the shipped config (96 samples + priorByRivals 1.0) in the lobby (`run.ps1 -BotName LetterSharkX -NewToken -LogFile logs\lobby.log`). Tournament day: the same with `-NoLobby`.

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
   powershell -ExecutionPolicy Bypass -File .\run.ps1 -BotName LetterSharkX -NewToken -NoLobby -LogFile logs\tournament.log
   ```
   - `-NewToken` mints a fresh token with your `spacetime login` and passes
     it straight into the bot: it isn't shown, saved or put on the
     clipboard (which another app can hold locked).
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
