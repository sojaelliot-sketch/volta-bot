// commands/captain.js
// Set team captain - gives bonus in matches

const User = require('../models/User');
const Player = require('../models/Player');
const { sendText } = require('../utils/messaging');
const { BRAND } = require('../config/constants');

async function captainCommand({ sock, msg, jid, sender, args, user }) {
  if (!user || !user.registered) {
    await sendText(sock, jid, `⚠️ Register first with *!register [name]*`, msg);
    return;
  }
  const squad = Player.getByOwner(sender);
  if (!squad || squad.length === 0) {
    await sendText(sock, jid, `⚠️ You have no players. Get some from packs or the market!`, msg);
    return;
  }

  // Show current captain if no args
  if (!args[0]) {
    const currentCaptain = squad.find(p => p.isCaptain);
    if (currentCaptain) {
      const card = `👑 *CURRENT CAPTAIN*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `*${currentCaptain.name}* (${currentCaptain.id})\n` +
        `Rarity: ${currentCaptain.rarity} | OVR: ${currentCaptain.ovr || 70}\n` +
        `Nation: ${currentCaptain.nationality || 'Unknown'}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Use *!captain [playerID]* to change captain\n${BRAND}`;
      await sendText(sock, jid, card, msg);
    } else {
      await sendText(sock, jid,
        `👑 *NO CAPTAIN SET*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Use *!captain [playerID]* to set your captain\n` +
        `The captain gives +5% team bonus in matches!\n${BRAND}`, msg);
    }
    return;
  }

  // Set new captain
  const query = args.join(' ');
  const player = Player.findByQuery(sender, query);
  if (!player) {
    await sendText(sock, jid, `❌ Player not found. Use *!squad* to see your players.`, msg);
    return;
  }

  // Remove captain from all players
  for (const p of squad) {
    if (p.isCaptain) {
      Player.update(p.id, { isCaptain: false });
    }
  }

  // Set new captain
  Player.update(player.id, { isCaptain: true });

  await sendText(sock, jid,
    `👑 *CAPTAIN APPOINTED!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `*${player.name}* (${player.id}) is now your captain!\n` +
    `Rarity: ${player.rarity} | Nation: ${player.nationality || 'Unknown'}\n\n` +
    `🎯 *Captain Bonus:* +5% team performance in matches\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
}

module.exports = { handle: captainCommand };
