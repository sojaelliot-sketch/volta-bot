const db = require('../config/database');
const User = require('./User');
const Player = require('./Player');

const TABLE = 'tournaments';

const DEFAULT_TOURNAMENTS = [
  // ──── CHAMPIONS CUP ────
  {
    id: 'champions_league',
    name: 'Champions League',
    type: 'cup',
    tier: 1,
    prize: 5000000,
    entryFee: 100000,
    maxParticipants: 32,
    minParticipants: 8,
    minOVR: 80,
    emoji: '🏆',
    description: 'The elite European club competition',
    requirements: { minWins: 50, minTrophies: 2, minMMR: 1200 },
    requiresQualification: false,
    brackets: true,
  },
  {
    id: 'europa_league',
    name: 'Europa League',
    type: 'cup',
    tier: 2,
    prize: 2500000,
    entryFee: 50000,
    maxParticipants: 32,
    minParticipants: 8,
    minOVR: 70,
    emoji: '🥈',
    description: 'Secondary European competition',
    requirements: { minWins: 30, minTrophies: 1, minMMR: 1100 },
    requiresQualification: false,
    brackets: true,
  },
  {
    id: 'conference_league',
    name: 'Conference League',
    type: 'cup',
    tier: 3,
    prize: 1000000,
    entryFee: 25000,
    maxParticipants: 32,
    minParticipants: 8,
    minOVR: 60,
    emoji: '🥉',
    description: 'Third-tier European competition',
    requirements: { minWins: 15, minTrophies: 0, minMMR: 1000 },
    requiresQualification: false,
    brackets: true,
  },

  // ──── DOMESTIC CUPS ────
  {
    id: 'fa_cup',
    name: 'FA Cup',
    type: 'cup',
    tier: 2,
    prize: 2000000,
    entryFee: 50000,
    maxParticipants: 64,
    minParticipants: 16,
    minOVR: 60,
    emoji: '🎯',
    description: 'The oldest knockout cup competition',
    requirements: { minWins: 10, minTrophies: 0, minMMR: 1000 },
    requiresQualification: false,
    brackets: true,
  },
  {
    id: 'carabao_cup',
    name: 'Carabao Cup',
    type: 'cup',
    tier: 3,
    prize: 1000000,
    entryFee: 25000,
    maxParticipants: 32,
    minParticipants: 8,
    minOVR: 55,
    emoji: '🥤',
    description: 'League cup competition',
    requirements: { minWins: 5, minTrophies: 0, minMMR: 950 },
    requiresQualification: false,
    brackets: true,
  },
  {
    id: 'community_shield',
    name: 'Community Shield',
    type: 'cup',
    tier: 2,
    prize: 1000000,
    entryFee: 0,
    maxParticipants: 2,
    minParticipants: 2,
    minOVR: 75,
    emoji: '🛡️',
    description: 'FA Cup winner vs Carabao Cup winner',
    requirements: {},
    requiresQualification: true,
    qualificationTournaments: ['fa_cup', 'carabao_cup'],
    brackets: true,
    isOneOff: true,
  },

  // ──── CONTINENTAL ────
  {
    id: 'copa_libertadores',
    name: 'Copa Libertadores',
    type: 'cup',
    tier: 1,
    prize: 4000000,
    entryFee: 100000,
    maxParticipants: 32,
    minParticipants: 8,
    minOVR: 75,
    emoji: '🌎',
    description: 'South American club championship',
    requirements: { minWins: 40, minTrophies: 2, minMMR: 1200 },
    requiresQualification: false,
    brackets: true,
  },
  {
    id: 'intercontinental_cup',
    name: 'Intercontinental Cup',
    type: 'cup',
    tier: 1,
    prize: 6000000,
    entryFee: 120000,
    maxParticipants: 8,
    minParticipants: 4,
    minOVR: 82,
    emoji: '🏅',
    description: 'Champions League winner vs Copa Libertadores winner',
    requirements: {},
    requiresQualification: true,
    qualificationTournaments: ['champions_league', 'copa_libertadores'],
    brackets: true,
    isOneOff: true,
  },
];

function getAllTournaments() {
  let state = db.findById(TABLE, 'tournaments');
  if (!state || !state.list) {
    state = { list: DEFAULT_TOURNAMENTS.map(t => ({
      ...t,
      participants: [],
      status: 'registration',
      winner: null,
      bracket: [],
      qualifiedTeams: [],
      results: [],
      startedAt: null,
      endedAt: null,
    }))};
    db.insert(TABLE, 'tournaments', state);
  }
  // Merge any new fields from DEFAULT_TOURNAMENTS into existing
  for (const def of DEFAULT_TOURNAMENTS) {
    const existing = state.list.find(t => t.id === def.id);
    if (existing) {
      for (const [k, v] of Object.entries(def)) {
        if (existing[k] === undefined) existing[k] = v;
      }
    }
  }
  return state.list;
}

function getTournament(id) {
  const state = db.findById(TABLE, 'tournaments');
  if (!state || !state.list) return null;
  return state.list.find(t => t.id === id);
}

function updateTournament(id, patch) {
  const state = db.findById(TABLE, 'tournaments');
  if (!state || !state.list) return null;
  const idx = state.list.findIndex(t => t.id === id);
  if (idx === -1) return null;
  Object.assign(state.list[idx], patch);
  db.update(TABLE, 'tournaments', { list: state.list });
  return state.list[idx];
}

function checkRequirements(userId, tournament) {
  const user = User.getByWhatsappId(userId);
  if (!user) return { ok: false, error: 'User not found' };

  const reqs = tournament.requirements || {};
  const totalGames = (user.wins || 0) + (user.losses || 0) + (user.draws || 0);
  const trophies = (user.trophies?.league?.length || 0) + (user.trophies?.tournaments?.length || 0) + (user.trophies?.cups?.length || 0);

  if (reqs.minWins && (user.wins || 0) < reqs.minWins) {
    return { ok: false, error: `Need ${reqs.minWins} wins (you have ${user.wins || 0})` };
  }
  if (reqs.minTrophies && trophies < reqs.minTrophies) {
    return { ok: false, error: `Need ${reqs.minTrophies} trophies (you have ${trophies})` };
  }
  if (reqs.minMMR && (user.mmr || 1000) < reqs.minMMR) {
    return { ok: false, error: `Need ${reqs.minMMR} MMR (you have ${user.mmr || 1000})` };
  }
  return { ok: true };
}

function checkOVR(userId, tournament) {
  const squad = Player.getByOwner(userId);
  if (squad.length === 0) return { ok: false, error: 'No players in squad' };
  const avgOVR = Math.round(squad.reduce((s, p) => s + (p.ovr || 70), 0) / squad.length);
  if (avgOVR < tournament.minOVR) {
    return { ok: false, error: `Need ${tournament.minOVR} OVR (you have ${avgOVR})` };
  }
  return { ok: true, avgOVR };
}

function canJoinTournament(userId, tournamentId) {
  const t = getTournament(tournamentId);
  if (!t) return { ok: false, error: 'Tournament not found' };
  if (t.status !== 'registration') return { ok: false, error: `Tournament is ${t.status}` };
  if (t.participants.length >= t.maxParticipants) return { ok: false, error: 'Tournament is full' };
  if (t.participants.find(p => p.userId === userId)) return { ok: false, error: 'Already joined' };

  // Check qualification requirement
  if (t.requiresQualification && t.qualificationTournaments) {
    const isQualified = t.qualifiedTeams && t.qualifiedTeams.includes(userId);
    if (!isQualified) {
      return { ok: false, error: `Must qualify through: ${t.qualificationTournaments.join(', ')}` };
    }
  }

  const reqCheck = checkRequirements(userId, t);
  if (!reqCheck.ok) return reqCheck;

  const ovrCheck = checkOVR(userId, t);
  if (!ovrCheck.ok) return ovrCheck;

  return { ok: true, entryFee: t.entryFee, avgOVR: ovrCheck.avgOVR };
}

function joinTournament(tournamentId, userId) {
  const canJoin = canJoinTournament(userId, tournamentId);
  if (!canJoin.ok) return { error: canJoin.error };

  const t = getTournament(tournamentId);
  t.participants.push({
    userId,
    joinedAt: new Date().toISOString(),
    wins: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    matches: [],
  });
  updateTournament(tournamentId, { participants: t.participants });
  return { success: true, entryFee: canJoin.entryFee, avgOVR: canJoin.avgOVR };
}

function leaveTournament(tournamentId, userId) {
  const t = getTournament(tournamentId);
  if (!t) return { error: 'Tournament not found' };
  const idx = t.participants.findIndex(p => p.userId === userId);
  if (idx === -1) return { error: 'Not in this tournament' };
  t.participants.splice(idx, 1);
  updateTournament(tournamentId, { participants: t.participants });
  return { success: true };
}

function qualifiesFor(userId, tournamentId) {
  const t = getTournament(tournamentId);
  if (!t) return false;
  if (!t.requiresQualification) return true;
  return t.qualifiedTeams && t.qualifiedTeams.includes(userId);
}

function addQualifiedTeam(tournamentId, userId) {
  const t = getTournament(tournamentId);
  if (!t) return;
  if (!t.qualifiedTeams) t.qualifiedTeams = [];
  if (!t.qualifiedTeams.includes(userId)) {
    t.qualifiedTeams.push(userId);
    updateTournament(tournamentId, { qualifiedTeams: t.qualifiedTeams });
  }
}

function startTournament(tournamentId) {
  const t = getTournament(tournamentId);
  if (!t) return { error: 'Tournament not found' };
  if (t.status !== 'registration') return { error: 'Tournament already started' };
  if (t.participants.length < t.minParticipants) {
    return { error: `Need at least ${t.minParticipants} participants (have ${t.participants.length})` };
  }

  // Generate bracket (seed by wins/MMR)
  const seeded = [...t.participants].sort((a, b) => {
    const userA = User.getByWhatsappId(a.userId);
    const userB = User.getByWhatsappId(b.userId);
    return (userB?.mmr || 1000) - (userA?.mmr || 1000);
  });

  const bracket = generateBracket(seeded);

  updateTournament(tournamentId, {
    status: 'active',
    bracket,
    startedAt: new Date().toISOString(),
  });

  return { success: true, bracket };
}

function generateBracket(participants) {
  const size = nextPowerOf2(participants.length);
  const bracket = [];

  // First round
  const firstRound = [];
  for (let i = 0; i < size; i += 2) {
    const team1 = participants[i] || null;
    const team2 = participants[i + 1] || null;
    firstRound.push({
      matchId: `r1_m${i / 2}`,
      round: 1,
      team1: team1?.userId || null,
      team2: team2?.userId || null,
      winner: team1 && !team2 ? team1.userId : team2 && !team1 ? team2.userId : null,
      score1: null,
      score2: null,
      status: team1 && team2 ? 'pending' : 'bye',
    });
  }
  bracket.push(firstRound);

  // Subsequent rounds
  let matchesInRound = firstRound.length / 2;
  let roundNum = 2;
  while (matchesInRound >= 1) {
    const round = [];
    for (let i = 0; i < matchesInRound; i++) {
      round.push({
        matchId: `r${roundNum}_m${i}`,
        round: roundNum,
        team1: null,
        team2: null,
        winner: null,
        score1: null,
        score2: null,
        status: 'waiting',
      });
    }
    bracket.push(round);
    matchesInRound = matchesInRound / 2;
    roundNum++;
  }

  return bracket;
}

function nextPowerOf2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function recordMatchResult(tournamentId, matchId, winnerId, score1, score2) {
  const t = getTournament(tournamentId);
  if (!t || !t.bracket) return;

  for (const round of t.bracket) {
    const match = round.find(m => m.matchId === matchId);
    if (match) {
      match.winner = winnerId;
      match.score1 = score1;
      match.score2 = score2;
      match.status = 'completed';

      // Update participant stats
      const winner = t.participants.find(p => p.userId === match.winner);
      const loserId = match.winner === match.team1 ? match.team2 : match.team1;
      const loser = t.participants.find(p => p.userId === loserId);

      if (winner) winner.wins++;
      if (loser) loser.losses++;

      // Advance winner to next round
      advanceWinner(t, match);
      break;
    }
  }

  updateTournament(tournamentId, { bracket: t.bracket, participants: t.participants });
}

function advanceWinner(t, completedMatch) {
  const currentRoundIdx = t.bracket.findIndex(r => r.some(m => m.matchId === completedMatch.matchId));
  if (currentRoundIdx >= t.bracket.length - 1) {
    // This was the final
    t.winner = completedMatch.winner;
    t.status = 'completed';
    t.endedAt = new Date().toISOString();
    return;
  }

  const nextRound = t.bracket[currentRoundIdx + 1];
  const matchIndexInRound = t.bracket[currentRoundIdx].indexOf(completedMatch);
  const nextMatchIdx = Math.floor(matchIndexInRound / 2);
  const nextMatch = nextRound[nextMatchIdx];

  if (matchIndexInRound % 2 === 0) {
    nextMatch.team1 = completedMatch.winner;
  } else {
    nextMatch.team2 = completedMatch.winner;
  }

  // If both teams set, match is ready
  if (nextMatch.team1 && nextMatch.team2) {
    nextMatch.status = 'pending';
  }
}

function getBracket(tournamentId) {
  const t = getTournament(tournamentId);
  if (!t || !t.bracket) return null;
  return t.bracket;
}

function getLeaderboard(tournamentId) {
  const t = getTournament(tournamentId);
  if (!t) return [];
  return t.participants
    .sort((a, b) => {
      const ptsA = a.wins * 3 + (a.goalsFor - a.goalsAgainst);
      const ptsB = b.wins * 3 + (b.goalsFor - b.goalsAgainst);
      return ptsB - ptsA;
    })
    .map((p, i) => ({ ...p, position: i + 1 }));
}

module.exports = {
  DEFAULT_TOURNAMENTS,
  getAllTournaments,
  getTournament,
  updateTournament,
  canJoinTournament,
  joinTournament,
  leaveTournament,
  qualifiesFor,
  addQualifiedTeam,
  startTournament,
  recordMatchResult,
  getBracket,
  getLeaderboard,
  checkRequirements,
};
