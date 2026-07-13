// index.js
require('dotenv').config();

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
const { formatChatName, formatSenderName, formatMessageText } = require('./utils/logger');
const { connectDB } = require('./config/database');
const router = require('./commands/router');
const { sendText } = require('./utils/messaging');
const { BRAND } = require('./config/constants');
const { startTipScheduler } = require('./utils/tips');

// The active WhatsApp socket — re-assigned on every (re)connect so the tip
// scheduler always sends through a live connection.
let activeSock = null;

const SESSION_DIR = process.env.SESSION_DIR || './sessions';
const USE_PAIRING_CODE = String(process.env.USE_PAIRING_CODE).toLowerCase() === 'true';
const PHONE_NUMBER = (process.env.PHONE_NUMBER || '').replace(/\D/g, '');

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

  // ── Pairing-code login (alternative to scanning a QR) ──────────────────
  if (USE_PAIRING_CODE && PHONE_NUMBER && !sock.authState.creds.registered && !pairingRequested) {
    pairingRequested = true;
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(PHONE_NUMBER);
        console.log(`[VOLTA] Pairing code for ${PHONE_NUMBER}: ${code}`);
        console.log('   Open WhatsApp → Linked Devices → Link with phone number, and enter this code.');
      } catch (err) {
        logger.error({ err }, 'Failed to request pairing code');
      }
    }, 1500);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !USE_PAIRING_CODE) {
      console.log('[VOLTA] Scan this QR code with WhatsApp → Linked Devices → Link a Device:');
      qrcode.generate(qr, { small: true });
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
      // Log incoming message
      const chatName = formatChatName(sock, msg.key.remoteJid);
      const senderName = formatSenderName(sock, msg);
      const text = formatMessageText(msg);
      logger.info({ chat: chatName, sender: senderName, text }, 'INCOMING');
      // The bot runs on the host's own WhatsApp account, so the host's
      // commands arrive as fromMe:true. We must NOT drop them — otherwise the
      // owner can never drive their own bot. Bot replies never start with '!'
      // so processing fromMe is safe (no feedback loop).
      // if (msg.key.fromMe) continue;
      // Never let one bad message crash the whole listener
      router.handle(sock, msg).catch((err) => logger.error({ err }, 'Unhandled router error'));
    }
  });

  // ── Group join welcome ──────────────────────────────────────────────────
  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    if (action !== 'add') return;
    for (const participant of participants) {
      if (participant === sock.user?.id) continue; // don't welcome the bot itself
      try {
        await sendText(sock, id,
          `👋 *Welcome to VOLTA!* ⚽ — ${BRAND}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `🎮 You've joined the pitch! Here's how to start:\n\n` +
          `1️⃣ *!start* — create your manager profile\n` +
          `2️⃣ *!register [name]* — get a FREE starter squad 🎁\n` +
          `3️⃣ *!play* — jump into your first match 🆚\n` +
          `4️⃣ *!help* — see EVERYTHING you can do\n` +
          `5️⃣ *!tutorial* — learn the game like a pro 🍼\n\n` +
          `💡 Tip: type *!squad* after registering to see your players. Have fun! 🔥`);
      } catch (err) {
        logger.error({ err }, 'Failed to send welcome message');
      }
    }
  });

  return sock;
}

async function main() {
  await connectDB();
  await startBot();
  startTipScheduler(() => activeSock, 60 * 1000);
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
