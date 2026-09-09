// commands/injuries.js
// View all injured players in your squad

const Player = require('../models/Player');
const { sendText } = require('../utils/messaging');
const { BRAND } = require('../config/constants');

async function injuriesCommand({ sock, msg, jid, sender, args, user }) {
  if (!user || !user.registered) {
    await sendText(sock, jid, `⚠️ Register first with *!register [name]*`, msg);
    return;
  }
  const squad = Player.getByOwner(sender);
  if (!squad || squad.length === 0) {
    await sendText(sock, jid, `⚠️ You have no players.`, msg);
    return;
  }

  const injured = squad.filter(p => p.injured || (p.condition && p.condition < 30));

  if (injured.length === 0) {
    await sendText(sock, jid,
      `✅ *MEDICAL REPORT*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `All players are fit! No injuries detected.\n` +
      `Use *!squad* to check player conditions.\n${BRAND}`, msg);
    return;
  }

  let output = `🏥 *MEDICAL REPORT*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  
  for (const p of injured) {
    const condition = p.condition || 100;
    const injuryType = p.injuryType || 'Unknown';
    const recoveryDays = p.injuryDays || Math.ceil((100 - condition) / 10);
    
    output += `• *${p.name}* (${p.id})\n`;
    output += `  Type: ${injuryType}\n`;
    output += `  Condition: ${condition}%\n`;
    output += `  Recovery: ~${recoveryDays} days\n\n`;
  }

  output += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  output += `Use *!surgery [id]* to heal instantly (750 MW)\n`;
  output += `Or wait for natural recovery.\n${BRAND}`;

  await sendText(sock, jid, output, msg);
}

module.exports = { handle: injuriesCommand };
