// commands/highlow.js
//   !highlow [higher|lower] [stake]   — alias: !hl
// A number 1–9 is shown. Guess whether the NEXT number (also 1–9) will be
// HIGHER or LOWER. Payout scales with the real probability so the house edge
// is a flat ~10% no matter which way you guess.
const User = require('../models/User');
const { HIGHLOW } = require('../config/constants');
const { money } = require('../utils/formatter');
const { randInt } = require('../utils/random');
const { sendText } = require('../utils/messaging');

const EMOJI = {
  higher: '⬆️',
  lower: '⬇️',
};

async function handle({ sock, msg, jid, sender, cmd, args }) {
  const user = User.getByWhatsappId(sender);
  if (!user || !user.registered) {
    await sendText(sock, jid, '❌ Register first! Type *!start*.', msg);
    return;
  }

  const dir = (args[0] || '').toLowerCase();
  if (dir !== 'higher' && dir !== 'lower') {
    await sendText(sock, jid,
      `🎲 *HIGH / LOW*\n━━━━━━━━━━━━━━\n` +
      `A number 1–9 is shown. Guess if the NEXT number is *higher* or *lower*!\n\n` +
      `🎯 *!highlow [higher|lower] [stake]*\n` +
      `Example: *!highlow higher 50*\n\n` +
      `💡 Payout is based on the real odds — pick smart!`, msg);
    return;
  }

  let stake = parseInt(args[1], 10);
  if (!stake || isNaN(stake)) stake = HIGHLOW.MIN_STAKE;
  stake = Math.max(HIGHLOW.MIN_STAKE, Math.min(HIGHLOW.MAX_STAKE, stake));
  if ((user.currency || 0) < stake) {
    await sendText(sock, jid, `❌ Need *${money(stake)}* to play. You've got *${money(user.currency || 0)}*.`, msg);
    return;
  }

  const first = randInt(1, 9);

  // Impossible bets — nudge the player to the only valid call.
  if (first === 1 && dir === 'lower') {
    await sendText(sock, jid, `🔢 Number is *1* — only *HIGHER* is possible. Try *!highlow higher ${stake}*.`, msg);
    return;
  }
  if (first === 9 && dir === 'higher') {
    await sendText(sock, jid, `🔢 Number is *9* — only *LOWER* is possible. Try *!highlow lower ${stake}*.`, msg);
    return;
  }

  const winProb = dir === 'higher' ? (9 - first) / 9 : (first - 1) / 9;
  const mult = (1 / winProb) * (1 - HIGHLOW.HOUSE_EDGE);
  const next = randInt(1, 9);

  let outcome, net, label;
  if (next === first) {
    outcome = 'tie'; net = 0; label = '😐 *SAME NUMBER!* Stake returned.';
  } else if ((dir === 'higher' && next > first) || (dir === 'lower' && next < first)) {
    outcome = 'win'; net = Math.round(stake * mult) - stake; label = `✅ *${dir.toUpperCase()}!* You called it!`;
  } else {
    outcome = 'lose'; net = -stake; label = `❌ *${dir === 'higher' ? 'LOWER' : 'HIGHER'}!* Unlucky.`;
  }

  User.update(sender, { currency: (user.currency || 0) + net });

  const balance = User.getByWhatsappId(sender).currency;
  let resultLine;
  if (outcome === 'win') resultLine = `💰 *+${money(net)}*  (${mult.toFixed(2)}×)`;
  else if (outcome === 'lose') resultLine = `💰 *-${money(-net)}*`;
  else resultLine = `💰 Stake returned (${money(stake)})`;

  await sendText(sock, jid,
    `🎲 *HIGH / LOW*\n━━━━━━━━━━━━━━\n` +
    `🔢 Number: *${first}*\n` +
    `${EMOJI[dir]} You said: *${dir.toUpperCase()}*\n` +
    `🔄 Next number: *${next}*\n` +
    `${label}\n\n` +
    `${resultLine}\n` +
    `💳 Balance: *${money(balance)}*`, msg);
}

module.exports = { handle };
