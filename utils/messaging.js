const logger = require('./logger');
const { formatChatName } = require('./logger');

async function sendText(sock, jid, text, quoted = null, mentions = null) {
  const content = { text };
  if (mentions && Array.isArray(mentions) && mentions.length) content.mentions = mentions;
  const opts = quoted ? { quoted } : undefined;
  try {
    const result = await sock.sendMessage(jid, content, opts);
    const chatName = formatChatName(sock, jid);
    logger.info({ chat: chatName, sender: 'BOT (You)', text: text.slice(0, 200) }, 'OUTGOING');
    return result;
  } catch (err) {
    logger.error({ err, jid, quoted: Boolean(quoted) }, 'Failed to send message');
    if (!quoted) {
      return null;
    }
    try {
      const result = await sock.sendMessage(jid, content);
      const chatName = formatChatName(sock, jid);
      logger.info({ chat: chatName, sender: 'BOT (You)', text: text.slice(0, 200) }, 'OUTGOING (retry)');
      return result;
    } catch (secondaryErr) {
      logger.error({ err: secondaryErr, jid }, 'Failed to send message without quote');
      return null;
    }
  }
}

async function typing(sock, jid, ms = 400) {
  try {
    await sock.sendPresenceUpdate('composing', jid);
    await new Promise((r) => setTimeout(r, ms));
  } catch {
    // presence updates are best-effort — never let this break a command
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendBurst(sock, jid, lines, delayMs = 800) {
  for (const line of lines) {
    await sendText(sock, jid, line);
    await sleep(delayMs);
  }
}

module.exports = { sendText, typing, sleep, sendBurst };