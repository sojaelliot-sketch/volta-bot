# Fixes — 16 Oct 2026

## Pairing code (index.js, utils/pairing.js)
- **Linked sessions were treated as unlinked.** The bot checked `creds.registered`, which Baileys only sets in the pairing-code flow. QR-linked sessions stay `registered: false` forever, so every restart fired `requestPairingCode()` at a logged-in socket and overwrote `creds.me` (corrupting the session). Now uses `creds.account`, which both flows set.
- **Code requested too early.** A fixed 3-second timer fired before WhatsApp was ready on slow connections → "Connection Closed", no retry. Now requested on the first `qr` event (server ready).
- **Code died while being typed.** The pairing socket closed after ~2.5 min (QR refs ran out) and silently issued a new code. Now stays up longer, and any new code is clearly marked "earlier code is now INVALID".
- **Press ENTER** in the terminal for a fresh code. Capped at 5 codes so the phone isn't spammed.
- **Number fixes:** `08012345678`, `+234 0801…`, `00234…` are all corrected to `2348012345678` (`DEFAULT_COUNTRY_CODE`, default 234). Nigerian numbers are length-checked.
- **Half-linked sessions** are moved aside automatically (renamed `sessions_old_<time>`, not deleted) on boot, and on a 401/405/500 rejection while linking.
- Logged out from the phone → session moved aside automatically, with clear instructions.
- Disconnect logs now show the reason. `BAILEYS_LOG_LEVEL=debug` in .env shows Baileys' own logs.
- A failed reconnect no longer leaves the bot dead with nothing scheduled.

## Commands / game logic
- **Every PvP match crashed at full time** (`awayFine is not defined`) — the final report and payout message never sent. Fixed (matchSession.js).
- **Owner not recognised from the phone number.** OWNER_ID is your LID (134643…); DMs come in as 2349011861051. Both are owner now and share one profile (`OWNER_ALIASES` in constants.js, or `OWNER_ALIASES=` in .env).
- `!playtourney` was silently ignored → now works like `!tourneyplay`.
- `!tourneyplay` wrote the winner without saving or advancing the bracket (no next round, final or prizes; lost on restart). Now goes through the bracket properly and uses team strength.
- `!cooldown 60 <id>` (minutes first) failed → both orders work.
- `!pvpadmin` didn't exist → alias for `!clearpvp`. `!site` / `!web` / `!pvpadmin` added to help.
- Targeting by `@lid` id now works.

## Tests
- New: `test_pairing.js` (36 checks, simulated WhatsApp), `test_owner.js` (12).
- Fixed harness bugs: parallel runs blamed commands for each other's replies; the "banned" check flagged "unbanned"; `audit.js` never exited. Removed tests for commands that don't exist (`!fun`, `!chat`, `!botstate`).
- `VOLTA_TEST_FAST=1` skips anti-ban send delays **in tests only** (test_all: 10+ min → 6 s). Never set it on the live bot.

## Not changed — your call
- `ECONOMY.MATCH_ENTRY_FEE: 10` is configured but never charged anywhere.
- `RATELIMIT` (20 commands/min) in constants.js is defined but never used.
- `!setbounty` (owner-only) is listed in the public STANDINGS menu.
