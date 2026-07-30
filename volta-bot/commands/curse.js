// commands/curse.js
//   !curse @user — cosmetic hex on a rival (flavor only, no stat effect)
const User = require('../models/User');
const { sendText } = require('../utils/messaging');
const { resolveTarget } = require('./router');
const { BRAND } = require('../config/constants');

const CURSES = [
  { name: 'The Wooden Foot Curse', text: '🪵 May your strikers develop wooden feet and sky every shot!', fail: 'The curse fizzles — their striker just scored a screamer!' },
  { name: 'The Goalkeeper\'s Nightmare', text: '🧤 May your keeper see ghosts in the net!', fail: 'Their keeper just made a world-class save — the curse backfired!' },
  { name: 'The Offside Trap', text: '🚩 May every attack end with an offside flag!', fail: 'The ref didn\'t blow — their goal stands! Curse failed!' },
  { name: 'The Post Curse', text: '🥅 May the woodwork be their worst enemy!', fail: 'The post just saved them! Your curse is useless!' },
  { name: 'The Momentum Drain', text: '📉 May your momentum drain like a leaking balloon!', fail: 'They just scored — momentum is THROUGH THE ROOF! Curse: FAILED.' },
  { name: 'The Red Card Hex', text: '🟥 May the ref reach for his pocket... often!', fail: 'The ref waves play on — clean tackling! Your hex did nothing!' },
  { name: 'The Rain Dance', text: '🌧️ May a sudden downpour ruin your perfectly polished boots!', fail: 'The sun comes out! Your rain dance was just a funny dance!' },
  { name: 'The Commentator\'s Curse', text: '🎙️ "And they\'ve surely got this in the bag now!" (commentator\'s curse activated)', fail: 'The commentator says "They look UNSTOPPABLE today!" — curse reversed!' },
];

async function handle({ sock, msg, jid, sender, args, replyTo, mentioned }) {
  const user = User.getByWhatsappId(sender);
  if (!user || !user.registered) {
    await sendText(sock, jid, `❌ Register first with *!start*.`, msg);
    return;
  }

  const targetJid = resolveTarget(args, { replyTo, mentioned });
  if (!targetJid || targetJid === sender) {
    await sendText(sock, jid, `⚠️ Usage: *!curse @user* — cast a harmless hex on a rival.`, msg);
    return;
  }

  const target = User.getByWhatsappId(targetJid);
  if (!target) {
    await sendText(sock, jid, `❌ Manager not found.`, msg);
    return;
  }

  const curse = CURSES[Math.floor(Math.random() * CURSES.length)];
  const failed = Math.random() < 0.4; // 40% chance to fail spectacularly

  await sendText(sock, jid,
    `🔮 *CURSE CAST!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${user.name} casts *${curse.name}* on ${target.name}!\n\n` +
    `${curse.text}\n\n` +
    (failed ? `💥 *CURSE FAILED!*\n${curse.fail}\n` : `😏 The dark magic hangs in the air...\n`) +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `_No actual effects were harmed in the casting of this curse._\n${BRAND}`, msg);
}

module.exports = { handle };
