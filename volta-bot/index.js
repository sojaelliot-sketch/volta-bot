// index.js
require('dotenv').config();
const readline = require('readline');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
} = require('@whiskeysockets/baileys');
const baileys = require('@whiskeysockets/baileys');
const { resolveVersion } = require('./utils/waVersion');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const logger = require('./utils/logger');
const db = require('./config/database');
const { connectDB } = db;
const User = require('./models/User');
const router = require('./commands/router');
const { sendText } = require('./utils/messaging');
const competitionScheduler = require('./utils/competitionScheduler');
const {
  stealthConnect,
  stopPresenceCycling,
  recordDisconnect,
  delayReadReceipt,
  recordMessageReceived,
  recordHandshake,
  getHealthStats,
  getWarmupStats,
  getCircadianMultiplier,
} = require('./utils/antiban');

// ── Per-sender message queue ──────────────────────────────────────────────
const senderQueues = new Map();

function enqueueMessage(sender, work) {
  const entry = senderQueues.get(sender);
  if (entry) {
    entry.queue.push(work);
  } else {
    senderQueues.set(sender, { queue: [work], processing: false });
  }
  processQueue(sender);
}

async function processQueue(sender) {
  const entry = senderQueues.get(sender);
  if (!entry || entry.processing) return;
  entry.processing = true;

  while (entry.queue.length > 0) {
    const job = entry.queue.shift();
    try {
      await job();
    } catch (err) {
      logger.error({ err }, 'Queue job error');
    }
  }

  entry.processing = false;
  if (entry.queue.length === 0) senderQueues.delete(sender);
}
const { BRAND } = require('./config/constants');
const { startTipScheduler } = require('./utils/tips');
const { startBackupScheduler } = require('./utils/backup');
const { sendWelcomeMessage } = require('./utils/welcome');

let activeSock = null;

const SESSION_DIR = process.env.SESSION_DIR || './sessions';

/* ------------------------------------------------------------------ *
 * Login mode — matches whatsapp-life-simulator exactly
 * ------------------------------------------------------------------ */

/** Read `--pair [number]` from the command line. */
function cliPairing(argv = process.argv.slice(2)) {
  const i = argv.findIndex((a) => a === '--pair' || a === '--pairing' || a === '-p');
  if (i === -1) return null;
  const next = argv[i + 1];
  return { on: true, number: next && !next.startsWith('-') ? next : '' };
}

/**
 * Normalise a phone number for WhatsApp pairing.
 * Accepts any format: +234-801-234-5678, (234) 801 234 5678, 002348012345678, etc.
 * Strips +, spaces, brackets, dashes, leading 00 international prefix.
 * E.164 allows 7-15 digits total (country code + number).
 */
function normaliseNumber(input) {
  let digits = String(input || '').replace(/\D/g, '');
  if (!digits) return null;
  // Strip leading "00" international prefix (e.g. 00234... -> 234...)
  if (digits.startsWith('00')) digits = digits.slice(2);
  // E.164 allows 7-15 digits
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(String(answer).trim()); });
  });
}

/** Decide whether to pair, and with which number. Returns null for QR mode. */
async function resolvePairing() {
  const cli = cliPairing();
  const wanted = (cli && cli.on) || String(process.env.USE_PAIRING_CODE).toLowerCase() === 'true';
  if (!wanted) return null;

  const given = (cli && cli.number) || process.env.PHONE_NUMBER || '';
  let normalised = normaliseNumber(given);

  while (!normalised) {
    if (!process.stdin.isTTY) {
      console.log('[VOLTA] ⚠️  Pairing-code login was requested but no valid number was supplied.');
      console.log('    Set PHONE_NUMBER, or pass it: npm start -- --pair 2348012345678');
      console.log('    Falling back to QR code.');
      return null;
    }
    const answer = await ask('\nEnter your WhatsApp number with country code (digits only, no +):\n  US: 14155552671 | UK: 447911123456 | NG: 2348012345678 | IN: 919876543210\n> ');
    normalised = normaliseNumber(answer);
    if (!normalised) console.log('   That does not look like a valid number. Try again.');
  }
  return normalised;
}

let pairingRequested = false;
let reconnectAttempts = 0;
let socketId = 0;
let cachedPairNumber = null;
let reconnectTimer = null;
let reconnecting = false;
let stableSince = 0;
let fatalStop = false;

const MAX_RECONNECT_ATTEMPTS = 12;
// A connection must survive this long before we treat it as healthy and clear
// the backoff. Without it, a socket that opens and dies a second later resets
// the counter every time and the "exponential" backoff never grows.
const STABLE_MS = 60 * 1000;

/**
 * Fully dispose of a socket.
 *
 * THIS is what caused the reconnect loop. startBot() built a new socket on every
 * disconnect but never shut the old one down — the `myId !== socketId` guard only
 * stopped us HANDLING its events. The old WebSocket stayed open, kept its
 * keepalive timers running, and kept trying to reconnect on its own. After a few
 * cycles several sockets were live against the same account at once, so WhatsApp
 * started closing them with 440 (replaced by another connection), which triggered
 * another reconnect, which created another socket. The bot fought itself and the
 * only way out was killing the process.
 */
function teardownSocket(sock) {
  if (!sock) return;
  try { sock.ev.removeAllListeners('connection.update'); } catch {}
  try { sock.ev.removeAllListeners('messages.upsert'); } catch {}
  try { sock.ev.removeAllListeners('creds.update'); } catch {}
  try { sock.end(undefined); } catch {}
  try { if (sock.ws && typeof sock.ws.close === 'function') sock.ws.close(); } catch {}
}

/** Schedule exactly one reconnect. Repeat calls while one is pending are ignored. */
function scheduleReconnect(delayMs, why) {
  if (fatalStop) return;
  if (reconnecting) return;
  reconnecting = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  console.log(`[VOLTA] ${why} Reconnecting in ${Math.round(delayMs / 1000)}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})…`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startBot()
      .catch((e) => console.log('[VOLTA] reconnect failed:', e && e.message))
      .finally(() => { reconnecting = false; });
  }, delayMs);
}

/**
 * A pairing attempt must start from a clean auth folder. A half-linked session
 * (files present, creds.registered === false) makes WhatsApp reject the code.
 */
function sessionIsDirty(dir) {
  const fs = require('fs');
  try {
    if (!fs.existsSync(dir)) return false;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) return false;
    const credsPath = require('path').join(dir, 'creds.json');
    if (!fs.existsSync(credsPath)) return files.length > 0;
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    return !creds.registered;
  } catch { return false; }
}

async function startBot() {
  if (sessionIsDirty(SESSION_DIR)) {
    console.log('[VOLTA] ⚠️  The sessions/ folder holds a half-linked session (registered: false).');
    console.log('    WhatsApp will reject a pairing code against it. Clear it first:');
    console.log(`      rm -rf ${SESSION_DIR}      (Windows:  rmdir /s /q sessions)`);
    console.log('    Then start again.');
  }

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version, source } = await resolveVersion(baileys, (m) => console.log(`[VOLTA] ${m}`));

  const registered = !!state.creds.registered;
  const pairNumber = registered ? null : (cachedPairNumber || await resolvePairing());
  if (pairNumber) cachedPairNumber = pairNumber;
  const usePairing = !!pairNumber;

  if (!registered) {
    console.log(usePairing
      ? `[VOLTA] Login method: pairing code (+${pairNumber})`
      : '[VOLTA] Login method: QR code  —  use "npm start -- --pair" for a code instead');
  }

  // Kill the previous socket before opening another one.
  if (activeSock) {
    teardownSocket(activeSock);
    activeSock = null;
  }

  const myId = ++socketId;

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    // Browsers.macOS('Desktop') resolves to ["Mac OS","Desktop","14.4.1"] — "Desktop"
    // is not a browser name, and WhatsApp will issue a code that never reaches the
    // phone. Ubuntu/Chrome is the combination that reliably pairs.
    browser: Browsers.ubuntu('Chrome'),
    logger: pino({ level: 'silent' }),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    // Pairing sends an iq that can outlive the default query timeout and abort
    // the handshake with 428/408. Disabling the timeout is the documented fix.
    defaultQueryTimeoutMs: undefined,
    qrTimeout: undefined,
    connectTimeoutMs: 60_000,
    keepAliveIntervalMs: 30_000,
  });
  activeSock = sock;

  // ---- Pairing code: request once, straight after the socket is up ----
  // Requesting on the `qr` event is unreliable; the documented pattern is to
  // check creds.registered and ask directly, after a short settle delay.
  pairingRequested = false;
  if (usePairing && !sock.authState.creds.registered) {
    pairingRequested = true;
    setTimeout(async () => {
      if (myId !== socketId) return;
      try {
        const code = await sock.requestPairingCode(pairNumber);
        const pretty = String(code).match(/.{1,4}/g).join('-');
        console.log('\n' + '='.repeat(48));
        console.log('   PAIRING CODE:   ' + pretty);
        console.log('='.repeat(48));
        console.log('   On your phone:');
        console.log('     WhatsApp -> Settings -> Linked Devices');
        console.log('       -> Link a device');
        console.log('       -> "Link with phone number instead"');
        console.log('       -> type the code above');
        console.log('');
        console.log('   The code lasts ~3 minutes. If it expires,');
        console.log('   restart and a fresh one is issued.');
        console.log('='.repeat(48) + '\n');
      } catch (err) {
        console.log('[VOLTA] Could not obtain a pairing code:', err && err.message);
        console.log('   Check the number is in full international form, digits only.');
        console.log('   If sessions/ is not empty, delete it and try again.');
        console.log('   Or restart without --pair to use a QR code instead.');
      }
    }, 3000);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Ignore events from stale sockets — only the latest socket matters.
    if (myId !== socketId) return;

    // ---- QR code ----
    if (qr && !usePairing) {
      let drawn = false;
      try {
        qrcode.generate(qr, { small: true });
        drawn = true;
      } catch (err) {
        console.log('[VOLTA] Could not render a QR in this terminal:', err && err.message);
        console.log('[VOLTA] Raw QR payload (paste into any QR generator):');
        console.log(qr);
        console.log('[VOLTA] Simpler option: restart with  npm start -- --pair');
      }
      if (drawn) {
        console.log('\n   Scan the QR code above:');
        console.log('       WhatsApp -> Settings -> Linked Devices -> Link a device');
        console.log('       It refreshes every 20 seconds until scanned.');
        console.log('       No camera to hand? Restart with:  npm start -- --pair\n');
      }
    }

    if (connection === 'connecting') console.log('[VOLTA] Connecting to WhatsApp…');

    if (connection === 'open') {
      pairingRequested = false;
      reconnecting = false;
      stableSince = Date.now();
      // Do NOT zero reconnectAttempts here — a socket that opens then dies
      // immediately would reset the backoff on every cycle and hammer WhatsApp.
      // It is cleared by the stability timer below.
      setTimeout(() => {
        if (myId === socketId && stableSince && Date.now() - stableSince >= STABLE_MS) {
          reconnectAttempts = 0;
        }
      }, STABLE_MS + 500).unref();
      const me = sock.user && String(sock.user.id || '').split(':')[0];
      console.log(`[VOLTA] ✅ Connected as ${me || 'unknown'}`);
      // Stealth connect: start presence cycling after delay
      stealthConnect(sock);

      // Start competition scheduler
      competitionScheduler.setSocket(sock);
      competitionScheduler.startScheduler();
      console.log('[VOLTA] ✅ Competition scheduler started');
    }

    if (connection === 'close') {
      if (myId !== socketId) return;

      const status = lastDisconnect && lastDisconnect.error
        && new Boom(lastDisconnect.error).output.statusCode;

      stopPresenceCycling();

      teardownSocket(sock);
      if (activeSock === sock) activeSock = null;
      stableSince = 0;

      // Fatal states. Retrying these forever is what turned a dead session into
      // an endless "Reconnecting…" scroll: the credentials are gone or rejected,
      // so no number of attempts will ever succeed.
      const FATAL = new Set([
        DisconnectReason.loggedOut,   // 401
        403,                          // banned / forbidden
        405,                          // not authorised for this connection
      ]);
      if (FATAL.has(status)) {
        fatalStop = true;
        console.log(`[VOLTA] ❌ WhatsApp rejected this session (${status}). Not retrying.`);
        console.log('    Delete the sessions/ folder and link again:');
        console.log('      rm -rf sessions   (Windows: rmdir /s /q sessions)');
        console.log('      npm start -- --pair 234XXXXXXXXXX');
        return;
      }

      if (status === DisconnectReason.restartRequired) {
        // Expected once, straight after linking. It used to reconnect on a flat
        // 1.5s with no attempt counter, so if WhatsApp kept sending it the bot
        // span in a tight loop indefinitely.
        reconnectAttempts++;
        if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
          fatalStop = true;
          console.log('[VOLTA] ❌ WhatsApp keeps asking for a restart. Giving up — relink the session.');
          return;
        }
        scheduleReconnect(Math.min(1500 * reconnectAttempts, 20000), 'Restart required after linking.');
        return;
      }

      reconnectAttempts++;
      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        fatalStop = true;
        console.log(`[VOLTA] ❌ Gave up after ${MAX_RECONNECT_ATTEMPTS} failed reconnects (last status: ${status || 'unknown'}).`);
        console.log('    The bot is idle. Restart the process, or relink if this keeps happening.');
        return;
      }

      // 440 = replaced by another connection. Back off harder for that one:
      // it usually means a second instance is running somewhere.
      const baseDelay = status === 440 ? 8000 : 3000;
      const jitter = Math.floor(Math.random() * 1500);   // avoid lockstep retries
      const delay = Math.min(baseDelay * Math.pow(1.6, reconnectAttempts - 1), 120000) + jitter;
      if (status === 440) {
        console.log('[VOLTA] ⚠️  Status 440 — another session replaced this one.');
        console.log('    If the bot is running in two places, close one. Two instances will fight forever.');
      }
      scheduleReconnect(delay, `Connection closed (${status || 'unknown'}).`);
    }
  });

  // ── Incoming messages ───────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    // Ignore messages from stale sockets.
    if (myId !== socketId) return;
    for (const msg of messages) {
      // NOTE: messageStubType lives on the message envelope, not on msg.message,
      // and stub messages carry no msg.message at all — so this must be handled
      // before the `!msg.message` guard below, not after it.
      if (msg.messageStubType === 27 && Array.isArray(msg.messageStubParameters)) {
        const groupJid = msg.key?.remoteJid;
        for (const addedJid of msg.messageStubParameters) {
          if (groupJid && addedJid) {
            await sendWelcomeMessage(sock, groupJid, addedJid).catch((err) =>
              logger.error({ err }, 'Welcome message failed'));
          }
        }
      }

      if (!msg.message) continue;

      if (msg.key && !msg.key.fromMe) {
        const senderJid = msg.key.participant || msg.key.remoteJid;
        delayReadReceipt(sock, msg.key.remoteJid, msg.key);
        recordMessageReceived(senderJid);
        recordHandshake(senderJid);
      }

      const jid = msg.key?.remoteJid;
      const senderKey = msg.key?.participant || jid || 'unknown';
      enqueueMessage(senderKey, () =>
        router.handle(sock, msg).catch((err) => logger.error({ err }, 'Unhandled router error'))
      );
    }
  });

  return sock;
}

async function main() {
  globalThis.__botStartTime = Date.now();
  await connectDB();

  await startBot();
  startTipScheduler(() => activeSock, 60 * 1000);

  startBackupScheduler();

  setInterval(() => {
    try { db.reloadAll(); } catch (err) { logger.error({ err }, 'Periodic reload failed'); }
  }, 60 * 1000).unref();

  // Free anyone left flagged as "in a match" by a crash or a restart.
  //
  // This used to be a bare setInterval, so its FIRST run was 60 seconds after
  // startup. If the bot died mid-match, every player in that game spent a full
  // minute after the restart unable to do anything — every command answering
  // "you're already in a match" for a match that no longer exists. It now runs
  // immediately on boot as well, and tells the affected players what happened
  // instead of leaving them to work it out.
  async function healOrphanMatches(notify) {
    try {
      const { getActiveMatchForUser } = require('./game-engine/matchSession');
      const freed = [];
      for (const u of User.all()) {
        if (u.inMatch && !getActiveMatchForUser(u.whatsappId)) {
          User.update(u.whatsappId, { inMatch: false, currentMatchId: null });
          freed.push(u);
        }
      }
      if (freed.length) {
        logger.info({ count: freed.length }, 'Released players stuck in dead matches');
        if (notify && activeSock) {
          for (const u of freed) {
            try {
              await sendText(activeSock, u.whatsappId,
                '⚠️ *Your match was interrupted.*\n\n' +
                'The bot restarted before it finished, so that game does not count ' +
                'and nothing was deducted.\n\nYou are free to play again — send *!play*.');
            } catch { /* their DM may be closed */ }
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Orphan inMatch heal failed');
    }
  }

  // Straight away, then every minute.
  healOrphanMatches(true);
  setInterval(() => healOrphanMatches(false), 60 * 1000).unref();
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});

/* ------------------------------------------------------------------ *
 * Graceful shutdown
 *
 * The database is plain JSON files guarded by a lockfile. Killing the
 * process mid-write can leave a stray .tmp file and — worse — a stale lock
 * directory that makes every later write hang or fail. Ctrl+C previously
 * went straight to exit with none of that cleaned up. This flushes any
 * pending state, releases the lock, and closes the socket politely so
 * WhatsApp does not register an abrupt drop (which counts against you).
 * ------------------------------------------------------------------ */
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[VOLTA] ${signal} received — shutting down cleanly…`);

  const done = setTimeout(() => {
    console.log('[VOLTA] Shutdown timed out, forcing exit.');
    process.exit(1);
  }, 8000);
  done.unref();

  fatalStop = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  try { stopPresenceCycling(); } catch {}

  try {
    if (typeof db.flushAll === 'function') db.flushAll();
    else if (typeof db.reloadAll === 'function') { /* nothing pending to flush */ }
    console.log('[VOLTA] Database flushed.');
  } catch (err) {
    console.log('[VOLTA] Database flush failed:', err && err.message);
  }

  try { if (typeof db.releaseLock === 'function') db.releaseLock(); } catch {}

  try {
    if (activeSock && typeof activeSock.end === 'function') {
      activeSock.end(undefined);
      console.log('[VOLTA] WhatsApp socket closed.');
    }
  } catch {}

  clearTimeout(done);
  console.log('[VOLTA] Goodbye.');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (err) => {
  console.log('[VOLTA] Unhandled promise rejection (kept process alive):', err && (err.stack || err.message || err));
});

process.on('uncaughtException', (err) => {
  console.log('[VOLTA] Uncaught exception (kept process alive):', err && err.stack);
});
