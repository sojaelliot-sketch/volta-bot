// commands/give.js
//   !give [amount] @user   — send Metaworks to another manager
//   also works by replying to the recipient's message with !give [amount]
const User = require('../models/User');
const { money } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');

function looksLikeJid(arg) {
  if (!arg) return false;
  return /^\d{6,}$/.test(arg) || arg.includes('@');
}

async function handle({ sock, msg, jid, sender, args, replyTo, mentioned }) {
  const amount = parseInt(args[0], 10);
  if (!amount || amount <= 0) {
    await sendText(sock, jid, `⚠️ Usage: *!give [amount] @user*  (or reply to them with *!give [amount]*).`, msg);
    return;
  }

  // recipient: reply / mention preferred, else a jid passed as 2nd arg
  let targetJid = replyTo || mentioned;
  if (!targetJid && args[1] && looksLikeJid(args[1])) {
    targetJid = args[1].includes('@') ? args[1] : `${args[1]}@s.whatsapp.net`;
  }
  if (!targetJid) {
    await sendText(sock, jid, `⚠️ Tag or reply to the person you want to give Metaworks to.`, msg);
    return;
  }
  if (targetJid === sender) {
    await sendText(sock, jid, `😅 You can't give Metaworks to yourself!`, msg);
    return;
  }

  const me = User.getByWhatsappId(sender);
  const them = User.getByWhatsappId(targetJid);
  if (!me || !me.registered) {
    await sendText(sock, jid, `❌ You need to register first (*!start*).`, msg);
    return;
  }
  if (!them || !them.registered) {
    await sendText(sock, jid, `❌ That user isn't registered yet.`, msg);
    return;
  }
  if ((me.currency || 0) < amount) {
    await sendText(sock, jid, `❌ You only have *${money(me.currency)}*. Can't give *${money(amount)}*.`, msg);
    return;
  }

  User.update(sender, { currency: (me.currency || 0) - amount });
  User.update(targetJid, { currency: (them.currency || 0) + amount });

  await sendText(sock, jid,
    `💸 *Transfer complete!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `You sent *${money(amount)}* to *${them.name}*.\n` +
    `💰 New balance: *${money((me.currency || 0) - amount)}*`, msg, [targetJid]);
}

module.exports = { handle };
