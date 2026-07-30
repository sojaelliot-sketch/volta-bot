// commands/chant.js
//   !chant — view your current chant
//   !chant set <text> — set a custom fan chant (costs 500 MW)
//   !chant clear — remove your chant
const User = require('../models/User');
const { sendText } = require('../utils/messaging');
const { BRAND } = require('../config/constants');

const CHANT_COST = 500;

async function handle({ sock, msg, jid, sender, args, user }) {
  if (!user || !user.registered) {
    await sendText(sock, jid, `❌ Register first with *!start*.`, msg);
    return;
  }

  const subcmd = (args[0] || '').toLowerCase();

  // !chant — view
  if (!subcmd) {
    if (user.chant) {
      await sendText(sock, jid,
        `📣 *YOUR FAN CHANT*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `_"${user.chant}"_\n\n` +
        `This plays during your big match moments!\n` +
        `💡 *!chant set <text>* to change (${CHANT_COST} MW)\n` +
        `💡 *!chant clear* to remove\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
    } else {
      await sendText(sock, jid,
        `📣 *FAN CHANTS*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `No chant set yet.\n\n` +
        `💡 *!chant set <text>* — set a custom chant (${CHANT_COST} MW)\n` +
        `Your chant auto-plays during big match moments!\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
    }
    return;
  }

  // !chant clear
  if (subcmd === 'clear') {
    User.update(sender, { chant: null });
    await sendText(sock, jid, `📣 Chant removed.`, msg);
    return;
  }

  // !chant set <text>
  if (subcmd === 'set') {
    const text = args.slice(1).join(' ').trim();
    if (!text) {
      await sendText(sock, jid, `⚠️ Usage: *!chant set <your chant text>*`, msg);
      return;
    }
    if (text.length > 100) {
      await sendText(sock, jid, `❌ Chant too long (max 100 characters).`, msg);
      return;
    }
    if ((user.currency || 0) < CHANT_COST) {
      await sendText(sock, jid, `❌ Setting a chant costs ${CHANT_COST} MW. You have ${user.currency || 0} MW.`, msg);
      return;
    }
    User.update(sender, { currency: (user.currency || 0) - CHANT_COST, chant: text });
    await sendText(sock, jid,
      `📣 *CHANT SET!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `_${text}_\n\n` +
      `Your fans will roar this during big moments!\n` +
      `Cost: ${CHANT_COST} MW\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
    return;
  }

  await sendText(sock, jid, `⚠️ Usage: *!chant* | *!chant set <text>* | *!chant clear*`, msg);
}

module.exports = { handle };
