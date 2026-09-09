// commands/wallet.js
//   !wallet  — show your currency balance + quick stats
const User = require('../models/User');
const { sendText } = require('../utils/messaging');
const ui = require('../utils/ui');

async function handle({ sock, msg, jid, sender }) {
  const u = User.getByWhatsappId(sender);
  if (!u || !u.registered) {
    await sendText(sock, jid, '❌ You need to register first! Type *!start*.', msg);
    return;
  }
  const text = ui.card({
    icon: '👛', title: `${u.name}'s wallet`,
    rows: [
      ['Balance', `💲${ui.money(u.currency)}`],
      ['MMR', `${u.mmr}  ·  ${u.rank}`],
      ['Record', `${u.wins}W · ${u.losses}L · ${u.draws}D`],
    ],
    next: '!daily for free Metaworks · !give to send some',
  });
  await sendText(sock, jid, text, msg);
}

module.exports = { handle };