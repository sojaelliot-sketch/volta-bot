'use strict';
// utils/mentions.js
//
// WhatsApp renders a tag only when BOTH of these are true:
//
//   1. the message body contains the literal token  @<number>   (no + or suffix)
//   2. that number's full jid appears in the message's `mentions` array
//
// Miss either and you get plain text with no highlight and no notification.
//
// The bot was missing the first half. Commands like !give passed
// `[targetJid]` as mentions but wrote the person's *name* in the body, so
// WhatsApp received a mentions array that matched nothing in the text. Nobody
// was ever actually tagged, and nobody got pinged — which is why people missed
// their challenges and loan offers.
//
// This module keeps the two halves together so they cannot drift apart.

const User = require('../models/User');

/** Digits of a jid: '2348012345678@s.whatsapp.net' -> '2348012345678'. */
function numberOf(jid) {
  if (!jid) return '';
  return String(jid).split('@')[0].split(':')[0].replace(/\D/g, '');
}

/** The token that must appear in the body for a tag to render. */
function token(jid) {
  const n = numberOf(jid);
  return n ? `@${n}` : '';
}

/**
 * Build a body fragment that tags someone.
 *
 * WhatsApp will not show a display name in place of the number, so putting the
 * club name next to the tag is the only way to get both readability and a real
 * notification:  "Kano Kings (@2348012345678)"
 *
 * Pass { bare: true } when the tag alone reads better.
 */
function tag(jid, { name = null, bare = false } = {}) {
  const t = token(jid);
  if (!t) return name || 'someone';
  if (bare) return t;
  const label = name || (User.getByWhatsappId(jid)?.name);
  return label ? `*${label}* ${t}` : t;
}

/**
 * Collect every jid that the body actually tags.
 *
 * Deriving this FROM the text rather than trusting the caller is the whole
 * point: the array can never list someone the body does not mention, and it can
 * never miss someone the body does.
 */
function collect(text, extraJids = []) {
  const found = new Set();
  const body = String(text || '');
  for (const m of body.matchAll(/@(\d{6,20})\b/g)) {
    found.add(`${m[1]}@s.whatsapp.net`);
  }
  // A caller may add jids explicitly, but only if the body really tags them.
  for (const jid of extraJids || []) {
    const n = numberOf(jid);
    if (n && body.includes(`@${n}`)) found.add(`${n}@s.whatsapp.net`);
  }
  return [...found];
}

/**
 * Everyone in a group, for an @everyone style announcement.
 * Returns { text, mentions } — never call this casually, it pings the room.
 */
async function everyone(sock, groupJid, body) {
  try {
    const meta = await sock.groupMetadata(groupJid);
    const jids = (meta.participants || []).map((p) => p.id).filter(Boolean);
    const tags = jids.map((j) => token(j)).filter(Boolean).join(' ');
    return { text: `${body}\n\n${tags}`, mentions: jids };
  } catch {
    return { text: body, mentions: [] };
  }
}

module.exports = { numberOf, token, tag, collect, everyone };
