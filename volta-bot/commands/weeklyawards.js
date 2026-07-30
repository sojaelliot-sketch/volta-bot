// commands/weeklyawards.js
//   !weeklyawards — view this week's awards
//   !weeklyawards post — (owner) post weekly awards to the group
const User = require('../models/User');
const Player = require('../models/Player');
const db = require('../config/database');
const { sendText } = require('../utils/messaging');
const { BRAND, ECONOMY } = require('../config/constants');

const REWARD = 500;

function getWeekKey() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay());
  start.setHours(0, 0, 0, 0);
  return start.toISOString().split('T')[0];
}

function calculateAwards() {
  const matches = db.all('matches') || [];
  const weekKey = getWeekKey();
  const weekMatches = matches.filter((m) => {
    const d = new Date(m.createdAt || m.date);
    const start = new Date(weekKey);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return d >= start && d < end;
  });

  if (!weekMatches.length) return null;

  // Player of the Week — most goals + assists combined
  const playerStats = {};
  for (const m of weekMatches) {
    if (m.scorerStats) {
      for (const [id, stats] of Object.entries(m.scorerStats)) {
        if (!playerStats[id]) playerStats[id] = { goals: 0, assists: 0, motm: 0 };
        playerStats[id].goals += stats.goals || 0;
        playerStats[id].assists += stats.assists || 0;
      }
    }
    if (m.mvp) {
      if (!playerStats[m.mvp]) playerStats[m.mvp] = { goals: 0, assists: 0, motm: 0 };
      playerStats[m.mvp].motm++;
    }
  }

  let potw = null, potwScore = 0;
  for (const [id, stats] of Object.entries(playerStats)) {
    const score = stats.goals * 3 + stats.assists * 2 + stats.motm * 5;
    if (score > potwScore) {
      potwScore = score;
      potw = id;
    }
  }

  // Biggest Upset — match with biggest MMR difference where underdog won
  let biggestUpset = null;
  let upsetDiff = 0;
  for (const m of weekMatches) {
    if (m.isAI || !m.winnerId || m.winnerId === 'draw') continue;
    const winner = User.getByWhatsappId(m.winnerId);
    const loser = User.getByWhatsappId(m.loserId || (m.winnerId === m.homeId ? m.awayId : m.homeId));
    if (!winner || !loser) continue;
    const diff = Math.abs((winner.mmr || 1000) - (loser.mmr || 1000));
    if (diff > upsetDiff) {
      upsetDiff = diff;
      biggestUpset = { winner: winner.name, loser: loser.name, diff };
    }
  }

  // Longest Win Streak
  const users = db.all('users');
  let streakUser = null, streakCount = 0;
  for (const u of users) {
    if ((u.winStreak || 0) > streakCount) {
      streakCount = u.winStreak;
      streakUser = u.name;
    }
  }

  return { potw, potwScore, biggestUpset, streakUser, streakCount, matchesPlayed: weekMatches.length };
}

async function handle({ sock, msg, jid, sender, args }) {
  const subcmd = (args[0] || '').toLowerCase();

  // !weeklyawards post — owner only
  if (subcmd === 'post') {
    const user = User.getByWhatsappId(sender);
    if (!User.isOwner(sender)) {
      await sendText(sock, jid, `⛔ Only the owner can post weekly awards.`, msg);
      return;
    }
    const awards = calculateAwards();
    if (!awards) {
      await sendText(sock, jid, `📊 No matches played this week yet.`, msg);
      return;
    }
    const potwPlayer = awards.potw ? Player.getById(awards.potw) : null;
    const lines = [
      `🏆 *WEEKLY AWARDS* — Week of ${getWeekKey()}`,
      `━━━━━━━━━━━━━━━━━━━━━━━`,
      `⚽ *Player of the Week:* ${potwPlayer ? `${potwPlayer.name} (${awards.potw})` : '—'}`,
      `   ${awards.potwScore} points (goals×3 + assists×2 + MOTM×5)`,
      ``,
    ];
    if (awards.biggestUpset) {
      lines.push(`📈 *Biggest Upset:* ${awards.biggestUpset.winner} beat ${awards.biggestUpset.loser}`);
      lines.push(`   ${awards.biggestUpset.diff} MMR underdog difference`);
    } else {
      lines.push(`📈 *Biggest Upset:* —`);
    }
    lines.push(`🔥 *Longest Win Streak:* ${awards.streakUser || '—'} (${awards.streakCount} wins)`);
    lines.push(`📊 Matches played this week: ${awards.matchesPlayed}`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`${BRAND}`);
    await sendText(sock, jid, lines.join('\n'), msg);
    return;
  }

  // !weeklyawards — view
  const awards = calculateAwards();
  if (!awards) {
    await sendText(sock, jid, `📊 No matches played this week yet.`, msg);
    return;
  }
  const potwPlayer = awards.potw ? Player.getById(awards.potw) : null;
  const lines = [
    `🏆 *WEEKLY AWARDS*`,
    `━━━━━━━━━━━━━━━━━━━━━━━`,
    `⚽ *Player of the Week:* ${potwPlayer ? `${potwPlayer.name}` : '—'}`,
    awards.biggestUpset ? `📈 *Biggest Upset:* ${awards.biggestUpset.winner} beat ${awards.biggestUpset.loser}` : `📈 *Biggest Upset:* —`,
    `🔥 *Longest Win Streak:* ${awards.streakUser || '—'} (${awards.streakCount} wins)`,
    `📊 Matches: ${awards.matchesPlayed}`,
    `━━━━━━━━━━━━━━━━━━━━━━━`,
    `💡 *!weeklyawards post* — owner posts to group`,
    BRAND,
  ];
  await sendText(sock, jid, lines.join('\n'), msg);
}

module.exports = { handle, calculateAwards, getWeekKey };
