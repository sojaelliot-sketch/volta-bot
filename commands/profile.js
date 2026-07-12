// commands/profile.js
//   !setname [name]   — set your own manager display name
//   !name [name]      — alias
const User = require('../models/User');
const { sendText } = require('../utils/messaging');

async function handle({ sock, msg, jid, sender, args }) {
  const name = args.join(' ').trim().replace(/\s+/g, ' ').slice(0, 24);
  if (!name) {
    await sendText(sock, jid, `⚠️ Give me a manager name:\n*!setname [name]*\n\nExample: *!setname Oasis FC*`, msg);
    return;
  }
  User.update(sender, { name });
  await sendText(sock, jid, `✅ Your manager name is now *${name}*! 🔥`, msg);
}

module.exports = { handle };
