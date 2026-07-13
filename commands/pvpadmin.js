// commands/pvpadmin.js
//   !clearpvp — force-clear every stuck/in-progress PvP match (owner + staff)
const User = require('../models/User');
const matchSession = require('../game-engine/matchSession');
const { sendText } = require('../utils/messaging');

async function handle({ sock, msg, jid, sender, user }) {
  if (!User.isOwner(sender) && !User.isStaff(user)) {
    await sendText(sock, jid, `⛔ *!clearpvp* is owner/staff only.`, msg);
    return;
  }
  const cleared = matchSession.clearAllPvP();
  await sendText(sock, jid,
    `🧹 *PvP MATCHES CLEARED*\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Cleared ${cleared} active PvP match(es), all interactive chances, and the chat locks they held.\n` +
    `Players can now start fresh matches. 🆚`, msg);
}

module.exports = { handle };
