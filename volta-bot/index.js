// index.js
require('dotenv').config();
const readline = require('readline');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');
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

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`[VOLTA] Using WA v${version.join('.')}, isLatest: ${isLatest}`);

  const registered = !!state.creds.registered;
  const pairNumber = registered ? null : await resolvePairing();
  const usePairing = !!pairNumber;

  if (!registered) {
    console.log(usePairing
      ? `[VOLTA] Login method: pairing code (+${pairNumber})`
      : '[VOLTA] Login method: QR code  —  use "npm start -- --pair" for a code instead');
  }

  const myId = ++socketId;

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    // Use canonical browser label — non-canonical labels (e.g. "Chrome" alone)
    // cause WhatsApp to reject the pairing handshake with 400 bad-request.
    // Browsers.macOS uses "Chrome (Mac OS)" which is accepted for pairing.
    browser: Browsers.macOS('Desktop'),
    logger: pino({ level: 'silent' }),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
  });
  activeSock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Ignore events from stale sockets — only the latest socket matters.
    if (myId !== socketId) return;

    // ---- Pairing code (triggered by qr event, per Baileys docs) ----
    if (qr && usePairing && !pairingRequested) {
      pairingRequested = true;
      sock.requestPairingCode(pairNumber).then(code => {
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
      }).catch(err => {
        console.log('[VOLTA] Could not obtain a pairing code:', err && err.message);
        console.log('   Check the number is correct and in full international form.');
        console.log('   Or restart without --pair to use a QR code instead.');
      });
    }

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
      reconnectAttempts = 0;
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

      if (status === DisconnectReason.loggedOut) {
        console.log('[VOLTA] Logged out. Delete the sessions/ folder and start again to re-link.');
        return;
      }
      if (status === DisconnectReason.restartRequired) {
        console.log('[VOLTA] Restart required after linking — reconnecting…');
        setTimeout(() => startBot().catch((e) => console.log('[VOLTA] reconnect failed:', e && e.message)), 1500);
        return;
      }
      // 440 = replaced by another connection; use exponential backoff.
      reconnectAttempts++;
      const baseDelay = status === 440 ? 5000 : 3000;
      const delay = Math.min(baseDelay * Math.pow(1.5, reconnectAttempts - 1), 60000);
      console.log(`[VOLTA] Connection closed (${status || 'unknown'}). Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts})…`);
      setTimeout(() => startBot().catch((e) => console.log('[VOLTA] reconnect failed:', e && e.message)), delay);
    }
  });

  // ── Incoming messages ───────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    // Ignore messages from stale sockets.
    if (myId !== socketId) return;
    for (const msg of messages) {
      if (!msg.message) continue;

      // ── Welcome message for new group members ──
      const stubType = msg.message?.messageStubType;
      const stubParams = msg.message?.messageStubParameters;
      if (stubType === 27 && stubParams && stubParams.length > 0) {
        const groupJid = msg.key?.remoteJid;
        const addedJid = stubParams[0];
        if (groupJid && addedJid) {
          await sendWelcomeMessage(sock, groupJid, addedJid);
        }
      }

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

  setInterval(() => {
    try {
      const { getActiveMatchForUser } = require('./game-engine/matchSession');
      const users = User.all();
      for (const u of users) {
        if (u.inMatch && !getActiveMatchForUser(u.whatsappId)) {
          User.update(u.whatsappId, { inMatch: false, currentMatchId: null });
        }
      }
    } catch (err) {
      logger.error({ err }, 'Orphan inMatch heal failed');
    }
  }, 60 * 1000).unref();
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.log('[VOLTA] Unhandled promise rejection (kept process alive):', err && (err.stack || err.message || err));
});

process.on('uncaughtException', (err) => {
  console.log('[VOLTA] Uncaught exception (kept process alive):', err && err.stack);
});
