// commands/botstate.js
//   !on     — owner turns the bot back on
//   !off    — owner turns the bot off (only !on works)
//   !afk    — owner mutes bot (no chat responses, commands still work for owner)
//   !afk off — owner unmutes bot
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const { sendText } = require('../utils/messaging');
const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'botstate.json');

let state = { enabled: true, afk: false, afkReason: '' };

function load() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    if (raw.trim()) state = { enabled: true, afk: false, afkReason: '', ...JSON.parse(raw) };
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

function isAfk() {
  return state.afk === true;
}

function getAfkReason() {
  return state.afkReason || '';
}

function setEnabled(v) {
  state.enabled = v;
  if (v) { state.afk = false; state.afkReason = ''; }
  save();
}

function setAfk(v, reason) {
  state.afk = v;
  state.afkReason = v ? (reason || 'AFK') : '';
  save();
}

async function handle({ sock, msg, jid, sender, cmd, args }) {
  if (!User.isOwner(sender)) {
    await sendText(sock, jid, '⛔ Only the owner can toggle bot state.', msg);
    return;
  }

  if (cmd === 'on') {
    setEnabled(true);
    await sendText(sock, jid, '🟢 *Bot is ON.* All commands are live again. ⚽', msg);
  } else if (cmd === 'off') {
    setEnabled(false);
    await sendText(sock, jid, '🔴 *Bot is OFF.* Only *!on* will respond until the owner switches it back on.', msg);
  } else if (cmd === 'afk') {
    if (args[0] === 'off') {
      setAfk(false);
      await sendText(sock, jid, '🟢 *Bot is back online.* Ready to chat!', msg);
    } else {
      const reason = args.join(' ') || 'AFK';
      setAfk(true, reason);
      await sendText(sock, jid, `😴 *Bot is now AFK.* ${reason}\n\nCommands still work for the owner. Say *!afk off* to resume chatting.`, msg);
    }
  }
}

module.exports = { handle, isEnabled, setEnabled, isAfk, getAfkReason, setAfk };
