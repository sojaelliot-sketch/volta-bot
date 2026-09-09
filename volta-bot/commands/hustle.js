const User = require('../models/User');
const { sendText } = require('../utils/messaging');
const ui = require('../utils/ui');
const { BRAND } = require('../config/constants');

const COOLDOWN_MS = 500 * 60 * 1000;
const REWARD = 2000;
// The cooldown used to be an in-memory Map, so every restart or crash handed
// everybody a fresh 2,000. It now lives on the user record.

async function handle({ sock, msg, jid, sender, user }) {
  if (!user || !user.registered) {
    await sendText(sock, jid, `👋 Register first with *!start*.`, msg);
    return;
  }

  const now = Date.now();
  const last = user.lastHustle ? new Date(user.lastHustle).getTime() : 0;
  if (now - last < COOLDOWN_MS) {
    const waitMs = COOLDOWN_MS - (now - last);
    const hrs = Math.floor(waitMs / 3600000);
    const mins = Math.ceil((waitMs % 3600000) / 60000);
    const waitTxt = hrs > 0 ? `*${hrs}h ${mins}m*` : `*${mins}m*`;
    await sendText(sock, jid, `⏳ Rest a bit! You can hustle again in ${waitTxt}.`, msg);
    return;
  }
  User.update(sender, { lastHustle: new Date(now).toISOString() });
  const res = User.addCurrency(sender, REWARD);

  await sendText(sock, jid, ui.card({
    icon: '💼', title: 'Hustle paid off',
    rows: [['Earned', `+${ui.money(REWARD)}`], ['Balance', ui.money(res.balance)]],
    next: 'Back again in a few hours.',
  }), msg);
}

module.exports = { handle };