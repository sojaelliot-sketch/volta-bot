// commands/give.js
//   !give [amount] @user   — send Metaworks to another manager
//   also works by replying to the recipient's message with !give [amount]
const User = require('../models/User');
const { money } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');
const ui = require('../utils/ui');
const mentions = require('../utils/mentions');
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
  if (!them) {
    await sendText(sock, jid, `❌ No manager found for that name/mention. Check the spelling or use @mention.`, msg);
    return;
  }
  if (!them.registered) {
    await sendText(sock, jid, `❌ *${them.name}* hasn't registered yet. They need to use *!start* first.`, msg);
    return;
  }
  // One atomic transfer. This used to be two separate writes, each computed
  // from a balance read earlier in the handler. If either account was touched
  // in between — a market sale settling, a second gift arriving — one of the
  // writes overwrote the other, destroying or conjuring currency.
  const result = User.transferCurrency(sender, targetJid, amount);
  if (!result.ok) {
    if (result.reason === 'insufficient') {
      await sendText(sock, jid, `❌ You only have *${money(result.balance)}*. Can't give *${money(amount)}*.`, msg);
    } else {
      await sendText(sock, jid, `❌ That transfer could not be completed. Nothing was taken from your account.`, msg);
    }
    return;
  }

  await sendText(sock, jid, ui.card({
    icon: '💸', title: 'Sent',
    lead: `${ui.money(amount)} to ${mentions.tag(targetJid, { name: them.name })}.`,
    rows: [['Your balance', ui.money(result.from)]],
    brand: false,
  }), msg, [targetJid]);
}

module.exports = { handle };
