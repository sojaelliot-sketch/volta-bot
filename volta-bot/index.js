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
const { BRAND } = require('./config/constants');
const { startTipScheduler } = require('./utils/tips');
const { startBackupScheduler } = require('./utils/backup');

// The active WhatsApp socket — re-assigned on every (re)connect so the tip
// scheduler always sends through a live connection.
let activeSock = null;

const SESSION_DIR = process.env.SESSION_DIR || './sessions';
const USE_PAIRING_CODE = String(process.env.USE_PAIRING_CODE).toLowerCase() === 'true';
let PHONE_NUMBER = (process.env.PHONE_NUMBER || '').replace(/\D/g, '');

function promptPhoneNumber() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('[VOLTA] Enter your WhatsApp number (international format, no +): ', (answer) => {
      rl.close();
      resolve(answer.replace(/\D/g, ''));
    });
  });
}

let pairingRequested = false;
let reconnectAttempts = 0;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`[VOLTA] Using WA v${version.join('.')}, isLatest: ${isLatest}`);

  const sock = makeWASocket({
    version,
    auth: state,
    // We handle QR rendering ourselves via the connection.update event below —
    // this avoids the deprecated built-in terminal printer and gives us full
    // control, which is what fixes most "QR never shows / 405" issues.
    printQRInTerminal: false,
    browser: Browsers.macOS('Desktop'),
    logger: pino({ level: 'silent' }),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
  });
  activeSock = sock;

  sock.ev.on('creds.update', saveCreds);

  // When pairing code succeeds, Baileys sets creds.registered = true but does
  // NOT close the connection (unlike QR pair-success which triggers a reconnect
  // from the server). We must force a reconnect so the bot logs in with its
  // fresh credentials, otherwise WhatsApp may never confirm the pairing.
  let wasRegistered = Boolean(sock?.authState?.creds?.registered);
  sock.ev.on('creds.update', (newCreds) => {
    if (!wasRegistered && newCreds.registered) {
      wasRegistered = true;
      reconnectAttempts = 0;
      console.log('[VOLTA] ✅ Device linked! Reconnecting with fresh credentials...');
      setTimeout(() => { try { sock.end(new Error('Pairing complete')); } catch {} }, 500);
    }
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      if (USE_PAIRING_CODE && PHONE_NUMBER && !pairingRequested) {
        pairingRequested = true;
        sock.requestPairingCode(PHONE_NUMBER).then(code => {
          console.log(`[VOLTA] Pairing code for ${PHONE_NUMBER}: ${code}`);
          console.log('   Open WhatsApp → Linked Devices → Link with phone number, and enter this code.');
        }).catch(err => {
          logger.error({ err }, 'Failed to request pairing code');
        });
      } else {
        console.log('[VOLTA] Scan this QR code with WhatsApp → Linked Devices → Link a Device:');
        qrcode.generate(qr, { small: true });
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output?.statusCode
        : null;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      console.log(`[VOLTA] Connection closed (code: ${statusCode || 'unknown'}). Logged out: ${loggedOut}`);

      if (loggedOut) {
        console.log('[VOLTA] Session logged out. Delete the sessions/ folder and restart to re-link.');
        return;
      }

      reconnectAttempts += 1;
      pairingRequested = false;
      const delay = Math.min(3000 * reconnectAttempts, 15000);
      console.log(`[VOLTA] Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts})...`);
      setTimeout(startBot, delay);
      return;
    }

    if (connection === 'open') {
      reconnectAttempts = 0;
      console.log('[VOLTA] ✅ VOLTA Bot connected to WhatsApp!');
      console.log(`   Logged in as: ${sock.user?.id || 'unknown'}`);
    }
  });

  // ── Incoming messages ───────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message) continue;
      // The bot runs on the host's own WhatsApp account, so the host's
      // commands arrive as fromMe:true. We must NOT drop them — otherwise the
      // owner can never drive their own bot. Bot replies never start with '!'
      // so processing fromMe is safe (no feedback loop).
      // if (msg.key.fromMe) continue;
      // Never let one bad message crash the whole listener
      router.handle(sock, msg).catch((err) => logger.error({ err }, 'Unhandled router error'));
    }
  });

  return sock;
}

async function main() {
  globalThis.__botStartTime = Date.now();
  await connectDB();

  // If pairing code mode is on but no number was set in .env, prompt now.
  if (USE_PAIRING_CODE && !PHONE_NUMBER) {
    PHONE_NUMBER = await promptPhoneNumber();
    if (!PHONE_NUMBER) {
      console.log('[VOLTA] No phone number entered. Defaulting to QR code mode.');
    }
  }

  await startBot();
  startTipScheduler(() => activeSock, 60 * 1000);

  // Automated JSON data backups (timestamped snapshots, pruned to a rolling set).
  startBackupScheduler();

  // Keep the bot's in-memory cache in sync with the web server (and any other
  // writer) so actions taken on one side are always visible on the other. The
  // DB layer already re-syncs on every mutation; this periodic reload just
  // refreshes read paths (e.g. !squad right after a web-side action) without
  // waiting for the next command. Cheap and keeps both processes coherent.
  setInterval(() => {
    try { db.reloadAll(); } catch (err) { logger.error({ err }, 'Periodic reload failed'); }
  }, 60 * 1000).unref();

  // Anti-break safety net: heal any user flagged inMatch whose match session no
  // longer exists (crash / restart / stuck PvP). Without this, a player could be
  // permanently locked out of !play. Runs every minute.
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
  logger.error({ err }, 'Unhandled promise rejection (kept process alive)');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception (kept process alive)');
});
