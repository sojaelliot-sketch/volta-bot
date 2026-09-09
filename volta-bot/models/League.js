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
      // Everyone starts in Division 3 (Junior). There used to be a hardcoded
      // exception putting a specific manager name into Division 4.
      const division = 3;
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
      // Strength is persistent and tied to the division: Division 1 clubs are
      // genuinely better than Division 4 ones. Without this, AI teams had no
      // ability at all — they were rows of frozen numbers that could never win
      // or lose a game, so promotion was decided entirely by luck of the draw.
      const base = [0, 82, 74, 66, 58][division] || 66;
      const strength = Math.max(40, Math.min(95, base + Math.floor(Math.random() * 13) - 6));

      state.standings[division][aiId] = {
        ...getPlayerStats(),
        isAi: true,
        strength,
        name: `${names[nameIndex]}${suffix}`,
        // Seed a plausible record. These used to be three independent random
        // numbers, so `played` rarely matched wins + draws + losses and the
        // table showed impossible rows like "P4 W7 D2 L5".
        ...(() => {
          const wins = Math.floor(Math.random() * 8);
          const draws = Math.floor(Math.random() * 4);
          const losses = Math.floor(Math.random() * 8);
          const goalsFor = wins * 2 + draws + Math.floor(Math.random() * 6);
          const goalsAgainst = losses * 2 + draws + Math.floor(Math.random() * 6);
          return {
            played: wins + draws + losses,
            wins, draws, losses, goalsFor, goalsAgainst,
            points: wins * 3 + draws,
          };
        })(),
      };
      const stats = state.standings[division][aiId];
      aiIds.push({ id: aiId, name: stats.name, division });
    }
  }

  updateState({ standings: state.standings });
  return aiIds;
}


// ─── AI FIXTURES ─────────────────────────────────────────────────────────
//
// AI clubs used to be decorative: a name, a random seeded record, and nothing
// else, forever. Their rows never changed, so the table below you was static
// scenery and promotion was decided purely by whether real players happened to
// be in your division.
//
// They now play each other. Once per cycle every AI club in a division is paired
// off and a result is simulated from the two teams' strengths, so the table
// moves under you between your own matches — and a Division 1 AI side is
// genuinely hard to finish above.

const AI_STRENGTH_DEFAULT = 66;

function aiStrength(stats) {
  return typeof stats.strength === 'number' ? stats.strength : AI_STRENGTH_DEFAULT;
}

/**
 * Simulate one fixture from two strengths. Returns [goalsA, goalsB].
 *
 * Two things this deliberately does NOT do:
 *
 *   No home advantage. Pairing is a shuffle, so "side A" is arbitrary — a bonus
 *   for the first-named club is not a home crowd, it is a bug. An earlier draft
 *   gave A a +3 and equal teams then finished 40% / 26%, which would have quietly
 *   skewed every table in the game.
 *
 *   No steep curve. At a /14 divisor, a 22-point gap left the underdog winning
 *   0.9% of the time and the division was decided the moment strengths were
 *   assigned. At /26 the favourite is still clearly favoured and the underdog
 *   takes about one game in six, which is roughly what a real league looks like.
 */
function simulateFixture(strengthA, strengthB) {
  const edge = (strengthA - strengthB) / 26;
  const draw = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2.0;
  const a = Math.max(0, Math.round(1.35 + edge * 0.55 + draw()));
  const b = Math.max(0, Math.round(1.35 - edge * 0.55 + draw()));
  return [a, b];
}

function applyResult(stats, forGoals, againstGoals) {
  stats.played++;
  stats.goalsFor += forGoals;
  stats.goalsAgainst += againstGoals;
  if (forGoals > againstGoals) { stats.wins++; stats.points += 3; stats.form.push('W'); }
  else if (forGoals === againstGoals) { stats.draws++; stats.points += 1; stats.form.push('D'); }
  else { stats.losses++; stats.form.push('L'); }
  if (stats.form.length > 5) stats.form = stats.form.slice(-5);
}

/**
 * Play one round of AI-vs-AI fixtures in every division.
 * Returns a per-division count of fixtures played.
 */
function playAiRound() {
  const state = getState();
  const played = {};

  for (let div = 1; div <= TOTAL_DIVISIONS; div++) {
    const division = state.standings[div] || {};
    const ais = Object.entries(division).filter(([, st]) => st && st.isAi);
    if (ais.length < 2) { played[div] = 0; continue; }

    // Shuffle, then pair off. An odd club sits the round out, like a real bye.
    for (let i = ais.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ais[i], ais[j]] = [ais[j], ais[i]];
    }

    let count = 0;
    for (let i = 0; i + 1 < ais.length; i += 2) {
      const [, a] = ais[i];
      const [, b] = ais[i + 1];
      const [ga, gb] = simulateFixture(aiStrength(a), aiStrength(b));
      applyResult(a, ga, gb);
      applyResult(b, gb, ga);
      count++;
    }
    played[div] = count;
  }

  updateState({ standings: state.standings });
  return played;
}

/** Recent form of an entry, newest first, e.g. "W W D L W". */
function formString(stats) {
  const f = Array.isArray(stats.form) ? stats.form.slice(-5) : [];
  if (!f.length) return '—';
  return f.slice().reverse().join(' ');
}

/** Points from the last five, used for a form table. */
function formPoints(stats) {
  const f = Array.isArray(stats.form) ? stats.form.slice(-5) : [];
  return f.reduce((n, r) => n + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
}

/** The division sorted by recent form rather than the season table. */
function getFormTable(division) {
  const state = getState();
  const rows = Object.entries(state.standings[division] || {}).map(([jid, stats]) => ({
    jid,
    name: stats.name || null,
    isAi: !!stats.isAi,
    form: formString(stats),
    formPoints: formPoints(stats),
    played: stats.played || 0,
  }));
  rows.sort((a, b) => b.formPoints - a.formPoints || b.played - a.played);
  return rows;
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

// ─── SORTING ─────────────────────────────────────────────────────────────
// One comparator used everywhere, so the table you SEE is the table that
// decides promotion. Previously the champion was picked on points alone while
// the tables sorted on points → GD → GF, which could crown the wrong manager.
function compareStandings(a, b) {
  const pa = a.points || 0, pb = b.points || 0;
  if (pb !== pa) return pb - pa;
  const gdA = (a.goalsFor || 0) - (a.goalsAgainst || 0);
  const gdB = (b.goalsFor || 0) - (b.goalsAgainst || 0);
  if (gdB !== gdA) return gdB - gdA;
  const gfA = a.goalsFor || 0, gfB = b.goalsFor || 0;
  if (gfB !== gfA) return gfB - gfA;
  const wa = a.wins || 0, wb = b.wins || 0;
  if (wb !== wa) return wb - wa;
  return 0;
}

// ─── PROMOTION / RELEGATION ──────────────────────────────────────────────
//
// How many go up and down, scaled to the size of the division.
//
// The old code always took the top 2 and bottom 2. In a division of 3 that
// marked index 1 as BOTH promoted and relegated: the promotion loop deleted
// the player, then the relegation loop spread the now-undefined record into a
// new object, so the manager ended up sitting in two divisions at once with a
// stats record of `{ relegatedAt }` and nothing else. Every later goal-
// difference calculation on that record produced NaN, which silently corrupts
// the sort order of the whole table.
function movementCounts(size) {
  if (size <= 2) return { up: 0, down: 0 };   // too small to be meaningful
  if (size <= 3) return { up: 1, down: 0 };
  if (size <= 5) return { up: 1, down: 1 };
  return { up: 2, down: 2 };
}

function processPromotionRelegation() {
  const state = getState();
  const results = { promoted: [], relegated: [], stayed: [], champions: [] };

  // PHASE 1 — decide everything from an untouched snapshot.
  //
  // The old implementation mutated `state.standings` while looping divisions
  // 1→4. Players relegated out of Division 1 landed in Division 2 *before*
  // Division 2 was processed, so they were judged twice in a single run and
  // could fall two divisions at once. Deciding first, then applying, makes a
  // manager's movement depend only on the table they actually played in.
  const snapshot = {};
  for (let div = 1; div <= TOTAL_DIVISIONS; div++) {
    const entries = Object.entries(state.standings[div] || {})
      .map(([jid, stats]) => [jid, stats])
      .sort((a, b) => compareStandings(a[1], b[1]));
    snapshot[div] = entries;
  }

  const moves = [];   // { jid, from, to, kind }
  const movedJids = new Set();

  for (let div = 1; div <= TOTAL_DIVISIONS; div++) {
    const entries = snapshot[div];
    if (!entries.length) continue;

    const { up, down } = movementCounts(entries.length);
    const canPromote = div > 1;
    const canRelegate = div < TOTAL_DIVISIONS;

    const promoteCount = canPromote ? Math.min(up, entries.length) : 0;
    // Never let the promotion and relegation slices overlap.
    const relegateCount = canRelegate
      ? Math.min(down, Math.max(0, entries.length - promoteCount))
      : 0;

    for (let i = 0; i < promoteCount; i++) {
      const jid = entries[i][0];
      moves.push({ jid, from: div, to: div - 1, kind: 'promoted' });
      movedJids.add(jid);
    }
    for (let i = 0; i < relegateCount; i++) {
      const jid = entries[entries.length - 1 - i][0];
      if (movedJids.has(jid)) continue;   // belt and braces
      moves.push({ jid, from: div, to: div + 1, kind: 'relegated' });
      movedJids.add(jid);
    }
  }

  // Champion of Division 1, decided on the same comparator as the table.
  const div1 = snapshot[1];
  if (div1.length) {
    const [jid, stats] = div1[0];
    results.champions.push({
      jid,
      name: stats.name || null,
      division: 1,
      points: stats.points || 0,
      played: stats.played || 0,
      reward: CHAMPION_REWARD,
      week: state.currentWeek || 0,
      at: new Date().toISOString(),
    });
  }

  // PHASE 2 — apply. Build fresh standings so nothing can be left behind in
  // two places at once.
  const next = {};
  for (let div = 1; div <= TOTAL_DIVISIONS; div++) next[div] = {};

  const moveByJid = new Map(moves.map((m) => [m.jid, m]));
  for (let div = 1; div <= TOTAL_DIVISIONS; div++) {
    for (const [jid, stats] of snapshot[div]) {
      const move = moveByJid.get(jid);
      if (move && move.from === div) {
        const stamped = {
          ...stats,
          [move.kind === 'promoted' ? 'promotedAt' : 'relegatedAt']: new Date().toISOString(),
        };
        next[move.to][jid] = stamped;
        results[move.kind].push({ jid, from: move.from, to: move.to });
      } else {
        next[div][jid] = stats;
        results.stayed.push({ jid, division: div });
      }
    }
  }

  state.standings = next;
  updateState({ standings: next, lastProcessed: new Date().toISOString() });
  return results;
}

// ─── CHAMPION REWARD ─────────────────────────────────────────────────────
// CHAMPION_REWARD existed as a constant and was reported in the results
// object, but no code anywhere ever paid it — the Division 1 winner was
// congratulated and given nothing. This actually credits the account.
function payChampions(champions = []) {
  const User = require('./User');
  const paid = [];
  for (const champ of champions) {
    if (!champ || !champ.jid) continue;
    const user = User.getByWhatsappId(champ.jid);
    if (!user || !user.registered) continue;      // skip AI and ghosts
    try {
      User.update(champ.jid, { currency: (user.currency || 0) + (champ.reward || 0) });
      paid.push({ jid: champ.jid, name: user.name, amount: champ.reward || 0 });
    } catch (err) {
      require('../utils/logger').error({ err, jid: champ.jid }, 'Champion payout failed');
    }
  }
  return paid;
}

// ─── WEEK MANAGEMENT ─────────────────────────────────────────────────────
//
// A league week now genuinely resets. The old startNewWeek() read state
// BEFORE running promotion/relegation, cleared `form` on that stale copy, and
// then called updateState() with a patch that did not include `standings` —
// so the reset silently did nothing, and had the patch included standings it
// would have overwritten the promotion results with pre-promotion data.
//
// Points also carried over forever, which made the table a lifetime ranking
// rather than a weekly competition: whoever joined first stayed top.
function startNewWeek({ resetStats = true } = {}) {
  const before = getState();

  const results = processPromotionRelegation();
  const paid = payChampions(results.champions);

  // Re-read: processPromotionRelegation has just written new standings.
  const state = getState();
  const standings = state.standings || {};

  if (resetStats) {
    for (let div = 1; div <= TOTAL_DIVISIONS; div++) {
      for (const jid of Object.keys(standings[div] || {})) {
        const s = standings[div][jid];
        standings[div][jid] = {
          ...s,
          played: 0, wins: 0, draws: 0, losses: 0,
          goalsFor: 0, goalsAgainst: 0, points: 0,
          form: [],
        };
      }
    }
  }

  const champions = [...(before.champions || []), ...results.champions].slice(-20);
  const history = [...(before.history || []), {
    week: before.currentWeek || 0,
    endedAt: new Date().toISOString(),
    promoted: results.promoted.length,
    relegated: results.relegated.length,
    champion: results.champions[0] ? results.champions[0].jid : null,
  }].slice(-50);

  updateState({
    standings,
    champions,
    history,
    currentWeek: (before.currentWeek || 0) + 1,
    weekStart: new Date().toISOString(),
    weekEnd: getNextWeekEnd(),
    totalWeeks: (before.totalWeeks || 0) + 1,
  });

  return { results, paid, week: (before.currentWeek || 0) + 1 };
}

function endCurrentWeek() {
  const results = processPromotionRelegation();
  const paid = payChampions(results.champions);
  return { ...results, paid };
}

/** True when the current league week has run past its end time. */
function isWeekOver() {
  const state = getState();
  if (!state.weekEnd) return false;
  return Date.now() >= new Date(state.weekEnd).getTime();
}

// ─── INTEGRITY REPAIR ────────────────────────────────────────────────────
// Cleans up damage left by the old promotion logic: managers sitting in two
// divisions at once, records missing their stats, and points that disagree
// with the win/draw/loss columns.
function repairIntegrity() {
  const state = getState();
  const fixed = { duplicates: 0, rebuiltStats: 0, recalculatedPoints: 0 };
  const seen = new Map();   // jid -> division it is kept in

  for (let div = 1; div <= TOTAL_DIVISIONS; div++) {
    const division = state.standings[div] || (state.standings[div] = {});
    for (const jid of Object.keys(division)) {
      // Duplicate across divisions: keep the higher division (lower number).
      if (seen.has(jid)) {
        delete division[jid];
        fixed.duplicates++;
        continue;
      }
      seen.set(jid, div);

      const s = division[jid] || {};
      const numeric = ['played', 'wins', 'draws', 'losses', 'goalsFor', 'goalsAgainst', 'points'];
      let rebuilt = false;
      for (const k of numeric) {
        if (typeof s[k] !== 'number' || !Number.isFinite(s[k]) || s[k] < 0) {
          s[k] = 0;
          rebuilt = true;
        }
      }
      if (!Array.isArray(s.form)) { s.form = []; rebuilt = true; }
      if (s.form.length > 5) s.form = s.form.slice(-5);
      if (rebuilt) fixed.rebuiltStats++;

      // played must equal W+D+L, and points must follow from W and D.
      const decided = s.wins + s.draws + s.losses;
      if (s.played !== decided) s.played = decided;
      const truePoints = s.wins * 3 + s.draws;
      if (s.points !== truePoints) {
        s.points = truePoints;
        fixed.recalculatedPoints++;
      }
      division[jid] = s;
    }
  }

  updateState({ standings: state.standings });
  return fixed;
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
    goalDifference: (stats.goalsFor || 0) - (stats.goalsAgainst || 0),
  }));

  players.sort(compareStandings);

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

// ─── ADMIN: CLEAR ALL LEAGUE DATA ──────────────────────────────────────────
function clearAll() {
  const state = defaultLeagueState();
  db.update(TABLE, 'league', state);
  return state;
}

// ─── ADMIN: PAUSE / RESUME ─────────────────────────────────────────────────
function setPaused(paused) {
  return updateState({ paused: !!paused });
}

function isPaused() {
  const state = getState();
  return !!state.paused;
}

// ─── ADMIN: MANUAL PROMOTE TO DIVISION ─────────────────────────────────────
function promoteToDivision(whatsappId, targetDiv) {
  if (targetDiv < 1 || targetDiv > TOTAL_DIVISIONS) return { error: `Division must be 1-${TOTAL_DIVISIONS}.` };
  const state = getState();

  // Remove from current division
  let fromDiv = null;
  for (let div = 1; div <= TOTAL_DIVISIONS; div++) {
    if (state.standings[div]?.[whatsappId]) {
      fromDiv = div;
      delete state.standings[div][whatsappId];
      break;
    }
  }

  if (!fromDiv) return { error: 'Player not in any division.' };

  // Place in target division with fresh stats
  if (!state.standings[targetDiv]) state.standings[targetDiv] = {};
  state.standings[targetDiv][whatsappId] = getPlayerStats();

  updateState({ standings: state.standings });
  return { from: fromDiv, to: targetDiv };
}

// ─── ADMIN: RESET ALL PLAYERS TO A DIVISION ────────────────────────────────
function resetAllToDivision(targetDiv) {
  if (targetDiv < 1 || targetDiv > TOTAL_DIVISIONS) return { error: `Division must be 1-${TOTAL_DIVISIONS}.` };
  const state = getState();
  let moved = 0;

  // Collect all players from all divisions
  const allPlayers = [];
  for (let div = 1; div <= TOTAL_DIVISIONS; div++) {
    for (const [jid] of Object.entries(state.standings[div] || {})) {
      allPlayers.push(jid);
    }
  }

  // Clear all divisions
  for (let div = 1; div <= TOTAL_DIVISIONS; div++) {
    state.standings[div] = {};
  }

  // Place everyone in target division
  if (!state.standings[targetDiv]) state.standings[targetDiv] = {};
  for (const jid of allPlayers) {
    state.standings[targetDiv][jid] = getPlayerStats();
    moved++;
  }

  updateState({ standings: state.standings });
  return { moved, division: targetDiv };
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
  isWeekOver,
  payChampions,
  repairIntegrity,
  playAiRound,
  simulateFixture,
  getFormTable,
  formString,
  formPoints,
  compareStandings,
  movementCounts,
  getPlayerDivision,
  getDivisionStandings,
  getAllDivisions,
  getWeekInfo,
  getLeagueHistory,
  clearAll,
  setPaused,
  isPaused,
  promoteToDivision,
  resetAllToDivision,
};
