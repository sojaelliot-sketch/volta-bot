// commands/subtract.js
//   !subtract [amount] @user   — staff: remove Metaworks from a manager
//   also works by replying to the target's message with !subtract [amount]
const User = require('../models/User');
const { money } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');
const { resolveTarget } = require('./router');

function canUse(sender) {
  if (User.isOwner(sender)) return true;
  const u = User.getByWhatsappId(sender);
  return User.roleRank(u?.role) >= User.roleRank('moderator');
}

async function handle({ sock, msg, jid, sender, args, replyTo, mentioned }) {
  if (!canUse(sender)) {
    await sendText(sock, jid, `⛔ Only Moderators, Officers and the Owner can use *!subtract*.`, msg);
    return;
  }

  const amount = parseInt(args[0], 10);
  if (!amount || amount <= 0) {
    await sendText(sock, jid, `⚠️ Usage: *!subtract [amount] @user*\nAlso works by replying to their message with *!subtract [amount]*.`, msg);
    return;
  }

  // target: reply / mention / name / explicit jid
  let targetJid = resolveTarget(args.slice(1), { replyTo, mentioned });
  if (!targetJid) {
    await sendText(sock, jid, `⚠️ Tag, reply to, or type the name of the manager to subtract from.`, msg);
    return;
  }

  const target = User.getByWhatsappId(targetJid);
  if (!target) {
    await sendText(sock, jid, `❌ No registered manager found for that target.`, msg);
    return;
  }
  if (!target.registered) {
    await sendText(sock, jid, `❌ *${target.name}* isn't registered.`, msg);
    return;
  }

  const before = target.currency || 0;
  if (before < amount) {
    await sendText(sock, jid,
      `❌ *${target.name}* only has *${money(before)}*. Can't subtract *${money(amount)}*.`, msg);
    return;
  }

  User.update(targetJid, { currency: before - amount });

  await sendText(sock, jid,
    `💸 *SUBTRACT*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `Target: *${target.name}*\n` +
    `Removed: *${money(amount)}*\n` +
    `Balance: *${money(before)}* → *${money(before - amount)}*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━`, msg, [targetJid]);
}

module.exports = { handle };
