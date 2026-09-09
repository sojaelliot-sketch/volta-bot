const logger = require('./logger');
const {
  getRateLimitDelay,
  recordMessageSent,
  recordMessageSentContact,
  varyMessage,
  checkBurstProtection,
  shouldBlockSend,
  recordMessageSent_health,
  recordMessageFailed,
  shouldPauseSending,
  gaussianRandom,
} = require('./antiban');

// ── Typing indicator tracking ──────────────────────────────────────────────
const activeTyping = new Map();
const TYPING_REFRESH_MS = 4000;

// ── Smart typing delay: 1-2 seconds ──────────────────────────────────────
function calcTypingDelay(responseLength) {
  const baseMs = 1000;
  const perCharMs = (responseLength || 0) * 3;
  const jitter = gaussianRandom(0, 100);
  const minMs = 1000;
  const maxMs = 2000;
  return Math.max(minMs, Math.min(maxMs, baseMs + perCharMs + jitter));
}

function startTyping(sock, jid) {
  if (!jid) return;
  if (activeTyping.has(jid)) return;
  try { sock.sendPresenceUpdate('composing', jid); } catch {}
  const intervalId = setInterval(() => {
    try { sock.sendPresenceUpdate('composing', jid); } catch {}
  }, TYPING_REFRESH_MS);
  activeTyping.set(jid, { intervalId, sock });
}

function stopTyping(jid) {
  if (!jid) return;
  const entry = activeTyping.get(jid);
  if (!entry) return;
  clearInterval(entry.intervalId);
  activeTyping.delete(jid);
  try { entry.sock.sendPresenceUpdate('paused', jid); } catch {}
}

async function smartTypingPause(sock, jid, responseLength) {
  if (!jid) return;
  const delay = calcTypingDelay(responseLength);
  try { sock.sendPresenceUpdate('composing', jid); } catch {}
  await new Promise(r => setTimeout(r, delay));
  try { sock.sendPresenceUpdate('paused', jid); } catch {}
}

async function sendText(sock, jid, text, quoted = null, mentions = null) {
  // Health monitor — auto-pause at 90% risk (more lenient)
  if (shouldPauseSending()) {
    logger.warn({ jid }, 'ANTIBAN: Pausing send (90%+ risk)');
    await new Promise(r => setTimeout(r, 15000)); // 15s pause, not 60s
  }

  // Burst protection — only for groups, not DMs
  if (jid && jid.endsWith('@g.us')) {
    const burst = checkBurstProtection(jid);
    if (burst.burst) {
      await new Promise(r => setTimeout(r, burst.restMs));
    }
  }

  // Rate limiter (Gaussian + Circadian + Warm-up)
  const msgLen = (text || '').length;
  const rateDelay = getRateLimitDelay(jid, msgLen);
  if (rateDelay > 0) {
    await new Promise(r => setTimeout(r, rateDelay));
  }

  // Message content variation (suffixes for repeated msgs)
  const variedText = varyMessage(text);

  const content = { text: variedText };
  if (mentions && Array.isArray(mentions) && mentions.length) content.mentions = mentions;
  const opts = quoted ? { quoted } : undefined;

  try {
    const result = await sock.sendMessage(jid, content, opts);
    recordMessageSent(jid);
    recordMessageSentContact(jid);
    recordMessageSent_health();
    return result;
  } catch (err) {
    recordMessageFailed();
    logger.error({ err, jid }, 'Failed to send message');
    if (!quoted) return null;
    try {
      const result = await sock.sendMessage(jid, content);
      recordMessageSent(jid);
      recordMessageSentContact(jid);
      recordMessageSent_health();
      return result;
    } catch {
      recordMessageFailed();
      return null;
    }
  }
}

async function typing(sock, jid, ms = 400) {
  try {
    await sock.sendPresenceUpdate('composing', jid);
    await new Promise(r => setTimeout(r, ms));
  } catch {}
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function sendBurst(sock, jid, lines, delayMs = 1500) {
  for (const line of lines) {
    await sendText(sock, jid, line);
    await sleep(1000 + Math.random() * 1000); // 1-2s between messages
  }
}


/**
 * Send an image with a caption, degrading to a plain text message when the
 * image could not be rendered (null buffer — see utils/safeCanvas.js) or when
 * WhatsApp rejects the upload. A command should never die because a picture
 * failed; the information in the caption is the part that matters.
 */
async function sendImageOrText(sock, jid, buffer, caption, quoted, textFallback) {
  // An empty string fallback means "say nothing" — used where the caller has
  // already sent the same information as text just above.
  const body = textFallback === '' ? '' : (textFallback || caption || '');
  if (!buffer) {
    return body ? sendText(sock, jid, body, quoted) : null;
  }
  try {
    return await sock.sendMessage(jid, { image: buffer, caption }, quoted ? { quoted } : undefined);
  } catch (err) {
    try { require('./logger').warn({ err }, 'Image send failed — falling back to text'); } catch {}
    return sendText(sock, jid, body, quoted);
  }
}

module.exports = { sendText, sendImageOrText, typing, sleep, sendBurst, startTyping, stopTyping, smartTypingPause, calcTypingDelay };