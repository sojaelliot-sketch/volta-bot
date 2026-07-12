// test_allcmds.js — exercise every command, report failures.
const fs = require('fs'), os = require('os'), path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-cmd-'));
process.env.DATA_DIR = TMP;

const db = require('./config/database');
const { MATCH, MODERATION } = require('./config/constants');
MATCH.SUB_WINDOW_MS = 80; // speed up PvP for the test only
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
};

function msg(text, sender) {
  const fromMe = sender === OWNER;
  return { key: { remoteJid: sender, participant: fromMe ? undefined : sender, fromMe }, message: { conversation: text } };
}

const results = [];
async function run(label, text, sender) {
  sent.length = 0;
  let threw = null;
  try {
    await router.handle(sock, msg(text, sender));
  } catch (e) { threw = e; }
  const errored = sent.some(s => /Something went wrong/.test(s.c?.text || ''));
  const banned = sent.some(s => /banned/i.test(s.c?.text || ''));
  const ok = !threw && !errored && !banned;
  results.push({ label, ok, threw: threw && (threw.message || String(threw)) });
  // space non-owner commands out past the anti-spam cooldown so they aren't
  // falsely flagged as spam during the test.
  if (sender !== OWNER) await new Promise(r => setTimeout(r, MODERATION.COOLDOWN_MS + 60));
}

async function main() {
  await db.connectDB();

  // setup users
  User.create(U1, 'Alice'); grantStarterSquad(U1); User.update(U1, { currency: 100000 });
  User.create(U2, 'Bob'); grantStarterSquad(U2); User.update(U2, { currency: 100000 });
  // owner via fromMe
  await run('start(owner)', '!start', OWNER);
  User.update(OWNER, { currency: 100000 });
  const ownerId = User.getByWhatsappId(OWNER).startingXI[0].slice(0, 6);
  const u1id = User.getByWhatsappId(U1).startingXI[0].slice(0, 6);

  // normal-user commands
  await run('help', '!help', U1);
  await run('squad', '!squad', U1);
  await run('card', `!card ${u1id}`, U1);
  await run('condition', '!condition', U1);
  await run('rename', `!rename ${u1id} Zlatan`, U1);
  await run('play', '!play', U1);
  await run('daily', '!daily', U1);
  await run('streak', '!streak', U1);
  await run('shop', '!shop', U1);
  await run('pack', '!pack starter', U1);
  await run('boost energy', `!boost energy ${u1id}`, U1);
  await run('boost form', `!boost form ${u1id}`, U1);
  await run('train', `!train ${u1id}`, U1);
  await run('train elite', `!train elite ${u1id}`, U1);
  await run('market', '!market', U1);
  await run('list', `!list ${u1id} 50000`, U1);
  await run('sell(alias)', `!sell ${u1id} 50000`, U1);
  await run('swap', `!swap ${u1id} xi`, U1);
  await run('slot', '!slot 50', U1);
  await run('coinflip', '!coinflip 50', U1);
  await run('highlow', '!highlow higher 50', U1);
  await run('leaderboard', '!leaderboard', U1);
  await run('explain', '!explain play', U1);
  await run('explain(all)', '!explain', U1);
  await run('bench', `!bench ${u1id}`, U1);

  // buy: find a real listing id from db
  const listings = db.all('market').filter(l => l.sold === false);
  if (listings.length) {
    await run('buy', `!buy ${listings[0].id.slice(0, 6)}`, U2);
  } else {
    results.push({ label: 'buy', ok: false, threw: 'no listing seeded' });
  }

  // owner commands
  await run('mods', '!mods', OWNER);
  await run('giveaway', '!giveaway 100 2', OWNER);
  await run('tournament start', '!tournament start 500', OWNER);
  await run('join', '!join', U1);
  await run('auction start', '!auction start auto 100', OWNER);
  await run('bid', '!bid 200', OWNER);
  await run('auction end', '!auction end', OWNER);
  await run('promote', `!promote 1111111111 officer`, OWNER);
  await run('warn', `!warn 1111111111`, OWNER);
  await run('kick', `!kick 1111111111`, OWNER);
  await run('ban', `!ban 1111111111`, OWNER);
  await run('unban', `!unban 1111111111`, OWNER);
  await run('demote', `!demote 1111111111`, OWNER);

  // challenge + accept (PvP) — uses shortened SUB_WINDOW_MS
  await run('challenge', `!challenge 2222222222`, U1);
  await run('accept(PvP)', '!accept', U2);

  // sub with no active match -> should give a friendly message, not crash
  await run('sub(none)', `!sub ${u1id} ${u1id}`, U1);

  // report
  console.log('\n=== RESULTS ===');
  let fails = 0;
  for (const r of results) {
    if (!r.ok) { fails++; console.log(`❌ ${r.label} -> ${r.threw || 'generic error response'}`); }
    else console.log(`✅ ${r.label}`);
  }
  console.log(`\n${results.length - fails}/${results.length} commands OK, ${fails} failing.`);
  process.exit(0);
}

main().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
