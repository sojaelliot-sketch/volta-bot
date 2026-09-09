// commands/profile.js
//   !setname [name]   — set your own manager display name
//   !name [name]      — alias
//   !profile          — show your own manager profile
//   !info [@user|id]  — show another manager's public profile
const User = require('../models/User');
const Player = require('../models/Player');
const League = require('../models/League');
const { money } = require('../utils/formatter');
const { sendText, sendImageOrText } = require('../utils/messaging');
const logger = require('../utils/logger');
const { BRAND } = require('../config/constants');
const { resolveTarget } = require('./router');
const { formatBadges } = require('../utils/badges');

function roleLabel(role) {
  if (role === 'officer') return '👮 Officer';
  if (role === 'moderator') return '🛡️ Moderator';
  return '👤 User';
}

function profileBlock(u) {
  const owned = Player.getByOwner(u.whatsappId);
  
  // Calculate proper OVR for each player and get team OVR
  let teamOVR = 0;
  let bestPlayer = null;
  let bestOVR = 0;
  
  if (owned.length > 0) {
    for (const p of owned) {
      p.ovr = Player.calculateOVR(p);
      teamOVR += p.ovr;
      if (p.ovr > bestOVR) {
        bestOVR = p.ovr;
        bestPlayer = p;
      }
    }
    teamOVR = Math.round(teamOVR / owned.length);
  }
  
  const badges = formatBadges(u);

  // Get league info
  const divInfo = League.getPlayerDivision(u.whatsappId);
  const leagueText = divInfo
    ? `${divInfo.emoji} *${divInfo.name}* — ${divInfo.subtitle}\n  Points: ${divInfo.stats?.points || 0} | W:${divInfo.stats?.wins || 0} D:${divInfo.stats?.draws || 0} L:${divInfo.stats?.losses || 0}\n`
    : '🎓 *Unranked*\n';

  // Captain
  const captain = owned.find(p => p.isCaptain);
  const captainText = captain ? `👑 Captain: *${captain.name}* (OVR ${captain.ovr || 70})\n` : '';

  // Trophies
  const trophies = u.trophies || {};
  const totalTrophies = (trophies.league?.length || 0) + (trophies.tournaments?.length || 0) + (trophies.cups?.length || 0);
  const trophyText = totalTrophies > 0 ? `🏆 Trophies: ${totalTrophies}\n` : '';

  // Team chemistry
  let chem = 0;
  if (owned.length > 0) {
    const nationalityGroups = {};
    for (const p of owned) {
      const nat = p.nationality || 'Unknown';
      if (!nationalityGroups[nat]) nationalityGroups[nat] = [];
      nationalityGroups[nat].push(p);
    }
    for (const [, players] of Object.entries(nationalityGroups)) {
      if (players.length >= 2) chem += players.length * 5;
    }
    const hasCaptain = owned.some(p => p.isCaptain);
    if (hasCaptain) chem += 15;
    chem = Math.min(100, chem);
  }

  return (
    `👤 *${u.name}*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    leagueText +
    captainText +
    `💰 ${money(u.currency)}  🏆 MMR ${u.mmr} (${u.rank})\n` +
    `⚔️ ${u.wins}W ${u.losses}L ${u.draws}D  ·  ${User.winRate(u)}% win rate\n` +
    `⚽ ${u.totalGoals || 0} career goals  📊 ${u.goalsConceded || 0} clean sheets\n` +
    `🔥 Win streak: ${u.winStreak || 0}  ${trophyText}` +
    `🧪 Chemistry: ${chem}/100\n` +
    `🧢 ${owned.length} players  ·  Team OVR: ${teamOVR}\n` +
    (bestPlayer ? `⭐ Best: ${bestPlayer.name} (OVR ${bestPlayer.ovr})\n` : '') +
    `👥 Role: ${roleLabel(u.role)}\n` +
    (badges ? `━━━━━━━━━━━━━━━━━━━━━━━\n${badges}\n` : '') +
    `━━━━━━━━━━━━━━━━━━━━━━━`
  );
}

async function handle({ sock, msg, jid, sender, cmd, args, replyTo, mentioned }) {
  // ── setname / name ──
  if (cmd === 'setname' || cmd === 'name') {
    const name = args.join(' ').trim().replace(/\s+/g, ' ').slice(0, 24);
    if (!name) {
      await sendText(sock, jid, `⚠️ Give me a manager name:\n*!setname [name]*\n\nExample: *!setname Oasis FC*`, msg);
      return;
    }
    User.update(sender, { name });
    await sendText(sock, jid, `✅ Your manager name is now *${name}*! 🔥`, msg);
    return;
  }

  // ── info [user] ──
  if (cmd === 'info') {
    let target = null;
    if (args[0] && /^\d{6,}$/.test(args[0])) target = `${args[0]}@s.whatsapp.net`;
    else if (args[0] && args[0].includes('@')) target = args[0];
    else if (replyTo) target = replyTo;
    else if (mentioned) target = mentioned;
    // Also support a manager NAME typed as text (e.g. !info Oasis FC).
    if (!target) target = resolveTarget(args, { replyTo, mentioned });

    const u = target ? User.getByWhatsappId(target) : null;
    if (!u || !u.registered) {
      await sendText(sock, jid, `❌ No registered manager found for that target. Try replying to them, @mentioning, or typing their name.`, msg);
      return;
    }
    await sendText(sock, jid, profileBlock(u) + `\n${BRAND}`, msg);
    try {
      const buf = require('../utils/profileRenderer').renderProfileCard(u);
      await sendImageOrText(sock, jid, buf, `🪪 *${u.name}* — VOLTA manager profile`, msg, '');
    } catch (err) { logger.error({ err }, 'profile card render failed'); }
    return;
  }

  // ── profile (self) ──
  if (cmd === 'profile') {
    const u = User.getByWhatsappId(sender);
    if (!u || !u.registered) {
      await sendText(sock, jid, `👋 You're not registered yet. Send *!start* first.`, msg);
      return;
    }
    await sendText(sock, jid, profileBlock(u) + `\n${BRAND}`, msg);
    try {
      const buf = require('../utils/profileRenderer').renderProfileCard(u);
      await sendImageOrText(sock, jid, buf, `🪪 *${u.name}* — VOLTA manager profile`, msg, '');
    } catch (err) { logger.error({ err }, 'profile card render failed'); }
    return;
  }
}

module.exports = { handle };
