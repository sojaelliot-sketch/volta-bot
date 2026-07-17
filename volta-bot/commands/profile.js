// commands/profile.js
//   !setname [name]   — set your own manager display name
//   !name [name]      — alias
//   !profile          — show your own manager profile
//   !info [@user|id]  — show another manager's public profile
const User = require('../models/User');
const Player = require('../models/Player');
const { money } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');
const { BRAND } = require('../config/constants');
const { resolveTarget } = require('./router');

function roleLabel(role) {
  if (role === 'officer') return '👮 Officer';
  if (role === 'moderator') return '🛡️ Moderator';
  return '👤 User';
}

function profileBlock(u) {
  const owned = Player.getByOwner(u.whatsappId);
  const ovr = owned.length
    ? owned.reduce((s, p) => s + Player.totalStats(p), 0)
    : 0;
  return (
    `👤 *${u.name}*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 ${money(u.currency)}  🏆 MMR ${u.mmr} (${u.rank})\n` +
    `⚔️ ${u.wins}W ${u.losses}L ${u.draws}D  ·  ${User.winRate(u)}% win rate\n` +
    `⚽ ${u.totalGoals || 0} career goals  🏆 ${u.tournamentWins || 0} tournament wins\n` +
    `🧢 ${owned.length} players  ·  Squad OVR ${ovr}\n` +
    `👥 Role: ${roleLabel(u.role)}\n` +
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
    return;
  }
}

module.exports = { handle };
