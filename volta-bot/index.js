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
const { normaliseNumber, isLinked, sessionState, archiveSession, formatCode } = require('./utils/pairing');
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
 * Login mode — pairing code or QR
 * ------------------------------------------------------------------ */

/** Read `--pair [number]` / `--qr` from the command line. */
function cliPairing(argv = process.argv.slice(2)) {
  if (argv.includes('--qr')) return { on: false, number: '' };
  const i = argv.findIndex((a) => a === '--pair' || a === '--pairing' || a === '-p');
  if (i === -1) return null;
  const next = argv[i + 1];
  return { on: true, number: next && !next.startsWith('-') ? next : '' };
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
  const wanted = cli ? cli.on : String(process.env.USE_PAIRING_CODE).toLowerCase() === 'true';
  if (!wanted) return null;

  const given = (cli && cli.number) || process.env.PHONE_NUMBER || '';
  let result = given ? normaliseNumber(given) : { error: 'No number given.' };
  if (given && result.error) console.log(`[VOLTA] ⚠️  PHONE_NUMBER "${given}": ${result.error}`);

  while (result.error) {
    if (!process.stdin.isTTY) {
      console.log('[VOLTA] ⚠️  Pairing-code login was requested but no valid number was supplied,');
      console.log('    and this terminal cannot prompt for one (running under pm2 / a service?).');
      console.log('    Set PHONE_NUMBER in .env, or run once by hand: npm start -- --pair 2348012345678');
      console.log('    Falling back to QR code.');
      return null;
    }
    const answer = await ask('\nEnter your WhatsApp number in international format:\n  NG: 2348012345678 (08012345678 also works) | UK: 447911123456 | US: 14155552671\n> ');
    result = normaliseNumber(answer);
    if (result.error) console.log('   ' + result.error + ' Try again.');
  }
  if (result.note) console.log(`[VOLTA] Number adjusted (${result.note}).`);
  return result.number;
}

let reconnectAttempts = 0;
let socketId = 0;
let cachedPairNumber = null;
let reconnectTimer = null;
let reconnecting = false;
let stableSince = 0;
let fatalStop = false;
let cachedVersion = null;
let codesIssued = 0;          // pairing codes requested since the last successful link
let freshStartsUsed = 0;      // times we wiped a rejected half-linked session
let stdinHooked = false;

const MAX_RECONNECT_ATTEMPTS = 12;
// Each code triggers a notification on the phone. If nobody is entering them,
// stop instead of spamming the account (which also looks bot-like to WhatsApp).
const MAX_PAIRING_CODES = 5;
const MAX_FRESH_STARTS = 3;
// How long one pairing socket stays up waiting for the code to be typed.
// Baileys closes the socket (408) when the server's QR refs run out; with the
// default 60s/20s timers that was ~2.5 minutes, so a code typed at minute 3
// was always rejected and a new, unannounced code had already replaced it.
const PAIRING_REF_MS = 90 * 1000;
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
      .then(() => { reconnecting = false; })
      .catch((e) => {
        // startBot itself failed (disk, version lookup…). Previously this just
        // logged and the bot sat dead with no socket and no retry pending.
        reconnecting = false;
        reconnectAttempts++;
        console.log('[VOLTA] reconnect failed:', e && e.message);
        if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
          fatalStop = true;
          console.log('[VOLTA] ❌ Could not restart the connection. Restart the process.');
          return;
        }
        scheduleReconnect(Math.min(5000 * reconnectAttempts, 60000), 'Startup error.');
      });
  }, delayMs);
}

/** Move a rejected / half-linked session aside so the next socket starts clean. */
function resetSession(why) {
  const where = archiveSession(SESSION_DIR);
  if (where) console.log(`[VOLTA] ${why} Old session moved to ${where}.`);
}

/** Ask WhatsApp for a pairing code on this socket and print it. */
async function issuePairingCode(sock, myId, number) {
  if (myId !== socketId || fatalStop) return;
  if (isLinked(sock.authState.creds)) return;
  if (codesIssued >= MAX_PAIRING_CODES) {
    fatalStop = true;
    console.log(`\n[VOLTA] ❌ ${MAX_PAIRING_CODES} pairing codes went unused. Stopping so the phone is not spammed.`);
    console.log('    Restart when you are ready to type the code:  npm start -- --pair ' + number);
    teardownSocket(sock);
    return;
  }
  codesIssued++;
  try {
    const code = await sock.requestPairingCode(number);
    if (myId !== socketId) return;   // socket was replaced while we waited
    console.log('\n' + '='.repeat(52));
    console.log(`   PAIRING CODE:   ${formatCode(code)}` + (codesIssued > 1 ? `   (new code #${codesIssued})` : ''));
    console.log(`   For number:     +${number}`);
    console.log('='.repeat(52));
    if (codesIssued > 1) console.log('   ⚠️  Any earlier code is now INVALID — use this one.');
    console.log('   On the phone that owns this number:');
    console.log('     WhatsApp -> Settings (or ⋮) -> Linked devices');
    console.log('       -> Link a device');
    console.log('       -> "Link with phone number instead"');
    console.log('       -> type the code above');
    console.log('   Watch for a WhatsApp notification on the phone — tapping it');
    console.log('   opens the code box directly.');
    if (process.stdin.isTTY) console.log('   Code expired or rejected? Press ENTER here for a fresh one.');
    console.log('='.repeat(52) + '\n');
  } catch (err) {
    console.log('[VOLTA] Could not obtain a pairing code:', err && err.message);
    console.log('   The connection will be retried automatically.');
  }
}

/** Interactive helper: ENTER in the terminal asks for a fresh code. */
function hookStdinForNewCode() {
  if (stdinHooked || !process.stdin.isTTY) return;
  stdinHooked = true;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', () => {
    const sock = activeSock;
    if (!sock || !cachedPairNumber || fatalStop) return;
    if (isLinked(sock.authState.creds)) return;
    console.log('[VOLTA] Requesting a fresh pairing code…');
    issuePairingCode(sock, socketId, cachedPairNumber);
  });
  process.stdin.resume();
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  if (!cachedVersion) {
    cachedVersion = await resolveVersion(baileys, (m) => console.log(`[VOLTA] ${m}`));
  }
  const { version } = cachedVersion;

  const linked = isLinked(state.creds);
  const pairNumber = linked ? null : (cachedPairNumber || await resolvePairing());
  if (pairNumber) cachedPairNumber = pairNumber;
  const usePairing = !!pairNumber;

  if (!linked) {
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
    logger: pino({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' }),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    // Pairing sends an iq that can outlive the default query timeout and abort
    // the handshake with 428/408. Disabling the timeout is the documented fix.
    defaultQueryTimeoutMs: undefined,
    // Keep the pairing socket alive long enough to actually type the code.
    qrTimeout: usePairing ? PAIRING_REF_MS : undefined,
    connectTimeoutMs: 60_000,
    keepAliveIntervalMs: 30_000,
  });
  activeSock = sock;

  // ---- Pairing code ----
  // Requested on the FIRST `qr` event of this socket. That event fires when the
  // server sends pair-device, i.e. the noise handshake is done and WhatsApp is
  // ready to accept a link request. The old fixed 3-second timer fired before
  // that on slow connections, so requestPairingCode failed with "Connection
  // Closed", printed an error and never tried again.
  let codeRequested = false;
  if (usePairing) hookStdinForNewCode();

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr, isNewLogin } = update;

    // Ignore events from stale sockets — only the latest socket matters.
    if (myId !== socketId) return;

    if (qr && usePairing && !codeRequested) {
      codeRequested = true;
      issuePairingCode(sock, myId, pairNumber);
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

    if (isNewLogin) console.log('[VOLTA] 📱 Phone accepted the link — finishing setup, the connection will restart once…');

    if (connection === 'connecting') console.log('[VOLTA] Connecting to WhatsApp…');

    if (connection === 'open') {
      reconnecting = false;
      codesIssued = 0;
      freshStartsUsed = 0;
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

      const err = lastDisconnect && lastDisconnect.error;
      const status = err && new Boom(err).output.statusCode;
      const reason = (err && err.message) || 'no reason given';
      const wasLinked = isLinked(sock.authState.creds);

      stopPresenceCycling();

      teardownSocket(sock);
      if (activeSock === sock) activeSock = null;
      stableSince = 0;

      console.log(`[VOLTA] Connection closed — ${status || '?'} (${reason})${wasLinked ? '' : ' [not linked yet]'}`);

      if (status === 403) {
        fatalStop = true;
        console.log('[VOLTA] ❌ WhatsApp returned 403 (forbidden) — this number may be banned or restricted.');
        console.log('    Check the account in the WhatsApp app before trying again.');
        return;
      }

      // Logged out from the phone (or the session was revoked). The credentials
      // are dead for good, so clear them now — the old code told the user to
      // delete the folder by hand and then sat idle.
      if (wasLinked && status === DisconnectReason.loggedOut) {
        fatalStop = true;
        resetSession('This device was logged out from the phone.');
        console.log('[VOLTA] ❌ Logged out. Start the bot again to link it afresh:');
        console.log('      npm start -- --pair 234XXXXXXXXXX');
        return;
      }

      // Rejected while still linking (401 bad code / 405 / 500 bad session).
      // A half-linked session makes every later attempt fail the same way, so
      // start over with brand-new keys — a limited number of times.
      if (!wasLinked && [DisconnectReason.loggedOut, 405, DisconnectReason.badSession].includes(status)) {
        freshStartsUsed++;
        if (freshStartsUsed > MAX_FRESH_STARTS) {
          fatalStop = true;
          console.log(`[VOLTA] ❌ WhatsApp keeps rejecting the link (${status}).`);
          console.log('    Check: the number is right, it has WhatsApp, and it has a free linked-device slot (max 4).');
          console.log('    If 405 persists, WhatsApp changed version: set WA_VERSION in .env or update Baileys.');
          return;
        }
        resetSession(`WhatsApp rejected the half-linked session (${status}); starting fresh.`);
        cachedVersion = null;   // 405 is often a stale WA Web version — look it up again
        scheduleReconnect(3000, 'Fresh session.');
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

      // Pairing window ran out with nobody typing the code. Not an error — open
      // a new socket and print a new code straight away (capped in issuePairingCode).
      if (!wasLinked && usePairing && status === DisconnectReason.timedOut) {
        console.log('[VOLTA] ⌛ The pairing code was not entered in time.');
        scheduleReconnect(2000, 'Getting a new code.');
        return;
      }

      // A linked session failing with 405 is usually an outdated WA Web version.
      if (status === 405) cachedVersion = null;

      reconnectAttempts++;
      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        fatalStop = true;
        console.log(`[VOLTA] ❌ Gave up after ${MAX_RECONNECT_ATTEMPTS} failed reconnects (last status: ${status || 'unknown'}).`);
        console.log('    The bot is idle. Restart the process, or relink if this keeps happening.');
        console.log('    For detail, run with BAILEYS_LOG_LEVEL=debug in .env.');
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

  // A half-linked session (keys created, link never completed) makes WhatsApp
  // reject every later pairing attempt. Clear it on boot instead of just
  // warning about it. A fully linked session is never touched.
  const st = sessionState(SESSION_DIR);
  if (st === 'unlinked' || st === 'corrupt') {
    resetSession(`Found a ${st === 'corrupt' ? 'corrupt' : 'half-linked'} session from an earlier attempt.`);
  }

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
