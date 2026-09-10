'use strict';
// commands/password.js — !password / !setpass
//
//   !password <new>            set or change your own
//   !password                  guidance, plus a suggestion
//   !password @user <new>      owner only: reset someone else's
//
// The important change: a password typed in a GROUP has already been read by
// everyone in it. The old command happily accepted that and stored it. It now
// refuses, tells the player why, and points them at a direct message — because
// a password everyone saw is not a password.

const User = require('../models/User');
const { sendText } = require('../utils/messaging');
const { resolveTarget } = require('./router');
const ui = require('../utils/ui');
const pw = require('../utils/password');

const SITE_URL = (process.env.SITE_URL || 'https://voltabot1.netlify.app').replace(/\/$/, '');

async function handle({ sock, msg, jid, sender, args, replyTo, mentioned, user }) {
  const isGroup = jid.endsWith('@g.us');

  // Owner resetting somebody else's.
  const target = resolveTarget(args, { replyTo, mentioned });
  let passwordArg = args[0];
  let targetJid = sender;
  if (target && target !== sender) {
    if (!User.isOwner(sender)) {
      await sendText(sock, jid, ui.denied('Only the owner can reset another manager\'s password.'), msg);
      return;
    }
    passwordArg = args[1];
    targetJid = target;
  }

  // ── No password given: explain, and offer one ──
  if (!passwordArg) {
    const has = !!(user && user.passwordHash);
    await sendText(sock, jid, ui.card({
      icon: '🔑', title: has ? 'Change your password' : 'Set a password',
      lead: has
        ? 'You already have one. Send a new one to replace it.'
        : `A password lets you sign in at ${SITE_URL}.`,
      body: [
        '*Send it to me privately:*',
        '  !password yourNewPassword',
        '',
        `At least ${pw.MIN_LEN} characters. Mix letters, numbers and a symbol.`,
        '',
        `_Need one? Try:_ *${pw.suggest()}*`,
        '',
        '💡 Or skip passwords entirely — send *!site* and tap the link.',
      ],
    }), msg);
    return;
  }

  // ── Refuse to accept a password that a whole group just read ──
  if (isGroup && targetJid === sender) {
    await sendText(sock, jid, ui.card({
      icon: '⚠️', title: 'Everyone here just read that',
      lead: 'I have not saved it — a password the whole group has seen is not a password.',
      body: [
        'Delete that message, then send it to me in a *direct chat* instead.',
        '',
        'Easier still: send *!site* here and tap the link. No password needed.',
      ],
      brand: false,
    }), msg);
    return;
  }

  const verdict = pw.check(passwordArg);
  if (!verdict.ok) {
    await sendText(sock, jid, ui.problem(verdict.problem, `_Try something like:_ *${pw.suggest()}*`), msg);
    return;
  }

  const targetUser = User.getByWhatsappId(targetJid);
  if (!targetUser) {
    await sendText(sock, jid, ui.problem('That manager is not registered yet.'), msg);
    return;
  }

  User.update(targetJid, pw.make(passwordArg));

  if (targetJid !== sender) {
    await sendText(sock, jid, ui.good('Password reset',
      [`*${targetUser.name}* can now sign in with the password you set.`]), msg);
    try {
      await sendText(sock, targetJid, ui.card({
        icon: '🔑', title: 'Your password was reset',
        lead: 'The owner set a new password on your account.',
        body: [`Sign in at ${SITE_URL}`, '', 'Change it any time with *!password <new>* in this chat.'],
      }));
    } catch { /* their DM may be closed */ }
    return;
  }

  const bars = '▰'.repeat(verdict.score + 1) + '▱'.repeat(4 - verdict.score);
  await sendText(sock, jid, ui.card({
    icon: '🔐', title: 'Password saved',
    rows: [['Club', targetUser.name], ['Strength', `${bars}  ${verdict.label}`]],
    body: ['', `Sign in at ${SITE_URL}`],
    next: 'Or send !site for a one-tap link that skips the password.',
  }), msg);
}

module.exports = { handle };
