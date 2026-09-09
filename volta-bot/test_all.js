// test_all.js — Exhaustive test of EVERY command, zero-cooldown, max speed
const fs = require('fs'), os = require('os'), path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-all-'));
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
const U3 = '3333333333@s.whatsapp.net';

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

  // ── SETUP ──
  User.create(U1, 'Alice'); grantStarterSquad(U1); User.update(U1, { currency: 100000 });
  User.create(U2, 'Bob'); grantStarterSquad(U2); User.update(U2, { currency: 100000 });
  User.create(U3, 'Charlie'); grantStarterSquad(U3); User.update(U3, { currency: 100000 });
  User.create(OWNER, 'Owner'); grantStarterSquad(OWNER); User.update(OWNER, { registered: true, currency: 100000 });

  // Make U1 an officer for mod commands
  User.update(U1, { role: 'officer' });

  await run('start(owner)', '!start', OWNER);
  const u1 = User.getByWhatsappId(U1);
  const u2 = User.getByWhatsappId(U2);
  const u3 = User.getByWhatsappId(U3);
  const u1id = u1.startingXI[0].slice(0, 6);
  const u2id = u2.startingXI[0].slice(0, 6);
  const u3id = u3.startingXI[0].slice(0, 6);
  const u1num = U1.replace('@s.whatsapp.net', '');
  const u2num = U2.replace('@s.whatsapp.net', '');
  const u3num = U3.replace('@s.whatsapp.net', '');

  async function batch(cmds) {
    await Promise.all(cmds.map(([label, text, sender]) => run(label, text, sender)));
  }

  // ══════════════════════════════════════════════════════════════
  // BATCH 1: Registration & Basics
  // ══════════════════════════════════════════════════════════════
  await batch([
    ['start (owner)', '!start', OWNER],
    ['register (already)', '!register Boss', OWNER],
    ['register (U3)', '!register Charlie', U3],
    ['help', '!help', U1],
    ['menu', '!menu', U1],
    ['announce', '!announce', U1],
    ['explain', '!explain', U1],
    ['explain play', '!explain play', U1],
    ['guide', '!guide', U1],
    ['how', '!how', U1],
    ['tutorial', '!tutorial', U1],
    ['tut', '!tut', U1],
    ['ping', '!ping', OWNER],
    ['pong', '!pong', U1],
    ['debug', '!debug', OWNER],
  ]);

  // ══════════════════════════════════════════════════════════════
  // BATCH 2: Squad Management
  // ══════════════════════════════════════════════════════════════
  await batch([
    ['squad', '!squad', U1],
    ['lineup', '!lineup', U1],
    ['bench', `!bench ${u1id}`, U1],
    ['card', `!card ${u1id}`, U1],
    ['condition', '!condition', U1],
    ['rename', `!rename ${u1id} Zlatan`, U1],
    ['profile', '!profile', U1],
    ['info', '!info', U1],
    ['info (other)', `!info ${u2num}`, U1],
    ['setname', '!setname Alice FC', U1],
    ['name', '!name Alice FC', U1],
    ['flex', '!flex', U1],
    ['autosquad', '!autosquad', U1],
    ['best', '!best', U1],
    ['squads', '!squads', U1],
    ['swap xi', `!swap ${u1id} xi`, U1],
    ['swap bench', `!swap ${u1id} bench`, U1],
    ['move', `!move ${u1id} xi`, U1],
    ['captain', '!captain', U1],
    ['captain set', `!captain ${u1id}`, U1],
    ['reserve', '!reserve', U1],
    ['preserves', '!preserves', U1],
  ]);

  // ══════════════════════════════════════════════════════════════
  // BATCH 3: Economy
  // ══════════════════════════════════════════════════════════════
  await batch([
    ['wallet', '!wallet', U1],
    ['bal', '!bal', U1],
    ['daily', '!daily', U1],
    ['streak', '!streak', U1],
    ['give', `!give 100 ${u2num}`, U1],
    ['shop', '!shop', U1],
    ['pack starter', '!pack starter', U1],
    ['boost energy', `!boost energy ${u1id}`, U1],
    ['boost form', `!boost form ${u1id}`, U1],
    ['boostall energy', '!boostall energy', U1],
    ['boostall form', '!boostall form', U1],
    ['train', `!train ${u1id}`, U1],
    ['topchem', '!topchem', U1],
  ]);

  // ══════════════════════════════════════════════════════════════
  // BATCH 4: Market
  // ══════════════════════════════════════════════════════════════
  await batch([
    ['market', '!market', U1],
    ['list', `!list ${u1id} 50000`, U1],
    ['sell', `!sell ${u1id} 50000`, U1],
    ['search', '!search common', U1],
    ['find', '!find common', U1],
  ]);
  const listings = db.all('market').filter(l => l.sold === false);
  if (listings.length) {
    await run('buy', `!buy ${listings[0].id.slice(0, 6)}`, U2);
  }

  // ══════════════════════════════════════════════════════════════
  // BATCH 5: Match (AI) — !play starts interactive session, skip it
  // ══════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════
  // BATCH 6: Gambling
  // ══════════════════════════════════════════════════════════════
  await batch([
    ['slot', '!slot 50', U1],
    ['coinflip', '!coinflip 50', U1],
    ['flip', '!flip 50', U2],
    ['highlow', '!highlow 50', U1],
    ['hl', '!hl 50', U2],
    ['penalty', '!penalty 50', U1],
    ['shoot', '!shoot L', U1],
    ['save', '!save C', U1],
  ]);

  // ══════════════════════════════════════════════════════════════
  // BATCH 7: PvP (challenge → accept → play)
  // ══════════════════════════════════════════════════════════════
  await run('challenge', `!challenge ${u2num}`, U1);
  await run('accept', '!accept', U2);
  // Play until match ends
  for (let i = 0; i < 30; i++) {
    await run(`a-u1-${i}`, '!a shoot', U1);
    await run(`a-u2-${i}`, '!a shoot', U2);
    const { getActiveMatchForUser } = require('./game-engine/matchSession');
    if (!getActiveMatchForUser(U1) && !getActiveMatchForUser(U2)) break;
  }

  // ══════════════════════════════════════════════════════════════
  // BATCH 8: League + Season
  // ══════════════════════════════════════════════════════════════
  await batch([
    ['league', '!league', U1],
    ['league me', '!league me', U1],
    ['league info', '!league info', U1],
    ['league 1', '!league 1', U1],
    ['league 3', '!league 3', U1],
    ['season', '!season', U1],
    ['league history', '!league history', U1],
    ['league init', '!league init', OWNER],
    ['league start', '!league start', OWNER],
    ['league end', '!league end', OWNER],
  ]);

  // ══════════════════════════════════════════════════════════════
  // BATCH 9: Tournament
  // ══════════════════════════════════════════════════════════════
  await run('tournament start', '!tournament start classic 500', OWNER);
  await batch([
    ['join', '!join', U1],
    ['join2', '!join', U2],
    ['bracket', '!bracket', U1],
    ['brackets', '!brackets', U1],
    ['tbv', '!tbv', U1],
    ['tournament', '!tournament', U1],
    ['tournament list', '!tournament list', U1],
    ['tbet', '!tbet', U1],
  ]);
  await run('tourneyplay', '!tourneyplay', U1);
  await run('tournament end', '!tournament end', OWNER);

  // ══════════════════════════════════════════════════════════════
  // BATCH 10: Owner / Mod Commands
  // ══════════════════════════════════════════════════════════════
  await batch([
    ['mods', '!mods', OWNER],
    ['giveaway', '!giveaway 100 2', OWNER],
    ['gw', '!gw 100 2', OWNER],
    ['broadcast', '!broadcast Hello', OWNER],
    ['ban', `!ban ${u3num}`, U1],
    ['unban', `!unban ${u3num}`, U1],
    ['warn', `!warn ${u2num}`, U1],
    ['cooldown', `!cooldown 60 ${u2num}`, U1],
    ['uncooldown', `!uncooldown ${u2num}`, U1],
    ['promote', `!promote ${u1num} officer`, OWNER],
    ['demote', `!demote ${u1num}`, OWNER],
    ['kick', `!kick ${u3num}`, U1],
    ['subtract', `!subtract 100 ${u2num}`, OWNER],
    ['take', `!take 100 ${u2num}`, OWNER],
    ['setbounty', `!setbounty 100 ${u2num}`, OWNER],
    ['pvpadmin', '!pvpadmin', OWNER],
    ['clearpvp', '!clearpvp', OWNER],
    ['reload', '!reload', OWNER],
  ]);

  // ══════════════════════════════════════════════════════════════
  // BATCH 11: Stadium
  // ══════════════════════════════════════════════════════════════
  await batch([
    ['stadium', '!stadium', U1],
    ['buystadium', '!buystadium small', U1],
    ['sellstadium', '!sellstadium', U1],
    ['pk', '!pk on', U1],
    ['pk off', '!pk off', U1],
  ]);

  // ══════════════════════════════════════════════════════════════
  // BATCH 12: Social / Misc
  // ══════════════════════════════════════════════════════════════
  await batch([
    ['leaderboard', '!leaderboard', U1],
    ['lb', '!lb', U1],
    ['top10', '!top10', U1],
    ['playerlb', '!playerlb', U1],
    ['plb', '!plb', U1],
    ['invite', '!invite', U1],
    ['hustle', '!hustle', U1],
    ['press', '!press', U1],
    ['rivalry', '!rivalry', U1],
    ['curse', '!curse', U1],
    ['fun', '!fun', U1],
    ['chat', '!chat hello', U1],
    ['formcheck', '!formcheck', U1],
    ['injuries', '!injuries', U1],
    ['shield', '!shield', U1],
    ['chant', '!chant', U1],
    ['chant set', '!chant set YNWA', U1],
    ['chant view', '!chant', U1],
    ['password', '!password test123', U1],
    ['setpass', '!setpass test456', U1],
    ['academy', '!academy', U1],
    ['scout', '!scout', U1],
    ['compgcs', '!compgcs', U1],
    ['awards', '!awards', U1],
    ['weeklyawards', '!weeklyawards', U1],
    ['trophies', '!trophies', U1],
    ['redeem', '!redeem', U1],
    ['teamchem', '!teamchem', U1],
    ['botstate', '!botstate', OWNER],
    ['on', '!on', OWNER],
  ]);

  // ══════════════════════════════════════════════════════════════
  // BATCH 13: Trade (needs two users)
  // ══════════════════════════════════════════════════════════════
  const u1all = User.getByWhatsappId(U1);
  const u2all = User.getByWhatsappId(U2);
  const tradeP1 = u1all.startingXI[0]?.slice(0, 6);
  const tradeP2 = u2all.startingXI[0]?.slice(0, 6);
  if (tradeP1 && tradeP2) {
    await run('trade propose', `!trade ${u2num} ${tradeP1} ${tradeP2}`, U1);
    await run('trade accept', '!trade accept', U2);
    await run('trade cancel', '!trade cancel', U1);
  }

  // ══════════════════════════════════════════════════════════════
  // BATCH 14: Loan
  // ══════════════════════════════════════════════════════════════
  await batch([
    ['loan', '!loan', U1],
    ['loan offer', `!loan offer ${u1id} ${u2num} 1000 100 7`, U1],
  ]);

  // ══════════════════════════════════════════════════════════════
  // BATCH 15: Auction
  // ══════════════════════════════════════════════════════════════
  await run('auction start', '!auction start auto 1000', U1);
  await run('bid', '!bid 2000', U2);
  await run('auction time', '!auction time 30', U1);
  await run('auction end', '!auction end', U1);

  // ══════════════════════════════════════════════════════════════
  // BATCH 16: Surgery (needs injured player)
  // ══════════════════════════════════════════════════════════════
  // Manually injure a player to test surgery
  const allPlayers = db.all('players');
  const testPlayer = allPlayers.find(p => p.owner === U1);
  if (testPlayer) {
    Player.update(testPlayer.id, { injured: true, injuredGames: 3 });
    await run('surgery', `!surgery ${testPlayer.id.slice(0, 6)}`, U1);
  }

  // ══════════════════════════════════════════════════════════════
  // BATCH 17: Retire (show warning only, NOT confirm)
  // ══════════════════════════════════════════════════════════════
  await run('retire', '!retire', U3);

  // ══════════════════════════════════════════════════════════════
  // BATCH 18: AFK mode
  // ══════════════════════════════════════════════════════════════
  await run('afk', '!afk', OWNER);
  await run('afk off', '!afk off', OWNER);

  // ══════════════════════════════════════════════════════════════
  // BATCH 19: Competitions (command-only, no match start)
  // ══════════════════════════════════════════════════════════════
  await batch([
    ['competitions', '!competitions', U1],
  ]);

  // ══════════════════════════════════════════════════════════════
  // BATCH 20: Botstate
  // ══════════════════════════════════════════════════════════════
  await run('off', '!off', OWNER);
  await run('on again', '!on', OWNER);

  // ══════════════════════════════════════════════════════════════
  // BATCH 21: League AI players
  // ══════════════════════════════════════════════════════════════
  await batch([
    ['league ai', '!league ai 50', OWNER],
    ['league (with ai)', '!league', U1],
    ['league 3 (with ai)', '!league 3', U1],
    ['league ai remove', '!league ai remove', OWNER],
  ]);

  // ══════════════════════════════════════════════════════════════
  // REPORT
  // ══════════════════════════════════════════════════════════════
  const fails = results.filter(r => !r.ok);
  const passes = results.filter(r => r.ok);
  console.log('\n' + '='.repeat(60));
  console.log(`RESULTS: ${passes.length}/${results.length} OK, ${fails.length} FAILING`);
  console.log('='.repeat(60));
  if (fails.length) {
    for (const f of fails) console.log(`  FAIL: ${f.label} -> ${f.threw || 'blocked/error'}`);
  }
  console.log('='.repeat(60));
  setTimeout(() => process.exit(0), 200);
}

main().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
