# ⚽ VOLTA Soccer Bot — 𝙈𝙀𝙏𝘼𝙒𝙊𝙍𝙆𝙎™

Phases 1–5 of the master build: **Foundation → Data Layer → Router/Registration → Squad Management → Match Engine.**

## What's in this build

| Phase | Covers |
|---|---|
| 1 — Foundation | `index.js` entry point, local JSON database, logger, constants |
| 2 — Data Layer | `User` / `Player` models, `playerGenerator` (name pools, pack opening) |
| 3 — Router & Registration | `!start`, `!register`, `!help` / `!menu`, message routing |
| 4 — Squad Management | `!squad`, `!lineup`, `!card`, `!condition`, `!bench`, `!rename` |
| 5 — Match Engine | `matchEngine.js` (stat math), `commentary.js` (burst messages), `matchSession.js` (orchestrator), `aiOpponent.js` (AI), `!play` command |

**Storage:** this build uses local JSON files under `data/` instead of MongoDB — zero setup,
easy to inspect (`cat data/users.json`), atomic writes so a crash mid-write can't corrupt data.
Swap in a real DB later without touching command files — everything goes through `models/User.js`
and `models/Player.js`.

## Setup

```bash
npm install
cp .env.example .env
npm start          # or: npm run dev  (auto-restarts on file changes)
```

## Connecting to WhatsApp

On first run you'll see a QR code printed directly in the terminal:

```
📱 Scan this QR code with WhatsApp → Linked Devices → Link a Device:
█▀▀▀▀▀█ ▄▄██▀▀ █▀▀▀▀▀█
█ ███ █ ▀█▄▀██ █ ███ █
...
```

Open WhatsApp on your phone → **Settings → Linked Devices → Link a Device** → scan it.
Once linked, credentials are saved to `sessions/` so you won't need to scan again on restart.

### Prefer a pairing code instead of scanning?

In `.env`, set:
```
USE_PAIRING_CODE=true
PHONE_NUMBER=2349011861051   # your WhatsApp number, digits only, country code first
```
On startup the terminal will print an 8-character code — enter it in WhatsApp under
**Linked Devices → Link with phone number**.

### Fixing a `405` / connection-closed error

A `405` on connect almost always means one of these:

1. **Stale WA protocol version** — this build calls `fetchLatestBaileysVersion()` on every
   startup so it always negotiates against the current WhatsApp Web protocol. Make sure
   `npm install` actually pulled the latest `@whiskeysockets/baileys` (check `npm ls @whiskeysockets/baileys`;
   run `npm update @whiskeysockets/baileys` if it's old).
2. **Corrupted/half-linked session** — delete the `sessions/` folder entirely and restart to
   force a fresh QR/pairing flow. A partially-written session is the #1 cause of repeated 405s.
3. **Browser fingerprint mismatch** — this build pins `Browsers.macOS('Desktop')`, which is
   the most reliably-accepted fingerprint right now. Don't change it unless you know why.
4. **Multiple bot instances fighting over the same session** — make sure only one `node index.js`
   process is running against the same `sessions/` folder.

If it still fails after a clean `sessions/` wipe, WhatsApp may be rate-limiting that number —
wait ~10 minutes before relinking.

## Confirming commands are actually being seen

Every incoming command is logged the moment the router receives it:

```
[12:03:41] INFO: 📨 command received
    jid: "2349011861051@s.whatsapp.net"
    cmd: "squad"
    args: []
```

If you send a command and see **nothing** in the terminal:
- Confirm the bot shows `✅ VOLTA Bot connected to WhatsApp!` — if not, it's not connected yet.
- Confirm you're messaging the **linked number's own chat** (or a chat it's a participant of).
- The router reads text from `conversation`, `extendedTextMessage`, image/video captions, and
  button/list replies — every common WhatsApp message shape — so this isn't a text-extraction gap.

If you see the log line but get no reply, check the log a few lines below it for a
`❌ Error handling message` stack trace — the router catches and logs every command error so
a bug in one command never silently swallows the reply.

## Try it

```
!start
!register Elliot
!squad
!card <id-from-squad>
!condition
!bench <id>
!rename <id> Flash
!help
```

## Next phases (not built here)

Phase 7 (Economy/Shop/Market), 8 (Academy/Daily), 9 (Tournaments), 10 (Leaderboard),
11 (Hardening) — per `VOLTA_MASTER_BUILD.md`.

## Logs

Verbose logs are written to `logs/combined.log` — the terminal only shows `[VOLTA]` prefixed
messages (connection status, QR codes, errors). Check the log file for detailed debug info.

---
*𝙈𝙀𝙏𝘼𝙒𝙊𝙍𝙆𝙎™ — Built Different.*
