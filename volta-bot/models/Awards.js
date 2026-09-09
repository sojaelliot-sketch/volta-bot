const db = require('../config/database');
const User = require('./User');
const Player = require('./Player');
const League = require('./League');

const TABLE = 'awards';

function getState() {
  let state = db.findById(TABLE, 'awards');
  if (!state) {
    state = { currentSeason: 1, history: [], currentAwards: {} };
    db.insert(TABLE, 'awards', state);
  }
  return state;
}

function updateState(patch) {
  return db.update(TABLE, 'awards', patch);
}

function calculateSeasonAwards() {
  const users = User.all().filter(u => u.registered);
  const allPlayers = Player.all();

  // Highest goal scorer
  let topScorer = null;
  let topGoals = 0;
  for (const u of users) {
    const goals = u.totalGoals || 0;
    if (goals > topGoals) {
      topGoals = goals;
      topScorer = { userId: u.whatsappId, name: u.name, value: goals };
    }
  }

  // Highest assists
  let topAssist = null;
  let topAssists = 0;
  for (const u of users) {
    const assists = u.totalAssists || 0;
    if (assists > topAssists) {
      topAssists = assists;
      topAssist = { userId: u.whatsappId, name: u.name, value: assists };
    }
  }

  // Most clean sheets
  let topCleanSheets = null;
  let mostCleanSheets = 0;
  for (const u of users) {
    const cs = u.goalsConceded || 0;
    if (cs > mostCleanSheets) {
      mostCleanSheets = cs;
      topCleanSheets = { userId: u.whatsappId, name: u.name, value: cs };
    }
  }

  // Best manager (highest win rate with min 10 games)
  let bestManager = null;
  let bestWinRate = 0;
  for (const u of users) {
    const totalGames = (u.wins || 0) + (u.losses || 0) + (u.draws || 0);
    if (totalGames >= 10) {
      const wr = ((u.wins || 0) / totalGames) * 100;
      if (wr > bestWinRate) {
        bestWinRate = wr;
        bestManager = { userId: u.whatsappId, name: u.name, value: Math.round(wr) };
      }
    }
  }

  // Golden Boot (highest goals per game ratio, min 5 games)
  let goldenBoot = null;
  let bestGoalsPerGame = 0;
  for (const u of users) {
    const totalGames = (u.wins || 0) + (u.losses || 0) + (u.draws || 0);
    if (totalGames >= 5) {
      const gpg = (u.totalGoals || 0) / totalGames;
      if (gpg > bestGoalsPerGame) {
        bestGoalsPerGame = gpg;
        goldenBoot = { userId: u.whatsappId, name: u.name, value: gpg.toFixed(2) };
      }
    }
  }

  // Most improved (biggest MMR gain)
  let mostImproved = null;
  let biggestMMRGain = 0;
  for (const u of users) {
    const gain = (u.mmr || 1000) - 1000;
    if (gain > biggestMMRGain) {
      biggestMMRGain = gain;
      mostImproved = { userId: u.whatsappId, name: u.name, value: gain };
    }
  }

  // Rich list
  let richest = null;
  let maxBalance = 0;
  for (const u of users) {
    const bal = u.currency || 0;
    if (bal > maxBalance) {
      maxBalance = bal;
      richest = { userId: u.whatsappId, name: u.name, value: bal };
    }
  }

  // Most active (most matches played)
  let mostActive = null;
  let mostMatches = 0;
  for (const u of users) {
    const matches = (u.wins || 0) + (u.losses || 0) + (u.draws || 0);
    if (matches > mostMatches) {
      mostMatches = matches;
      mostActive = { userId: u.whatsappId, name: u.name, value: matches };
    }
  }

  // Best defense (fewest goals conceded)
  let bestDefense = null;
  let fewestConceded = Infinity;
  for (const u of users) {
    const conceded = u.goalsConceded || 0;
    const totalGames = (u.wins || 0) + (u.losses || 0) + (u.draws || 0);
    if (totalGames >= 5 && conceded < fewestConceded) {
      fewestConceded = conceded;
      bestDefense = { userId: u.whatsappId, name: u.name, value: conceded };
    }
  }

  // Longest win streak
  let longestStreak = null;
  let maxStreak = 0;
  for (const u of users) {
    const streak = u.bestStreak || 0;
    if (streak > maxStreak) {
      maxStreak = streak;
      longestStreak = { userId: u.whatsappId, name: u.name, value: streak };
    }
  }

  // Cup specialist (most tournament wins)
  let cupSpecialist = null;
  let mostTourneyWins = 0;
  for (const u of users) {
    const tourneyWins = u.tournamentWins || 0;
    if (tourneyWins > mostTourneyWins) {
      mostTourneyWins = tourneyWins;
      cupSpecialist = { userId: u.whatsappId, name: u.name, value: tourneyWins };
    }
  }

  return {
    topScorer,
    topAssist,
    topCleanSheets,
    bestManager,
    goldenBoot,
    mostImproved,
    richest,
    mostActive,
    bestDefense,
    longestStreak,
    cupSpecialist,
  };
}

function awardTrophy(userId, type, name) {
  const user = User.getByWhatsappId(userId);
  if (!user) return;
  const trophies = user.trophies || {};
  if (!trophies[type]) trophies[type] = [];
  trophies[type].push({ name, date: new Date().toISOString() });
  User.update(userId, { trophies });
}

function endSeason() {
  const state = getState();
  const awards = calculateSeasonAwards();

  // Award trophies
  if (awards.topScorer) awardTrophy(awards.topScorer.userId, 'achievements', 'Golden Boot - Top Scorer');
  if (awards.topAssist) awardTrophy(awards.topAssist.userId, 'achievements', 'Playmaker Award - Most Assists');
  if (awards.topCleanSheets) awardTrophy(awards.topCleanSheets.userId, 'achievements', 'Golden Glove - Most Clean Sheets');
  if (awards.bestManager) awardTrophy(awards.bestManager.userId, 'achievements', 'Best Manager of the Season');
  if (awards.goldenBoot) awardTrophy(awards.goldenBoot.userId, 'achievements', 'Golden Boot - Best Goals/Game');
  if (awards.mostImproved) awardTrophy(awards.mostImproved.userId, 'achievements', 'Most Improved Manager');
  if (awards.richest) awardTrophy(awards.richest.userId, 'achievements', 'Richest Manager');
  if (awards.mostActive) awardTrophy(awards.mostActive.userId, 'achievements', 'Most Active Manager');
  if (awards.bestDefense) awardTrophy(awards.bestDefense.userId, 'achievements', 'Best Defense Award');
  if (awards.longestStreak) awardTrophy(awards.longestStreak.userId, 'achievements', 'Longest Win Streak');
  if (awards.cupSpecialist) awardTrophy(awards.cupSpecialist.userId, 'achievements', 'Cup Specialist');

  state.history.push({
    season: state.currentSeason,
    awards,
    completedAt: new Date().toISOString(),
  });
  state.currentSeason++;
  state.currentAwards = awards;
  updateState({ ...state });

  return awards;
}

function getAwards() {
  const state = getState();
  return state.currentAwards || calculateSeasonAwards();
}

function getHistory() {
  const state = getState();
  return state.history || [];
}

module.exports = {
  getState,
  calculateSeasonAwards,
  endSeason,
  getAwards,
  getHistory,
  awardTrophy,
};
