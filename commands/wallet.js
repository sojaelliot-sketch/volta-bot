// commands/wallet.js
//   !wallet  — show your currency balance + quick stats
const User = require('../models/User');
const { money } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');

async function handle({ sock, msg, jid, sender }) {
  const u = User.getByWhatsappId(sender);
  if (!u || !u.registered) {
    await sendText(sock, jid, '❌ You need to register first! Type *!start*.', msg);
    return;
  }
  const text =
    `👛 *${u.name}'s WALLET*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 Balance: *${money(u.currency)}*\n` +
    `🏆 MMR: ${u.mmr} (${u.rank})\n` +
    `⚔️ ${u.wins}W ${u.losses}L ${u.draws}D\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💡 *!give [amount] @user* — send Metaworks\n` +
    `💡 *!daily* — free Metaworks`;
  await sendText(sock, jid, text, msg);
}

module.exports = { handle };
