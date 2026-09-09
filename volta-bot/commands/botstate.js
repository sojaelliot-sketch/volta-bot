// commands/botstate.js
//   !on       — owner turns the bot back on
//   !off      — owner turns the bot off (only !on works)
//   !afk      — owner mutes bot (no chat responses, commands still work for owner)
//   !afk off  — owner unmutes bot
//   !tips on  — enable auto-tips
//   !tips off — disable auto-tips
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const { sendText } = require('../utils/messaging');
const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'botstate.json');

let state = { enabled: true, afk: false, afkReason: '', tipsEnabled: true, disabledCmds: [] };

function load() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    if (raw.trim()) state = { enabled: true, afk: false, afkReason: '', tipsEnabled: true, disabledCmds: [], ...JSON.parse(raw) };
  } catch {}
}
function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state));
  } catch {}
}
load();

function isEnabled() { return state.enabled !== false; }
function isAfk() { return state.afk === true; }
function getAfkReason() { return state.afkReason || ''; }
function isTipsEnabled() { return state.tipsEnabled !== false; }
function getDisabledCmds() { return state.disabledCmds || []; }
function isCmdDisabled(cmd) { return (state.disabledCmds || []).includes(cmd); }

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

function setTipsEnabled(v) {
  state.tipsEnabled = v;
  save();
}

function setCmdDisabled(cmd, disabled) {
  if (!state.disabledCmds) state.disabledCmds = [];
  if (disabled && !state.disabledCmds.includes(cmd)) {
    state.disabledCmds.push(cmd);
  } else if (!disabled) {
    state.disabledCmds = state.disabledCmds.filter(c => c !== cmd);
  }
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
  } else if (cmd === 'tips') {
    if (args[0] === 'on') {
      setTipsEnabled(true);
      await sendText(sock, jid, '💡 *Auto-tips ON.* New managers will receive helpful tips.', msg);
    } else if (args[0] === 'off') {
      setTipsEnabled(false);
      await sendText(sock, jid, '💡 *Auto-tips OFF.* No more automatic tips.', msg);
    } else {
      const status = isTipsEnabled() ? 'ON' : 'OFF';
      await sendText(sock, jid, `💡 *Auto-tips:* ${status}\nUsage: *!tips on* or *!tips off*`, msg);
    }
  } else if (cmd === 'disable') {
    const targetCmd = (args[0] || '').toLowerCase();
    if (!targetCmd) {
      const disabled = getDisabledCmds();
      if (disabled.length === 0) {
        await sendText(sock, jid, `🟢 No commands disabled.\n\nUsage: *!disable [cmd]* — disable a command\n*!disable [cmd]* again — re-enable it`, msg);
      } else {
        await sendText(sock, jid, `🔴 *Disabled commands:* ${disabled.join(', ')}\n\nUse *!disable [cmd]* again to re-enable.`, msg);
      }
      return;
    }
    if (isCmdDisabled(targetCmd)) {
      setCmdDisabled(targetCmd, false);
      await sendText(sock, jid, `🟢 *!${targetCmd}* has been re-enabled.`, msg);
    } else {
      setCmdDisabled(targetCmd, true);
      await sendText(sock, jid, `🔴 *!${targetCmd}* has been disabled.`, msg);
    }
  }
}

module.exports = { handle, isEnabled, setEnabled, isAfk, getAfkReason, setAfk, isTipsEnabled, setTipsEnabled, getDisabledCmds, isCmdDisabled };
