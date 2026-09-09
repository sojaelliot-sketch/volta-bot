'use strict';
// test_league.js — correctness tests for the division league.
//
// The league is the one system where a bug is invisible until it has already
// ruined somebody's week: tables silently corrupt, a manager quietly ends up in
// two divisions, a champion is congratulated and paid nothing. None of it
// throws, so no error ever reaches the logs.
//
// Run:  node test_league.js

const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-league-'));

const db = require('./config/database');
const User = require('./models/User');
const League = require('./models/League');

let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); pass++; }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function eq(label, actual, expected) {
  ok(label, actual === expected, `expected ${expected}, got ${actual}`);
}

// Put a manager straight into a division with a given record.
function seat(div, jid, { points = 0, gf = 0, ga = 0, w = 0, d = 0, l = 0 } = {}) {
  const state = League.getState();
  state.standings[div] = state.standings[div] || {};
  state.standings[div][jid] = {
    played: w + d + l, wins: w, draws: d, losses: l,
    goalsFor: gf, goalsAgainst: ga,
    points: points || (w * 3 + d),
    form: [], promotedAt: null, relegatedAt: null,
  };
  League.updateState({ standings: state.standings });
}

function whereIs(jid) {
  const found = [];
  const state = League.getState();
  for (let d = 1; d <= League.TOTAL_DIVISIONS; d++) {
    if (state.standings[d] && state.standings[d][jid]) found.push(d);
  }
  return found;
}

function reset() {
  League.clearAll();
}

(async () => {
  await db.connectDB();

  // ── Movement counts ───────────────────────────────────────────────────
  console.log('\nMOVEMENT SIZING');
  eq('2-team division: nobody moves (up)', League.movementCounts(2).up, 0);
  eq('2-team division: nobody moves (down)', League.movementCounts(2).down, 0);
  eq('3-team division: 1 up, 0 down', League.movementCounts(3).up, 1);
  eq('3-team division: 0 down', League.movementCounts(3).down, 0);
  eq('5-team division: 1 up', League.movementCounts(5).up, 1);
  eq('8-team division: 2 up', League.movementCounts(8).up, 2);
  eq('8-team division: 2 down', League.movementCounts(8).down, 2);

  // ── The 3-player collision that used to corrupt the table ─────────────
  console.log('\nREGRESSION: 3-team division must not promote AND relegate the same manager');
  reset();
  seat(2, 'a@s.whatsapp.net', { w: 5 });     // 15 pts — top
  seat(2, 'b@s.whatsapp.net', { w: 3 });     //  9 pts — middle
  seat(2, 'c@s.whatsapp.net', { w: 1 });     //  3 pts — bottom
  let r = League.processPromotionRelegation();

  const bPlaces = whereIs('b@s.whatsapp.net');
  eq('middle manager exists in exactly one division', bPlaces.length, 1);
  ok('middle manager was not both promoted and relegated',
     !(r.promoted.some(m => m.jid === 'b@s.whatsapp.net') && r.relegated.some(m => m.jid === 'b@s.whatsapp.net')));
  eq('top manager promoted to Division 1', whereIs('a@s.whatsapp.net')[0], 1);

  // No record may be left without its stats.
  const stAll = League.getState().standings;
  let corrupt = 0;
  for (let d = 1; d <= League.TOTAL_DIVISIONS; d++) {
    for (const rec of Object.values(stAll[d] || {})) {
      if (typeof rec.points !== 'number' || typeof rec.goalsFor !== 'number') corrupt++;
    }
  }
  eq('no stat-less records created', corrupt, 0);

  // ── Nobody falls two divisions in one run ─────────────────────────────
  console.log('\nREGRESSION: a single run must move a manager at most one division');
  reset();
  for (let i = 0; i < 8; i++) seat(1, `d1_${i}@s.whatsapp.net`, { w: 8 - i });
  for (let i = 0; i < 8; i++) seat(2, `d2_${i}@s.whatsapp.net`, { w: 8 - i });
  for (let i = 0; i < 8; i++) seat(3, `d3_${i}@s.whatsapp.net`, { w: 8 - i });
  r = League.processPromotionRelegation();

  let jumped = 0;
  for (const m of [...r.promoted, ...r.relegated]) {
    if (Math.abs(m.to - m.from) !== 1) jumped++;
  }
  eq('every move is exactly one division', jumped, 0);

  // The manager relegated out of Division 1 must be sitting in Division 2,
  // not pushed straight through to Division 3.
  const droppedFrom1 = r.relegated.filter(m => m.from === 1);
  ok('relegated from D1 land in D2', droppedFrom1.every(m => whereIs(m.jid)[0] === 2));

  let duplicated = 0;
  const seen = new Set();
  for (let d = 1; d <= League.TOTAL_DIVISIONS; d++) {
    for (const jid of Object.keys(League.getState().standings[d] || {})) {
      if (seen.has(jid)) duplicated++;
      seen.add(jid);
    }
  }
  eq('no manager appears in two divisions', duplicated, 0);

  // ── Division 1 cannot promote, Division 4 cannot relegate ─────────────
  console.log('\nBOUNDARIES');
  ok('nobody promoted out of Division 1', !r.promoted.some(m => m.from === 1));
  ok('nobody relegated out of Division 4', !r.relegated.some(m => m.from === League.TOTAL_DIVISIONS));

  // ── Tiebreakers ───────────────────────────────────────────────────────
  console.log('\nTIEBREAKERS');
  reset();
  seat(2, 'level@s.whatsapp.net',  { w: 4, gf: 10, ga: 8 });  // 12 pts, GD +2
  seat(2, 'better@s.whatsapp.net', { w: 4, gf: 12, ga: 4 });  // 12 pts, GD +8
  seat(2, 'worst@s.whatsapp.net',  { w: 1, gf: 3,  ga: 9 });
  seat(2, 'filler@s.whatsapp.net', { w: 0 });
  const table = League.getDivisionStandings(2);
  eq('goal difference breaks a points tie', table[0].jid, 'better@s.whatsapp.net');

  // ── Champion is paid ──────────────────────────────────────────────────
  console.log('\nCHAMPION REWARD');
  reset();
  const champ = 'champ@s.whatsapp.net';
  User.create(champ, 'Winner FC');
  User.update(champ, { registered: true, currency: 500 });
  seat(1, champ, { w: 9, gf: 30, ga: 5 });
  seat(1, 'runnerup@s.whatsapp.net', { w: 4 });
  seat(1, 'third@s.whatsapp.net', { w: 1 });

  const before = User.getByWhatsappId(champ).currency;
  const ended = League.endCurrentWeek();
  const after = User.getByWhatsappId(champ).currency;
  eq('a champion was identified', ended.champions.length, 1);
  eq('champion is the top of the table', ended.champions[0].jid, champ);
  eq('champion reward actually credited', after - before, League.CHAMPION_REWARD);

  // Regression: !league end used to credit the prize inline AND via the model.
  reset();
  const dp = 'dp@s.whatsapp.net';
  User.create(dp, 'Double FC');
  User.update(dp, { registered: true, currency: 0 });
  seat(1, dp, { w: 9 });
  seat(1, 'n2@s.whatsapp.net', { w: 2 });
  seat(1, 'n3@s.whatsapp.net', { w: 1 });
  const endRes = League.endCurrentWeek();
  eq('prize paid exactly once', User.getByWhatsappId(dp).currency, League.CHAMPION_REWARD);
  eq('payout list has one entry', endRes.paid.length, 1);

  // AI entries must never be paid real currency.
  reset();
  seat(1, 'ai_player_0@s.whatsapp.net', { w: 9 });
  const aiEnded = League.endCurrentWeek();
  eq('AI champion is not paid', aiEnded.paid.length, 0);

  // ── Weekly reset ──────────────────────────────────────────────────────
  console.log('\nWEEKLY RESET');
  reset();
  const keep = 'keeper@s.whatsapp.net';
  User.create(keep, 'Keeper FC');
  User.update(keep, { registered: true, currency: 0 });
  seat(2, keep, { w: 6, d: 1, l: 1, gf: 20, ga: 9 });
  seat(2, 'x@s.whatsapp.net', { w: 2 });
  seat(2, 'y@s.whatsapp.net', { w: 1 });
  seat(2, 'z@s.whatsapp.net', { w: 0 });

  const weekBefore = League.getWeekInfo().week;
  const out = League.startNewWeek();
  const weekAfter = League.getWeekInfo().week;
  eq('week counter advanced', weekAfter, weekBefore + 1);

  const div = League.getPlayerDivision(keep);
  ok('manager still in the league after rollover', !!div);
  eq('points reset to zero', div.stats.points, 0);
  eq('played reset to zero', div.stats.played, 0);
  eq('goals for reset to zero', div.stats.goalsFor, 0);
  eq('form cleared', div.stats.form.length, 0);

  const hist = League.getLeagueHistory();
  ok('week recorded in history', hist.history.length > 0);

  // ── Integrity repair ──────────────────────────────────────────────────
  console.log('\nINTEGRITY REPAIR');
  reset();
  const st = League.getState();
  // Simulate exactly the damage the old code produced.
  st.standings[2]['ghost@s.whatsapp.net'] = { relegatedAt: '2026-01-01T00:00:00.000Z' };
  st.standings[3]['ghost@s.whatsapp.net'] = { relegatedAt: '2026-01-01T00:00:00.000Z' };
  st.standings[2]['wrong@s.whatsapp.net'] = {
    played: 99, wins: 3, draws: 1, losses: 1, goalsFor: 8, goalsAgainst: 4, points: 500, form: [],
  };
  League.updateState({ standings: st.standings });

  const repaired = League.repairIntegrity();
  eq('duplicate entry removed', repaired.duplicates, 1);
  eq('ghost record rebuilt', whereIs('ghost@s.whatsapp.net').length, 1);
  const wrong = League.getState().standings[2]['wrong@s.whatsapp.net'];
  eq('points recalculated from W/D', wrong.points, 10);
  eq('played recalculated from W+D+L', wrong.played, 5);

  const ghost = League.getState().standings[2]['ghost@s.whatsapp.net'];
  eq('ghost has numeric points', typeof ghost.points, 'number');
  ok('ghost goal difference is not NaN', Number.isFinite((ghost.goalsFor || 0) - (ghost.goalsAgainst || 0)));

  // ── AI seeding consistency ────────────────────────────────────────────
  console.log('\nAI SEEDING');
  reset();
  League.addAiPlayers(40);
  let inconsistent = 0;
  const s2 = League.getState().standings;
  for (let d = 1; d <= League.TOTAL_DIVISIONS; d++) {
    for (const rec of Object.values(s2[d] || {})) {
      if (rec.played !== rec.wins + rec.draws + rec.losses) inconsistent++;
      if (rec.points !== rec.wins * 3 + rec.draws) inconsistent++;
    }
  }
  eq('AI records are internally consistent', inconsistent, 0);

  console.log('\n' + '='.repeat(52));
  console.log(`LEAGUE TESTS: ${pass} passed, ${fail} failed`);
  console.log('='.repeat(52) + '\n');
  process.exit(fail ? 1 : 0);
})();
