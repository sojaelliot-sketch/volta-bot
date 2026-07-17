// commands/search.js
//   !search [name]   /   !find [name]
// Search the player pool by real name (not ID) and show club + market price.
const db = require('../config/database');
const Player = require('../models/Player');
const User = require('../models/User');
const { RARITY } = require('../config/constants');
const { money, bar } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');

function clubName(ownerId) {
  if (!ownerId) return 'Free Agent';
  if (ownerId.startsWith('club:')) return ownerId.slice(5).replace(/_/g, ' ');
  if (ownerId === 'AI_MARKET') return 'AI Market';
  // A real manager owns this player — show their manager name (not just "Manager").
  const owner = User.getByWhatsappId(ownerId);
  return owner ? owner.name : 'Manager';
}

async function handle({ sock, msg, jid, sender, args, user }) {
  const q = args.join(' ').trim();
  if (!q) {
    await sendText(sock, jid,
      `🔎 *Search players by name*\n\n` +
      `Usage: *!search [name]*\nExample: *!search Messi*\n\n` +
      `Shows matching players, their club, and market price if listed.`, msg);
    return;
  }

  const ql = q.toLowerCase();
  const matches = db.all('players')
    .filter((p) => (p.name || '').toLowerCase().includes(ql))
    .slice(0, 12);

  if (!matches.length) {
    await sendText(sock, jid, `🔎 No players found matching *${q}*.`, msg);
    return;
  }

  const listingByPlayer = {};
  for (const l of db.all('market')) {
    if (!l.sold) listingByPlayer[l.playerId] = l;
  }

  let text = `🔎 *SEARCH: ${q}* — ${matches.length} result(s)\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  for (const p of matches) {
    const emoji = RARITY[p.rarity]?.emoji || '⚪';
    const role = p.role === 'goalkeeper' ? '🧤' : '⚽';
    const total = Player.totalStats(p);
    const club = clubName(p.ownerId);
    const l = listingByPlayer[p.id];
    text += `${emoji} *${p.name}* ${role}\n`;
    text += `   ${p.rarity} · ${club} · OVR ${total} · 🤝 ${p.chemistry || 0}% chem · ❤️ ${bar(p.condition)}\n`;
    if (l) {
      const short = l.id.slice(0, 6);
      text += `   💰 ${money(l.price)} · 🆔 \`${short}\` — *!buy ${short}*\n`;
    } else {
      const owner = User.getByWhatsappId(p.ownerId);
      text += `   🛡️ Not on the market — managed by *${owner ? owner.name : 'a manager'}*\n`;
    }
    text += `\n`;
  }
  text += `━━━━━━━━━━━━━━━━━━━━━━\n💡 *!buy [id]* signs a listed player.`;

  await sendText(sock, jid, text, msg);
}

module.exports = { handle };
