// ═══════════════════════════════════════════════════════════════════════════
//  VOLTA • DEV CONSOLE  —  LOCAL "FAKE WHATSAPP"
//  ⚠️ THROWAWAY DEV TOOL — does NOT touch the live bot or its data.
//  Uses a temp DATA_DIR so nothing here persists into the real bot.
//  Delete this file when asked. To run:
//     node dev/console_bot.js
//  Then type commands like:  !start   !menu   !profile   !stadium   !play
//  Type  !quit  to exit.
// ═══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

// ── isolated data/log dirs so the live bot is never touched ────────────────
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'volta-console-'));
process.env.DATA_DIR = path.join(tmpRoot, 'data');
process.env.LOG_DIR = path.join(tmpRoot, 'logs');
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.LOG_DIR, { recursive: true });

const db = require('../config/database');
const router = require('../commands/router');
const { OWNER_ID } = require('../config/constants');

// ── fake "whatsapp" connection ─────────────────────────────────────────────
// The current console user. Swap with:  owner | alice | bob
let activeUser = 'owner';

const USERS = {
  owner: `${OWNER_ID}@s.whatsapp.net`,
  alice: '1111111111@s.whatsapp.net',
  bob: '2222222222@s.whatsapp.net',
};

const sock = {
  sendMessage: async (jid, content, opts) => {
    const text = content && content.text;
    if (content && content.image) {
      const cap = content.caption || '';
      console.log(`\n  🖼️  [image → ${short(jid)}] ${cap.split('\n')[0]}`);
      if (cap.split('\n').length > 1) console.log('     ' + cap.split('\n').slice(1).join('\n     '));
    }
    if (text) {
      console.log(`\n  ${text.split('\n').join('\n  ')}`);
    }
    return { key: { id: 'dev-' + Date.now() } };
  },
  sendPresenceUpdate: async () => {},
  groupParticipantsUpdate: async () => {},
};

function short(jid) {
  return jid.length > 20 ? jid.slice(0, 8) + '…' : jid;
}

function buildMsg(line) {
  const sender = USERS[activeUser] || USERS.owner;
  // owner messages arrive as fromMe:true just like the real self-hosted bot
  const fromMe = activeUser === 'owner';
  return {
    key: {
      remoteJid: sender,
      fromMe,
      id: 'dev-' + Math.random().toString(36).slice(2),
      participant: fromMe ? undefined : sender,
    },
    message: { conversation: line },
  };
}

// ── console REPL ───────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function prompt() {
  rl.question(`\n[${activeUser}] ! `, async (line) => {
    const cmd = line.trim();
    if (cmd === '!quit' || cmd === '.exit') { console.log('Bye.'); rl.close(); return; }
    if (cmd === '') { prompt(); return; }
    if (cmd === '!whoami') { console.log(`  you are "${activeUser}" → ${USERS[activeUser]}`); prompt(); return; }
    if (cmd.startsWith('!as ')) {
      const who = cmd.slice(4).trim().toLowerCase();
      if (USERS[who]) { activeUser = who; console.log(`  → now acting as ${who}`); }
      else console.log(`  unknown user. try: !as owner | !as alice | !as bob`);
      prompt(); return;
    }
    if (cmd.startsWith('!')) {
      try { await router.handle(sock, buildMsg(cmd)); }
      catch (e) { console.log('  ⚠️ harness error:', e.message); }
    } else {
      console.log('  type commands starting with "!" (e.g. !menu). !quit to exit.');
    }
    prompt();
  });
}

(async () => {
  await db.connectDB();
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  VOLTA DEV CONSOLE — local fake WhatsApp (throwaway)       ║');
  console.log('║  data dir:', process.env.DATA_DIR);
  console.log('║  you are "owner". switch users with: !as alice / !as bob   ║');
  console.log('║  commands: !start !menu !profile !stadium !play !quit      ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  prompt();
})();
