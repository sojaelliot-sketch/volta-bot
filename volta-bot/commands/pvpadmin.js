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
  const res = matchSession.clearAllPvP();
  await sendText(sock, jid,
    `🧹 *PvP MATCHES CLEARED*\n` +
    `━━━━━━━━━━━━━━\n` +
    `Cleared ${res.cleared} in-memory match(es) + all interactive chances and chat locks.\n` +
    `Healed ${res.healed} player(s) who were stuck *in match*.\n` +
    `Everyone can now start fresh matches. 🆚`, msg);
}

module.exports = { handle };
