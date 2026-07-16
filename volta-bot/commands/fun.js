// commands/fun.js
// Light mini-games so players can stack Metaworks themselves.
//   !slot [stake]     — emoji slot machine
//   !coinflip [amount] — 50/50 double-or-nothing
const User = require('../models/User');
const { SLOT, COINFLIP } = require('../config/constants');
const { pick } = require('../utils/random');
const { sendText } = require('../utils/messaging');

async function handle({ sock, msg, jid, sender, cmd, args }) {
  const user = User.getByWhatsappId(sender);
  if (!user || !user.registered) {
    await sendText(sock, jid, '❌ Register first! Type *!start*.', msg);
    return;
  }

  if (cmd === 'slot') {
    let stake = parseInt(args[0], 10);
    if (!stake || isNaN(stake)) stake = SLOT.COST;
    stake = Math.max(SLOT.COST, stake);
    if ((user.currency || 0) < stake) {
      await sendText(sock, jid, `❌ Need *${stake}* Metaworks to spin. You've got *${user.currency || 0}*.`, msg);
      return;
    }

    const reels = [pick(SLOT.EMOJIS), pick(SLOT.EMOJIS), pick(SLOT.EMOJIS)];
    const line = reels.join(' ');

    let mult = 0;
    let label = 'no luck';
    if (reels[0] === reels[1] && reels[1] === reels[2]) {
      mult = reels[0] === '7️⃣' ? SLOT.JACKPOT : SLOT.THREE_SAME;
      label = reels[0] === '7️⃣' ? '💥 *JACKPOT!*' : '✨ *TRIPLE!*';
    } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
      mult = SLOT.TWO_SAME;
      label = '😏 *TWO matching!*';
    }

    const payout = Math.round(stake * mult);
    const net = payout - stake;
    User.update(sender, { currency: (user.currency || 0) - stake + payout });

    await sendText(sock, jid,
      `🎰 *SPIN* (stake ${stake})\n━━━━━━━━━━━━━━━━━━━━━━━\n  ${line}\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${mult ? label + ` +${net} Metaworks` : `😬 Bust. -${stake} Metaworks`}\n` +
      `💳 Balance: *${User.getByWhatsappId(sender).currency}*`, msg);
    return;
  }

  if (cmd === 'coinflip' || cmd === 'flip') {
    let amount = parseInt(args[0], 10);
    if (!amount || isNaN(amount)) {
      await sendText(sock, jid, `⚠️ Usage: *!coinflip [amount]* — double or nothing!\n💡 Predict: *!coinflip [amount] heads|tails*`, msg);
      return;
    }
    amount = Math.max(COINFLIP.MIN, Math.min(COINFLIP.MAX, amount));
    if ((user.currency || 0) < amount) {
      await sendText(sock, jid, `❌ Need *${amount}* Metaworks to flip. You've got *${user.currency || 0}*.`, msg);
      return;
    }

    const face = Math.random() < 0.5 ? 'heads' : 'tails';
    const faceEmoji = face === 'heads' ? '👑 HEADS' : '🔻 TAILS';
    const pickFace = (args[1] || '').toLowerCase();
    const predicted = pickFace === 'heads' || pickFace === 'tails';
    const win = predicted ? (face === pickFace) : (Math.random() < 0.5);

    User.update(sender, { currency: (user.currency || 0) + (win ? amount : -amount) });
    const balance = User.getByWhatsappId(sender).currency;

    let head;
    if (predicted) {
      head = `🪙 *COIN FLIP* — you called *${pickFace.toUpperCase()}*\n🎲 The coin landed on *${faceEmoji}*`;
    } else {
      head = `🪙 *COIN FLIP* — the coin landed on *${faceEmoji}*`;
    }

    await sendText(sock, jid,
      `${head}\n` +
      (win
        ? `✅ *YOU WON!* +${amount} Metaworks! 🔥`
        : `❌ *YOU LOST!* -${amount} Metaworks. 😬`) +
      `\n💳 Balance: *${balance}*`, msg);
    return;
  }
}

module.exports = { handle };
