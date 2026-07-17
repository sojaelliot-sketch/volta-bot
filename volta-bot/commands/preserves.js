// commands/preserves.js
//   !preserves — list the players currently in your Reserves.
// (Use !reserve to MOVE players in/out of the reserves.)
const User = require('../models/User');
const Player = require('../models/Player');
const { money } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');
const { RARITY, BRAND } = require('../config/constants');

async function handle({ sock, msg, jid, sender, user }) {
  const u = user || User.getByWhatsappId(sender);
  if (!u || !u.registered) {
    await sendText(sock, jid, `👋 You're not registered yet. Send *!start* first.`, msg);
    return;
  }

  const ids = u.reserves || [];
  const players = ids.map((id) => Player.getById(id)).filter(Boolean);

  if (!players.length) {
    await sendText(sock, jid,
      `📦 *Your Reserves are empty.*\n\n` +
      `Move a player to Reserves with *!reserve [id]*, or open a pack in the *!shop* — new pulls land here first.`, msg);
    return;
  }

  players.sort((a, b) => Player.totalStats(b) - Player.totalStats(a));

  let out = `📦 *YOUR RESERVES* (${players.length})\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
  for (const p of players) {
    const emoji = RARITY[p.rarity]?.emoji || '⚪';
    const role = p.role === 'goalkeeper' ? '🧤 GK' : '⚽ OF';
    out += `${emoji} *${Player.displayName(p)}* · ${role} · OVR ${Player.totalStats(p)}\n`;
    out += `   ${p.rarity} · 💰 ${money(Player.marketValue(p))} · 🆔 \`${p.id.slice(0, 6)}\`\n`;
  }
  out += `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `↩️ Bring one back with *!reserve out [id]*, or *!swap [id] xi* to promote.\n${BRAND}`;

  await sendText(sock, jid, out, msg);
}

module.exports = { handle };
