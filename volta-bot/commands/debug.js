// commands/debug.js
//   !debug         — owner only: deep diagnostics
//   !debug fix     — fix common issues (stale inMatch, reset AFK)
//   !debug reset   — reset bot state (clear AFK, enable bot)
const User = require('../models/User');
const db = require('../config/database');
const { getActivePvPForUser } = require('../game-engine/matchSession');
const { BRAND } = require('../config/constants');
const { sendText } = require('../utils/messaging');
const botstate = require('./botstate');

async function handle({ sock, msg, jid, sender, args }) {
  if (!User.isOwner(sender)) {
    await sendText(sock, jid, `⛔ *!debug* is owner-only.`, msg);
    return;
  }

  const subcmd = (args[0] || '').toLowerCase();

  // ── !debug fix — fix common issues ──
  if (subcmd === 'fix') {
    const users = db.all('users');
    let fixed = 0;

    // Fix stale inMatch flags
    for (const u of users) {
      if (u.inMatch && !getActivePvPForUser(u.whatsappId)) {
        User.update(u.whatsappId, { inMatch: false, currentMatchId: null });
        fixed++;
      }
    }

    // Clear AFK if stuck
    if (botstate.isAfk()) {
      botstate.setAfk(false);
      fixed++;
    }

    await sendText(sock, jid,
      `🔧 *DEBUG FIX*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ Fixed ${fixed} issue(s):\n` +
      `  • Cleared ${fixed > 0 ? fixed : 'no'} stale inMatch flags\n` +
      `  • Cleared AFK state\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
    return;
  }

  // ── !debug reset — full bot state reset ──
  if (subcmd === 'reset') {
    botstate.setAfk(false);
    botstate.setEnabled(true);
    await sendText(sock, jid,
      `🔄 *DEBUG RESET*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ Bot state reset:\n` +
      `  • AFK: OFF\n` +
      `  • Bot: ON\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
    return;
  }

  // ── !debug — show diagnostics ──
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
    `🤖 Bot: ${botstate.isEnabled() ? '🟢 ON' : '🔴 OFF'}`,
    `😴 AFK: ${botstate.isAfk() ? '🟢 YES (' + botstate.getAfkReason() + ')' : 'NO'}`,
    `━━━━━━━━━━━━━━━━━━━━━━━`,
    `💡 *!debug fix* — fix stale inMatch flags & clear AFK`,
    `💡 *!debug reset* — reset bot to ON + clear AFK`,
    `━━━━━━━━━━━━━━━━━━━━━━━`,
    BRAND,
  ];
  await sendText(sock, jid, lines.join('\n'), msg);
}

module.exports = { handle };
