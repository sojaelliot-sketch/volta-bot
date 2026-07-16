// commands/playerlb.js
//   !plb [metric]     /   !playerlb [metric]
// Player leaderboard. Metrics: ovr (default) | goals | motm | value
//   !plb [name]  — find a specific player's rank
const db = require('../config/database');
const Player = require('../models/Player');
const { RARITY } = require('../config/constants');
const { sendText } = require('../utils/messaging');

const METRICS = {
  ovr:   { label: 'OVERALL RATING', get: (p) => Player.totalStats(p),                 fmt: (v) => `${v} OVR` },
  goals: { label: 'CAREER GOALS',   get: (p) => p.goals || 0,                        fmt: (v) => `${v}⚽` },
  motm:  { label: 'MAN OF THE MATCH', get: (p) => p.manOfTheMatch || 0,               fmt: (v) => `${v}🌟` },
  value: { label: 'MARKET VALUE',    get: (p) => Player.marketValue(p),               fmt: (v) => `${v}💰` },
};

function clubName(ownerId) {
  if (!ownerId) return 'Free Agent';
  if (ownerId.startsWith('club:')) return ownerId.slice(5).replace(/_/g, ' ');
  if (ownerId === 'AI_MARKET') return 'AI Market';
  return 'Manager';
}

function rankedAll(metric) {
  return db.all('players')
    .map((p) => ({ p, val: metric.get(p) }))
    .sort((a, b) => b.val - a.val);
}

function buildBoard(metric, limit = 15) {
  return rankedAll(metric).slice(0, limit);
}

async function handle({ sock, msg, jid, sender, args }) {
  const raw = (args[0] || '').toLowerCase();

  // ── specific player lookup (non-metric words = a name search) ──
  if (raw && !METRICS[raw]) {
    const ql = raw;
    const ranked = rankedAll(METRICS.ovr);
    const idx = ranked.findIndex((r) => (r.p.name || '').toLowerCase().includes(ql));
    if (idx === -1) {
      await sendText(sock, jid, `🔎 No player found matching *${raw}*.`, msg);
      return;
    }
    const { p, val } = ranked[idx];
    const emoji = RARITY[p.rarity]?.emoji || '⚪';
    const role = p.role === 'goalkeeper' ? '🧤' : '⚽';
    await sendText(sock, jid,
      `🔝 *${p.name}* — rank #${idx + 1} of ${ranked.length}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${emoji} ${role} ${p.rarity} · OVR ${val}\n` +
      `🏟️ ${clubName(p.ownerId)} · Lv.${p.level}\n` +
      `⚽ ${p.goals || 0}G · 🅰️ ${p.assists || 0}A · 🧤 ${p.saves || 0}SV · ⭐ ${p.manOfTheMatch || 0} MOTM`, msg);
    return;
  }

  const metric = METRICS[raw] || METRICS.ovr;
  const board = buildBoard(metric, 15);
  let text = `🏆 *PLAYER LEADERBOARD · TOP ${board.length} (${metric.label})*\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  board.forEach((r, i) => {
    const { p, val } = r;
    const emoji = RARITY[p.rarity]?.emoji || '⚪';
    const role = p.role === 'goalkeeper' ? '🧤' : '⚽';
    text += `${i + 1}. ${emoji} *${p.name}* ${role} — ${metric.fmt(val)}\n`;
    text += `   ${p.rarity} · ${clubName(p.ownerId)} · ⚽ ${p.goals || 0}G ⭐ ${p.manOfTheMatch || 0} MOTM\n`;
  });
  text += `━━━━━━━━━━━━━━━━━━━━━━\n💡 *!plb [name]* to find one player · metrics: ovr · goals · motm · value`;

  await sendText(sock, jid, text, msg);
}

module.exports = { handle };
