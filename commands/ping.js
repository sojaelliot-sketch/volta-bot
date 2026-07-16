// commands/ping.js
//   !ping  — owner only: bot latency / uptime / health snapshot
const User = require('../models/User');
const db = require('../config/database');
const { BRAND } = require('../config/constants');
const { sendText } = require('../utils/messaging');

function uptimeStr() {
  const ms = (globalThis.__botStartTime ? Date.now() - globalThis.__botStartTime : process.uptime() * 1000);
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${d > 0 ? d + 'd ' : ''}${h}h ${m}m ${sec}s`;
}

async function handle({ sock, msg, jid, sender }) {
  if (!User.isOwner(sender)) {
    await sendText(sock, jid, `⛔ *!ping* is owner-only.`, msg);
    return;
  }
  const start = Date.now();
  const t = Date.now() - start;
  const registered = User.all().filter((u) => u.registered).length;
  const staff = User.all().filter((u) => u.role === 'officer' || u.role === 'moderator').length;

  await sendText(sock, jid,
    `🏓 *PONG!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚡ Latency: *${t}ms*\n` +
    `⏱️ Uptime: *${uptimeStr()}*\n` +
    `👥 Registered: *${registered}*  ·  Staff: *${staff}*\n` +
    `💾 Data: ${db.all('users').length} users · ${db.all('players').length} players · ${db.all('market').length} listings\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
}

module.exports = { handle };
