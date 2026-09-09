const User = require('../models/User');
const Awards = require('../models/Awards');
const { sendText } = require('../utils/messaging');
const { BRAND } = require('../config/constants');

async function awardsCommand({ sock, msg, jid, sender, args, user }) {
  if (!user || !user.registered) {
    await sendText(sock, jid, `⚠️ Register first with *!register [name]*`, msg);
    return;
  }

  const subcmd = (args[0] || '').toLowerCase();

  // !awards end — owner only, end season and give awards
  if (subcmd === 'end') {
    if (!User.isOwner(sender)) {
      await sendText(sock, jid, `⛔ Only the Owner can end the season.`, msg);
      return;
    }
    const awards = Awards.endSeason();
    let output = `🎉 *SEASON ENDED! AWARDS GIVEN!*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (awards.topScorer) output += `⚽ *Golden Boot:* ${awards.topScorer.name} (${awards.topScorer.value} goals)\n`;
    if (awards.topAssist) output += `🅰️ *Playmaker:* ${awards.topAssist.name} (${awards.topAssist.value} assists)\n`;
    if (awards.topCleanSheets) output += `🧤 *Golden Glove:* ${awards.topCleanSheets.name} (${awards.topCleanSheets.value} clean sheets)\n`;
    if (awards.bestManager) output += `👔 *Best Manager:* ${awards.bestManager.name} (${awards.bestManager.value}% win rate)\n`;
    if (awards.goldenBoot) output += `🎯 *Goals/Game:* ${awards.goldenBoot.name} (${awards.goldenBoot.value})\n`;
    if (awards.mostImproved) output += `📈 *Most Improved:* ${awards.mostImproved.name} (+${awards.mostImproved.value} MMR)\n`;
    if (awards.richest) output += `💰 *Richest:* ${awards.richest.name} (${awards.richest.value} MW)\n`;
    if (awards.mostActive) output += `🔥 *Most Active:* ${awards.mostActive.name} (${awards.mostActive.value} matches)\n`;
    if (awards.bestDefense) output += `🛡️ *Best Defense:* ${awards.bestDefense.name} (${awards.bestDefense.value} conceded)\n`;
    if (awards.longestStreak) output += `🔥 *Best Streak:* ${awards.longestStreak.name} (${awards.longestStreak.value} wins)\n`;
    if (awards.cupSpecialist) output += `🏆 *Cup Specialist:* ${awards.cupSpecialist.name} (${awards.cupSpecialist.value} wins)\n`;

    output += `\n━━━━━━━━━━━━━━━━━━━━━━━\nTrophies awarded to winners!\n${BRAND}`;
    await sendText(sock, jid, output, msg);
    return;
  }

  // !awards history — show past seasons
  if (subcmd === 'history') {
    const history = Awards.getHistory();
    if (history.length === 0) {
      await sendText(sock, jid, `📋 No completed seasons yet.`, msg);
      return;
    }
    let output = `📋 *SEASON HISTORY*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    for (const season of history.slice(-5)) {
      output += `📅 *Season ${season.season}*\n`;
      output += `Completed: ${new Date(season.completedAt).toLocaleDateString()}\n`;
      const a = season.awards;
      if (a.topScorer) output += `  ⚽ ${a.topScorer.name} (${a.topScorer.value} goals)\n`;
      if (a.bestManager) output += `  👔 ${a.bestManager.name} (${a.bestManager.value}% WR)\n`;
      output += `\n`;
    }
    output += `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`;
    await sendText(sock, jid, output, msg);
    return;
  }

  // Default: show current awards
  const awards = Awards.getAwards();
  let output = `🏆 *SEASON AWARDS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (!awards.topScorer && !awards.bestManager) {
    output += `No awards data yet. Keep playing to earn stats!\n\n`;
    output += `*Award Categories:*\n`;
    output += `• ⚽ Golden Boot (most goals)\n`;
    output += `• 🅰️ Playmaker (most assists)\n`;
    output += `• 🧤 Golden Glove (most clean sheets)\n`;
    output += `• 👔 Best Manager (highest win rate)\n`;
    output += `• 📈 Most Improved (biggest MMR gain)\n`;
    output += `• 💰 Richest Manager\n`;
    output += `• 🔥 Most Active\n`;
    output += `• 🛡️ Best Defense\n`;
    output += `• 🔥 Longest Win Streak\n`;
    output += `• 🏆 Cup Specialist\n`;
  } else {
    if (awards.topScorer) output += `⚽ *Golden Boot:* ${awards.topScorer.name} — ${awards.topScorer.value} goals\n`;
    if (awards.topAssist) output += `🅰️ *Playmaker:* ${awards.topAssist.name} — ${awards.topAssist.value} assists\n`;
    if (awards.topCleanSheets) output += `🧤 *Golden Glove:* ${awards.topCleanSheets.name} — ${awards.topCleanSheets.value} clean sheets\n`;
    if (awards.bestManager) output += `👔 *Best Manager:* ${awards.bestManager.name} — ${awards.bestManager.value}% win rate\n`;
    if (awards.goldenBoot) output += `🎯 *Best Goals/Game:* ${awards.goldenBoot.name} — ${awards.goldenBoot.value}\n`;
    if (awards.mostImproved) output += `📈 *Most Improved:* ${awards.mostImproved.name} — +${awards.mostImproved.value} MMR\n`;
    if (awards.richest) output += `💰 *Richest:* ${awards.richest.name} — ${(awards.richest.value/1000).toFixed(0)}K MW\n`;
    if (awards.mostActive) output += `🔥 *Most Active:* ${awards.mostActive.name} — ${awards.mostActive.value} matches\n`;
    if (awards.bestDefense) output += `🛡️ *Best Defense:* ${awards.bestDefense.name} — ${awards.bestDefense.value} conceded\n`;
    if (awards.longestStreak) output += `🔥 *Best Streak:* ${awards.longestStreak.name} — ${awards.longestStreak.value} wins\n`;
    if (awards.cupSpecialist) output += `🏆 *Cup Specialist:* ${awards.cupSpecialist.name} — ${awards.cupSpecialist.value} wins\n`;
  }

  output += `\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
  output += `Use *!awards history* to see past seasons\n${BRAND}`;
  await sendText(sock, jid, output, msg);
}

module.exports = { handle: awardsCommand };
