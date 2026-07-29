const User = require('../models/User');
const { sendText } = require('../utils/messaging');
const { BRAND } = require('../config/constants');

const COOLDOWN_MS = 60_000;
const REWARD = 20;
const lastHustle = new Map();

async function handle({ sock, msg, jid, sender, user }) {
  if (!user || !user.registered) {
    await sendText(sock, jid, `👋 Register first with *!start*.`, msg);
    return;
  }

  const now = Date.now();
  const last = lastHustle.get(sender) || 0;
  if (now - last < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
    await sendText(sock, jid, `⏳ Rest a bit! You can hustle again in *${wait}s*.`, msg);
    return;
  }
  lastHustle.set(sender, now);

  User.update(sender, { currency: (user.currency || 0) + REWARD });

  const lines = [
    `💼 *HUSTLE!* You earned *${REWARD}* Metaworks 💰`,
    `   💰 Balance: ${(user.currency || 0) + REWARD}`,
    BRAND,
  ].join('\n');
  await sendText(sock, jid, lines, msg);
}

module.exports = { handle };