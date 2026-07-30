// commands/retire.js
//   !retire — permanently retire your club and start fresh
//   !retire confirm — confirm retirement (are-you-sure gate)
const User = require('../models/User');
const Player = require('../models/Player');
const { sendText } = require('../utils/messaging');
const { BRAND } = require('../config/constants');

const LEGACY_BONUS = 5000;
const LEGACY_CARD_BONUS = 2000;

async function handle({ sock, msg, jid, sender, args, user }) {
  if (!user || !user.registered) {
    await sendText(sock, jid, `❌ Register first with *!start*.`, msg);
    return;
  }

  const subcmd = (args[0] || '').toLowerCase();

  // !retire confirm
  if (subcmd === 'confirm') {
    // Find best Legendary card to keep
    const allCards = [...(user.startingXI || []), ...(user.bench || []), ...(user.reserves || [])];
    let bestCard = null, bestOvr = 0;
    for (const id of allCards) {
      const p = Player.getById(id);
      if (p && p.rarity === 'Legendary') {
        const ovr = Object.values(p.stats || {}).reduce((a, b) => a + b, 0) / Object.keys(p.stats || {}).length;
        if (ovr > bestOvr) { bestOvr = ovr; bestCard = id; }
      }
    }

    // If no Legendary, keep first Elite
    if (!bestCard) {
      for (const id of allCards) {
        const p = Player.getById(id);
        if (p && p.rarity === 'Elite') {
          bestCard = id;
          break;
        }
      }
    }

    // If no Elite either, keep best card by OVR
    if (!bestCard && allCards.length) {
      for (const id of allCards) {
        const p = Player.getById(id);
        if (p) {
          const ovr = Object.values(p.stats || {}).reduce((a, b) => a + b, 0) / Object.keys(p.stats || {}).length;
          if (ovr > bestOvr) { bestOvr = ovr; bestCard = id; }
        }
      }
    }

    // Release all cards except the legacy card
    for (const id of allCards) {
      if (id !== bestCard) {
        Player.update(id, { owner: null });
      }
    }

    // If keeping a card, adjust its stats slightly for the fresh start
    if (bestCard) {
      Player.update(bestCard, { level: 1, form: 50, condition: 100, injuredUntil: null });
    }

    // Reset user to fresh state with legacy bonus
    User.update(sender, {
      name: user.name,
      currency: LEGACY_BONUS,
      startingXI: bestCard ? [bestCard] : [],
      bench: [],
      reserves: bestCard ? [] : [],
      savedSquads: [],
      mmr: 800,
      rank: 'Bronze',
      wins: 0,
      losses: 0,
      draws: 0,
      totalGoals: 0,
      winStreak: 0,
      tournamentWins: 0,
      badges: [],
      lastDaily: null,
      dailyStreak: 0,
      inMatch: false,
      currentMatchId: null,
      tipStart: null,
      tipIndex: 0,
      stadium: null,
      fanEnergy: 100,
      pkEnabled: false,
      youth: [],
      retiredAt: new Date().toISOString(),
    });

    const keptCard = bestCard ? Player.getById(bestCard) : null;
    await sendText(sock, jid,
      `🏳️ *CLUB RETIRED*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${user.name} has been retired.\n\n` +
      `🎁 *Legacy Bonus:* ${LEGACY_BONUS} MW\n` +
      (keptCard ? `🏆 *Kept:* ${keptCard.name} (${keptCard.id}) — your legacy card\n` : '') +
      `\nA new chapter begins...\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
    return;
  }

  // !retire — show warning
  const allCards = [...(user.startingXI || []), ...(user.bench || []), ...(user.reserves || [])];
  await sendText(sock, jid,
    `⚠️ *ARE YOU SURE?*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `You are about to PERMANENTLY retire *${user.name}*.\n\n` +
    `This will:\n` +
    `• Release ALL your players (except 1 legacy card)\n` +
    `• Reset your MMR to 800\n` +
    `• Reset your record to 0-0-0\n` +
    `• Clear your badges, stadium, and squads\n` +
    `• Give you ${LEGACY_BONUS} MW legacy bonus\n\n` +
    `📦 Current: ${allCards.length} cards · ${user.mmr} MMR · ${user.wins}W-${user.losses}L-${user.draws}D\n\n` +
    `💡 Type *!retire confirm* to proceed.\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
}

module.exports = { handle };
