// commands/setbounty.js
//   !setbounty [price] [@user|id]  — owner only: set a bounty on another manager.
//   The bounty is stored on the target's user doc; when they are defeated in a
//   PvP match, the winner claims the bounty. (Payout wiring lives in the match
//   engine; this command manages the bounty amount.)
const User = require('../models/User');
const { money } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');

function toJid(arg) {
  const a = (arg || '').trim();
  if (!a) return null;
  return a.includes('@') ? a : `${a}@s.whatsapp.net`;
}

async function handle({ sock, msg, jid, sender, args, replyTo, mentioned }) {
  if (!User.isOwner(sender)) {
    await sendText(sock, jid, `⛔ *!setbounty* is owner-only.`, msg);
    return;
  }
  const price = parseInt(args[0], 10);
  if (!price || price <= 0) {
    await sendText(sock, jid, `⚠️ Usage: *!setbounty [price] [@user or reply]*`, msg);
    return;
  }

  let target = replyTo || mentioned;
  if (!target && args[1] && /^\d{6,}$/.test(args[1])) target = toJid(args[1]);
  else if (!target && args[1] && args[1].includes('@')) target = args[1];

  if (!target) {
    await sendText(sock, jid, `⚠️ Tag, reply to, or give the id of the manager you're putting a bounty on.`, msg);
    return;
  }
  const u = User.getByWhatsappId(target);
  if (!u || !u.registered) {
    await sendText(sock, jid, `❌ No registered manager found for that target.`, msg);
    return;
  }

  User.update(target, { bounty: price });
  await sendText(sock, jid,
    `🎯 Bounty of *${money(price)}* placed on *${u.name}*! Beat them in a PvP match to claim it. 💰`, msg, [target]);
}

module.exports = { handle };
