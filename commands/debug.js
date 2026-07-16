// commands/debug.js
//   !debug  — owner only: deep diagnostics (cache coherence, counts, stuck matches)
const User = require('../models/User');
const db = require('../config/database');
const { getActivePvPForUser } = require('../game-engine/matchSession');
const { BRAND } = require('../config/constants');
const { sendText } = require('../utils/messaging');

async function handle({ sock, msg, jid, sender }) {
  if (!User.isOwner(sender)) {
    await sendText(sock, jid, `⛔ *!debug* is owner-only.`, msg);
    return;
  }

  const users = db.all('users');
  const players = db.all('players');
  const market = db.all('market');

  const registered = users.filter((u) => u.registered).length;
  const inMatch = users.filter((u) => u.inMatch).length;
  const banned = users.filter((u) => u.bannedUntil && new Date(u.bannedUntil).getTime() > Date.now()).length;
  const listed = market.filter((l) => !l.sold).length;

  // detect users flagged inMatch but with no live session (stale lock)
  let stale = 0;
  for (const u of users) {
    if (u.inMatch && !getActivePvPForUser(u.whatsappId)) stale++;
  }

  const lines = [
    `🛠️ *DEBUG*`,
    `━━━━━━━━━━━━━━━━━━━━━━━`,
    `👥 Users: ${users.length} (registered ${registered})`,
    `⚔️ inMatch: ${inMatch}  ·  stale inMatch flags: ${stale}`,
    `🚫 banned now: ${banned}`,
    `🧢 Players: ${players.length}`,
    `💱 Market listings: ${listed}`,
    `⏱️ Uptime: ${Math.floor(process.uptime())}s`,
    `━━━━━━━━━━━━━━━━━━━━━━━`,
    BRAND,
  ];
  await sendText(sock, jid, lines.join('\n'), msg);
}

module.exports = { handle };
