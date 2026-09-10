'use strict';
// utils/password.js — one place for password handling.
//
// The hashing was written twice: once in commands/password.js and again in
// web/server.js. Two copies of a security routine is one copy too many — if
// either had drifted (a different key length, a different salt encoding),
// passwords set on one side would silently stop working on the other.

const crypto = require('crypto');

const MIN_LEN = 6;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

function newSalt() { return crypto.randomBytes(SALT_BYTES).toString('hex'); }

function hash(password, saltHex) {
  return crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), KEY_BYTES).toString('hex');
}

function verify(password, hashHex, saltHex) {
  if (!hashHex || !saltHex || !password) return false;
  try {
    const computed = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), KEY_BYTES).toString('hex');
    const a = Buffer.from(computed, 'hex');
    const b = Buffer.from(hashHex, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

/** Produce { salt, hash } for storing on the user record. */
function make(password) {
  const salt = newSalt();
  return { passwordSalt: salt, passwordHash: hash(password, salt) };
}

// A short list of the passwords people actually pick. Not a security control on
// its own — just enough to stop the worst choices with a helpful message.
const OBVIOUS = new Set([
  'password', 'passw0rd', '123456', '1234567', '12345678', '123456789', 'qwerty',
  'abc123', 'football', 'letmein', 'iloveyou', 'admin', 'welcome', '000000',
  '111111', 'volta', 'volta123', 'whatsapp', 'chelsea', 'arsenal', 'barcelona',
]);

/**
 * Judge a password and say what is wrong in words a player can act on.
 * Returns { ok, score 0-4, label, problem }.
 */
function check(password) {
  const p = String(password || '');
  if (p.length < MIN_LEN) {
    return { ok: false, score: 0, label: 'too short',
      problem: `Passwords need at least ${MIN_LEN} characters. That one has ${p.length}.` };
  }
  if (p.length > 128) {
    return { ok: false, score: 0, label: 'too long', problem: 'Keep it under 128 characters.' };
  }
  if (OBVIOUS.has(p.toLowerCase())) {
    return { ok: false, score: 0, label: 'too common',
      problem: 'That is one of the first passwords anyone would guess. Pick something else.' };
  }
  if (/^(.)\1+$/.test(p)) {
    return { ok: false, score: 0, label: 'too simple',
      problem: 'That is the same character repeated. Mix it up.' };
  }

  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 12) score++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
  if (/\d/.test(p)) score++;
  if (/[^A-Za-z0-9]/.test(p)) score++;
  score = Math.min(4, score);

  const label = ['weak', 'weak', 'okay', 'good', 'strong'][score];
  return { ok: true, score, label, problem: null };
}

/** A memorable suggestion, for players who ask for one. */
function suggest() {
  const words = ['pitch', 'striker', 'corner', 'volley', 'header', 'keeper', 'winger',
    'tackle', 'dribble', 'stadium', 'whistle', 'penalty', 'offside', 'chant'];
  const pick = (a) => a[crypto.randomInt(a.length)];
  const n = crypto.randomInt(10, 100);
  const sym = pick(['!', '#', '-', '.', '*']);
  return `${pick(words)}${sym}${pick(words)}${n}`;
}

module.exports = { MIN_LEN, make, hash, verify, check, suggest, newSalt };
