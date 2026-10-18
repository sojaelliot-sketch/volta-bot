'use strict';
// utils/pairing.js — helpers for WhatsApp login (pairing code / QR).
//
// Kept free of any socket code so every rule here can be unit-tested
// (see test_pairing.js) without touching WhatsApp.

const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ *
 * Phone number normalisation
 * ------------------------------------------------------------------ */

/**
 * Turn whatever the user typed into the digits WhatsApp expects:
 * country code + national number, no +, no spaces, no trunk "0".
 *
 * Common mistakes this repairs (each one makes WhatsApp silently refuse
 * the code, or send it to a number that does not exist):
 *   08012345678        -> 2348012345678   (local format, leading 0)
 *   +234 0801 234 5678 -> 2348012345678   (country code AND the trunk 0)
 *   002348012345678    -> 2348012345678   (00 international prefix)
 *
 * The local-format repair uses DEFAULT_COUNTRY_CODE (default 234, Nigeria).
 *
 * @returns {{ number: string, note?: string } | { error: string }}
 */
function normaliseNumber(input, defaultCC = process.env.DEFAULT_COUNTRY_CODE || '234') {
  const cc = String(defaultCC || '').replace(/\D/g, '');
  let digits = String(input || '').replace(/\D/g, '');
  const notes = [];
  if (!digits) return { error: 'No number given.' };

  if (digits.startsWith('00')) digits = digits.slice(2);

  // Local format: 0801... -> 234801...
  if (digits.startsWith('0')) {
    if (!cc) {
      return { error: 'That is a local number (starts with 0). Add your country code and drop the 0, e.g. 2348012345678.' };
    }
    digits = cc + digits.replace(/^0+/, '');
    notes.push(`added country code ${cc} and dropped the leading 0`);
  } else if (cc && digits.startsWith(cc + '0')) {
    // 2340801... -> 234801...
    digits = cc + digits.slice(cc.length + 1);
    notes.push('dropped the 0 that came after the country code');
  }

  // Nigeria has a fixed length, so we can catch typos before WhatsApp does.
  if (digits.startsWith('234') && digits.length !== 13) {
    return { error: `Nigerian numbers are 234 + 10 digits (13 in total). "${digits}" has ${digits.length}.` };
  }

  // E.164: max 15 digits; anything under 8 is not a real mobile number.
  if (digits.length < 8 || digits.length > 15) {
    return { error: `"${digits}" is ${digits.length} digits — a full international number is 8 to 15.` };
  }

  return notes.length ? { number: digits, note: notes.join('; ') } : { number: digits };
}

/* ------------------------------------------------------------------ *
 * Session state
 * ------------------------------------------------------------------ */

/**
 * Is this device actually linked to a WhatsApp account?
 *
 * NOT `creds.registered`. Baileys only sets `registered = true` in the
 * pairing-CODE flow, and sets it before the link is complete. A session linked
 * by QR keeps `registered: false` for ever. The old check therefore treated
 * every QR-linked session as unlinked: it warned the user to delete a working
 * session, and on every start it fired requestPairingCode() at a logged-in
 * socket, which overwrote creds.me and corrupted the session.
 *
 * `creds.account` is written by pair-success, which is the final step of BOTH
 * flows, so it is the reliable marker.
 */
function isLinked(creds) {
  return !!(creds && creds.account && creds.me && creds.me.id);
}

/**
 * Inspect the auth folder without loading Baileys.
 * @returns {'empty'|'linked'|'unlinked'|'corrupt'}
 */
function sessionState(dir) {
  try {
    if (!fs.existsSync(dir)) return 'empty';
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) return 'empty';
    const credsPath = path.join(dir, 'creds.json');
    if (!fs.existsSync(credsPath)) return 'corrupt';
    let creds;
    try { creds = JSON.parse(fs.readFileSync(credsPath, 'utf8')); } catch { return 'corrupt'; }
    return isLinked(creds) ? 'linked' : 'unlinked';
  } catch {
    return 'corrupt';
  }
}

/**
 * Move a dead / half-linked session out of the way so the next attempt starts
 * clean. It is renamed, not deleted, in case it is ever needed again.
 * @returns {string|null} where it went, or null if there was nothing to move
 */
function archiveSession(dir) {
  if (!fs.existsSync(dir)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${dir.replace(/[\\/]+$/, '')}_old_${stamp}`;
  try {
    fs.renameSync(dir, dest);
    return dest;
  } catch {
    // Windows can refuse a rename while a file is briefly locked — fall back to delete.
    try { fs.rmSync(dir, { recursive: true, force: true }); return '(deleted)'; } catch { return null; }
  }
}

/** "ABCD1234" -> "ABCD-1234" */
function formatCode(code) {
  const s = String(code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return (s.match(/.{1,4}/g) || [s]).join('-');
}

module.exports = { normaliseNumber, isLinked, sessionState, archiveSession, formatCode };
