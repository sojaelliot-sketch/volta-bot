// commands/academy.js
//   !academy            — show your academy (youth) players
//   !scout [id]         — scout a NEW youth talent (costs ACADEMY.SCOUT_COST)
//   !promote [id]       — promote a youth prospect into your squad (Reserves)
//
// Youth players are created as real players up-front (with a CVC id) but kept
// out of the manager's active pool until promoted. They live in the `youth`
// array on the user doc; promoting simply adds the existing player id to the
// manager's Reserves.
const User = require('../models/User');
const Player = require('../models/Player');
const { ACADEMY } = require('../config/constants');
const { buildYouthPlayer } = require('../utils/playerGenerator');
const { money } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');

function findYouthId(user, shortArg) {
  const list = user.youth || [];
  if (!shortArg) return null;
  return list.find((id) => String(id).toLowerCase().startsWith(shortArg.toLowerCase())) || null;
}

function youthTotal(p) {
  if (!p || !p.stats) return 0;
  return Object.values(p.stats).reduce((a, b) => a + b, 0);
}

async function handle({ sock, msg, jid, sender, cmd, args, user }) {
  // ── academy (list) ──
  if (cmd === 'academy') {
    const youth = user.youth || [];
    if (!youth.length) {
      await sendText(sock, jid,
        `🏫 *YOUR ACADEMY*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `No youth prospects yet.\n\n` +
        `💡 *!scout* costs ${money(ACADEMY.SCOUT_COST)} and discovers a young talent (${ACADEMY.YOUTH_STAT_MIN}–${ACADEMY.YOUTH_STAT_MAX} OVR). Then *!promote [id]* adds them to your squad.`, msg);
      return;
    }
    let out = `🏫 *YOUR ACADEMY* (${youth.length}/${ACADEMY.SCOUT_SLOTS})\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
    for (const id of youth) {
      const p = Player.getById(id);
      if (!p) continue;
      out += `${p.id} · ${p.name} (${p.role === 'goalkeeper' ? '🧤 GK' : '⚽'}) — ${youthTotal(p)} OVR · Pot ${p.potential}\n`;
    }
    out += `━━━━━━━━━━━━━━━━━━━━━━━\n💡 *!promote [id]* adds a prospect to your squad.`;
    await sendText(sock, jid, out, msg);
    return;
  }

  // ── scout with no id → discover a new youth prospect ──
  if (cmd === 'scout' && !args[0]) {
    if ((user.currency || 0) < ACADEMY.SCOUT_COST) {
      await sendText(sock, jid, `❌ Scouting costs ${money(ACADEMY.SCOUT_COST)}. You have ${money(user.currency)}.`, msg);
      return;
    }
    const youth = user.youth || [];
    if (youth.length >= ACADEMY.SCOUT_SLOTS) {
      await sendText(sock, jid, `⚠️ Academy is full (${ACADEMY.SCOUT_SLOTS} slots). Promote someone with *!promote [id]* first.`, msg);
      return;
    }
    const p = buildYouthPlayer(sender);
    User.update(sender, {
      currency: (user.currency || 0) - ACADEMY.SCOUT_COST,
      youth: [...youth, p.id],
    });
    await sendText(sock, jid,
      `🔍 *NEW PROSPECT!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${p.name} (${p.role === 'goalkeeper' ? '🧤 GK' : '⚽'})\n` +
      `🌟 Potential: ${p.potential}\n` +
      `📊 ${youthTotal(p)} OVR (${ACADEMY.YOUTH_STAT_MIN}–${ACADEMY.YOUTH_STAT_MAX})\n` +
      `🆔 ${p.id}\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 *!promote ${p.id}* to add them to your squad.`, msg);
    return;
  }

  // ── scout [id] / promote [id] → promote a youth prospect ──
  if (cmd === 'scout' || cmd === 'promote') {
    const idArg = args[0];
    if (!idArg) {
      await sendText(sock, jid, `⚠️ Usage: *!promote [id]* — add a youth prospect to your squad.`, msg);
      return;
    }
    const id = findYouthId(user, idArg);
    if (!id) {
      await sendText(sock, jid, `❌ No youth prospect with ID *${idArg}*. Check *!academy*.`, msg);
      return;
    }
    const p = Player.getById(id);
    User.update(sender, {
      youth: (user.youth || []).filter((y) => y !== id),
      reserves: [...(user.reserves || []), id],
    });
    await sendText(sock, jid,
      `⬆️ *PROMOTED!* ${p?.name || 'Prospect'} joined your squad (Reserves). 🔥\n🆔 ${id}`, msg);
    return;
  }
}

module.exports = { handle };
