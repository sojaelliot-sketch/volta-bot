const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, '..', 'data');
const OWNER = '2349011861051@s.whatsapp.net';

const players = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'players.json'), 'utf8'));
const users = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8'));

function playerOvr(p) {
  const s = p.stats;
  if (p.role === 'goalkeeper') return (s.reflex + s.positioning + s.anticipation + s.strength + s.composure) / 5;
  return (s.pace + s.skill + s.shooting + s.stamina + s.composure) / 5;
}

// Collect existing owner players + AI club players into one pool
const existingOwner = Object.values(players).filter(p => p.ownerId === OWNER);
const clubPlayers = Object.values(players)
  .filter(p => p.ownerId !== OWNER && p.ownerId.startsWith('club:'));

const pool = [...existingOwner, ...clubPlayers]
  .sort((a, b) => playerOvr(b) - playerOvr(a));

console.log('Existing owner players:', existingOwner.length);
console.log('Club players available:', clubPlayers.length);
console.log('Best overall:', pool[0].name, Math.round(playerOvr(pool[0])));

// Pick the top players for owner squads
// Squad 1 (active): 3 startingXI (outfield) + 1 GK + 3 bench
// Squad 2 (saved): 3 startingXI (outfield) + 1 GK + 3 bench
// All other players go to reserves
const needTotal = Math.min(pool.length, 40);
const chosen = pool.slice(0, needTotal);

// Separate into GKs and outfield
const gks = chosen.filter(p => p.role === 'goalkeeper');
const outfield = chosen.filter(p => p.role !== 'goalkeeper');

// Squad 1: best GK + best 7 outfield
const squad1_gk = gks.slice(0, 1);
const squad1_of = outfield.slice(0, 7);
// Squad 2: next GK + next 7 outfield
const squad2_gk = gks.slice(1, 2);
const squad2_of = outfield.slice(7, 14);
// Reserves: rest
const reserves = [
  ...outfield.slice(14),
  ...gks.slice(2),
];

// Include any existing owner players not in chosen (e.g. lower-OVR originals)
const existingNotChosen = existingOwner.filter(ep => !chosen.find(c => c.id === ep.id));
const allTransferred = [...squad1_gk, ...squad1_of, ...squad2_gk, ...squad2_of, ...reserves, ...existingNotChosen];
for (const p of allTransferred) {
  p.ownerId = OWNER;
  p.isListed = false;
  p.marketPrice = 0;
  p.isAI = false;
  players[p.id] = p;
}

// Build squad arrays (player IDs)
const s1_startingXI = [...squad1_of.slice(0, 3).map(p => p.id), ...squad1_gk.map(p => p.id)];
const s1_bench = squad1_of.slice(3, 7).map(p => p.id);
const s1_reserves = [];

const s2_startingXI = [...squad2_of.slice(0, 3).map(p => p.id), ...squad2_gk.map(p => p.id)];
const s2_bench = squad2_of.slice(3, 7).map(p => p.id);
const s2_reserves = [...reserves.map(p => p.id), ...existingNotChosen.map(p => p.id)];

// Update user
const user = users[OWNER];
user.startingXI = s1_startingXI;
user.bench = s1_bench;
user.reserves = s2_reserves;
user.savedSquads = [
  { startingXI: s2_startingXI, bench: s2_bench, reserves: [] },
];
user.currency = 50000000;
user.registered = true;

fs.writeFileSync(path.join(DATA_DIR, 'users.json'), JSON.stringify(users, null, 2));
fs.writeFileSync(path.join(DATA_DIR, 'players.json'), JSON.stringify(players, null, 2));

console.log(`Done! Setup complete.`);
console.log(`Owner players:`, Object.values(players).filter(p => p.ownerId === OWNER).length);
console.log(`  Squad 1 (active): ${s1_startingXI.length} XI + ${s1_bench.length} bench`);
console.log(`  Squad 2 (saved):  ${s2_startingXI.length} XI + ${s2_bench.length} bench`);
console.log(`  Reserves squad 2: ${s2_reserves.length} players`);
console.log(`  Currency: ${user.currency}`);

// Show best players
const allOwner = Object.values(players).filter(p => p.ownerId === OWNER).sort((a, b) => playerOvr(b) - playerOvr(a));
console.log(`\nBest owner players (top 10):`);
allOwner.slice(0, 10).forEach((p, i) => {
  let extra = '';
  if (s1_startingXI.includes(p.id)) extra = ' [XI]';
  else if (s1_bench.includes(p.id)) extra = ' [B]';
  else if (s2_startingXI.includes(p.id)) extra = ' [XI-2]';
  else if (s2_bench.includes(p.id)) extra = ' [B-2]';
  else extra = ' [RES]';
  console.log(`  ${i+1}. ${p.name} — ${Math.round(playerOvr(p))} OVR — ${p.role}${extra}`);
});
