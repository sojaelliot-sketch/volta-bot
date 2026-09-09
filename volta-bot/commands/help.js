'use strict';
// commands/help.js — !help
//
// Three levels, so nobody has to read 90 command names to find one thing:
//
//   !help          → the areas of the game, with what each is for
//   !help squad    → every command in that area, each with a line explaining it
//   !help card     → what that one command does, how to type it, an example
//
// It all renders from config/commandIndex.js. The old menu was hand-typed, so it
// drifted: it still advertised !loan maccept and !loan mpay long after those
// stopped being needed, and never mentioned commands added later.

const { sendText } = require('../utils/messaging');
const { sendChoice } = require('../utils/interactive');
const { BRAND } = require('../config/constants');
const User = require('../models/User');
const db = require('../config/database');
const { COMMANDS, CATEGORIES, resolve, byCategory } = require('../config/commandIndex');

function announcement() {
  try {
    return db.findById('leagues', 'announcement')?.message || null;
  } catch { return null; }
}

function accessOf(sender, user) {
  if (User.isOwner(sender)) return 'owner';
  try { if (User.isStaff(user)) return 'staff'; } catch { /* not staff */ }
  return 'all';
}

function topLevel(access) {
  const note = announcement();
  const out = [];
  out.push('⚽ *VOLTA SOCCER* — your club, your empire 🏆');
  out.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (note) { out.push(''); out.push(`📢 ${note}`); }
  out.push('');
  for (const [key, meta] of Object.entries(CATEGORIES)) {
    const cmds = byCategory(key, access);
    if (!cmds.length) continue;
    out.push(`${meta.icon} *${meta.name.toUpperCase()}*`);
    const names = cmds.map((c) => `!${c.name}`);
    let line = '';
    for (const n of names) {
      if (line && line.length + n.length + 1 > 48) { out.push(line); line = n; }
      else line = line ? `${line}  ${n}` : n;
    }
    if (line) out.push(line);
    out.push('');
  }
  out.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  out.push('✨ *Just arrived?*  !start  ·  !squad  ·  !play  ·  !daily  ·  !league');
  out.push('📖 *!help <area>* lists what each area does.');
  out.push('💡 Stuck on one command? _Try *!help borrow* or *!help chemistry*._');
  out.push(BRAND);
  return out.join('\n');
}

function category(key, access) {
  const meta = CATEGORIES[key];
  const cmds = byCategory(key, access);
  if (!meta || !cmds.length) return null;
  const out = [];
  out.push(`${meta.icon} *${meta.name.toUpperCase()}*`);
  out.push('━━━━━━━━━━━━━━━━━━━━━━━');
  out.push(`_${meta.blurb}_`);
  out.push('');
  for (const c of cmds) {
    out.push(`*!${c.name}*${c.access && c.access !== 'all' ? ` _(${c.access})_` : ''}`);
    out.push(`   ${c.s}`);
    if (c.u) out.push(`   ${c.u}`);
  }
  out.push('');
  out.push('━━━━━━━━━━━━━━━━━━━━━━━');
  out.push('*!help* for the other areas.');
  return out.join('\n');
}

function single(name) {
  const key = resolve(name);
  if (!key) return null;
  const c = COMMANDS[key];
  const meta = CATEGORIES[c.cat];
  const out = [];
  out.push(`*!${key}*`);
  out.push('━━━━━━━━━━━━━━━━━━━━━━━');
  out.push(c.s + '.');
  out.push('');
  out.push('*How to use it*');
  out.push(c.u || '!' + key);
  if (c.ex) { out.push(''); out.push('*Example*'); out.push(c.ex); }
  if (c.access && c.access !== 'all') {
    out.push('');
    out.push(`_${c.access === 'owner' ? 'Owner only.' : 'Staff only.'}_`);
  }
  out.push('');
  out.push(`_More like this: *!help ${c.cat}*._`);
  return out.join('\n');
}

// Suggest something rather than dead-ending on a typo.
function nearest(input) {
  const q = String(input || '').toLowerCase().replace(/^!/, '');
  if (!q) return [];
  const names = Object.keys(COMMANDS);
  const starts = names.filter((n) => n.startsWith(q.slice(0, 3)));
  const contains = names.filter((n) => n.includes(q) && !starts.includes(n));
  return [...starts, ...contains].slice(0, 4);
}

async function handle({ sock, msg, jid, sender, cmd, args, user }) {
  if (cmd === 'announce') {
    if (!User.isOwner(sender)) {
      await sendText(sock, jid, '⛔ *!announce* is owner-only.', msg);
      return;
    }
    const message = args.join(' ').trim();
    db.update('leagues', 'announcement', { message: message || null });
    await sendText(sock, jid,
      message ? `📢 Notice set — it now shows at the top of *!help*.\n\n${message}` : '📢 Notice cleared.', msg);
    return;
  }

  const access = accessOf(sender, user);
  const topic = (args[0] || '').toLowerCase().replace(/^!/, '');

  if (!topic) {
    await sendText(sock, jid, topLevel(access), msg);
    await sendChoice(sock, jid, {
      text: '*Jump straight in:*',
      footer: 'Or send !help <topic> for any area',
      choices: [
        { id: '!squad', label: 'My squad' },
        { id: '!play', label: 'Play a match' },
        { id: '!daily', label: 'Claim daily' },
      ],
    });
    return;
  }

  const cat = category(topic, access);
  if (cat) { await sendText(sock, jid, cat, msg); return; }

  const one = single(topic);
  if (one) { await sendText(sock, jid, one, msg); return; }

  const guesses = nearest(topic);
  await sendText(sock, jid,
    `❓ There's no *!${topic}*.\n` +
    (guesses.length ? `\nDid you mean: ${guesses.map((g) => `*!${g}*`).join('  ')}\n` : '') +
    `\nSend *!help* to see everything.`, msg);
}

module.exports = { handle, topLevel, category, single };
