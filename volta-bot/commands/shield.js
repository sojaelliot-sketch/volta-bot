// commands/shield.js
//   !shield — spend 1000 MW to protect your win streak from the next loss
const User = require('../models/User');
const { sendText } = require('../utils/messaging');
const { BRAND, ECONOMY } = require('../config/constants');

const SHIELD_COST = 1000;

async function handle({ sock, msg, jid, sender, user }) {
  if (!user || !user.registered) {
    await sendText(sock, jid, `❌ Register first with *!start*.`, msg);
    return;
  }

  if (user.streakShield) {
    await sendText(sock, jid,
      `🛡️ *STREAK SHIELD ACTIVE*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Your next loss won't break your win streak!\n` +
      `Win streak: ${user.winStreak || 0}\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
    return;
  }

  if ((user.winStreak || 0) < 3) {
    await sendText(sock, jid,
      `🛡️ You need at least a 3-win streak to buy a shield.\n` +
      `Current streak: ${user.winStreak || 0}`, msg);
    return;
  }

  if ((user.currency || 0) < SHIELD_COST) {
    await sendText(sock, jid,
      `❌ Streak Shield costs ${SHIELD_COST} MW. You have ${user.currency || 0} MW.`, msg);
    return;
  }

  User.update(sender, {
    currency: (user.currency || 0) - SHIELD_COST,
    streakShield: true,
  });

  await sendText(sock, jid,
    `🛡️ *STREAK SHIELD ACTIVATED!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `Cost: ${SHIELD_COST} MW\n` +
    `Win streak protected: ${user.winStreak} 🔥\n\n` +
    `Your next loss won't break the streak.\n` +
    `The shield breaks on use.\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
}

module.exports = { handle };
