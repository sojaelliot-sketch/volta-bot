// Simulate 100 vs-AI matches using a temp data dir, report stats
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpDir = path.join(os.tmpdir(), `volta-sim-${Date.now()}`);
fs.mkdirSync(tmpDir, { recursive: true });
process.env.DATA_DIR = tmpDir;

const db = require('./config/database');
const User = require('./models/User');
const Player = require('./models/Player');
const ms = require('./game-engine/matchSession');

const OWNER = '2349011861051@s.whatsapp.net';
const FAKE = 'sim_opp@s.whatsapp.net';

User.create(OWNER, 'SimHome'); User.update(OWNER, { registered: true, currency: 50000 });
User.create(FAKE, 'SimAway'); User.update(FAKE, { registered: true, currency: 50000 });

function fill(ownerId, tag) {
  for (let i = 0; i < 4; i++) {
    const r = i === 3 ? 'goalkeeper' : 'outfield';
    const s = r === 'goalkeeper'
      ? { reflex: 70+i, positioning: 68+i, anticipation: 65+i, strength: 62+i, composure: 60+i }
      : { pace: 72+i, skill: 70+i, shooting: 68+i, stamina: 72+i, composure: 65+i };
    Player.create({ ownerId, name: `${tag}_${i}`, role: r, rarity: 'rare', stats: s });
  }
  const all = Player.getByOwner(ownerId);
  const of = all.filter(p => p.role !== 'goalkeeper');
  const gk = all.find(p => p.role === 'goalkeeper');
  const xi = of.slice(0,3).map(p=>p.id); if(gk) xi.push(gk.id);
  User.update(ownerId, { startingXI: xi, bench: of.slice(3,6).map(p=>p.id), reserves: all.filter(p=>!xi.includes(p.id)).map(p=>p.id) });
}
fill(OWNER, 'H');
fill(FAKE, 'A');

let ok = 0, fail = 0;

async function run(i) {
  const jid = `sim_${i}@s.whatsapp.net`;
  const sock = { sendMessage: async()=>{}, sendPresenceUpdate: async()=>{}, groupMetadata: async()=>({subject:'T'}) };
  try {
    const s = await ms.startMatch(sock, OWNER, 'AI', { chatJid: jid, aiDifficulty: 'Medium' });
    if (!s) { fail++; console.error(`  Match ${i}: startMatch returned null`); return; }
    await new Promise(r => setTimeout(r, 400));
    ok++;
  } catch(e) { fail++; console.error(`Match ${i}:`, e.message); }
}

(async () => {
  console.log('Simulating 100 vs-AI matches...');
  const t0 = Date.now();
  for (let i = 0; i < 100; i++) {
    await run(i);
    if ((i+1)%20 === 0) process.stdout.write(`  ${i+1}/100\n`);
  }
  const secs = ((Date.now()-t0)/1000).toFixed(1);

  // Read results from matches table
  const all = db.all('matches') || {};
  const list = Object.values(all).filter(m => m.homeId === OWNER || m.awayId === OWNER);
  let hw=0, aw=0, d=0, tg=0;
  for (const m of list) {
    if (m.result === 'W') hw++; else if (m.result === 'L') aw++; else d++;
    tg += (m.homeScore||0)+(m.awayScore||0);
  }

  console.log(`\n=== ${ok+fail} matches in ${secs}s ===`);
  console.log(`Completed: ${ok} | Errors: ${fail}`);
  if (list.length) {
    console.log(`Home wins: ${hw} (${(hw/list.length*100).toFixed(0)}%)`);
    console.log(`Away wins: ${aw} (${(aw/list.length*100).toFixed(0)}%)`);
    console.log(`Draws:     ${d} (${(d/list.length*100).toFixed(0)}%)`);
    console.log(`Total goals: ${tg} (avg ${(tg/list.length).toFixed(2)})`);
  }
  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exit(0);
})();