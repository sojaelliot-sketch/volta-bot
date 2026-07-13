// commands/botstate.js
//   !on  — owner turns the bot back on (commands live for everyone)
//   !off — owner turns the bot off (only !on works for non-owners)
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const { sendText } = require('../utils/messaging');
const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'botstate.json');

let state = { enabled: true };

function load() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    if (raw.trim()) state = { enabled: true, ...JSON.parse(raw) };
  } catch {}
}
function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state));
  } catch {}
}
load();

function isEnabled() {
  return state.enabled !== false;
}
function setEnabled(v) {
  state.enabled = v;
  save();
}

async function handle({ sock, msg, jid, sender, cmd }) {
  if (!User.isOwner(sender)) {
    await sendText(sock, jid, '⛔ Only the owner can toggle the bot on/off.', msg);
    return;
  }
  if (cmd === 'on') {
    setEnabled(true);
    await sendText(sock, jid, '🟢 *Bot is ON.* All commands are live again. ⚽', msg);
  } else if (cmd === 'off') {
    setEnabled(false);
    await sendText(sock, jid, '🔴 *Bot is OFF.* Only *!on* will respond until the owner switches it back on.', msg);
  }
}

module.exports = { handle, isEnabled, setEnabled };
