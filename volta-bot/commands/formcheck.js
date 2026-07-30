// commands/formcheck.js
//   !formcheck @user — see opponent's last 5 results as W-W-L-W-D
const User = require('../models/User');
const db = require('../config/database');
const { sendText } = require('../utils/messaging');
const { resolveTarget } = require('./router');
const { BRAND } = require('../config/constants');

async function handle({ sock, msg, jid, sender, args, replyTo, mentioned }) {
  const user = User.getByWhatsappId(sender);
  if (!user || !user.registered) {
    await sendText(sock, jid, `❌ Register first with *!start*.`, msg);
    return;
  }

  const targetJid = resolveTarget(args, { replyTo, mentioned });
  if (!targetJid || targetJid === sender) {
    await sendText(sock, jid, `⚠️ Usage: *!formcheck @user* — see their recent form.`, msg);
    return;
  }

  const target = User.getByWhatsappId(targetJid);
  if (!target) {
    await sendText(sock, jid, `❌ Manager not found.`, msg);
    return;
  }

  // Get their last 5 match results
  const matches = db.all('matches') || [];
  const recent = matches
    .filter((m) => m.winnerId && !m.isAI && (m.homeId === targetJid || m.awayId === targetJid))
    .sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date))
    .slice(0, 5);

  if (!recent.length) {
    await sendText(sock, jid, `📊 ${target.name} has no PvP matches yet.`, msg);
    return;
  }

  const form = recent.map((m) => {
    if (m.winnerId === 'draw') return 'D';
    return m.winnerId === targetJid ? 'W' : 'L';
  });

  const formEmoji = form.map((r) => r === 'W' ? '✅' : r === 'L' ? '❌' : '🟡').join(' ');
  const wins = form.filter((r) => r === 'W').length;
  const losses = form.filter((r) => r === 'L').length;
  const draws = form.filter((r) => r === 'D').length;

  await sendText(sock, jid,
    `📊 *FORM CHECK*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${target.name}\n\n` +
    `Recent: ${form.join(' — ')}\n` +
    `${formEmoji}\n\n` +
    `W: ${wins}  L: ${losses}  D: ${draws}\n` +
    `Win Rate: ${Math.round((wins / form.length) * 100)}%\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
}

module.exports = { handle };
