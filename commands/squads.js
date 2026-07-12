// commands/squads.js
// Manage multiple saved squads:
//   !squads                 — list your squads
//   !buysquad              — unlock an extra squad slot (costs Metaworks)
//   !switchsquad [n]       — swap your active squad with saved squad #n
const User = require('../models/User');
const Player = require('../models/Player');
const { SQUAD } = require('../config/constants');
const { money } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');

function getSaved(user) {
  return Array.isArray(user.savedSquads) ? user.savedSquads : [];
}
function squadSize(s) {
  return (s.startingXI?.length || 0) + (s.bench?.length || 0) + (s.reserves?.length || 0);
}

async function handle({ sock, msg, jid, sender, cmd, args, user }) {
  const saved = getSaved(user);
  const total = 1 + saved.length;

  if (cmd === 'squads') {
    let out = `🗂️ *YOUR SQUADS* (${total}/${SQUAD.MAX_SQUADS})\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
    out += `▶️ *Squad 1* (active) — ${user.startingXI.length + user.bench.length + user.reserves.length} players\n`;
    saved.forEach((s, i) => {
      out += `💾 *Squad ${i + 2}* — ${squadSize(s)} players\n`;
    });
    if (saved.length === 0) out += `\nℹ️ Buy an extra squad with *!buysquad* to rotate tactics.`;
    out += `\n━━━━━━━━━━━━━━━━━━━━━━━`;
    await sendText(sock, jid, out, msg);
    return;
  }

  if (cmd === 'buysquad') {
    if (total >= SQUAD.MAX_SQUADS) {
      await sendText(sock, jid, `⚠️ You already own the max of *${SQUAD.MAX_SQUADS}* squads.`, msg);
      return;
    }
    if ((user.currency || 0) < SQUAD.EXTRA_SQUAD_COST) {
      await sendText(sock, jid,
        `❌ An extra squad costs *${money(SQUAD.EXTRA_SQUAD_COST)}*. You have *${money(user.currency)}*.`, msg);
      return;
    }
    User.update(sender, {
      currency: (user.currency || 0) - SQUAD.EXTRA_SQUAD_COST,
      savedSquads: [...saved, { startingXI: [], bench: [], reserves: [] }],
    });
    await sendText(sock, jid,
      `✅ *Extra squad unlocked!* (${total + 1}/${SQUAD.MAX_SQUADS})\n` +
      `💲 -${money(SQUAD.EXTRA_SQUAD_COST)}\nUse *!switchsquad ${total + 1}* to load it.`, msg);
    return;
  }

  if (cmd === 'switchsquad') {
    const n = parseInt(args[0], 10);
    if (!n || n < 1 || n > total) {
      await sendText(sock, jid, `⚠️ Usage: *!switchsquad [1-${total}]*`, msg);
      return;
    }
    if (n === 1) {
      await sendText(sock, jid, `ℹ️ Squad 1 is already your active squad.`, msg);
      return;
    }
    const idx = n - 2; // savedSquads index
    const current = { startingXI: user.startingXI, bench: user.bench, reserves: user.reserves };
    const next = saved[idx] || { startingXI: [], bench: [], reserves: [] };
    const newSaved = saved.slice();
    newSaved[idx] = current;
    User.update(sender, {
      startingXI: next.startingXI,
      bench: next.bench,
      reserves: next.reserves,
      savedSquads: newSaved,
    });
    const players = next.startingXI.length + next.bench.length + next.reserves.length;
    await sendText(sock, jid,
      `🔁 *Switched to Squad ${n}!*\nNow active: ${players} players. Use *!squad* to view.`, msg);
    return;
  }
}

module.exports = { handle };
