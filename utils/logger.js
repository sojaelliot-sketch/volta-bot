const fs = require('fs');
const path = require('path');
const pino = require('pino');

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const fileTransport = pino.transport({
  target: 'pino-pretty',
  options: {
    colorize: false,
    singleLine: true,
    translateTime: 'HH:MM:ss',
    ignore: 'pid,hostname',
    destination: path.join(LOG_DIR, 'combined.log'),
    mkdir: true,
  },
});

const consoleTransport = pino.transport({
  target: 'pino-pretty',
  options: {
    colorize: true,
    singleLine: true,
    translateTime: 'HH:MM:ss',
    ignore: 'pid,hostname',
  },
});

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
}, pino.multistream([fileTransport, consoleTransport]));

function formatChatName(sock, jid) {
  if (!jid) return 'Unknown';
  if (jid.endsWith('@g.us')) return `Group:${jid}`;
  if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')) return `DM:${jid}`;
  return jid;
}

function formatSenderName(sock, msg) {
  if (msg.key.fromMe) return 'BOT (You)';
  const participant = msg.key.participant || msg.key.remoteJid;
  if (!participant) return 'Unknown';
  // Try to get pushName from message
  if (msg.pushName) return msg.pushName;
  return participant.split('@')[0];
}

function formatMessageText(msg) {
  if (!msg.message) return '';
  const m = msg.message;
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return `[Image] ${m.imageMessage.caption}`;
  if (m.videoMessage?.caption) return `[Video] ${m.videoMessage.caption}`;
  if (m.documentMessage?.caption) return `[Document] ${m.documentMessage.caption}`;
  if (m.stickerMessage) return '[Sticker]';
  if (m.audioMessage) return '[Audio]';
  if (m.locationMessage) return '[Location]';
  if (m.contactMessage) return '[Contact]';
  if (m.reactionMessage) return `[Reaction: ${m.reactionMessage.key?.id}]`;
  if (m.buttonsResponseMessage) return `[Button: ${m.buttonsResponseMessage.selectedButtonId}]`;
  if (m.listResponseMessage) return `[List: ${m.listResponseMessage.singleSelectReply?.selectedRowId}]`;
  return JSON.stringify(m).slice(0, 100);
}

module.exports = { logger, formatChatName, formatSenderName, formatMessageText };