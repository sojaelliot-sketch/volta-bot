// commands/teamchem.js
// View team chemistry breakdown

const User = require('../models/User');
const Player = require('../models/Player');
const { sendText } = require('../utils/messaging');
const { BRAND } = require('../config/constants');

function calculateChemistry(squad) {
  if (!squad || squad.length === 0) return { total: 0, breakdown: [] };
  
  let totalChem = 0;
  const breakdown = [];
  
  // Nationality bonus - players from same country
  const nationalityGroups = {};
  for (const p of squad) {
    const nat = p.nationality || 'Unknown';
    if (!nationalityGroups[nat]) nationalityGroups[nat] = [];
    nationalityGroups[nat].push(p);
  }
  
  for (const [nat, players] of Object.entries(nationalityGroups)) {
    if (players.length >= 2) {
      const bonus = players.length * 5;
      totalChem += bonus;
      breakdown.push({ type: 'Nationality', detail: `${nat} x${players.length}`, bonus });
    }
  }
  
  // Rarity bonus - high rarity players boost team
  const rarityCounts = {};
  for (const p of squad) {
    const r = p.rarity || 'Common';
    if (!rarityCounts[r]) rarityCounts[r] = 0;
    rarityCounts[r]++;
  }
  
  const rarityBonus = (rarityCounts['Legendary'] || 0) * 10 + 
                      (rarityCounts['Elite'] || 0) * 5 + 
                      (rarityCounts['Rare'] || 0) * 2;
  totalChem += rarityBonus;
  if (rarityBonus > 0) {
    breakdown.push({ type: 'Rarity Bonus', detail: `L:${rarityCounts['Legendary']||0} E:${rarityCounts['Elite']||0} R:${rarityCounts['Rare']||0}`, bonus: rarityBonus });
  }
  
  // Captain bonus
  const hasCaptain = squad.some(p => p.isCaptain);
  if (hasCaptain) {
    totalChem += 15;
    breakdown.push({ type: 'Captain', detail: 'Active', bonus: 15 });
  }
  
  // Position diversity bonus
  const positions = new Set(squad.map(p => p.role || 'outfield'));
  const posBonus = positions.size * 3;
  totalChem += posBonus;
  if (posBonus > 0) {
    breakdown.push({ type: 'Position Diversity', detail: `${positions.size} types`, bonus: posBonus });
  }
  
  // Cap at 100
  totalChem = Math.min(100, totalChem);
  
  return { total: totalChem, breakdown };
}

async function teamchemCommand({ sock, msg, jid, sender, args, user }) {
  if (!user || !user.registered) {
    await sendText(sock, jid, `⚠️ Register first with *!register [name]*`, msg);
    return;
  }
  const squad = Player.getByOwner(sender);
  if (!squad || squad.length === 0) {
    await sendText(sock, jid, `⚠️ You have no players.`, msg);
    return;
  }

  const { total, breakdown } = calculateChemistry(squad);
  
  // Chemistry tier
  let tier, tierEmoji;
  if (total >= 80) { tier = 'Legendary'; tierEmoji = '🟠'; }
  else if (total >= 60) { tier = 'Elite'; tierEmoji = '🟣'; }
  else if (total >= 40) { tier = 'Rare'; tierEmoji = '🔵'; }
  else { tier = 'Common'; tierEmoji = '⚪'; }

  let output = `🧪 *TEAM CHEMISTRY*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  output += `${tierEmoji} *Chemistry: ${total}/100* (${tier})\n\n`;
  
  // Chemistry bar
  const filled = Math.floor(total / 5);
  const empty = 20 - filled;
  output += `[${'█'.repeat(filled)}${'░'.repeat(empty)}]\n\n`;
  
  // Breakdown
  if (breakdown.length > 0) {
    output += `📊 *Breakdown:*\n`;
    for (const b of breakdown) {
      output += `• ${b.type}: ${b.detail} (+${b.bonus})\n`;
    }
    output += `\n`;
  }
  
  // Bonuses
  output += `🎯 *Bonuses:*\n`;
  output += `• Match Performance: +${Math.floor(total / 10)}%\n`;
  output += `• Player Development: +${Math.floor(total / 20)}%\n`;
  output += `• Transfer Attractiveness: +${Math.floor(total / 15)}%\n`;

  output += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  output += `Build chemistry by:\n`;
  output += `• Signing players from same nation\n`;
  output += `• Having high-rarity players\n`;
  output += `• Setting a captain (!captain)\n${BRAND}`;

  await sendText(sock, jid, output, msg);
}

module.exports = { handle: teamchemCommand, calculateChemistry };
