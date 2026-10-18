'use strict';
// test_pairing.js — pairing-code login, tested end to end against a FAKE
// WhatsApp socket (no network, no phone). Run:  node test_pairing.js
//
// Boots the real index.js with @whiskeysockets/baileys swapped for a stub,
// then drives the connection events WhatsApp would send.

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

let pass = 0, fail = 0;
const ok = (l, c, d) => { c ? (console.log('  ✓ ' + l), pass++) : (console.log('  ✗ ' + l + (d ? ' — ' + d : '')), fail++); };
const eq = (l, a, b) => ok(l, a === b, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 1. pure helpers ---------------- */
const P = require('./utils/pairing');
console.log('\nNUMBER NORMALISATION');
eq('full intl stays', P.normaliseNumber('2348012345678').number, '2348012345678');
eq('+ and spaces stripped', P.normaliseNumber('+234 801 234 5678').number, '2348012345678');
eq('local 0801… gets 234', P.normaliseNumber('08012345678').number, '2348012345678');
eq('234 0801… drops the 0', P.normaliseNumber('+234 0801 234 5678').number, '2348012345678');
eq('00 prefix stripped', P.normaliseNumber('002348012345678').number, '2348012345678');
ok('short NG number rejected', !!P.normaliseNumber('23480123456').error);
ok('garbage rejected', !!P.normaliseNumber('hello').error);
eq('UK number untouched', P.normaliseNumber('447911123456').number, '447911123456');
eq('US number untouched', P.normaliseNumber('+1 (415) 555-2671').number, '14155552671');

console.log('\nLINK DETECTION');
ok('fresh creds = not linked', !P.isLinked({ registered: false }));
ok('QR-linked creds (registered:false) = linked', P.isLinked({ registered: false, account: {}, me: { id: '234:5@s.whatsapp.net' } }));
ok('code accepted but pair-success missing = not linked', !P.isLinked({ registered: true, me: { id: '234@s.whatsapp.net', name: '~' } }));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'volta-pair-'));
const sdir = path.join(tmp, 'sessions');
eq('missing dir = empty', P.sessionState(sdir), 'empty');
fs.mkdirSync(sdir); fs.writeFileSync(path.join(sdir, 'creds.json'), JSON.stringify({ registered: false, me: { id: 'x' } }));
eq('half-linked detected', P.sessionState(sdir), 'unlinked');
fs.writeFileSync(path.join(sdir, 'creds.json'), JSON.stringify({ registered: false, account: { a: 1 }, me: { id: '234:1@s.whatsapp.net' } }));
eq('QR-linked session detected as linked', P.sessionState(sdir), 'linked');
fs.writeFileSync(path.join(sdir, 'creds.json'), '{broken');
eq('corrupt detected', P.sessionState(sdir), 'corrupt');
ok('archive moves it aside', !!P.archiveSession(sdir) && !fs.existsSync(sdir));
eq('code formatting', P.formatCode('abcd1234'), 'ABCD-1234');

/* ---------------- 2. full flow with a fake socket ---------------- */
const { EventEmitter } = require('events');
const realBaileys = require('@whiskeysockets/baileys');
const sockets = [];
let credsStore = null;  // shared, like the files on disk

function fakeMakeWASocket(cfg) {
  const ev = new EventEmitter();
  const s = {
    cfg, ev, ended: false, codeRequests: [],
    authState: cfg.auth,
    user: null,
    ws: { close() {} },
    end() { s.ended = true; },
    async requestPairingCode(num) {
      if (!s.ready) throw new Error('Connection Closed');
      s.codeRequests.push(num);
      cfg.auth.creds.me = { id: num + '@s.whatsapp.net', name: '~' };
      return 'ABCD' + String(1000 + sockets.length);
    },
    // test drivers
    serverReady() { s.ready = true; ev.emit('connection.update', { qr: 'ref,noise,id,adv' }); },
    close(statusCode, message = 'x') {
      const e = new Error(message); e.output = { statusCode }; e.isBoom = true;
      ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: e } });
    },
    open() { s.user = { id: '2348012345678:7@s.whatsapp.net' }; ev.emit('connection.update', { connection: 'open' }); },
  };
  sockets.push(s);
  return s;
}
async function fakeAuth() {
  if (!credsStore) credsStore = { registered: false, noiseKey: {}, me: undefined };
  return { state: { creds: credsStore, keys: {} }, saveCreds: async () => {} };
}

const stub = {
  ...realBaileys,
  default: fakeMakeWASocket,
  makeWASocket: fakeMakeWASocket,
  useMultiFileAuthState: fakeAuth,
  fetchLatestWaWebVersion: async () => ({ version: [2, 3000, 1] }),
};
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@whiskeysockets/baileys') return stub;
  return origLoad.call(this, req, ...rest);
};

// Isolated data + session dirs so the real data/ is never touched.
const dataDir = path.join(tmp, 'data');
fs.cpSync(path.join(__dirname, 'data'), dataDir, { recursive: true, filter: (p) => !p.includes('backups') });
process.env.DATA_DIR = dataDir;
process.env.SESSION_DIR = path.join(tmp, 'sess');
process.env.USE_PAIRING_CODE = 'true';
process.env.PHONE_NUMBER = '08012345678';   // local format on purpose
process.env.LOG_LEVEL = 'silent';

// Pre-create a half-linked session: boot must clear it.
fs.mkdirSync(process.env.SESSION_DIR);
fs.writeFileSync(path.join(process.env.SESSION_DIR, 'creds.json'), JSON.stringify({ registered: false }));

const logs = [];
const origLog = console.log;
console.log = (...a) => { logs.push(a.join(' ')); };
const restore = () => { console.log = origLog; };

(async () => {
  require('./index.js');
  await sleep(400);
  restore();
  console.log('\nFULL FLOW (fake socket)');
  ok('half-linked session cleared on boot', logs.some((l) => /half-linked session/.test(l)));
  eq('one socket created', sockets.length, 1);
  const s1 = sockets[0];
  ok('pairing mode keeps socket alive longer', s1.cfg.qrTimeout >= 60000, String(s1.cfg.qrTimeout));
  eq('no code requested before server is ready', s1.codeRequests.length, 0);

  console.log = (...a) => logs.push(a.join(' '));
  s1.serverReady();
  await sleep(50);
  restore();
  eq('code requested on first qr event', s1.codeRequests.length, 1);
  eq('number normalised to 234…', s1.codeRequests[0], '2348012345678');
  ok('code printed', logs.some((l) => /PAIRING CODE:\s+ABCD-1001/.test(l)));
  console.log = (...a) => logs.push(a.join(' '));
  s1.serverReady(); s1.serverReady();   // QR rotation must not spam codes
  await sleep(30);
  restore();
  eq('QR rotation does not request more codes', s1.codeRequests.length, 1);

  // Pairing window times out -> new socket, new code, old one flagged invalid.
  console.log = (...a) => logs.push(a.join(' '));
  s1.close(408, 'QR refs attempts ended');
  await sleep(2600);
  restore();
  eq('reconnected after timeout', sockets.length, 2);
  ok('old socket ended', s1.ended);
  const s2 = sockets[1];
  console.log = (...a) => logs.push(a.join(' '));
  s2.serverReady();
  await sleep(50);
  restore();
  eq('new code on new socket', s2.codeRequests.length, 1);
  ok('user told old code is invalid', logs.some((l) => /earlier code is now INVALID/.test(l)));

  // Phone enters the code: pair-success sets account, then 515 restart.
  credsStore.registered = true;
  credsStore.account = { details: 'x' };
  credsStore.me = { id: '2348012345678:7@s.whatsapp.net' };
  console.log = (...a) => logs.push(a.join(' '));
  s2.ev.emit('connection.update', { isNewLogin: true });
  s2.close(515, 'Stream Errored (restart required)');
  await sleep(1800);
  restore();
  eq('restarted after link', sockets.length, 3);
  const s3 = sockets[2];
  eq('linked socket is NOT in pairing mode', s3.cfg.qrTimeout, undefined);
  console.log = (...a) => logs.push(a.join(' '));
  s3.serverReady();   // even if a qr event arrived, no code must be requested
  s3.open();
  await sleep(50);
  restore();
  eq('no pairing code requested on a linked session', s3.codeRequests.length, 0);
  ok('connected message', logs.some((l) => /Connected as 2348012345678/.test(l)));

  // Regression: QR-linked sessions (registered:false forever) must not be re-paired.
  credsStore.registered = false;
  console.log = (...a) => logs.push(a.join(' '));
  s3.close(428, 'Connection Closed');
  await sleep(7000);
  restore();
  eq('reconnected after drop', sockets.length, 4);
  sockets[3].serverReady();
  await sleep(30);
  eq('QR-linked session not hit with requestPairingCode', sockets[3].codeRequests.length, 0);

  console.log('\n' + '='.repeat(50));
  console.log(`PAIRING TESTS: ${pass} passed, ${fail} failed`);
  console.log('='.repeat(50));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { restore(); console.error(e); process.exit(1); });
