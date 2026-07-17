// commands/give.js
//   !give [amount] @user   — send Metaworks to another manager
//   also works by replying to the recipient's message with !give [amount]
const User = require('../models/User');
const { money } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');
const { resolveTarget } = require('./router');

async function handle({ sock, msg, jid, sender, args, replyTo, mentioned }) {
  const amount = parseInt(args[0], 10);
  if (!amount || amount <= 0) {
    await sendText(sock, jid, `⚠️ Usage: *!give [amount] @user*  (reply, @mention, or type their name).`, msg);
    return;
  }

  // recipient: reply / mention / name / explicit jid as 2nd arg
  let targetJid = resolveTarget(args.slice(1), { replyTo, mentioned });
  if (!targetJid) {
    await sendText(sock, jid, `⚠️ Tag, reply to, or type the name of the person you want to give Metaworks to.`, msg);
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
