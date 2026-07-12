// commands/password.js
//   !password <newpassword>          — set / change YOUR web-app password
//   !password @user <newpassword>    — owner only: reset someone else's password
//
// The password is hashed with scrypt + a random salt and stored on the user
// doc (passwordHash / passwordSalt). It is used to log in to the VOLTA web
// app (web/server.js) where managers can manage their squad from a browser.
const crypto = require('crypto');
const User = require('../models/User');
const { sendText } = require('../utils/messaging');
const { resolveTarget } = require('./router');
const { BRAND } = require('../config/constants');

const MIN_LEN = 4;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, KEY_BYTES).toString('hex');
}
function newSalt() {
  return crypto.randomBytes(SALT_BYTES).toString('hex');
}
function verifyPassword(password, hashHex, saltHex) {
  if (!hashHex || !saltHex) return false;
  const computed = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), KEY_BYTES).toString('hex');
  // length-safe comparison
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hashHex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handle({ sock, msg, jid, sender, args, replyTo, mentioned }) {
  // owner resetting someone else's password (reply / mention + password)
  const target = resolveTarget(args, { replyTo, mentioned });
  let passwordArg;
  let targetJid = sender;

  if (target && target !== sender) {
    if (!User.isOwner(sender)) {
      await sendText(sock, jid, `🚫 Only the *owner* can reset another manager's password.`, msg);
      return;
    }
    passwordArg = args[1];
    targetJid = target;
  } else {
    passwordArg = args[0];
    targetJid = sender;
  }

  const pw = (passwordArg || '').trim();
  if (pw.length < MIN_LEN) {
    await sendText(sock, jid,
      `🔐 Set a password for the VOLTA web app.\n\n` +
      `*!password [password]*  (min ${MIN_LEN} chars)\n\n` +
      `Then log in at the web app with this password to manage your squad from a browser.`, msg);
    return;
  }

  const salt = newSalt();
  const hash = hashPassword(pw, Buffer.from(salt, 'hex'));
  User.update(targetJid, { passwordHash: hash, passwordSalt: salt });

  const who = targetJid === sender ? 'Your' : `*${targetJid}*'s`;
  await sendText(sock, jid,
    `🔐 ${who} web-app password is set!\n\n` +
    `🌐 Open the VOLTA web app and log in with this password to manage your team.\n` +
    `Powered by ${BRAND}`, msg);
}

// Exposed so the web server can verify passwords with the exact same algorithm.
module.exports = { handle, verifyPassword };
