// test_fast.js — Fire ALL commands in parallel batches, zero wait
const fs = require('fs'), os = require('os'), path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-fast-'));
process.env.DATA_DIR = TMP;

const { MATCH, MODERATION } = require('./config/constants');
MODERATION.COOLDOWN_MS = 0;
MODERATION.WARNINGS_BEFORE_BAN = 999;
MATCH.SUB_WINDOW_MS = 50;

const db = require('./config/database');
const User = require('./models/User');
const Player = require('./models/Player');
const { grantStarterSquad } = require('./utils/playerGenerator');
const router = require('./commands/router');

const OWNER = '2349011861051@s.whatsapp.net';
const U1 = '1111111111@s.whatsapp.net';
const U2 = '2222222222@s.whatsapp.net';

const sent = [];
const sock = {
  sendMessage: async (jid, c) => { sent.push({ jid, c }); return {}; },
  sendPresenceUpdate: async () => {},
  groupParticipantsUpdate: async () => {},
  groupMetadata: async () => ({ desc: '', subject: 'Test Group' }),
};

function msg(text, sender) {
  const fromMe = sender === OWNER;
  return { key: { remoteJid: sender, participant: fromMe ? undefined : sender, fromMe }, message: { conversation: text } };
}

const results = [];
async function run(label, text, sender) {
  const before = sent.length;
  let threw = null;
  try { await router.handle(sock, msg(text, sender)); } catch (e) { threw = e; }
  const mySent = sent.slice(before);
  const errored = mySent.some(s => /Something went wrong/.test(s.c?.text || ''));
  const banned = mySent.some(s => /banned/i.test(s.c?.text || ''));
  const ok = !threw && !errored && !banned;
  results.push({ label, ok, threw: threw && (threw.message || String(threw)).split('\n')[0] });
}

async function main() {
  await db.connectDB();

  // Setup users
  User.create(U1, 'Alice'); grantStarterSquad(U1); User.update(U1, { currency: 100000 });
  User.create(U2, 'Bob'); grantStarterSquad(U2); User.update(U2, { currency: 100000 });
  User.create(OWNER, 'Owner'); grantStarterSquad(OWNER); User.update(OWNER, { registered: true, currency: 100000 });

  await run('start', '!start', OWNER);
  const u1id = User.getByWhatsappId(U1).startingXI[0].slice(0, 6);
  const u2id = User.getByWhatsappId(U2).startingXI[0].slice(0, 6);
  const u1num = U1.replace('@s.whatsapp.net', '');
  const u2num = U2.replace('@s.whatsapp.net', '');

  // Helper: run a batch of commands in parallel
  async function batch(cmds) {
    await Promise.all(cmds.map(([label, text, sender]) => run(label, text, sender)));
  }

  // ── BATCH 1: Basics + Profile ──
  await batch([
    ['help', '!help', U1],
    ['menu', '!menu', U1],
    ['explain', '!explain', U1],
    ['explain play', '!explain play', U1],
    ['ping', '!ping', OWNER],
    ['debug', '!debug', OWNER],
    ['squad', '!squad', U1],
    ['lineup', '!lineup', U1],
    ['bench', `!bench ${u1id}`, U1],
    ['card', `!card ${u1id}`, U1],
    ['condition', '!condition', U1],
    ['profile', '!profile', U1],
    ['info', '!info', U1],
    ['setname', '!setname Alice FC', U1],
    ['autosquad', '!autosquad', U1],
    ['squads', '!squads', U1],
  ]);

  // ── BATCH 2: Economy ──
  await batch([
    ['wallet', '!wallet', U1],
    ['daily', '!daily', U1],
    ['streak', '!streak', U1],
    ['give', `!give 100 ${u2num}`, U1],
    ['shop', '!shop', U1],
    ['pack starter', '!pack starter', U1],
    ['boost energy', `!boost energy ${u1id}`, U1],
    ['boost form', `!boost form ${u1id}`, U1],
    ['train', `!train ${u1id}`, U1],
    ['topchem', '!topchem', U1],
  ]);

  // ── BATCH 3: Market ──
  await batch([
    ['market', '!market', U1],
    ['list', `!list ${u1id} 50000`, U1],
    ['sell', `!sell ${u1id} 50000`, U1],
    ['search', '!search common', U1],
    ['find', '!find common', U1],
  ]);

  // Buy a listed item
  const listings = db.all('market').filter(l => l.sold === false);
  if (listings.length) {
    await run('buy', `!buy ${listings[0].id.slice(0, 6)}`, U2);
  }

  // ── BATCH 4: Match + Gambling ──
  await batch([
    ['play easy', '!play easy', U1],
    ['slot', '!slot 50', U1],
    ['coinflip', '!coinflip 50', U1],
    ['highlow', '!highlow higher 50', U1],
  ]);

  // ── BATCH 5: PvP ──
  await run('challenge', `!challenge ${u2num}`, U1);
  await run('accept', '!accept', U2);
  for (let i = 0; i < 30; i++) {
    await run(`a-u1-${i}`, '!a shoot', U1);
    await run(`a-u2-${i}`, '!a shoot', U2);
    // Break if match ended (no more active session)
    const { getActiveMatchForUser } = require('./game-engine/matchSession');
    if (!getActiveMatchForUser(U1) && !getActiveMatchForUser(U2)) break;
  }

  // ── BATCH 6: League + Season ──
  await batch([
    ['league', '!league', U1],
    ['league me', '!league me', U1],
    ['league info', '!league info', U1],
    ['league 1', '!league 1', U1],
    ['season', '!season', U1],
    ['league history', '!league history', U1],
  ]);

  // ── BATCH 7: Tournament ──
  await run('tournament start', '!tournament start classic 500', OWNER);
  await batch([
    ['join1', '!join', U1],
    ['join2', '!join', U2],
    ['bracket', '!bracket', U1],
  ]);
  await run('tourneyplay', '!tourneyplay', U1);
  await run('tournament end', '!tournament end', OWNER);

  // ── BATCH 8: Owner / Mod ──
  await batch([
    ['mods', '!mods', OWNER],
    ['giveaway', '!giveaway 100 2', OWNER],
    ['broadcast', '!broadcast Hello', OWNER],
    ['promote', `!promote ${u1num} officer`, OWNER],
    ['warn', `!warn ${u1num}`, OWNER],
    ['demote', `!demote ${u1num}`, OWNER],
    ['unban', `!unban ${u1num}`, OWNER],
  ]);

  // ── BATCH 9: Misc ──
  await batch([
    ['leaderboard', '!leaderboard', U1],
    ['playerlb', '!playerlb', U1],
    ['chat', '!chat hello', U1],
    ['swap', `!swap ${u1id} xi`, U1],
    ['academy', '!academy', U1],
    ['password', '!password test123', U1],
    ['reserve', '!reserve', U1],
    ['formcheck', '!formcheck', U1],
    ['injuries', '!injuries', U1],
    ['dash', '!dash', U1],
    ['shield', '!shield', U1],
    ['chant', '!chant', U1],
    ['chant set', '!chant set YNWA', U1],
    ['chant view', '!chant', U1],
    ['hustle', '!hustle', U1],
    ['invite', '!invite', U1],
    ['stadium', '!stadium', U1],
    ['press', '!press', U1],
    ['setbounty', `!setbounty 100 ${u2num}`, OWNER],
    ['compgcs', '!compgcs', U1],
    ['awards', '!awards', U1],
    ['weeklyawards', '!weeklyawards', U1],
    ['trophies', '!trophies', U1],
    ['curse', '!curse', U1],
    ['fun', '!fun', U1],
    ['redeem', '!redeem', U1],
    ['teamchem', '!teamchem', U1],
    ['rivalry', '!rivalry', U1],
    ['penalty', '!penalty 50', U1],
    ['shoot', '!shoot L', U1],
    ['save', '!save C', U1],
    ['pvpadmin', '!pvpadmin', OWNER],
    ['tournament cmd', '!tournament', U1],
    ['competitions', '!competitions', U1],
    ['botstate', '!botstate', OWNER],
    ['on', '!on', OWNER],
  ]);

  // ── Report ──
  const fails = results.filter(r => !r.ok);
  console.log('\n' + '='.repeat(50));
  console.log(`RESULTS: ${results.length - fails.length}/${results.length} OK, ${fails.length} FAILING`);
  console.log('='.repeat(50));
  if (fails.length) {
    for (const f of fails) console.log(`  FAIL: ${f.label} -> ${f.threw || 'blocked'}`);
  }
  process.exit(0);
}

main().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
