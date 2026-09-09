// commands/debug.js
//   !debug         — owner only: deep diagnostics
//   !debug fix     — fix common issues (stale inMatch, reset AFK)
//   !debug reset   — reset bot state (clear AFK, enable bot)
//   !debug warmup  — show warm-up progress
//   !debug antiban — show full antiban stats
const User = require('../models/User');
const db = require('../config/database');
const { getActivePvPForUser } = require('../game-engine/matchSession');
const { BRAND } = require('../config/constants');
const { sendText } = require('../utils/messaging');
const { getWarmupStats, getHealthStats, getCircadianMultiplier } = require('../utils/antiban');
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

  // ── !debug warmup — show warm-up progress ──
  if (subcmd === 'warmup') {
    const w = getWarmupStats();
    const bar = '█'.repeat(Math.min(7, w.currentDay)) + '░'.repeat(Math.max(0, 7 - w.currentDay));
    await sendText(sock, jid,
      `📈 *WARM-UP STATUS*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Day: *${w.currentDay}/${w.maxDays}* ${w.isComplete ? '✅' : '⏳'}\n` +
      `Progress: [${bar}]\n` +
      `📊 Daily: *${w.sentToday}/${w.dailyLimit}*\n` +
      `📊 Hourly: *${w.hourlyLimit}/hr*\n` +
      `📦 Total: *${w.totalSent}*\n` +
      `📅 Started: ${w.firstStartedAt ? new Date(w.firstStartedAt).toLocaleDateString() : 'N/A'}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
    return;
  }

  // ── !debug antiban — full antiban stats ──
  if (subcmd === 'antiban') {
    const w = getWarmupStats();
    const h = getHealthStats();
    const circ = getCircadianMultiplier();
    const riskColor = h.riskPercent >= 70 ? '🔴' : h.riskPercent >= 50 ? '🟠' : h.riskPercent >= 25 ? '🟡' : '🟢';
    await sendText(sock, jid,
      `🛡️ *ANTIBAN STATUS*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `*Health:*\n` +
      `  Risk: ${riskColor} *${h.riskPercent}%* (${h.riskLevel})\n` +
      `  Sent: *${h.sent}*  Failed: *${h.failed}*\n` +
      `  Errors: *${h.errors}*  Disconnects: *${h.disconnects}*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `*Warm-up:*\n` +
      `  Day: *${w.currentDay}/7* ${w.isComplete ? '✅' : '⏳'}\n` +
      `  Today: *${w.sentToday}/${w.dailyLimit}*\n` +
      `  Total: *${w.totalSent}*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `*Circadian:* ${circ}x (${new Date().getHours()}:00)\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
    return;
  }

  // ── !debug — show diagnostics ──
  const users = db.all('users');
  const players = db.all('players');
  const market = db.all('market');
  const warmup = getWarmupStats();

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
    `📈 Warm-up: Day ${warmup.currentDay}/7 ${warmup.isComplete ? '✅' : '⏳'}`,
    `━━━━━━━━━━━━━━━━━━━━━━━`,
    `💡 *!debug fix* — fix stale inMatch flags & clear AFK`,
    `💡 *!debug reset* — reset bot to ON + clear AFK`,
    `💡 *!debug warmup* — show warm-up progress`,
    `━━━━━━━━━━━━━━━━━━━━━━━`,
    BRAND,
  ];
  await sendText(sock, jid, lines.join('\n'), msg);
}

module.exports = { handle };
