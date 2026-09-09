// commands/trophies.js
// View all trophies and achievements won

const { sendText } = require('../utils/messaging');
const { BRAND } = require('../config/constants');

async function trophiesCommand({ sock, msg, jid, sender, args, user }) {
  if (!user || !user.registered) {
    await sendText(sock, jid, `⚠️ Register first with *!register [name]*`, msg);
    return;
  }
  const userTrophies = user.trophies || {};
  
  let output = `🏆 *TROPHY CABINET*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  
  // League trophies
  const leagueTrophies = userTrophies.league || [];
  if (leagueTrophies.length > 0) {
    output += `⚽ *League Titles:* ${leagueTrophies.length}\n`;
    for (const t of leagueTrophies.slice(-3)) {
      output += `  🥇 ${t.name || 'Champion'} - ${new Date(t.date).toLocaleDateString()}\n`;
    }
    output += `\n`;
  } else {
    output += `⚽ *League Titles:* 0\n\n`;
  }

  // Tournament trophies
  const tournamentTrophies = userTrophies.tournaments || [];
  if (tournamentTrophies.length > 0) {
    output += `🏅 *Tournament Wins:* ${tournamentTrophies.length}\n`;
    for (const t of tournamentTrophies.slice(-3)) {
      output += `  🏆 ${t.name || 'Tournament'} - ${new Date(t.date).toLocaleDateString()}\n`;
    }
    output += `\n`;
  } else {
    output += `🏅 *Tournament Wins:* 0\n\n`;
  }

  // Cup trophies
  const cupTrophies = userTrophies.cups || [];
  if (cupTrophies.length > 0) {
    output += `🎯 *Cup Wins:* ${cupTrophies.length}\n`;
    for (const t of cupTrophies.slice(-3)) {
      output += `  🎖️ ${t.name || 'Cup'} - ${new Date(t.date).toLocaleDateString()}\n`;
    }
    output += `\n`;
  } else {
    output += `🎯 *Cup Wins:* 0\n\n`;
  }

  // Special achievements
  const achievements = userTrophies.achievements || [];
  if (achievements.length > 0) {
    output += `✨ *Special Achievements:*\n`;
    for (const a of achievements.slice(-5)) {
      output += `  ⭐ ${a.name} - ${new Date(a.date).toLocaleDateString()}\n`;
    }
    output += `\n`;
  }

  // Career stats
  output += `📊 *Career Stats:*\n`;
  output += `• Total Trophies: ${(leagueTrophies.length || 0) + (tournamentTrophies.length || 0) + (cupTrophies.length || 0)}\n`;
  output += `• Matches Won: ${user.wins || 0}\n`;
  output += `• Total Goals: ${user.goalsScored || 0}\n`;
  output += `• Best Win Streak: ${user.bestStreak || 0}\n`;

  output += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  output += `Keep playing to fill your trophy cabinet!\n${BRAND}`;

  await sendText(sock, jid, output, msg);
}

module.exports = { handle: trophiesCommand };
