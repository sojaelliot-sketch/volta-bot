// smoke2.js — exercise new commands + interactive flows
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-smoke-'));
const db = require('./config/database');
const User = require('./models/User');
const Player = require('./models/Player');
const { grantStarterSquad } = require('./utils/playerGenerator');
const router = require('./commands/router');
const { getPvpSessionFor } = require('./game-engine/matchSession');
const { sleep } = require('./utils/messaging');

const OWNER = '2349011861051@s.whatsapp.net';
const U1 = '1111111111@s.whatsapp.net';
const U2 = '2222222222@s.whatsapp.net';
const sent = [];
const sock = { sendMessage: async (j, c) => { sent.push({ j, c }); return {}; }, sendPresenceUpdate: async () => {}, groupParticipantsUpdate: async () => {} };
function msg(t, s) { const fm = s === OWNER; return { key: { remoteJid: s, participant: fm ? undefined : s, fromMe: fm }, message: { conversation: t } }; }

const results = [];
const { MODERATION } = require('./config/constants');
async function run(label, text, sender) {
  sent.length = 0;
  let threw = null;
  try { await router.handle(sock, msg(text, sender)); } catch (e) { threw = e; }
  const errored = sent.some(s => /Something went wrong/.test(s.c?.text || ''));
  const banned = sent.some(s => /banned/i.test(s.c?.text || ''));
  const ok = !threw && !errored && !banned;
  const res = { label, ok, err: threw && threw.message };
  results.push(res);
  if (!ok) console.log('FAIL', label, threw && threw.message, (sent[0]?.c?.text || '').slice(0, 60));
  if (sender !== OWNER && !['a', 'chance', 'shoot', 'save', 'sub'].includes(text.slice(1).split(/\s+/)[0].toLowerCase()))
    await sleep(MODERATION.COOLDOWN_MS + 60);
  return res;
}

(async () => {
  await db.connectDB();
  User.create(U1, 'Alice'); grantStarterSquad(U1); User.update(U1, { currency: 100000 });
  User.create(U2, 'Bob'); grantStarterSquad(U2); User.update(U2, { currency: 100000 });
  await run('owner start', '!start', OWNER);
  User.update(OWNER, { currency: 100000 });

  await run('wallet', '!wallet', U1);
  await run('autosquad', '!autosquad', U1);
  await run('buysquad', '!buysquad', U1);
  await run('squads', '!squads', U1);
  await run('switchsquad', '!switchsquad 2', U1);
  await run('switchsquad back', '!switchsquad 2', U1);
  await run('give (args)', '!give 500 2222222222', U1);
  await run('give (mention)', '!give 100 2222222222', U1);

  // penalty vs AI — drive shoot/save to completion
  await run('penalty start', '!penalty 50', U1);
  for (let i = 0; i < 12; i++) {
    await run('pen shoot' + i, '!shoot L', U1);
    await run('pen save' + i, '!save C', U1);
    await sleep(30);
  }

  // tournament flow
  await run('tournament start', '!tournament start classic 500', OWNER);
  await run('join1', '!join', U1);
  await run('join2', '!join', U2);
  await run('tournament end', '!tournament end', OWNER);
  await run('tourneyplay', '!tourneyplay', U1);

  // PvP interactive
  const ch = await run('challenge', '!challenge 2222222222', U1);
  console.log('DBG challenge sent:', JSON.stringify(sent.map(s => (s.c?.text || '').replace(/\n/g, ' ').slice(0, 70))));
  const acc = await run('accept', '!accept', U2);
  console.log('DBG pvp after accept:', !!getPvpSessionFor(U1), !!getPvpSessionFor(U2));
  console.log('DBG accept sent full:', JSON.stringify(sent.map(s => (s.c?.text || '').replace(/\n/g, ' ').slice(0, 90))));
  for (let i = 0; i < 40; i++) {
    await run('a-u1-' + i, '!a shoot', U1);
    await run('a-u2-' + i, '!a shoot', U2);
    await sleep(200);
    if (!getPvpSessionFor(U1) && !getPvpSessionFor(U2)) { console.log('PvP ended after', i, 'iters'); break; }
  }

  const fails = results.filter(r => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} OK`);
  if (fails.length) console.log('FAILURES:', fails.map(f => f.label).join(', '));
  process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
