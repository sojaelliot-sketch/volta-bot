// test/feature_test.js
// Standalone harness to exercise every new/changed feature WITHOUT a live bot.
// Run from repo root: node test/feature_test.js
const os = require('os');
const path = require('path');
const fs = require('fs');

const DATA = path.join(os.tmpdir(), 'volta-feat-test-' + Date.now());
fs.mkdirSync(DATA, { recursive: true });
process.env.DATA_DIR = DATA;
process.env.LOG_DIR = DATA;

const db = require('../config/database');
const User = require('../models/User');
const Player = require('../models/Player');
const { buildStarterSquad } = require('../utils/playerGenerator');
const stadiumUtil = require('../utils/stadium');
const stCmd = require('../commands/stadium');
const profileCmd = require('../commands/profile');
const shopCmd = require('../commands/shop');
const matchSession = require('../game-engine/matchSession');
const tourney = require('../game-engine/tournament');
const { STADIUM } = require('../config/constants');

// ─── fake whatsapp sock + capture ────────────────────────────────────────────
const sent = [];
const sock = {
  sendMessage: async (jid, content, opts) => {
    const entry = { jid, text: content && content.text, image: content && content.image, caption: content && content.caption };
    sent.push(entry);
    return { key: { id: 'test' } };
  },
  sendPresenceUpdate: async () => {},
};

function lastTexts(n = 5) { return sent.slice(-n).map(s => s.text).filter(Boolean); }
function clearSent() { sent.length = 0; }
function jidOf(n) { return `${n}@s.whatsapp.net`; }

async function makeUser(num, name) {
  const jid = jidOf(num);
  User.create(jid, name);
  const players = buildStarterSquad(jid);
  const ids = players.map(p => p.id);
  User.update(jid, { registered: true, startingXI: ids, bench: [], reserves: [] });
  return jid;
}

function ctx(sender, cmd, args = [], extra = {}) {
  return { sock, jid: sender, sender, cmd, args, msg: { key: { id: 'm' } }, user: User.getByWhatsappId(sender), ...extra };
}

// ─── tiny assert ─────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label); }
}

(async () => {
  await db.connectDB();

  console.log('\n=== 1. STADIUM COMMANDS (!stadium / !buystadium / !sellstadium / !pk) ===');
  const A = await makeUser('1111111111', 'Alpha FC');
  // give currency to buy
  User.update(A, { currency: 50000 });
  clearSent();
  await stCmd.handle(ctx(A, 'stadium'));
  const stadImg = sent.find(s => s.image);
  ok(stadImg && stadImg.caption.includes('Sunday Pitch'), '!stadium shows default Sunday Pitch card (caption)');
  ok(!!stadImg, '!stadium sent an image (stadium card)');

  clearSent();
  await stCmd.handle(ctx(A, 'buystadium', ['volta_colosseum']));
  ok((User.getByWhatsappId(A).stadium === 'volta_colosseum'), '!buystadium sets stadium to volta_colosseum');
  ok((User.getByWhatsappId(A).fanEnergy === 100), '!buystadium sets fanEnergy to 100');
  ok(lastTexts(1)[0].includes('VOLTA Colosseum'), '!buystadium confirms purchase');

  clearSent();
  await stCmd.handle(ctx(A, 'stadium'));
  const stadImg2 = sent.find(s => s.image);
  ok((stadImg2 && stadImg2.caption.includes('ONLINE')) || (stadImg2 && stadImg2.caption.includes('weather roof')), '!stadium shows weather roof status for Colosseum');

  // sell
  const beforeSell = User.getByWhatsappId(A).currency;
  clearSent();
  await stCmd.handle(ctx(A, 'sellstadium'));
  ok((User.getByWhatsappId(A).stadium === null), '!sellstadium reverts to Sunday Pitch (null)');
  ok((User.getByWhatsappId(A).currency > beforeSell), '!sellstadium refunds currency');
  ok(lastTexts(1)[0].includes('recovered'), '!sellstadium confirms refund');

  // buy invalid
  clearSent();
  await stCmd.handle(ctx(A, 'buystadium', ['nope']));
  ok(lastTexts(1)[0].includes('Usage'), '!buystadium invalid key shows usage');

  // pk toggle
  clearSent();
  await stCmd.handle(ctx(A, 'pk', ['on']));
  ok((User.getByWhatsappId(A).pkEnabled === true), '!pk on sets pkEnabled true');
  clearSent();
  await stCmd.handle(ctx(A, 'pk', ['off']));
  ok((User.getByWhatsappId(A).pkEnabled === false), '!pk off sets pkEnabled false');

  console.log('\n=== 2. STADIUM CATCH #1 — TRAINING MULTIPLIER ===');
  // Give A a stadium with known mult and a player to train
  User.update(A, { stadium: 'legends_dome', currency: 50000, fanEnergy: 100 });
  const p = Player.getSquadPlayers(A)[0];
  const before = p.stats.pace;
  // force a deterministic gain by stubbing Math.random for the roll to be "great"
  const realRandom = Math.random;
  Math.random = () => 0.05; // roll <= 70 => great roll (gain 2-4 base for non-elite)
  clearSent();
  await shopCmd.handle(ctx(A, 'train', [p.id]));
  Math.random = realRandom;
  const after = Player.getById(p.id).stats.pace;
  ok((after > before), `training increased pace (${before} -> ${after})`);
  // legends_dome mult = 2.0, base gain would be 2-4, boosted 4-8. Ensure boosted >= base expectation.
  ok((after - before) >= 2, `training gain present (delta ${after - before}, expect boosted by x2)`);

  console.log('\n=== 3. STADIUM CATCH #2 — HOME FAN-ENERGY BONUSES ===');
  const home = await makeUser('2222222222', 'Home FC');
  User.update(home, { stadium: 'volta_colosseum', fanEnergy: 100, currency: 50000 });
  const hb = stadiumUtil.homeBonuses(User.getByWhatsappId(home));
  ok((hb.active === true), 'homeBonuses active at full energy');
  ok((hb.momentum > 0 && hb.currencyMult > 1), 'homeBonuses give momentum + currency mult');
  // low energy => no bonus
  User.update(home, { fanEnergy: 10 });
  const hbLow = stadiumUtil.homeBonuses(User.getByWhatsappId(home));
  ok((hbLow.active === false), 'homeBonuses inactive at low energy (<40)');
  // energy adjust
  User.update(home, { fanEnergy: 50 });
  stadiumUtil.adjustFanEnergy(User.getByWhatsappId(home), 'win');
  ok((User.getByWhatsappId(home).fanEnergy === 62), 'adjustFanEnergy win +12 (50->62)');
  // dormant when unpaid upkeep (simulate stale upkeep)
  User.update(home, { upkeepLastPaid: new Date(Date.now() - 30 * 864e5).toISOString(), stadium: 'volta_colosseum', fanEnergy: 100 });
  const hbDormant = stadiumUtil.homeBonuses(User.getByWhatsappId(home));
  ok((hbDormant.active === false), 'homeBonuses dormant after upkeep grace expires');

  console.log('\n=== 4. STADIUM CATCH #3 — WEATHER IMMUNITY ===');
  const w = await makeUser('3333333333', 'Weather FC');
  User.update(w, { stadium: 'volta_colosseum', fanEnergy: 80, currency: 50000 });
  ok((stadiumUtil.blocksWeather(User.getByWhatsappId(w)) === true), 'Colosseum @energy80 blocks weather');
  User.update(w, { fanEnergy: 30 });
  ok((stadiumUtil.blocksWeather(User.getByWhatsappId(w)) === false), 'Colosseum @energy30 does NOT block (roof broken)');
  User.update(w, { stadium: 'local_ground', fanEnergy: 100 });
  ok((stadiumUtil.blocksWeather(User.getByWhatsappId(w)) === false), 'tier<3 stadium never blocks weather');

  console.log('\n=== 5. VS-AI MATCH (!play path) + MATCH IMAGE + HOME BONUS ===');
  const m = await makeUser('4444444444', 'Match FC');
  User.update(m, { stadium: 'city_arena', fanEnergy: 100, currency: 50000 });
  clearSent();
  const beforeBal = User.getByWhatsappId(m).currency;
  const session = await matchSession.startMatch(sock, m, 'AI', { chatJid: m, aiDifficulty: 'Medium' });
  const afterBal = User.getByWhatsappId(m).currency;
  ok((afterBal !== beforeBal), `vs-AI match awarded currency (${beforeBal} -> ${afterBal})`);
  ok(sent.some(s => s.image && s.caption), 'vs-AI match sent full-time image card');
  ok((session.weather === 'raining' || session.weather === 'clear'), 'match assigned weather');

  console.log('\n=== 6. PROFILE RENDERER in !info ===');
  const i = await makeUser('5555555555', 'Info FC');
  clearSent();
  await profileCmd.handle(ctx(i, 'info', [], { mentioned: i }));
  // info with no target falls back to resolveTarget; use self profile instead
  clearSent();
  await profileCmd.handle(ctx(i, 'profile'));
  ok(sent.some(s => s.image && s.caption && s.caption.includes('profile')), '!profile sends profile card image');
  ok(sent.some(s => s.text && s.text.includes('Squad OVR')), '!profile also sends text block');

  console.log('\n=== 7. TOURNAMENT DRAW -> PK (interactive PvP finishPvP path) ===');
  const T1 = await makeUser('6666666666', 'TourA');
  const T2 = await makeUser('7777777777', 'TourB');
  User.update(T1, { currency: 50000 });
  User.update(T2, { currency: 50000 });
  // Build a tournament manually (avoid setTimeout autoSim) and a drawn PvP session.
  tourney.create({ category: 'classic', prize: 1000, host: T1, chatJid: T1, sock, players: [] });
  tourney.addPlayer(T1);
  tourney.addPlayer(T2);
  // manually construct a bracket so resolveByResult works
  const cur = tourney.summary();
  // Use the public API path: start() arms timers; instead build rounds directly is private.
  // Simpler: call start() then immediately resolve the two pending ties with a FORCED draw via finishPvP.
  // We drive finishPvP directly with a hand-built session that is drawn + isTournament.
  const pkSession = {
    matchId: 'pk-test', sock, chatJid: T1,
    homeId: T1, awayId: T2, isAI: false, isPvP: true, isTournament: true, pkEnabled: false,
    homeName: 'TourA', awayName: 'TourB',
    homeScore: 2, awayScore: 2,
    goalScorers: [], scorerStats: {},
    homeMomentum: 50, awayMomentum: 50,
    homeSquad: Player.getSquadPlayers(T1), awaySquad: Player.getSquadPlayers(T2),
    timeElapsed: 0, phase: 'idle',
  };
  clearSent();
  await matchSession.finishPvP(pkSession);
  // A winner must have been decided by penalties (not a draw)
  ok((pkSession._finished === true), 'finishPvP ran to completion (no double-finish)');
  const t1w = User.getByWhatsappId(T1).wins + User.getByWhatsappId(T1).losses;
  ok((t1w >= 1), 'one of the tournament sides recorded a win/loss after PK');
  ok(sent.some(s => s.text && s.text.includes('PENALTIES')), 'penalties message broadcast on drawn tournament tie');

  console.log('\n=== 8. NORMAL PVP DRAW -> PK when pkEnabled ===');
  const P1 = await makeUser('8888888888', 'PkA');
  const P2 = await makeUser('9999999999', 'PkB');
  User.update(P1, { pkEnabled: true, currency: 50000 });
  User.update(P2, { pkEnabled: true, currency: 50000 });
  const pkSession2 = {
    matchId: 'pk-test-2', sock, chatJid: P1,
    homeId: P1, awayId: P2, isAI: false, isPvP: true, isTournament: false, pkEnabled: true,
    homeName: 'PkA', awayName: 'PkB',
    homeScore: 1, awayScore: 1,
    goalScorers: [], scorerStats: {},
    homeMomentum: 50, awayMomentum: 50,
    homeSquad: Player.getSquadPlayers(P1), awaySquad: Player.getSquadPlayers(P2),
    timeElapsed: 0, phase: 'idle',
  };
  clearSent();
  await matchSession.finishPvP(pkSession2);
  ok((pkSession2._finished === true), 'finishPvP (pkEnabled) ran to completion');
  ok(sent.some(s => s.text && s.text.includes('PENALTIES')), 'penalties triggered for pkEnabled normal PvP draw');

  console.log('\n=== 9. NORMAL PVP DRAW -> NO PK when pkEnabled off ===');
  const Q1 = await makeUser('1212121212', 'NoPkA');
  const Q2 = await makeUser('1313131313', 'NoPkB');
  const pkSession3 = {
    matchId: 'pk-test-3', sock, chatJid: Q1,
    homeId: Q1, awayId: Q2, isAI: false, isPvP: true, isTournament: false, pkEnabled: false,
    homeName: 'NoPkA', awayName: 'NoPkB',
    homeScore: 0, awayScore: 0,
    goalScorers: [], scorerStats: {},
    homeMomentum: 50, awayMomentum: 50,
    homeSquad: Player.getSquadPlayers(Q1), awaySquad: Player.getSquadPlayers(Q2),
    timeElapsed: 0, phase: 'idle',
  };
  clearSent();
  await matchSession.finishPvP(pkSession3);
  const q1res = User.getByWhatsappId(Q1);
  ok((q1res.wins + q1res.losses === 0 && q1res.draws >= 1), 'drawn PvP with pk off records a DRAW (no PK)');
  ok(!sent.some(s => s.text && s.text.includes('PENALTIES')), 'no penalties when pkEnabled off');

  console.log('\n=== 10. MOMENTUM FIX REGRESSION (matchSession.js) ===');
  const engine = require('../game-engine/matchEngine');
  // Directions must be: GOAL +, MISS -, BIG_SAVE +, TURNOVER +
  ok((engine.updateMomentum(50, 'GOAL') > 50), 'GOAL raises momentum');
  ok((engine.updateMomentum(50, 'MISS') < 50), 'MISS lowers momentum');
  ok((engine.updateMomentum(50, 'BIG_SAVE') > 50), 'BIG_SAVE raises momentum');
  // On a non-goal event the ATTACKER must lose momentum and the DEFENDER gain it.
  // Drive several vs-AI matches and assert momentum never leaves [0,100] and that
  // a missed chance never pushes BOTH sides up.
  let momentumOk = true, bothUp = false;
  for (let i = 0; i < 8; i++) {
    const m2 = await makeUser(`777000${i}`, `MomFC${i}`);
    User.update(m2, { stadium: null, fanEnergy: 50, currency: 50000 });
    const before = { h: 50, a: 50 };
    const sess = await matchSession.startMatch(sock, m2, 'AI', { chatJid: m2, aiDifficulty: 'Medium' });
    if (sess.homeMomentum < 0 || sess.homeMomentum > 100 || sess.awayMomentum < 0 || sess.awayMomentum > 100) momentumOk = false;
  }
  ok(momentumOk, 'momentum stays within [0,100] across simulated matches');

  console.log(`\n─────────────────────────────────`);
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  console.log(`─────────────────────────────────`);

  // cleanup temp data
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', e); try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}; process.exit(2); });
