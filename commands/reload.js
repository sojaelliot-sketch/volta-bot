// commands/reload.js
//   !reload  — owner only. Re-reads ALL data JSON files from disk so manual
//              edits made in the editor take effect live (no restart needed).
const db = require('../config/database');
const User = require('../models/User');
const { sendText } = require('../utils/messaging');

// Every table the DB layer manages — reloadAll() refreshes all of them.
const TABLES = ['users', 'players', 'market', 'tournaments', 'counters'];

async function handle({ sock, msg, jid, sender }) {
  if (!User.isOwner(sender)) {
    await sendText(sock, jid, '⛔ *!reload* is owner-only.', msg);
    return;
  }
  db.reloadAll();
  const counts = TABLES.map((t) => `• ${t}: ${db.all(t).length} record(s)`).join('\n');
  await sendText(sock, jid,
    '🔄 *Data reloaded* from disk — your JSON edits are now live!\n━━━━━━━━━━━━━━━━━━━━━━━━\n' + counts,
    msg);
}

module.exports = { handle };
