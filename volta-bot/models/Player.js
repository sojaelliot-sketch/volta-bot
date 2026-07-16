// models/Player.js
const db = require('../config/database');
const { RARITY } = require('../config/constants');
const User = require('./User');
const { pick, randInt } = require('../utils/random');

const TABLE = 'players';

// Short, PRONOUNCEABLE player IDs: 3 letters in Consonant-Vowel-Consonant form
// (e.g. "BAK", "ZOT", "KIP"). ~2,200 combos, plus a digit fallback if every
// CVC is somehow taken, so IDs stay unique and never collide.
const CONSONANTS = 'BCDFGHJKLMNPQRSTVWZ';
const VOWELS = 'AEIOU';
function generatePlayerId() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const id = pick(CONSONANTS) + pick(VOWELS) + pick(CONSONANTS);
    if (!db.findById(TABLE, id)) return id;
  }
  // Fallback: CVC + digit (still reads fine, guarantees we never loop forever)
  let id;
  do {
    id = pick(CONSONANTS) + pick(VOWELS) + pick(CONSONANTS) + randInt(0, 9);
  } while (db.findById(TABLE, id));
  return id;
}

function defaultStats(role) {
  return role === 'goalkeeper'
    ? { reflex: 60, positioning: 60, anticipation: 60, strength: 60, composure: 60 }
    : { pace: 60, skill: 60, shooting: 60, stamina: 60, composure: 60 };
}

function newPlayerDoc({
  ownerId,
  name,
  role = 'outfield',
  rarity = 'Common',
  potential = 'Medium',
  stats,
  age = 21,
  nationality = 'Nigerian',
}) {
  const id = generatePlayerId();
  const now = new Date().toISOString();
  return {
    id,
    ownerId,
    name,
    nickname: null,
    role,
    rarity,
    potential,
    level: 1,
    stats: stats || defaultStats(role),

    condition: 100,
    form: 'Normal',
    chemistry: 0,

    injuredUntil: null,   // ISO timestamp; null = healthy

    isListed: false,
    marketPrice: 0,
    isAI: false,

    matchesPlayed: 0,
    goals: 0,
    assists: 0,
    saves: 0,
    manOfTheMatch: 0,

    nationality,
    age,

    createdAt: now,
    updatedAt: now,
  };
}

function create(fields) {
  const doc = newPlayerDoc({ ...fields, ownerId: User.normalizeJid(fields.ownerId) });
  return db.insert(TABLE, doc.id, doc);
}

function getById(id) {
  return db.findById(TABLE, id);
}

function getByOwner(ownerId) {
  const id = User.normalizeJid(ownerId);
  return db.find(TABLE, (p) => User.normalizeJid(p.ownerId) === id);
}

// Resolve a player by exact id, or by a (case-insensitive) id prefix across the
// whole player pool. Used by commands where a user might paste a partial/clipped
// id (e.g. auction / market listings, which only show a short id).
function findByPrefix(prefix) {
  if (!prefix) return null;
  const p = String(prefix).toUpperCase();
  return db.find(TABLE, (x) => x.id.startsWith(p));
}

// Resolve a single player owned by `ownerId` from a human-friendly query:
// exact id, id prefix, full nickname/name (case-insensitive), or name prefix.
// Lets managers type a player's NAME instead of hunting for an ID.
function findByQuery(ownerId, q) {
  if (!q) return null;
  const owned = getByOwner(ownerId);
  const s = String(q).trim().toLowerCase();
  let p = owned.find((x) => x.id.toLowerCase() === s);
  if (p) return p;
  p = owned.find((x) => x.id.toLowerCase().startsWith(s));
  if (p) return p;
  p = owned.find((x) => (x.nickname || '').toLowerCase() === s || (x.name || '').toLowerCase() === s);
  if (p) return p;
  p = owned.find((x) => (x.nickname || '').toLowerCase().startsWith(s) || (x.name || '').toLowerCase().startsWith(s));
  return p || null;
}

// Resolve a single player from the WHOLE pool by exact id, id prefix, or
// nickname/name. Used by the auction host, who may list any player.
function findAny(q) {
  if (!q) return null;
  const s = String(q).trim().toLowerCase();
  const all = db.all(TABLE);
  let p = all.find((x) => x.id.toLowerCase() === s);
  if (p) return p;
  p = all.find((x) => x.id.toLowerCase().startsWith(s));
  if (p) return p;
  p = all.find((x) => (x.nickname || '').toLowerCase() === s || (x.name || '').toLowerCase() === s);
  if (p) return p;
  return all.find((x) => (x.nickname || '').toLowerCase().startsWith(s) || (x.name || '').toLowerCase().startsWith(s)) || null;
}

function update(id, patch) {
  return db.update(TABLE, id, patch);
}

function remove(id) {
  return db.remove(TABLE, id);
}

// Players that belong to the user's ACTIVE squad only (the union of their
// startingXI + bench + reserves). This keeps each saved squad's roster
// isolated — a player in Squad 2 never leaks into Squad 1, and autosquad /
// match assembly only ever consider the squad you currently have loaded.
function getSquadPlayers(ownerId) {
  const user = User.getByWhatsappId(ownerId);
  if (!user) return [];
  const ids = [
    ...(user.startingXI || []),
    ...(user.bench || []),
    ...(user.reserves || []),
  ];
  return ids.map((id) => getById(id)).filter(Boolean);
}

// ─── DERIVED VALUES (equivalent of mongoose virtuals) ─────────────────────

function displayName(player) {
  return player.nickname || player.name;
}

function totalStats(player) {
  const s = player.stats;
  return player.role === 'goalkeeper'
    ? s.reflex + s.positioning + s.anticipation + s.strength + s.composure
    : s.pace + s.skill + s.shooting + s.stamina + s.composure;
}

// Value = (TotalStats × LevelFactor × FormFactor) + RarityBonus
function marketValue(player) {
  const rarityBonus = RARITY[player.rarity]?.bonus || 0;
  const levelFactor = 1 + (player.level - 1) * 0.1;
  const formFactor = player.form === 'Hot' ? 1.1 : player.form === 'Cold' ? 0.9 : 1.0;
  return Math.round(totalStats(player) * levelFactor * formFactor + rarityBonus);
}

module.exports = {
  create,
  getById,
  getByOwner,
  findByPrefix,
  findByQuery,
  findAny,
  getSquadPlayers,
  update,
  remove,
  displayName,
  totalStats,
  marketValue,
};
