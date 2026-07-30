// commands/trade.js
//   !trade @user <your card> <their card> — propose a trade
//   !trade accept — accept a pending trade
//   !trade cancel — cancel a pending trade
const User = require('../models/User');
const Player = require('../models/Player');
const db = require('../config/database');
const { sendText } = require('../utils/messaging');
const { resolveTarget } = require('./router');
const { BRAND } = require('../config/constants');

function findUserPlayer(user, shortArg) {
  if (!shortArg) return null;
  const all = [...(user.startingXI || []), ...(user.bench || []), ...(user.reserves || [])];
  return all.find((id) => id.toLowerCase().startsWith(shortArg.toLowerCase())) || null;
}

async function handle({ sock, msg, jid, sender, args, replyTo, mentioned }) {
  const user = User.getByWhatsappId(sender);
  if (!user || !user.registered) {
    await sendText(sock, jid, `❌ You need to register first (*!start*).`, msg);
    return;
  }

  const subcmd = (args[0] || '').toLowerCase();

  // !trade accept
  if (subcmd === 'accept') {
    const pending = db.findOne('social', (s) => s.type === 'trade' && s.to === sender && s.status === 'pending');
    if (!pending) {
      await sendText(sock, jid, `❌ No pending trade offers.`, msg);
      return;
    }
    const fromUser = User.getByWhatsappId(pending.from);
    if (!fromUser) {
      await sendText(sock, jid, `❌ The trader is no longer registered.`, msg);
      return;
    }
    // Verify both cards still exist
    const myCard = Player.getById(pending.theirCard);
    const theirCard = Player.getById(pending.yourCard);
    if (!myCard || myCard.owner !== sender) {
      await sendText(sock, jid, `❌ You no longer have *${pending.theirCard}*.`, msg);
      return;
    }
    if (!theirCard || theirCard.owner !== pending.from) {
      await sendText(sock, jid, `❌ They no longer have *${pending.yourCard}*.`, msg);
      return;
    }

    // Execute trade — swap owners
    Player.update(pending.theirCard, { owner: pending.from });
    Player.update(pending.yourCard, { owner: sender });

    // Swap in squads
    const removeFromUser = (u, id) => {
      for (const arr of ['startingXI', 'bench', 'reserves']) {
        const idx = (u[arr] || []).indexOf(id);
        if (idx !== -1) { u[arr].splice(idx, 1); return true; }
      }
      return false;
    };
    removeFromUser(user, pending.theirCard);
    removeFromUser(fromUser, pending.yourCard);
    user.reserves = [...(user.reserves || []), pending.yourCard];
    fromUser.reserves = [...(fromUser.reserves || []), pending.theirCard];
    User.update(sender, { reserves: user.reserves });
    User.update(pending.from, { reserves: fromUser.reserves });

    pending.status = 'completed';
    db.update('social', pending.key, { status: 'completed' });

    const theirName = User.getByWhatsappId(pending.from);
    await sendText(sock, jid,
      `✅ *TRADE COMPLETE!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `You gave: *${theirCard.name}* (${pending.theirCard})\n` +
      `You got: *${myCard.name}* (${pending.yourCard})\n` +
      `with ${theirName?.name || '???'}\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
    return;
  }

  // !trade cancel
  if (subcmd === 'cancel') {
    const pending = db.findOne('social', (s) => s.type === 'trade' && (s.from === sender || s.to === sender) && s.status === 'pending');
    if (!pending) {
      await sendText(sock, jid, `❌ No pending trade to cancel.`, msg);
      return;
    }
    pending.status = 'cancelled';
    db.update('social', pending.key, { status: 'cancelled' });
    await sendText(sock, jid, `🚫 Trade cancelled.`, msg);
    return;
  }

  // !trade @user <your card> <their card>
  const targetJid = resolveTarget(args, { replyTo, mentioned });
  if (!targetJid || targetJid === sender) {
    await sendText(sock, jid, `⚠️ Usage: *!trade @user <your card> <their card>*\nOr *!trade accept* / *!trade cancel*`, msg);
    return;
  }

  const target = User.getByWhatsappId(targetJid);
  if (!target) {
    await sendText(sock, jid, `❌ Manager not found.`, msg);
    return;
  }

  // Find the card args — skip the first arg which is the target
  const cardArgs = args.filter((a) => !a.startsWith('@') && !a.includes('@'));
  if (cardArgs.length < 2) {
    await sendText(sock, jid, `⚠️ Usage: *!trade @user <your card> <their card>*`, msg);
    return;
  }

  const myCardId = findUserPlayer(user, cardArgs[0]);
  const theirCardId = findUserPlayer(target, cardArgs[1]);

  if (!myCardId) {
    await sendText(sock, jid, `❌ You don't have a card matching *${cardArgs[0]}*. Check *!squad*.`, msg);
    return;
  }
  if (!theirCardId) {
    await sendText(sock, jid, `❌ They don't have a card matching *${cardArgs[1]}*.`, msg);
    return;
  }

  const myCard = Player.getById(myCardId);
  const theirCard = Player.getById(theirCardId);

  // Create pending trade
  const tradeKey = `trade_${Date.now()}_${sender}`;
  const trade = {
    type: 'trade',
    key: tradeKey,
    from: sender,
    to: targetJid,
    yourCard: myCardId,
    theirCard: theirCardId,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  db.insert('social', tradeKey, trade);

  await sendText(sock, jid,
    `🤝 *TRADE PROPOSAL*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `To: *${target.name}*\n\n` +
    `You offer: *${myCard?.name || myCardId}* (${myCardId})\n` +
    `You want: *${theirCard?.name || theirCardId}* (${theirCardId})\n\n` +
    `They reply *!trade accept* to confirm.\n` +
    `Either side can *!trade cancel*.\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
}

module.exports = { handle };
