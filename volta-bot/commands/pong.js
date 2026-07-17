// commands/pong.js
//   !pong — bot health report: uptime, message latency, commands answered,
//   issues found, and a data/health summary. Available to everyone.
const User = require('../models/User');
const db = require('../config/database');
const { BRAND } = require('../config/constants');
const { sendText } = require('../utils/messaging');
const stats = require('../utils/stats');

function uptimeStr() {
  const ms = (globalThis.__botStartTime ? Date.now() - globalThis.__botStartTime : process.uptime() * 1000);
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${d > 0 ? d + 'd ' : ''}${h}h ${m}m ${sec}s`;
}

function memMb() {
  try { return Math.round(process.memoryUsage().rss / 1048576); } catch { return 0; }
}

async function handle({ sock, msg, jid }) {
  // Round-trip latency: time how long a WhatsApp send actually takes.
  const t0 = Date.now();
  await sendText(sock, jid, '🏓 measuring...', msg);
  const latency = Date.now() - t0;

  const s = stats.snapshot();
  const health = s.issuesFound === 0
    ? '🟢 Healthy'
    : s.issuesFound < 5 ? '🟡 Minor issues' : '🔴 Degraded';
  const answerRate = s.commandsSeen
    ? Math.round((s.commandsAnswered / s.commandsSeen) * 100)
    : 100;

  await sendText(sock, jid,
    `🏓 *PONG — BOT HEALTH*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${health}\n` +
    `⚡ Latency: *${latency}ms*\n` +
    `⏱️ Uptime: *${uptimeStr()}*\n` +
    `🧠 Memory: *${memMb()} MB*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `✅ Commands answered: *${s.commandsAnswered}*\n` +
    `📥 Commands seen: *${s.commandsSeen}*  ·  ${answerRate}% served\n` +
    `⚠️ Issues found: *${s.issuesFound}*\n` +
    (s.lastError ? `   ↳ last: _${s.lastError}_\n` : '') +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💾 ${db.all('users').length} users · ${db.all('players').length} players · ${db.all('market').length} listings\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
}

module.exports = { handle };
