// commands/rivalry.js
//   !rivalry @user — track head-to-head record between two managers
const User = require('../models/User');
const db = require('../config/database');
const { sendText } = require('../utils/messaging');
const { resolveTarget } = require('./router');
const { BRAND } = require('../config/constants');

function getRivalry(id1, id2) {
  const key = [id1, id2].sort().join('||');
  const social = db.findOne('social', (s) => s.type === 'rivalry' && s.key === key);
  if (social) return social;
  return { type: 'rivalry', key, users: [id1, id2].sort(), wins: {}, matches: 0, title: null };
}

function saveRivalry(data) {
  const existing = db.findOne('social', (s) => s.type === 'rivalry' && s.key === data.key);
  if (existing) {
    Object.assign(existing, data);
  } else {
    db.insert('social', data.key, data);
  }
}

function recordResult(winnerId, loserId, isDraw) {
  const key = [winnerId, loserId].sort().join('||');
  const r = getRivalry(winnerId, loserId);
  r.matches = (r.matches || 0) + 1;
  if (!r.wins) r.wins = {};
  if (isDraw) {
    r.wins[winnerId] = (r.wins[winnerId] || 0) + 0.5;
    r.wins[loserId] = (r.wins[loserId] || 0) + 0.5;
  } else {
    r.wins[winnerId] = (r.wins[winnerId] || 0) + 1;
  }
  // Unlock title after 5+ meetings
  if (r.matches >= 5 && !r.title) {
    const titles = ['Arch Rivals', 'Mortal Enemies', 'Frenemies', 'Blood Feud', 'The Eternal Derby'];
    r.title = titles[Math.floor(Math.random() * titles.length)];
  }
  saveRivalry(r);
  return r;
}

async function handle({ sock, msg, jid, sender, args, replyTo, mentioned }) {
  const targetJid = resolveTarget(args, { replyTo, mentioned });
  if (!targetJid || targetJid === sender) {
    await sendText(sock, jid, `⚠️ Usage: *!rivalry @user* — check your head-to-head record with another manager.`, msg);
    return;
  }

  const target = User.getByWhatsappId(targetJid);
  if (!target) {
    await sendText(sock, jid, `❌ Manager not found.`, msg);
    return;
  }

  const r = getRivalry(sender, targetJid);
  const me = User.getByWhatsappId(sender);
  const myWins = r.wins?.[sender] || 0;
  const theirWins = r.wins?.[targetJid] || 0;
  const draws = r.matches - myWins - theirWins;

  let out = `⚔️ *RIVALRY*\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
  if (r.title) out += `🏆 *${r.title}*\n`;
  out += `${me?.name || 'You'} vs ${target.name}\n`;
  out += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  out += `📊 Matches: ${r.matches || 0}\n`;
  out += `✅ Your wins: ${myWins}\n`;
  out += `❌ Their wins: ${theirWins}\n`;
  if (draws > 0) out += `🤝 Draws: ${draws}\n`;
  if (r.matches < 5) out += `\n💡 ${5 - r.matches} more meeting(s) to unlock rivalry title!`;
  out += `\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`;
  await sendText(sock, jid, out, msg);
}

module.exports = { handle, recordResult, getRivalry };
