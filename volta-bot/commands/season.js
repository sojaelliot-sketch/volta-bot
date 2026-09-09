// commands/season.js
// Season overview with league weekly updates

const User = require('../models/User');
const League = require('../models/League');
const { sendText } = require('../utils/messaging');
const { BRAND } = require('../config/constants');

async function seasonCommand({ sock, msg, jid, sender, args, user }) {
  const weekInfo = League.getWeekInfo();
  const state = League.getState();
  const history = League.getLeagueHistory();
  let playerDivision = null;
  if (user && user.registered) {
    playerDivision = League.getPlayerDivision(sender);
  }

  let output = `📅 *SEASON OVERVIEW*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  
  // Current week info
  output += `📆 *Current Week:* ${weekInfo.week}\n`;
  output += `⏱️ *Time Left:* ${weekInfo.timeLeft}\n`;
  output += `📊 *Status:* ${weekInfo.isActive ? '🟢 Active' : '🔴 Inactive'}\n\n`;
  
  // Season stats
  output += `📈 *Season Stats:*\n`;
  output += `• Total Weeks Played: ${state.totalWeeks || 0}\n`;
  output += `• Season Started: ${new Date(state.seasonStart).toLocaleDateString()}\n\n`;
  
  // Player's current status
  if (playerDivision) {
    output += `👤 *Your Status:*\n`;
    output += `• Division: ${playerDivision.name} (${playerDivision.subtitle})\n`;
    output += `• Position: ${playerDivision.stats.position || 'N/A'}\n`;
    output += `• Points: ${playerDivision.stats.points || 0}\n`;
    output += `• Record: ${playerDivision.stats.wins || 0}W ${playerDivision.stats.draws || 0}D ${playerDivision.stats.losses || 0}L\n`;
    output += `• Goals: ${playerDivision.stats.goalsFor || 0} scored, ${playerDivision.stats.goalsAgainst || 0} conceded\n\n`;
  } else {
    output += `👤 *Your Status:* Not in league yet\n`;
    output += `Use *!league me* to join!\n\n`;
  }

  // Recent champions
  if (history.champions && history.champions.length > 0) {
    output += `🏆 *Recent Champions:*\n`;
    const recent = history.champions.slice(-3);
    for (const champ of recent) {
      const champUser = User.getByWhatsappId(champ.jid);
      output += `• ${champUser?.name || champ.jid} - ${champ.points} pts (${new Date(champ.awardedAt || Date.now()).toLocaleDateString()})\n`;
    }
    output += `\n`;
  }

  output += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  output += `Use *!league* to see division tables\n`;
  output += `Use *!league start* (staff) to start new week\n${BRAND}`;

  await sendText(sock, jid, output, msg);
}

module.exports = { handle: seasonCommand };
