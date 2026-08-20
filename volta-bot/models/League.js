// models/League.js
// Division league system: Division 4 (Academy) → Division 1 (Elite Division)
// Weekly cycles with promotion/relegation

const db = require('../config/database');

const TABLE = 'leagues';

// Division names and metadata
const DIVISIONS = {
  4: { name: 'Division 4', subtitle: 'Academy Division', emoji: '🎓', color: '⚪' },
  3: { name: 'Division 3', subtitle: 'Junior Division', emoji: '📚', color: '🔵' },
  2: { name: 'Division 2', subtitle: 'Championship Division', emoji: '🏆', color: '🟣' },
  1: { name: 'Division 1', subtitle: 'Elite Division', emoji: '👑', color: '🟡' },
};

const TOTAL_DIVISIONS = 4;
const CHAMPION_REWARD = 1000000; // 1M Metaworks

// ─── DEFAULT STATE ───────────────────────────────────────────────────────
function defaultLeagueState() {
  const state = {
    // Current week tracking
    currentWeek: 1,
    weekStart: new Date().toISOString(),
    weekEnd: getNextWeekEnd(),
    lastProcessed: null,

    // Division standings: { [division]: { [whatsappId]: stats } }
    standings: {},

    // Promotion/relegation history
    history: [],

    // Season stats
    seasonStart: new Date().toISOString(),
    totalWeeks: 0,
    champions: [],
  };

  // Initialize empty divisions
  for (let div = 1; div <= TOTAL_DIVISIONS; div++) {
    state.standings[div] = {};
  }

  return state;
}

function getNextWeekEnd() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday
  const daysUntilSunday = (7 - dayOfWeek) % 7 || 7;
  const nextSunday = new Date(now);
  nextSunday.setDate(now.getDate() + daysUntilSunday);
  nextSunday.setHours(23, 59, 59, 999);
  return nextSunday.toISOString();
}

// ─── STATE MANAGEMENT ────────────────────────────────────────────────────
function getState() {
  let state = db.findById(TABLE, 'league');
  if (!state) {
    state = defaultLeagueState();
    db.insert(TABLE, 'league', state);
  }
  return state;
}

function updateState(patch) {
  return db.update(TABLE, 'league', patch);
}

// ─── DIVISION ASSIGNMENT ─────────────────────────────────────────────────
function assignDivision(whatsappId) {
  const state = getState();

  // Check if user is already in a division
  for (let div = 1; div <= TOTAL_DIVISIONS; div++) {
    if (state.standings[div]?.[whatsappId]) {
      return div;
    }
  }

  // New player → Division 3 (Junior Division)
  const division = 3;
  if (!state.standings[division]) state.standings[division] = {};
  state.standings[division][whatsappId] = getPlayerStats();
  updateState({ standings: state.standings });
  return division;
}

function getPlayerStats() {
  return {
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
    form: [], // Last 5 match results: 'W', 'D', 'L'
    promotedAt: null,
    relegatedAt: null,
  };
}

// ─── INITIALIZE EXISTING PLAYERS ─────────────────────────────────────────
// All existing players → Division 3, except Hudson → Division 4
function initializeExistingPlayers() {
  const User = require('./User');
  const state = getState();

  const users = User.all().filter(u => u.registered);

  for (const user of users) {
    const jid = user.whatsappId;

    // Check if already in a division
    let alreadyInDivision = false;
    for (let div = 1; div <= TOTAL_DIVISIONS; div++) {
      if (state.standings[div]?.[jid]) {
        alreadyInDivision = true;
        break;
      }
    }

    if (!alreadyInDivision) {
      // Hudson goes to Division 4, everyone else to Division 3
      const division = user.name === 'Hudson' ? 4 : 3;
      if (!state.standings[division]) state.standings[division] = {};
      state.standings[division][jid] = getPlayerStats();
    }
  }

  updateState({ standings: state.standings });
  return state;
}

// ─── ADD AI PLAYERS ──────────────────────────────────────────────────────
// Generate AI players to populate divisions
function addAiPlayers(count = 250) {
  const state = getState();

  const names = [
    'Phoenix FC', 'United Falcons', 'Red Stars', 'Blue Warriors', 'Golden Eagles',
    'Silver Hawks', 'Iron Wolves', 'Thunder FC', 'Lightning Bolts', 'Storm United',
    'Royal Kings', 'Crown Jewels', 'Diamond FC', 'Ruby Rangers', 'Sapphire SC',
    'Emerald City', 'Topaz Town', 'Pearl Palace', 'Coral Club', 'Crystal Castle',
    'Shadow FC', 'Dark Knights', 'Night Owls', 'Moon Stars', 'Sun United',
    'Fire FC', 'Water Works', 'Earth United', 'Wind FC', 'Ice Bears',
    'Dragon FC', 'Tiger Town', 'Lion Legends', 'Bear FC', 'Wolf Pack',
    'Eagle Eyes', 'Hawk FC', 'Fox United', 'Shark FC', 'Panther Pride',
    'Leopard FC', 'Cheetah United', 'Rhino FC', 'Gorilla Galaxy', 'Elephant FC',
    'Whale FC', 'Dolphin United', 'Octopus FC', 'Penguin FC', 'Seal SC',
  ];

  const aiIds = [];
  for (let i = 0; i < count; i++) {
    const aiId = `ai_player_${i}@s.whatsapp.net`;
    const division = Math.floor(Math.random() * TOTAL_DIVISIONS) + 1;
    const nameIndex = i % names.length;
    const suffix = i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : '';

    // Check if already exists
    let alreadyExists = false;
    for (let div = 1; div <= TOTAL_DIVISIONS; div++) {
      if (state.standings[div]?.[aiId]) {
        alreadyExists = true;
        break;
      }
    }

    if (!alreadyExists) {
      if (!state.standings[division]) state.standings[division] = {};
      state.standings[division][aiId] = {
        ...getPlayerStats(),
        isAi: true,
        name: `${names[nameIndex]}${suffix}`,
        // Random initial stats
        played: Math.floor(Math.random() * 20),
        wins: Math.floor(Math.random() * 10),
        draws: Math.floor(Math.random() * 5),
        losses: Math.floor(Math.random() * 10),
        goalsFor: Math.floor(Math.random() * 30),
        goalsAgainst: Math.floor(Math.random() * 30),
        points: 0,
      };
      // Calculate points
      const stats = state.standings[division][aiId];
      stats.points = stats.wins * 3 + stats.draws;
      aiIds.push({ id: aiId, name: stats.name, division });
    }
  }

  updateState({ standings: state.standings });
  return aiIds;
}

// ─── REMOVE AI PLAYERS ───────────────────────────────────────────────────
function removeAiPlayers() {
  const state = getState();
  let removed = 0;

  for (let div = 1; div <= TOTAL_DIVISIONS; div++) {
    const division = state.standings[div] || {};
    for (const [jid, stats] of Object.entries(division)) {
      if (stats.isAi) {
        delete division[jid];
        removed++;
      }
    }
  }

  updateState({ standings: state.standings });
  return removed;
}
function recordMatch(whatsappId, { goalsFor, goalsAgainst, isWin, isDraw }) {
  const state = getState();

  // Find which division this player is in
  let playerDivision = null;
  for (let div = 1; div <= TOTAL_DIVISIONS; div++) {
    if (state.standings[div]?.[whatsappId]) {
      playerDivision = div;
      break;
    }
  }

  if (!playerDivision) {
    // Player not in league, auto-assign to Division 3
    playerDivision = assignDivision(whatsappId);
  }

  const stats = state.standings[playerDivision][whatsappId];
  stats.played++;
  stats.goalsFor += goalsFor || 0;
  stats.goalsAgainst += goalsAgainst || 0;

  if (isWin) {
    stats.wins++;
    stats.points += 3;
    stats.form.push('W');
  } else if (isDraw) {
    stats.draws++;
    stats.points += 1;
    stats.form.push('D');
  } else {
    stats.losses++;
    stats.form.push('L');
  }

  // Keep only last 5 form results
  if (stats.form.length > 5) stats.form = stats.form.slice(-5);

  state.standings[playerDivision][whatsappId] = stats;
  updateState({ standings: state.standings });
  return stats;
}

// ─── PROMOTION / RELEGATION ──────────────────────────────────────────────
function processPromotionRelegation() {
  const state = getState();
  const results = { promoted: [], relegated: [], stayed: [], champions: [] };

  for (let div = 1; div <= TOTAL_DIVISIONS; div++) {
    const division = state.standings[div] || {};
    const players = Object.entries(division);

    if (players.length === 0) continue;

    // Sort by points (desc), then goal difference, then goals for
    players.sort((a, b) => {
      const statsA = a[1];
      const statsB = b[1];
      if (statsB.points !== statsA.points) return statsB.points - statsA.points;
      const gdA = statsA.goalsFor - statsA.goalsAgainst;
      const gdB = statsB.goalsFor - statsB.goalsAgainst;
      if (gdB !== gdA) return gdB - gdA;
      return statsB.goalsFor - statsA.goalsFor;
    });

    // Special case: if only 2 players, both stay
    if (players.length === 2) {
      for (const [jid] of players) {
        results.stayed.push({ jid, division: div });
      }
      continue;
    }

    // Normal case: top 2 promoted (if not Division 1), bottom 2 relegated (if not Division 7)
    const promoted = [];
    const relegated = [];

    if (players.length >= 2) {
      // Top 2 → promoted
      if (div > 1) { // Can't promote from Division 1
        for (let i = 0; i < Math.min(2, players.length); i++) {
          promoted.push(players[i][0]);
        }
      }

      // Bottom 2 → relegated
      if (div < TOTAL_DIVISIONS) { // Can't relegate from Division 7
        for (let i = players.length - 1; i >= Math.max(0, players.length - 2); i--) {
          relegated.push(players[i][0]);
        }
      }
    }

    // Apply promotions
    for (const jid of promoted) {
      if (div > 1) {
        const newDiv = div - 1;
        if (!state.standings[newDiv]) state.standings[newDiv] = {};
        state.standings[newDiv][jid] = { ...division[jid], promotedAt: new Date().toISOString() };
        delete division[jid];
        results.promoted.push({ jid, from: div, to: newDiv });
      }
    }

    // Apply relegations
    for (const jid of relegated) {
      if (div < TOTAL_DIVISIONS) {
        const newDiv = div + 1;
        if (!state.standings[newDiv]) state.standings[newDiv] = {};
        state.standings[newDiv][jid] = { ...division[jid], relegatedAt: new Date().toISOString() };
        delete division[jid];
        results.relegated.push({ jid, from: div, to: newDiv });
      }
    }

    // Players who stayed
    for (const [jid] of players) {
      if (!promoted.includes(jid) && !relegated.includes(jid)) {
        results.stayed.push({ jid, division: div });
      }
    }
  }

  // Check Division 1 champion (top player in Division 1)
  const div1 = state.standings[1] || {};
  const div1Players = Object.entries(div1);
  if (div1Players.length > 0) {
    div1Players.sort((a, b) => b[1].points - a[1].points);
    const champion = div1Players[0];
    results.champions.push({
      jid: champion[0],
      division: 1,
      points: champion[1].points,
      reward: CHAMPION_REWARD,
    });
  }

  // Update state
  updateState({
    standings: state.standings,
    lastProcessed: new Date().toISOString(),
  });

  return results;
}

// ─── WEEK MANAGEMENT ─────────────────────────────────────────────────────
function startNewWeek() {
  const state = getState();

  // Process promotion/relegation from previous week
  const results = processPromotionRelegation();

  // Reset standings for new week (keep points but reset form)
  for (let div = 1; div <= TOTAL_DIVISIONS; div++) {
    const division = state.standings[div] || {};
    for (const jid of Object.keys(division)) {
      // Keep cumulative stats, just reset form
      division[jid].form = [];
    }
  }

  const newState = {
    currentWeek: (state.currentWeek || 0) + 1,
    weekStart: new Date().toISOString(),
    weekEnd: getNextWeekEnd(),
    totalWeeks: (state.totalWeeks || 0) + 1,
  };

  updateState(newState);
  return { results, week: newState.currentWeek };
}

function endCurrentWeek() {
  return processPromotionRelegation();
}

// ─── QUERIES ─────────────────────────────────────────────────────────────
function getPlayerDivision(whatsappId) {
  const state = getState();
  for (let div = 1; div <= TOTAL_DIVISIONS; div++) {
    if (state.standings[div]?.[whatsappId]) {
      return { division: div, ...DIVISIONS[div], stats: state.standings[div][whatsappId] };
    }
  }
  return null;
}

function getDivisionStandings(division) {
  const state = getState();
  const divisionData = state.standings[division] || {};
  const players = Object.entries(divisionData).map(([jid, stats]) => ({
    jid,
    ...stats,
    goalDifference: stats.goalsFor - stats.goalsAgainst,
  }));

  // Sort by points, goal difference, goals for
  players.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    return b.goalsFor - a.goalsFor;
  });

  return players;
}

function getAllDivisions() {
  const result = {};
  for (let div = 1; div <= TOTAL_DIVISIONS; div++) {
    result[div] = {
      ...DIVISIONS[div],
      players: getDivisionStandings(div),
    };
  }
  return result;
}

function getWeekInfo() {
  const state = getState();
  const now = new Date();
  const end = new Date(state.weekEnd);
  const remaining = Math.max(0, end - now);
  const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
  const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  return {
    week: state.currentWeek,
    start: state.weekStart,
    end: state.weekEnd,
    timeLeft: `${days}d ${hours}h`,
    isActive: remaining > 0,
  };
}

function getLeagueHistory() {
  const state = getState();
  return {
    totalWeeks: state.totalWeeks || 0,
    champions: state.champions || [],
    history: state.history || [],
  };
}

module.exports = {
  DIVISIONS,
  TOTAL_DIVISIONS,
  CHAMPION_REWARD,
  getState,
  updateState,
  assignDivision,
  initializeExistingPlayers,
  addAiPlayers,
  removeAiPlayers,
  recordMatch,
  processPromotionRelegation,
  startNewWeek,
  endCurrentWeek,
  getPlayerDivision,
  getDivisionStandings,
  getAllDivisions,
  getWeekInfo,
  getLeagueHistory,
};
