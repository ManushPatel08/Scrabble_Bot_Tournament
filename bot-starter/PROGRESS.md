# Progress (updated 2026-10-22)

Work happens in the clone at `C:\Users\Manush\Desktop\Scrabblebot\scrabblebot`,
on branch `scrabblebot-bot`, merged with upstream's tournament version
(`3064b36`).

## Status: ready; only the live run remains (the user's step)

- **Rules:** re-verified against the tournament module (TypeScript, SDK
  2.12): see [RULES.md](RULES.md). The changes that affect play are random
  ties, ±2 sim bid jitter, opt-in tournament registration and
  admin-configurable rack size and auction length.
- **Strategy:** `final` in `src/strategy/versions.ts` (equal to
  `DEFAULT_PARAMS`). It passes every acceptance check under the tournament
  rules: see the table at the top of [RESULTS.md](RESULTS.md).
- **Live client:** `src/index.ts`, logic in `src/live/adapter.ts`.
  - Built for SDK 2.12.0 (the version upstream pins).
  - Auto-registers for tournaments and reads per-match settings.
  - Detects offline opponents.
  - Places a safe bid before words.
  - Reconnects with backoff and replays the match after a restart.
- **Launcher:** `run.ps1` asks for the token with hidden input, keeps the PC
  awake and restarts the bot on a crash. It was tested against a dead local
  address: it starts, the token never appears in the output, and the bot
  goes into its reconnect loop.
- **Checks:** `npm run typecheck` is clean, `npm test` passes 65/65, and the
  no-token smoke test passes.

## Manual steps (need the user's account and token)

1. **Get a token** (once). Install the SpacetimeDB CLI
   (https://spacetimedb.com/install) and run `spacetime login`. Then, on
   https://scrabblebot.vercel.app:
   1. On **/account**, run the `connect_id` command it shows.
   2. Create a team and bot on **/team/new**.
   3. On **/team**, click **Generate token** and copy it. It's shown only once.
2. **Test match** (before the tournament):
   ```powershell
   cd C:\Users\Manush\Desktop\Scrabblebot\scrabblebot\bot-starter
   powershell -ExecutionPolicy Bypass -File .\run.ps1 -BotName <your bot name>
   ```
   Paste the token when asked. Expect `connected` → `acting as bot` →
   `joining lobby` → `match N: …` → one line per auction →
   `match N ended: place X/6`. Stop with Ctrl+C.
3. **Tournament day:** start the same command **before registration
   closes**. Then:
   - Check for `registering for tournament N`, and that the bot appears on
     **/tournament**.
   - Leave it running. The launcher keeps the PC awake; keep it plugged in,
     on a stable network.
   - Run only one copy.
   - If anything goes wrong, run the same command again; it resumes the
     match.

## Watch for

- **Upstream changes before the tournament:** `git fetch` and
  `git log HEAD..origin/main`. If anything new appears, re-verify RULES.md
  and re-run `node sim/evaluate.ts`.
