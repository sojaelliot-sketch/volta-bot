'use strict';
// utils/welcome.js — greeting someone who just joined the group.
//
// Two problems with the old version:
//
//   1. The tag never worked. It built "@Kano Kings" from the club NAME, but
//      WhatsApp only renders a mention when the text contains @<number> and the
//      jid is in the mentions array. So the new member was never actually
//      tagged and never notified — the greeting just scrolled past them.
//
//   2. It handed a stranger nine commands, three of which (!squad, !daily,
//      !auction) do nothing until they have registered. The first thing someone
//      sees should be ONE instruction.

const User = require('../models/User');
const { sendText } = require('./messaging');
const mentions = require('./mentions');
const { BRAND } = require('../config/constants');

// Rotated so a group adding ten people doesn't get the same line ten times.
const OPENERS = [
  'A new manager walks in.',
  'Look who just signed.',
  'Someone new at the door.',
  'Fresh blood.',
  'The squad grows.',
];

async function sendWelcomeMessage(sock, groupJid, userJid) {
  try {
    const meta = await sock.groupMetadata(groupJid).catch(() => null);
    const groupName = meta?.subject || 'the group';
    const user = User.getByWhatsappId(userJid);

    // A real tag: the @number in the body plus the jid in the mentions array.
    const tag = mentions.token(userJid);

    const opener = OPENERS[Math.floor(Math.random() * OPENERS.length)];
    const lines = [];

    if (user && user.registered) {
      // A returning manager already has a club — welcome them back, don't
      // explain the game to them.
      lines.push(`⚽ *${opener}*`);
      lines.push('');
      lines.push(`${tag} — *${user.name}* is back in ${groupName}.`);
      lines.push('');
      lines.push(`Send *!squad* to pick up where you left off.`);
    } else {
      lines.push(`⚽ *${opener}*`);
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push('');
      lines.push(`Welcome to *${groupName}*, ${tag}.`);
      lines.push('');
      lines.push('VOLTA is five-a-side football. You run a club: sign players,');
      lines.push('pick your four, and play other managers in this chat.');
      lines.push('');
      lines.push('*One thing to do:*');
      lines.push('   Send *!start* and I will hand you a squad.');
      lines.push('');
      lines.push('_I will walk you through the rest one step at a time._');
      lines.push('_No need to read anything._');
    }

    lines.push(BRAND);
    await sendText(sock, groupJid, lines.join('\n'), null, [userJid]);
  } catch (err) {
    try { require('./logger').error({ err, groupJid, userJid }, 'Welcome message failed'); } catch {}
  }
}

module.exports = { sendWelcomeMessage };
