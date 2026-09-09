// commands/highlow.js
//   !highlow [stake]                 — start: reveals a number 1–9, then…
//   !highlow [higher|lower]          — guess using the number you were shown
//   !highlow [higher|lower] [stake]  — one-shot (legacy): pick + reveal at once
// A number 1–9 is shown. Guess whether the NEXT number (also 1–9) will be
// HIGHER or LOWER. Payout scales with the real probability so the house edge
// is a flat ~10% no matter which way you guess.
const User = require('../models/User');
const { HIGHLOW } = require('../config/constants');
const { randInt } = require('../utils/random');
const { sendText } = require('../utils/messaging');
const ui = require('../utils/ui');

const EMOJI = { higher: '⬆️', lower: '⬇️' };

// Two-step state: sender -> { first, stake, expires }
const pending = new Map();
const PENDING_TTL_MS = 5 * 60 * 1000;

function resolve(sender, first, dir, stake) {
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

  User.addCurrency(sender, net, { allowNegative: true });
  const balance = User.getByWhatsappId(sender).currency;
  const cash =
    outcome === 'win' ? `💰 *+${ui.money(net)}*  ·  ${mult.toFixed(2)}× on ${ui.money(stake)}`
    : outcome === 'lose' ? `💰 *-${ui.money(-net)}*`
    : `💰 Stake returned (${ui.money(stake)})`;

  return ui.card({
    icon: '🎲', title: 'High / Low',
    rows: [
      ['Number shown', first],
      ['You said', `${EMOJI[dir]} ${dir.toUpperCase()}`],
      ['Next number', next],
    ],
    body: [label, cash, `💳 Balance: *${ui.money(balance)}*`],
    next: 'Another spin? !highlow starts a fresh round.',
  });
}

async function handle({ sock, msg, jid, sender, cmd, args }) {
  const user = User.getByWhatsappId(sender);
  if (!user || !user.registered) {
    await sendText(sock, jid, '❌ Register first! Type *!start*.', msg);
    return;
  }

  const dir = (args[0] || '').toLowerCase();
  const isDir = dir === 'higher' || dir === 'lower';

  // ── Two-step completion: a number was already shown to this player ──
  if (isDir) {
    const p = pending.get(sender);
    if (p && p.expires > Date.now()) {
      pending.delete(sender);
      if ((p.first === 1 && dir === 'lower')) {
        await sendText(sock, jid, `🔢 Number is *1* — only *HIGHER* is possible. Your stake was refunded.`, msg);
        return;
      }
      if (p.first === 9 && dir === 'higher') {
        await sendText(sock, jid, `🔢 Number is *9* — only *LOWER* is possible. Your stake was refunded.`, msg);
        return;
      }
      await sendText(sock, jid, resolve(sender, p.first, dir, p.stake), msg);
      return;
    }
    // No pending game → legacy one-shot: dir + stake inline.
    let stake = parseInt(args[1], 10);
    if (!stake || isNaN(stake)) stake = HIGHLOW.MIN_STAKE;
    stake = Math.max(HIGHLOW.MIN_STAKE, Math.min(HIGHLOW.MAX_STAKE, stake));
    if ((user.currency || 0) < stake) {
      await sendText(sock, jid, `❌ Need *${ui.money(stake)}* to play. You've got *${ui.money(user.currency || 0)}*.`, msg);
      return;
    }
    const first = randInt(1, 9);
    if (first === 1 && dir === 'lower') {
      await sendText(sock, jid, `🔢 Number is *1* — only *HIGHER* is possible. Try *!highlow higher ${stake}*.`, msg);
      return;
    }
    if (first === 9 && dir === 'higher') {
      await sendText(sock, jid, `🔢 Number is *9* — only *LOWER* is possible. Try *!highlow lower ${stake}*.`, msg);
      return;
    }
    await sendText(sock, jid, resolve(sender, first, dir, stake), msg);
    return;
  }

  // ── Start a two-step game: reveal the number, ask for the guess ──
  let stake = parseInt(dir, 10); // dir was actually the stake here
  if (!stake || isNaN(stake)) stake = HIGHLOW.MIN_STAKE;
  stake = Math.max(HIGHLOW.MIN_STAKE, Math.min(HIGHLOW.MAX_STAKE, stake));
  if ((user.currency || 0) < stake) {
    await sendText(sock, jid, `❌ Need *${ui.money(stake)}* to play. You've got *${ui.money(user.currency || 0)}*.`, msg);
    return;
  }

  const first = randInt(1, 9);
  pending.set(sender, { first, stake, expires: Date.now() + PENDING_TTL_MS });

  await sendText(sock, jid, ui.card({
    icon: '🎲', title: 'High / Low',
    rows: [['Number shown', `*${first}*`]],
    body: [
      `Will the NEXT number (1–9) be *HIGHER* ⬆️ or *LOWER* ⬇️?`,
      `Reply  *!highlow higher*  or  *!highlow lower*`,
      `💰 Stake: *${ui.money(stake)}*`,
    ],
  }), msg);
}

module.exports = { handle };