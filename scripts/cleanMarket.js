// scripts/cleanMarket.js
// Maintenance: detect and optionally purge market listings whose sellerId does
// NOT match the listed player's real ownerId. Such listings are corrupted (a
// player belonging to a real manager was listed under a fake club seller) and
// would let a buyer clone the player without stripping it from its true owner.
//
// Report-only by default. Pass --fix to actually rewrite market.json and clear
// the stale isListed/marketPrice flags on the affected player docs.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FIX = process.argv.includes('--fix');

function load(table) {
  const file = path.join(DATA_DIR, `${table}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function save(table, data) {
  const file = path.join(DATA_DIR, `${table}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const players = load('players');
const market = load('market');

const conflicts = market.filter((l) => {
  const p = players[l.playerId];
  if (!p) return true; // listing for a missing player is invalid too
  return l.sellerId !== p.ownerId;
});

console.log(`Total listings: ${market.length}`);
console.log(`Corrupted (sellerId !== player.ownerId): ${conflicts.length}`);
for (const l of conflicts) {
  const p = players[l.playerId];
  console.log(
    `  ${l.id}  player=${l.playerId} name=${p ? p.name : '???'}  ` +
      `owner=${p ? p.ownerId : 'MISSING'}  seller=${l.sellerId}  sold=${l.sold}`
  );
}

// Players that are flagged isListed but have no valid active listing.
const flaggedStale = Object.values(players).filter((p) => {
  if (!p.isListed) return false;
  return !market.some((l) => l.playerId === p.id && l.sellerId === p.ownerId && !l.sold);
});
console.log(`\nPlayers isListed but no valid active listing: ${flaggedStale.length}`);
for (const p of flaggedStale) {
  console.log(`  ${p.id} (${p.name}) owner=${p.ownerId} marketPrice=${p.marketPrice}`);
}

if (!FIX) {
  console.log('\n(report only — run with --fix to purge)');
  process.exit(0);
}

// ─── APPLY FIX ──────────────────────────────────────────────────────────────
const conflictIds = new Set(conflicts.map((l) => l.id));
const cleaned = market.filter((l) => !conflictIds.has(l.id));

const playersToClear = new Set();
for (const l of conflicts) playersToClear.add(l.playerId);
for (const p of flaggedStale) playersToClear.add(p.id);

for (const id of playersToClear) {
  if (players[id]) {
    players[id].isListed = false;
    players[id].marketPrice = 0;
  }
}

save('market', cleaned);
save('players', players);
console.log(
  `\nFIXED: removed ${conflicts.length} listings, cleared flags on ${playersToClear.size} players.`
);
process.exit(0);
