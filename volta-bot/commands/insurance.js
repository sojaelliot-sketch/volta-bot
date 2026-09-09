const User = require('../models/User');
const Player = require('../models/Player');
const { SHOP, BRAND } = require('../config/constants');
const { money } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');

async function handle({ sock, msg, jid, sender, cmd, args, user }) {
  if (!user || !user.registered) {
    await sendText(sock, jid, `⚠️ Register first with *!register [name]*`, msg);
    return;
  }

  const playerId = args[0];
  if (!playerId) {
    await sendText(sock, jid,
      `🛡️ *PLAYER INSURANCE*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Protect a player from injury for 24 hours!\n\n` +
      `Usage: *!insurance [id|name]*\n` +
      `Cost: ${money(SHOP.INSURANCE_COST)} per player\n\n` +
      `💡 Insured players won't get injured during matches.\n${BRAND}`, msg);
    return;
  }

  const player = Player.findByQuery(sender, playerId);
  if (!player) {
    await sendText(sock, jid, `❌ No player found for *${playerId}*. Use *!squad* to find IDs.`, msg);
    return;
  }

  if (player.insuredUntil && new Date(player.insuredUntil).getTime() > Date.now()) {
    const expires = new Date(player.insuredUntil).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    await sendText(sock, jid, `✅ *${Player.displayName(player)}* is already insured until *${expires}*!`, msg);
    return;
  }

  const u = User.getByWhatsappId(sender);
  if ((u.currency || 0) < SHOP.INSURANCE_COST) {
    await sendText(sock, jid, `❌ Not enough! Insurance costs ${money(SHOP.INSURANCE_COST)}. You have ${money(u.currency)}.`, msg);
    return;
  }

  User.update(sender, { currency: (u.currency || 0) - SHOP.INSURANCE_COST });
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  Player.update(player.id, { insuredUntil: expiresAt.toISOString() });

  await sendText(sock, jid,
    `🛡️ *PLAYER INSURED!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚽ *${Player.displayName(player)}*\n` +
    `📅 Protected for 24 hours\n` +
    `💰 Cost: ${money(SHOP.INSURANCE_COST)}\n\n` +
    `This player won't get injured during matches until *${expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}*.\n${BRAND}`, msg);
}

module.exports = { handle };
