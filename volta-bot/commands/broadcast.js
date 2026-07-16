// commands/broadcast.js
//   !broadcast [message]  — owner + officer: send a message to every group the bot is in
const User = require('../models/User');
const { BRAND } = require('../config/constants');
const { sendText } = require('../utils/messaging');

async function handle({ sock, msg, jid, sender, args }) {
  if (!User.isOwner(sender)) {
    const u = User.getByWhatsappId(sender);
    if (User.roleRank(u?.role) < User.roleRank('officer')) {
      await sendText(sock, jid, `⛔ Only the *Owner* and *Officers* can broadcast.`, msg);
      return;
    }
  }
  const text = args.join(' ').trim();
  if (!text) {
    await sendText(sock, jid, `📣 Usage: *!broadcast [message]* — sends to every group the bot is in.`, msg);
    return;
  }

  let groups = [];
  try {
    groups = await sock.groupFetchAllParticipating();
  } catch {
    groups = {};
  }
  const ids = Object.keys(groups);
  let sent = 0;
  const payload =
    `📣 *BROADCAST* 📣\n━━━━━━━━━━━━━━━━━━━━━━━\n${text}\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`;

  for (const g of ids) {
    try {
      await sock.sendMessage(g, { text: payload });
      sent++;
    } catch {
      // ignore groups we can't reach
    }
  }

  await sendText(sock, jid,
    `📣 Broadcast sent to *${sent}* group(s).\n${BRAND}`, msg);
}

module.exports = { handle };
