// commands/playerlb.js
//   !plb            /   !playerlb
// Player leaderboard — ranks all players by overall rating (OVR).
// Optional: !plb [name] to find a specific player's rank + rating.
const db = require('../config/database');
const Player = require('../models/Player');
const { RARITY } = require('../config/constants');
const { sendText } = require('../utils/messaging');

function clubName(ownerId) {
  if (!ownerId) return 'Free Agent';
  if (ownerId.startsWith('club:')) return ownerId.slice(5).replace(/_/g, ' ');
  if (ownerId === 'AI_MARKET') return 'AI Market';
  return 'Manager';
}

function buildBoard(limit = 15) {
  return db.all('players')
    .map((p) => ({ p, ovr: Player.totalStats(p) }))
    .sort((a, b) => b.ovr - a.ovr)
    .slice(0, limit);
}

async function handle({ sock, msg, jid, sender, args }) {
  const q = args.join(' ').trim();

  // ── specific player lookup ──
  if (q) {
    const ql = q.toLowerCase();
    const ranked = db.all('players')
      .map((p) => ({ p, ovr: Player.totalStats(p) }))
      .sort((a, b) => b.ovr - a.ovr);
    const idx = ranked.findIndex((r) => (r.p.name || '').toLowerCase().includes(ql));
    if (idx === -1) {
      await sendText(sock, jid, `🔎 No player found matching *${q}*.`, msg);
      return;
    }
    const { p, ovr } = ranked[idx];
    const emoji = RARITY[p.rarity]?.emoji || '⚪';
    const role = p.role === 'goalkeeper' ? '🧤' : '⚽';
    await sendText(sock, jid,
      `🔝 *${p.name}* — rank #${idx + 1} of ${ranked.length}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${emoji} ${role} ${p.rarity} · OVR ${ovr}\n` +
      `🏟️ ${clubName(p.ownerId)} · ${p.position} · Lv.${p.level}\n` +
      `⚽ ${p.goals || 0}G · 🅰️ ${p.assists || 0}A · 🧤 ${p.saves || 0}SV · ⭐ ${p.manOfTheMatch || 0} MOTM`, msg);
    return;
  }

  // ── top player leaderboard ──
  const board = buildBoard(15);
  let text = `🏆 *PLAYER LEADERBOARD · TOP ${board.length}*\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  board.forEach((r, i) => {
    const { p, ovr } = r;
    const emoji = RARITY[p.rarity]?.emoji || '⚪';
    const role = p.role === 'goalkeeper' ? '🧤' : '⚽';
    text += `${i + 1}. ${emoji} *${p.name}* ${role} — OVR ${ovr}\n`;
    text += `   ${p.rarity} · ${clubName(p.ownerId)} · ⚽ ${p.goals || 0}G ⭐ ${p.manOfTheMatch || 0} MOTM\n`;
  });
  text += `━━━━━━━━━━━━━━━━━━━━━━\n💡 *!plb [name]* to find one player's rank.`;

  await sendText(sock, jid, text, msg);
}

module.exports = { handle };
