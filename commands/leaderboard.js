// commands/leaderboard.js
//   !leaderboard [category] / !lb [category] — ranked managers
//   Categories: mmr (default) | wins | goals | rich | winrate
const User = require('../models/User');
const { BRAND } = require('../config/constants');
const { sendText } = require('../utils/messaging');

const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

const CATEGORIES = {
  mmr:    { label: 'TOP MANAGERS (by MMR)',  key: 'mmr',        get: (u) => u.mmr || 1000,                fmt: (v) => `${v} MMR` },
  wins:   { label: 'MOST WINS',              key: 'wins',       get: (u) => u.wins || 0,                  fmt: (v) => `${v} wins` },
  goals:  { label: 'TOP SCORERS (career)',   key: 'totalGoals', get: (u) => u.totalGoals || 0,            fmt: (v) => `${v} goals` },
  rich:   { label: 'RICHEST MANAGERS',       key: 'currency',   get: (u) => u.currency || 0,             fmt: (v) => `${v} MW` },
  winrate:{ label: 'BEST WIN RATE',          key: 'winrate',    get: (u) => User.winRate(u),             fmt: (v) => `${v}% win`, minGames: 5 },
};

function resolveCategory(arg) {
  if (!arg) return CATEGORIES.mmr;
  const a = arg.toLowerCase();
  if (CATEGORIES[a]) return CATEGORIES[a];
  // friendly aliases
  const alias = { top: 'mmr', rating: 'mmr', score: 'goals', goal: 'goals', money: 'rich', wealth: 'rich', cash: 'rich', wr: 'winrate', rate: 'winrate' };
  if (alias[a]) return CATEGORIES[alias[a]];
  return null;
}

async function handle({ sock, msg, jid, sender, args }) {
  const cat = resolveCategory(args[0]);
  if (!cat) {
    const names = Object.keys(CATEGORIES).join(' · ');
    await sendText(sock, jid,
      `❓ Unknown leaderboard *!lb ${args[0]}*.\n` +
      `Try: *!lb* (MMR) or *!lb [${names}]*`, msg);
    return;
  }

  let all = User.all().filter(u => u.registered);
  if (cat.minGames) {
    all = all.filter(u => (u.wins + u.losses + u.draws) >= cat.minGames);
  }
  if (!all.length) {
    await sendText(sock, jid, `📊 No ranked players yet. Be the first — type *!start*!`, msg);
    return;
  }

  const ranked = all.slice().sort((a, b) => cat.get(b) - cat.get(a));
  const top = ranked.slice(0, 10);

  let out = `📊 *VOLTA LEADERBOARD* — ${cat.label}\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
  top.forEach((u, i) => {
    const medal = MEDALS[i] || `${i + 1}.`;
    out += `${medal} *${u.name}* — ${cat.fmt(cat.get(u))} (${u.rank || 'Bronze'})\n`;
  });

   const me = User.getByWhatsappId(sender);
   const myPos = ranked.findIndex(u => User.normalizeJid(u.whatsappId) === User.normalizeJid(sender)) + 1;
  if (me?.registered && myPos) {
    out += `\n━━━━━━━━━━━━━━━━━━━━━━━\n📍 You: #${myPos} of ${ranked.length} — ${cat.fmt(cat.get(me))}`;
  }
  out += `\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`;

  await sendText(sock, jid, out, msg);
}

module.exports = { handle, CATEGORIES };
