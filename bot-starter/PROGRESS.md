# Progress (updated 2026-10-22)

Work happens in the clone at `C:\Users\Manush\Desktop\Scrabblebot\scrabblebot`,
on branch `scrabblebot-bot`, merged with upstream's tournament version
(`3064b36`).

## Status: ready; only the user's steps remain

- **Rules:** re-verified against the tournament module (TypeScript, SDK
  2.12): see [RULES.md](RULES.md). The changes that affect play are random
  ties, ±2 sim bid jitter, opt-in tournament registration and
  admin-configurable rack size and auction length.
- **Live server:** it runs a newer, unpublished module (round robin plus
  finals; RULES.md → "The live server runs a newer, unpublished module").
  The bindings are patched to its schema (`npm run sync-bindings`).
  `npm run check-schema` confirms that every table and enum matches by
  name and type. `run.ps1` repeats the check before each start.
- **Strategy:** `final` in `src/strategy/versions.ts` (equal to
  `DEFAULT_PARAMS`). It passes every acceptance check under the tournament
  rules: see the table at the top of [RESULTS.md](RESULTS.md).
- **Live client:** `src/index.ts`, logic in `src/live/adapter.ts`.
  - Built for SDK 2.12.0 (the version upstream pins).
  - Auto-registers for tournaments.
  - Reads each auction's window from the auction row.
  - Holds out of lobbies during the round robin and finals.
  - Subscribes only to its own slice of the live tables. On 2026-10-22,
    `subscribeToAllTables` ran out of memory on the live server's ~11 M
    rows (exit 134).
  - Detects offline opponents.
  - Places a safe bid before words.
  - Reconnects with backoff and replays the match after a restart.
- **Token without the website:** `npm run get-token`. The site at
  scrabblebot.vercel.app is now an unrelated app, so the helper runs the
  module's own credential flow. The token goes to the clipboard only.
- **Launcher:** `run.ps1` checks the schema, asks for the token with hidden
  input, keeps the PC awake and restarts the bot on a crash.
- **Checks:**
  - `npm run typecheck` is clean.
  - `npm test` passes 66/66.
  - Launcher smoke test passes (dead host: the schema check is skipped, the
    bot reconnects, and the token never appears).
  - The token helper's claim was tried live with a bogus code (rejected,
    as expected).
  - The filtered subscriptions were run live (anonymous, read-only):
    0.15–0.6 s and 15–117 MB. The client was also started live with a
    non-bot identity: it exits with code 2, as intended.

## Manual steps (need the user's account)

The SpacetimeDB CLI is installed (`%LOCALAPPDATA%\SpacetimeDB`), and
`spacetime login` was done on 2026-10-22. The account's team was created
with the README's placeholder names: bot 4097 is "YourBotName". To pick
real names: `spacetime call scrabblebot leave_team`, then step 1.

1. **Get a token** (once). In a new PowerShell window:
   ```powershell
   cd C:\Users\Manush\Desktop\Scrabblebot\scrabblebot\bot-starter
   npm run get-token -- --team "<team name>" --bot "<bot name>"
   ```
   It creates the team and bot, then copies a fresh bot token to the
   clipboard. The token is not shown. Later runs (`npm run get-token`) mint
   further tokens for the same bot.
2. **Test match** (before the tournament), straight after step 1:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\run.ps1 -BotName "<bot name>"
   ```
   Paste the token when asked (right-click or Ctrl+V; nothing shows). Expect,
   in order:
   - `bindings match the live scrabblebot schema`
   - `connected`, then `acting as bot`
   - `joining lobby`
   - `match N: …`, then one line per auction
   - `match N ended: place X/6`

   Stop with Ctrl+C.
3. **Tournament day:** start the same command **before registration
   closes**. Then:
   - Check for `registering for tournament N`.
   - Leave it running. The launcher keeps the PC awake; keep it plugged in,
     on a stable network.
   - Run only one copy.
   - If anything goes wrong, run the same command again; it resumes the
     match.

## Watch for

- **Upstream changes before the tournament:** `git fetch` and
  `git log HEAD..origin/main`. If anything new appears, re-verify RULES.md
  and re-run `node sim/evaluate.ts`.
- **Live schema changes:** `run.ps1` checks the schema on every start. A
  mismatch the sync script doesn't cover prints a warning. In that case,
  run `npm run check-schema` and extend `scripts/sync-live-bindings.mjs`.
