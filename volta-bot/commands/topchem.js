// commands/topchem.js
//   !topchem  — list the highest-chemistry players currently on the market
//   (or owned). The longer a core plays together, the higher their chemistry.
const db = require('../config/database');
const Player = require('../models/Player');
const { RARITY } = require('../config/constants');
const { money } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');

function clubName(ownerId) {
  if (!ownerId) return 'Free Agent';
  if (ownerId.startsWith('club:')) return ownerId.slice(5).replace(/_/g, ' ');
  if (ownerId === 'AI_MARKET') return 'AI Market';
  return 'Manager';
}

async function handle({ sock, msg, jid, sender, args }) {
  const top = db.all('players')
    .slice()
    .sort((a, b) => (b.chemistry || 0) - (a.chemistry || 0))
    .slice(0, 10);

  if (!top.length) {
    await sendText(sock, jid, `🔎 No players found.`, msg);
    return;
  }

  const listingByPlayer = {};
  for (const l of db.all('market')) {
    if (!l.sold) listingByPlayer[l.playerId] = l;
  }

  let text = `🔬 *TOP CHEMISTRY PLAYERS*\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  top.forEach((p, i) => {
    const emoji = RARITY[p.rarity]?.emoji || '⚪';
    const l = listingByPlayer[p.id];
    text += `${i + 1}. ${emoji} *${p.name}* — 🤝 ${p.chemistry || 0}% chem\n`;
    text += `   ${p.rarity} · ${clubName(p.ownerId)} · OVR ${Player.totalStats(p)}\n`;
    text += l ? `   💰 ${money(l.price)} · 🆔 \`${l.id.slice(0, 6)}\` — *!buy ${l.id.slice(0, 6)}*\n` : `   (not on the market)\n`;
  });
  text += `━━━━━━━━━━━━━━━━━━━━━━\n💡 Chemistry grows each match a player features in.`;

  await sendText(sock, jid, text, msg);
}

module.exports = { handle };
