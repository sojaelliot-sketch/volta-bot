// models/User.js
const db = require('../config/database');
const { ECONOMY, MODERATION } = require('../config/constants');

const TABLE = 'users';

function newUserDoc(whatsappId, name) {
  const now = new Date().toISOString();
  return {
    whatsappId,
    name: name || 'Manager',
    currency: ECONOMY.STARTING_CURRENCY,

    // Squad — arrays of Player ids
    startingXI: [],
    bench: [],
    reserves: [],

    // Extra saved squads (slot 0 is the default above)
    savedSquads: [],

    // Competitive
    mmr: 1000,
    rank: 'Bronze',
    wins: 0,
    losses: 0,
    draws: 0,
    totalGoals: 0,

    // Daily
    lastDaily: null,
    dailyStreak: 0,

    // State
    inMatch: false,
    currentMatchId: null,
    registered: false,

    // Moderation
    role: 'user',          // user | moderator | officer
    warnings: 0,
    bannedUntil: null,     // ISO string or null

    createdAt: now,
    updatedAt: now,
  };
}

function getByWhatsappId(whatsappId) {
  return db.findOne(TABLE, (u) => u.whatsappId === whatsappId);
}

function create(whatsappId, name) {
  const existing = getByWhatsappId(whatsappId);
  if (existing) return existing;
  const doc = newUserDoc(whatsappId, name);
  return db.insert(TABLE, whatsappId, doc);
}

function update(whatsappId, patch) {
  return db.update(TABLE, whatsappId, patch);
}

function getOrCreate(whatsappId) {
  return getByWhatsappId(whatsappId) || create(whatsappId);
}

function winRate(user) {
  const total = user.wins + user.losses + user.draws;
  return total === 0 ? 0 : Math.round((user.wins / total) * 100);
}

function all() {
  return db.all(TABLE);
}

function roleRank(role) {
  return MODERATION.ROLE_RANK[role] || 0;
}

function isOwner(id) {
  // Normalize both sides to digits only so "@s.whatsapp.net" and any
  // formatting differences don't break the comparison.
  const bare = String(id || '').replace(/\D/g, '');
  const owner = String(MODERATION.OWNER_ID || '').replace(/\D/g, '');
  return !!bare && bare === owner;
}

function isStaff(user) {
  return !!user && (user.role === 'officer' || user.role === 'moderator');
}

function isBanned(user) {
  if (!user || !user.bannedUntil) return false;
  return new Date(user.bannedUntil).getTime() > Date.now();
}

function banRemainingMs(user) {
  if (!user || !user.bannedUntil) return 0;
  return Math.max(0, new Date(user.bannedUntil).getTime() - Date.now());
}

module.exports = {
  create, getByWhatsappId, getOrCreate, update, winRate, all,
  roleRank, isOwner, isStaff, isBanned, banRemainingMs,
};
