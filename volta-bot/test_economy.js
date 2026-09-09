'use strict';
// test_economy.js — money must not be creatable from nothing.
//
// Economy bugs never throw. The balance is simply wrong, and by the time anyone
// notices, the wrong number has been spent, gifted and traded on. These tests
// pin the currency invariants directly.
//
// Run:  node test_economy.js

const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-econ-'));

process.env.LOG_LEVEL="silent";
const { MODERATION } = require('./config/constants');
MODERATION.COOLDOWN_MS = 0;
MODERATION.WARNINGS_BEFORE_BAN = 9999;

// The router simulates typing with a real sleep before every reply. Harmless in
// production, fatal to a test that runs hundreds of commands.
const messaging = require('./utils/messaging');
messaging.smartTypingPause = async () => {};
messaging.startTyping = async () => {};
messaging.stopTyping = async () => {};
messaging.sleep = async () => {};

const db = require('./config/database');
const User = require('./models/User');
const { SLOT, ECONOMY } = require('./config/constants');
const router = require('./commands/router');

// The router logs every dispatched command. Silence it so the loop tests do not
// bury the results under thousands of lines.
const _log = console.log;
let quiet = false;
console.log = (...a) => { if (!quiet || !String(a[0] || '').startsWith('[CMD]')) _log(...a); };

let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); pass++; }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function eq(label, a, b) { ok(label, a === b, `expected ${b}, got ${a}`); }

const sent = [];
const sock = {
  sendMessage: async (jid, c) => { sent.push({ jid, c }); return {}; },
  sendPresenceUpdate: async () => {},
  groupMetadata: async () => ({ desc: '', subject: 'T' }),
};
const asMsg = (text, sender) => ({
  key: { remoteJid: sender, participant: sender, fromMe: false },
  message: { conversation: text },
});
async function cmd(text, sender) {
  sent.length = 0;
  await router.handle(sock, asMsg(text, sender));
  return sent.map((s) => s.c?.text || '').join('\n');
}
const bal = (jid) => User.getByWhatsappId(jid).currency;

function mk(jid, name, currency) {
  User.create(jid, name);
  User.update(jid, { registered: true, currency });
}

(async () => {
  await db.connectDB();

  const A = '1111111111@s.whatsapp.net';
  const B = '2222222222@s.whatsapp.net';
  mk(A, 'Alpha FC', 10000);
  mk(B, 'Beta FC', 10000);

  // ── Atomic primitives ────────────────────────────────────────────────
  console.log('\nATOMIC BALANCE OPERATIONS');
  let r = User.addCurrency(A, 500);
  eq('credit applies', bal(A), 10500);
  eq('credit reports new balance', r.balance, 10500);

  r = User.addCurrency(A, -500);
  eq('debit applies', bal(A), 10000);

  r = User.addCurrency(A, -999999);
  ok('overdraft refused', !r.ok, `reason ${r.reason}`);
  eq('balance untouched after refused debit', bal(A), 10000);

  r = User.addCurrency(A, -999999, { allowNegative: true });
  ok('forced debit clamps at zero', bal(A) === 0);
  User.update(A, { currency: 10000 });

  // ── The lost-update bug ──────────────────────────────────────────────
  console.log('\nREGRESSION: concurrent writes must not destroy or create money');
  User.update(A, { currency: 1000 });
  // The old pattern: read once, then write absolute values twice.
  const stale = User.getByWhatsappId(A);
  User.update(A, { currency: (stale.currency || 0) + 500 });
  User.update(A, { currency: (stale.currency || 0) + 300 });
  eq('old read-modify-write does lose an update', bal(A), 1300);   // 1800 was intended

  User.update(A, { currency: 1000 });
  User.addCurrency(A, 500);
  User.addCurrency(A, 300);
  eq('atomic increments both land', bal(A), 1800);

  // ── Transfers ────────────────────────────────────────────────────────
  console.log('\nTRANSFERS');
  User.update(A, { currency: 5000 });
  User.update(B, { currency: 5000 });
  const total = () => bal(A) + bal(B);
  const startTotal = total();

  const t = User.transferCurrency(A, B, 1200);
  ok('transfer succeeds', t.ok);
  eq('sender debited', bal(A), 3800);
  eq('recipient credited', bal(B), 6200);
  eq('no money created or destroyed', total(), startTotal);

  const bad = User.transferCurrency(A, B, 999999);
  ok('over-balance transfer refused', !bad.ok);
  eq('refused transfer changes nothing', total(), startTotal);

  ok('self-transfer refused', !User.transferCurrency(A, A, 100).ok);
  ok('zero transfer refused', !User.transferCurrency(A, B, 0).ok);
  ok('negative transfer refused', !User.transferCurrency(A, B, -500).ok);
  eq('invalid transfers changed nothing', total(), startTotal);

  // !give must conserve currency
  User.update(A, { currency: 5000 });
  User.update(B, { currency: 5000 });
  await cmd(`!give 1000 ${B.replace('@s.whatsapp.net', '')}`, A);
  eq('!give conserves total currency', bal(A) + bal(B), 10000);

  // ── Interest exploit ─────────────────────────────────────────────────
  console.log('\nREGRESSION: !interest was an unlimited money faucet');
  User.update(A, { currency: 10000, lastInterest: null });
  await cmd('!interest', A);
  const afterFirst = bal(A);
  ok('first interest pays out', afterFirst > 10000, `balance ${afterFirst}`);

  for (let i = 0; i < 10; i++) await cmd('!interest', A);
  eq('spamming !interest pays nothing more', bal(A), afterFirst);

  const txt = await cmd('!interest', A);
  ok('cooldown is explained to the player', /once a day|next payment/i.test(txt));

  // ── Slot machine must be a sink, not a source ────────────────────────
  console.log('\nSLOT MACHINE RETURN');
  const N = SLOT.EMOJIS.length, outcomes = N ** 3;
  const jackpot = 1, tripleOther = N - 1;
  const allDiff = N * (N - 1) * (N - 2);
  const twoSame = outcomes - N - allDiff;
  const rtp = (jackpot * SLOT.JACKPOT + tripleOther * SLOT.THREE_SAME + twoSame * SLOT.TWO_SAME) / outcomes;
  console.log(`      return to player: ${(rtp * 100).toFixed(1)}%`);
  ok('slot does not pay out more than it takes', rtp < 1, `RTP ${(rtp * 100).toFixed(1)}%`);
  ok('slot house edge is not predatory', rtp > 0.80, `RTP ${(rtp * 100).toFixed(1)}%`);
  ok('slot stake is capped', typeof SLOT.MAX_STAKE === 'number' && SLOT.MAX_STAKE > 0);

  // A simulated session, run against the payout table directly rather than
  // through the router — deterministic, and it does not need 250 disk writes.
  let bankroll = 0, staked = 0;
  const roll = () => SLOT.EMOJIS[Math.floor(Math.random() * SLOT.EMOJIS.length)];
  for (let i = 0; i < 20000; i++) {
    const r = [roll(), roll(), roll()];
    const stake = 100;
    staked += stake;
    let mult = 0;
    if (r[0] === r[1] && r[1] === r[2]) mult = r[0] === '7️⃣' ? SLOT.JACKPOT : SLOT.THREE_SAME;
    else if (r[0] === r[1] || r[1] === r[2] || r[0] === r[2]) mult = SLOT.TWO_SAME;
    bankroll += Math.round(stake * mult) - stake;
  }
  console.log(`      20,000 simulated spins: net ${bankroll.toLocaleString()} on ${staked.toLocaleString()} staked`);
  ok('a long slot session loses money', bankroll < 0, `net ${bankroll}`);

  // ── Gambling cannot go below zero ────────────────────────────────────
  console.log('\nNO NEGATIVE BALANCES');
  User.update(A, { currency: 60 });
  for (let i = 0; i < 12; i++) await cmd('!slot 50', A);
  ok('slot never drives a balance negative', bal(A) >= 0, `balance ${bal(A)}`);

  User.update(A, { currency: 20 });
  await cmd('!coinflip 1000', A);
  ok('cannot flip more than you hold', bal(A) >= 0, `balance ${bal(A)}`);

  // ── Cooldowns survive a restart ──────────────────────────────────────
  console.log('\nREGRESSION: cooldowns must survive a restart');
  User.update(A, { currency: 0, lastHustle: null });
  await cmd('!hustle', A);
  const afterHustle = bal(A);
  ok('hustle pays once', afterHustle > 0);

  // Simulate a process restart: module state is gone, the record is not.
  delete require.cache[require.resolve('./commands/hustle')];
  await cmd('!hustle', A);
  eq('hustle cooldown is not reset by a restart', bal(A), afterHustle);

  User.update(A, { currency: 0, lastDaily: null });
  await cmd('!daily', A);
  const afterDaily = bal(A);
  await cmd('!daily', A);
  eq('daily cannot be claimed twice', bal(A), afterDaily);

  User.update(A, { currency: 0, lastSalary: null });
  await cmd('!salary', A);
  const afterSalary = bal(A);
  await cmd('!salary', A);
  eq('salary cannot be claimed twice', bal(A), afterSalary);

  // ── Currency is always a clean non-negative integer ──────────────────
  console.log('\nBALANCE HYGIENE');
  User.update(A, { currency: 100 });
  User.addCurrency(A, 0.7);
  ok('balances stay integers', Number.isInteger(bal(A)), `got ${bal(A)}`);
  User.addCurrency(A, NaN);
  ok('NaN cannot corrupt a balance', Number.isFinite(bal(A)), `got ${bal(A)}`);
  User.addCurrency(A, 'abc');
  ok('a non-numeric delta is ignored', Number.isFinite(bal(A)), `got ${bal(A)}`);

  console.log('\n' + '='.repeat(52));
  console.log(`ECONOMY TESTS: ${pass} passed, ${fail} failed`);
  console.log('='.repeat(52) + '\n');
  process.exit(fail ? 1 : 0);
})();
