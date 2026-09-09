const User = require('../models/User');
const Player = require('../models/Player');
const { BRAND } = require('../config/constants');
const { money } = require('../utils/formatter');
const { sendText, typing } = require('../utils/messaging');

const CONTRACT_COST_PER_LEVEL = 50;
const REPAIR_COST = 75;

async function handle({ sock, msg, jid, sender, cmd, args, user }) {
  if (!user || !user.registered) {
    await sendText(sock, jid, `⚠️ Register first with *!register [name]*`, msg);
    return;
  }

  if (cmd === 'contract') return cmdContract({ sock, msg, jid, sender, args, user });
  if (cmd === 'repair') return cmdRepair({ sock, msg, jid, sender, args, user });
}

async function cmdContract({ sock, msg, jid, sender, args, user }) {
  const playerId = args[0];
  if (!playerId) {
    await sendText(sock, jid,
      `📝 *PLAYER CONTRACTS*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Renew a player's contract to keep them fit and motivated.\n\n` +
      `Usage: *!contract [id|name]*\n` +
      `Cost: 50 MW per player level\n\n` +
      `💡 Contracts boost condition and prevent morale loss.\n${BRAND}`, msg);
    return;
  }

  const player = Player.findByQuery(sender, playerId);
  if (!player) {
    await sendText(sock, jid, `❌ No player found for *${playerId}*. Use *!squad* to find IDs.`, msg);
    return;
  }

  const cost = CONTRACT_COST_PER_LEVEL * (player.level || 1);
  const u = User.getByWhatsappId(sender);
  if ((u.currency || 0) < cost) {
    await sendText(sock, jid, `❌ Contract renewal costs ${money(cost)} (Lv.${player.level}). You have ${money(u.currency)}.`, msg);
    return;
  }

  User.update(sender, { currency: (u.currency || 0) - cost });
  Player.update(player.id, { condition: Math.min(100, (player.condition || 50) + 30), form: 'Hot' });

  await sendText(sock, jid,
    `📝 *CONTRACT RENEWED!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚽ *${Player.displayName(player)}*\n` +
    `📅 Level: ${player.level} | Cost: ${money(cost)}\n` +
    `💚 Condition: ${Math.min(100, (player.condition || 50) + 30)}%\n` +
    `🔥 Form: Hot\n` +
    `💳 Balance: ${money((u.currency || 0) - cost)}\n${BRAND}`, msg);
}

async function cmdRepair({ sock, msg, jid, sender, args, user }) {
  const playerId = args[0];
  if (!playerId) {
    await sendText(sock, jid,
      `🔧 *PLAYER REPAIR*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Fix a player's condition back to 80%.\n\n` +
      `Usage: *!repair [id|name]*\n` +
      `Cost: ${money(REPAIR_COST)}\n\n` +
      `💡 Cheaper than !boost energy but restores less.\n${BRAND}`, msg);
    return;
  }

  const player = Player.findByQuery(sender, playerId);
  if (!player) {
    await sendText(sock, jid, `❌ No player found for *${playerId}*. Use *!squad* to find IDs.`, msg);
    return;
  }

  if ((player.condition || 0) >= 80) {
    await sendText(sock, jid, `✅ *${Player.displayName(player)}* is already at ${player.condition}% condition — no repair needed!`, msg);
    return;
  }

  const u = User.getByWhatsappId(sender);
  if ((u.currency || 0) < REPAIR_COST) {
    await sendText(sock, jid, `❌ Repair costs ${money(REPAIR_COST)}. You have ${money(u.currency)}.`, msg);
    return;
  }

  User.update(sender, { currency: (u.currency || 0) - REPAIR_COST });
  Player.update(player.id, { condition: 80 });

  await sendText(sock, jid,
    `🔧 *REPAIR COMPLETE!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚽ *${Player.displayName(player)}*\n` +
    `💚 Condition: 80%\n` +
    `💰 Cost: ${money(REPAIR_COST)}\n` +
    `💳 Balance: ${money((u.currency || 0) - REPAIR_COST)}\n${BRAND}`, msg);
}

module.exports = { handle };
