# ScrabbleBot rules, verified against the module source

Source of truth: the tournament ("Calhacks") version of the module, upstream
commit `3064b36` ("Calhacks version (#14)"). The module is now TypeScript in
`spacetimedb/src/`: `game.ts`, `index.ts`, `schema.ts`, `lobby.ts`,
`tournament.ts`, `letters.ts` and `dictionary.ts`. Citations are `file:line`
in that commit.

This file was first written against the Rust module (`lib.rs`, commit
`e1dab18`). Everything here was re-verified against the TypeScript rewrite.
[What changed](#what-changed-from-the-rust-module) lists every difference
that affects play. Where the README or the `/docs` page (`src/pages/Docs.tsx`)
disagree with the code, the code wins; see
[where the docs are wrong](#where-the-docs-are-wrong).

## The live server runs a newer, unpublished module

Checked 2026-10-22 against the live `scrabblebot` database on maincloud,
through its public schema (`npm run check-schema`). The database runs a
module **newer than any published commit**: none of the 12 branches on
GitHub contains its round-robin code. Its game logic can't be read, so
everything below the schema level is still verified against `3064b36`.

| # | Live schema | Effect on this bot |
|---|---|---|
| L1 | `match_state` has **no** `auction_duration_ms` / `starting_rack_size` (they remain in `matchmaker_config`, which is empty live, so the module's defaults apply) | bindings patched (`npm run sync-bindings`); the client reads the window from each auction row (`closes_at − opens_at`), and the tracker infers rack size from observation (C4) |
| L2 | `tournament.status` variants, in order: `Lobby, Swiss, Bracket, Final, Ended, Registration, RoundRobin, FinalsReady, FinalsRunning, FinalsIntermission, FinalsTieReplay, Crowned`. `ForceEnded` is gone | enum patched (rows decode by variant index); the client holds out of lobbies in `RoundRobin` and every `Finals*` phase |
| L3 | `tournament` adds `desired_min_matches_per_bot` (default 5), `actual_matches_per_bot`, `finals_size` (default 6) and `current_finals_match`; `create_tournament(desired_min_matches_per_bot, finals_size, auction_type)` | format: a round robin in which every entrant plays at least N matches, then finals among the top `finals_size` |
| L4 | `tournament_entry` replaces `total_score` with `round_robin_wins` (u32) and `round_robin_total_score` (i64); keeps `swiss_points`, `eliminated`, `final_finish_position` | standings are most likely **wins, then total score**. The client logs both |
| L5 | `tournament_match.phase` adds `RoundRobin` and `FinalReplay`; new columns `finals_match_number`, `replay_of_finals_match` | finals are numbered matches; **a tied finals match is replayed** |
| L6 | new table `pending_match_seat (tournament_id, round_robin_index, seat, bot_id)` | round-robin seating is planned ahead |
| L7 | the reducers the bot calls are unchanged: `submit_bid(auction_id, amount)`, `submit_word(match_id, word)`, `join_lobby()`, `register_for_tournament(tournament_id)`. New admin-only: `admin_register_all_sim_bots`, `spawn_sim_bots_to`, `start_next_finals_match` | none. Sims may be entered in the tournament, which suits this bot (its best fields) |

The phase order in L2 and the ranking in L4 are read from names and
defaults, not code. Ranking by first places matches what the tuning
optimised: win rate (first place) in self-play, the league and the baseline
field ([RESULTS.md](RESULTS.md)), with total score as the tiebreak.

## Verified mechanics

### Match setup
| Rule | Value | Source |
|---|---|---|
| Starting balance | 100 per bot per match | `game.ts:49`, `game.ts:265-273` |
| Starting score | 0 | `game.ts:271` |
| Bag | standard Scrabble distribution with no blanks, 98 tiles | `letters.ts:42-70`, `game.ts:248`, `game.ts:275-282` |
| **Starting rack** | each bot is dealt `startingRackSize` tiles (default **5**) privately | `game.ts:61-64`, `game.ts:284-295` |
| **Admin-configurable settings** | rack size 0–20, auction length **250–10,000 ms** (default 1,000), lobby size 2–12 (default 6). Each match records its own `auctionDurationMs` and `startingRackSize` | `index.ts:603-644`, `game.ts:66-76`, `game.ts:249-262`, `schema.ts:284-285` |
| Auctions per match | `98 − rack size × N`: 68 for 6 bots with 5-tile racks, 88 for a 2-bot final | follows from the two rows above |
| Draws | uniform over the tiles left in the bag | `game.ts:672-693` |
| Payment mode | `matchState.auctionType` (public), copied from the lobby or tournament | `game.ts:236-262` |
| Lobby payment mode | **always Vickrey** | `lobby.ts:30` |
| Tournament payment mode | set by the admin per tournament | `index.ts:779-814`, `tournament.ts:182`, `tournament.ts:266` |

### Auction
| Rule | Detail | Source |
|---|---|---|
| Window | `auctionDurationMs` for this match. Bids are accepted while `timestamp < closesAt` | `game.ts:302`, `game.ts:560`, `index.ts:665-670` |
| One auction at a time | the next letter is drawn and its auction opened **in the same transaction** that closes the previous one | `game.ts:545-582` |
| Bid validity | `amount ≥ 0`, caller must be a participant, `amount ≤ current balance` | `index.ts:651-677` |
| Re-bidding | a new bid replaces the old one | `index.ts:678`, `game.ts:756-775` |
| Zero bids | ignored; only `amount > 0` counts | `game.ts:484` |
| Winner | highest amount. **Equal bids are shuffled, so ties are random** | `game.ts:485-488` |
| Vickrey payment, one bidder | `min(reserve 1, bid)`, which is always 1 | `game.ts:51`, `game.ts:500` |
| Vickrey payment, two or more bidders | the second-highest bid (your own bid if tied) | `game.ts:500` |
| First-price payment | the winner's own bid | `game.ts:497-498` |
| No bids | the letter is **discarded**: nobody gets it and nothing returns it to the bag | `game.ts:490-527` |
| Award | balance −= paid, letter goes to the private `holding` | `game.ts:504-518` |
| Score effect of paying | none; payment touches `balance` only | `game.ts:509-512` |

### Words
| Rule | Detail | Source |
|---|---|---|
| When | any time while the match is `Running`, including mid-auction | `index.ts:691-693` |
| Validity | ≥ 2 letters, A–Z only (input is upper-cased first), in the ENABLE list | `index.ts:703-712`, `dictionary.ts:29-53` |
| Ownership | the rack must hold every letter, counting repeats | `game.ts:621-626` |
| Consumption | the letters are **removed** from the rack | `game.ts:628-639` |
| Limits | none on plays per round, play frequency or length | no check in `submitWord` / `playWord` |
| Reward | `base × num / den` in integer (floor) division | `game.ts:641-647` |
| Credit | added to **both** `balance` and `score` | `game.ts:649-653` |
| Public record | `wordPlay {botId, word, baseScore, bonus, totalReward}` | `game.ts:655-664` |

Letter values (`letters.ts:1-40`, unchanged): A E I O U L N S T R = 1 · D G = 2 ·
B C M P = 3 · F H V W Y = 4 · K = 5 · J X = 8 · Q Z = 10. The full bag is worth
187 face points. The wordlist is unchanged: ENABLE, 172,820 words, with no QI
or ZA.

### End of match and ranking
| Rule | Detail | Source |
|---|---|---|
| End trigger | after an auction closes, the bag is empty, so the status becomes `Ended` **in that same transaction** | `game.ts:545-557`, `game.ts:677-679` |
| Consequence | **a letter won in the final auction can never be played by a real bot** (sims play theirs before the end check, `game.ts:541-543`) | — |
| Last-auction signal | while the final auction is open, `matchState.bagTotal == 0` | `game.ts:687` |
| Ranking | by `score`; `balance` and leftover tiles are ignored | `game.ts:403`, `tournament.ts:414-417` |
| Ties | tied bots share the place (Swiss points, and the win for Elo) | `tournament.ts:385-386`, `game.ts:431-432` |

### Simulated bots
Six are seeded at init: Cheapo and Snippet (Cheapskate), Valor and Hagrid
(ValueBidder), Brutus and Maverick (Aggressive) (`index.ts:176-187`). They
fill timed-out lobbies (`lobby.ts:62-83`). They enter a tournament only if an
admin adds them (`index.ts:851-862`).

- **Bids:** placed in the transaction that opens each auction, using the
  sim's balance at that moment (`game.ts:729-753`). The base bid is
  Cheapskate `value − 1`, ValueBidder `value`, or Aggressive `value + 4` on
  vowels and `value + 2` on consonants. **A uniform random jitter in
  [−2, 2] is added.** The result is floored at 1 and capped at balance
  (`game.ts:697-727`, `game.ts:741-747`).
- **What's predictable:** `bot.isSimulated`, `bot.strategy` and each sim's
  balance are public. So a sim's bid is known up to that ±2 jitter. Sims no
  longer win ties.
- **Word play:** immediately after winning a letter, a sim plays its longest
  word of 3 or more letters, at most once per win (`game.ts:541-543`,
  `game.ts:777-797`, `dictionary.ts:63-106`).

### Tournament
| Phase | Rule | Source |
|---|---|---|
| Registration | the admin creates the tournament. **Each bot must call `registerForTournament` from its own process** (opt-in). Registrations are accepted only in `Registration` | `index.ts:779-832`, `tournament.ts:109-129` |
| Start | the admin starts it; it needs at least `matchSize` entrants. Round 1 waits until no entrant is in a casual match | `index.ts:887-931`, `tournament.ts:87-107` |
| During | entrants still in contention can't join lobbies. **Offline entrants are still seated** (and lose every auction) | `index.ts:730-734`, `tournament.ts:41-53`, `Docs.tsx` "Stay connected" |
| Swiss pairing | round 1 is shuffled; later rounds sort by standings. Tables of about `matchSize` (sizes differ by ≤ 1). **Nobody sits out** | `tournament.ts:149-208` |
| Swiss points | `max(matchSize − place, 0)`, where place = number of bots with a strictly higher score | `tournament.ts:380-395` |
| Standings | Swiss points, then **total score over all tournament matches**, then lower bot id | `tournament.ts:139-147`, `tournament.ts:418-426` |
| Cut | top `topCut` by standings. With 3 or more it goes to a bracket, with 2 straight to the final | `tournament.ts:285-299` |
| Bracket | the admin starts each match. Everyone still alive plays one match and **last place is eliminated**. A tie for last goes to the lower total score, then the higher bot id | `index.ts:964-974`, `tournament.ts:251-281`, `tournament.ts:304-337` |
| Final | **3 two-bot games**. The champion has the highest **aggregate score** over those games, then total score, then lower bot id | `tournament.ts:133`, `tournament.ts:341-372`, `tournament.ts:447-453` |

## The five questions

### 1. Multipliers for 4, 5 and 6 letters, and how base score is computed
Unchanged. `letters.ts:75-81` returns `(num, den)`:

| Word length | Multiplier |
|---|---|
| ≤ 3 | 1/1 |
| **4** | **3/2 (1.5×)** |
| **5** | **2/1 (2×)** |
| **6** | **5/2 (2.5×)** |
| 7+ | 3/1 |

Base score is the plain sum of letter values (`game.ts:641-644`). Reward is
`base * num / den` in bigint integer division, which **floors**
(`game.ts:645-647`). So a 4-letter word with base 5 pays 7, and a 6-letter
word with base 7 pays 17.

### 2. Does playing a word use its letters, and are there limits?
Yes, the letters are consumed (`game.ts:628-639`). The limits are:
- at least 2 letters (`index.ts:704-706`);
- A–Z only (`index.ts:707-709`);
- in the dictionary (`index.ts:710-712`);
- the match must be `Running` (`index.ts:691-693`).

There is no maximum length, no per-round or per-match limit, and no cooldown.

### 3. Do leftover balance or unplayed letters count?
**No.** Everything uses `score` only:
- placings (`game.ts:403`);
- Swiss points (`tournament.ts:380-395`);
- standings, elimination and the final (`tournament.ts:139-147`, `304-337`, `341-372`).

`score` changes only in `playWord` (`game.ts:649-653`). Paying for a letter
lowers `balance` but not `score` (`game.ts:509-512`). Two consequences:
- Money is worth nothing at the end.
- Letters must be played **before the final auction closes**. The match ends
  in the same transaction (`game.ts:545-557`), and `submitWord` rejects
  non-running matches (`index.ts:691-693`). The final auction is the one
  that opens with `bagTotal == 0`.

### 4. What bid information is public, and how do you learn the payment mode?
After each auction only `auctionResult {auctionId, matchId, letter,
winnerBotId, paid, closedAt}` is published (`game.ts:520-527`,
`schema.ts:400`). Individual bids sit in the private `pendingBid` table
(`schema.ts:380`) and are deleted at close (`game.ts:537-539`). The top bid
goes to the private `auctionTopBid` (`schema.ts:429`, `game.ts:528-535`) and
is moved to the public archive only **after the match ends**
(`game.ts:360-375`).

What `paid` tells you:
- **Vickrey:** the second-highest bid, or 1 if there was a single bidder.
- **First-price:** the winner's own bid.
- Losing bids are never revealed.

Also public: every bot's live `balance` and `score` (`matchParticipant`),
`bagTotal`, all word plays, `botCredential.connected`, and the matchmaker
config. The payment mode is `matchState.auctionType` (`lobby.auctionType` is
always Vickrey, `lobby.ts:30`; `tournament.auctionType`).

*Fair-play note:* the spectator view `visibleAuctionTopBids` hides live top
bids from bot credentials but shows them to other identities
(`index.ts:113-131`). Using a second, non-bot connection to read them would
leak sealed bids. This bot never does.

### 5. Reducers, context and timing
**Reducers a bot calls** (TS bindings from SpacetimeDB 2.12; handles are
camelCase, e.g. `conn.db.matchState`; reducers return promises):

| Reducer | Arguments | Source |
|---|---|---|
| `joinLobby` | `{}` | `index.ts:720-764` |
| `submitBid` | `{ auctionId: bigint, amount: bigint }` | `index.ts:648-680` |
| `submitWord` | `{ matchId: bigint, word: string }` | `index.ts:684-716` |
| `registerForTournament` / `unregisterFromTournament` | `{ tournamentId: bigint }` | `index.ts:818-847` |

Scheduled ticks are now callable only by the scheduler (`game.ts:154-162`,
`index.ts:997`). Admin reducers are off limits.

**Timing:**
- The first auction opens in the transaction that starts the match. Each
  later auction opens inside the tick that closes the previous one, with
  `closesAt = opensAt + auctionDurationMs` (`game.ts:301-321`,
  `game.ts:559-582`). There is no gap between letters.
- **Late bids are rejected**: "Auction window expired" or "Auction closed"
  (`index.ts:662-670`).
- A re-bid replaces the earlier bid. Ties are random, so there's no
  insertion priority to lose.
- The window can be as short as **250 ms** if an admin sets it, so a bot
  must decide well inside it.
- The starter's `BidContext {letter, myBalance, myRack}` and
  `WordContext {myRack, dictionary}` are starter conventions, not module
  API. This bot extends them (`src/strategy.ts`).

## What changed from the Rust module
| # | Rust module (`e1dab18`) | Tournament module (`3064b36`) | Effect on this bot |
|---|---|---|---|
| C1 | Rust; SDK 2.2; snake_case client handles | TypeScript; SDK **2.12**; **camelCase** handles and index accessors | live client moved to the 2.12 names |
| C2 | ties go to the earliest insert, so sims always win ties | **ties random** (`game.ts:485-488`) | tie model and first-price bidding updated |
| C3 | sim bids deterministic | sim bids **±2 jitter** (`game.ts:697-747`) | first-price prices sims over the jitter distribution |
| C4 | rack size 5, 1 s auctions, lobby 6 fixed | admin-configurable per match: 0–20 tiles, 250–10,000 ms, 2–12 bots (`index.ts:603-644`) | tracker derives totals from observation; client reads per-match settings and skips precompute on short windows |
| C5 | every bot in the table is entered | **opt-in registration** (`index.ts:818-832`); offline registrants are still seated | client auto-registers; offline seats are detected |
| C6 | Swiss leftovers sit out; places by stable sort | tables with no sit-outs; **shared places**; **total-score tiebreaks**; admin starts each finals match | total score matters even when not winning |
| C7 | a bot could play a lobby match during a tournament | entrants are kept out of lobbies; round 1 waits for casual matches to end | client doesn't try to join lobbies while held |
| C8 | `auction_tick` / `lobby_timeout_tick` callable by anyone | scheduler only (`game.ts:154-162`) | — |
| C9 | Elo win for the first-sorted bot only | tied leaders share the win (`game.ts:431-432`) | — |

## Where the docs are wrong
Checked against the README and `src/pages/Docs.tsx` at `3064b36`:

| # | Claim (where) | What the code does |
|---|---|---|
| D1 | "Tiles nobody bids on go back to the bag" (README; `/docs`) | **Discarded** (`game.ts:490-527`; nothing returns them) |
| D2 | Lobby open "60 seconds" (README; `/docs`) | **90 s** (`game.ts:60`, `lobby.ts:23`) |
| D3 | Lobby padded with "idle simulated bots" (README; `/docs`) | Sims **bid (with jitter) and play words** (`game.ts:697-797`) |
| D4 | "First-price is configurable per lobby" (README) | Lobbies are **always Vickrey** (`lobby.ts:30`); only tournaments choose |
| D5 | `auction_result` includes `top_bid` (`/docs`, "What's visible") | Only `winnerBotId` and `paid` (`schema.ts:400`); the top bid stays private until the match ends |
| D6 | "1-second sealed-bid window" (README) | Default 1 s, but per match and settable from 250 ms to 10 s (`index.ts:603-644`) |
| D7 | Racks start empty (rules never mention starting tiles) | `startingRackSize` (default 5) tiles are dealt privately (`game.ts:284-295`) |
| D8 | The starter "persists the token to `.token-<BOT_NAME>`" (`/docs`) | True of the stock starter. **This bot never writes the token**; it reads `BOT_TOKEN` only |

## What this means for strategy
- **Objective:** maximise word score. Currency only buys letters and is
  worth 0 at the end. Total score also breaks tournament ties.
- **The final auction** is worthless except to deny a sim. Play everything
  before it closes.
- **Sims are predictable** to within ±2 per bid. Ties are coin flips, so in
  first-price the right bid weighs the jitter distribution rather than
  bidding "sim + 1".
- **Short auction windows** (down to 250 ms) and **offline registrants** are
  both possible in a tournament. The client handles both.
