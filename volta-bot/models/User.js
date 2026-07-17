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
    winStreak: 0,           // current consecutive-win counter (for badges)
    tournamentWins: 0,

    // Collectible badges/achievements — array of badge KEYS (see BADGES const).
    badges: [],

    // Daily
    lastDaily: null,
    dailyStreak: 0,

    // State
    inMatch: false,
    currentMatchId: null,
    registered: false,

    // Onboarding tips — tipStart is set on registration; tipIndex counts how
    // many of the TIPS pool this manager has received (survives restarts).
    tipStart: null,
    tipIndex: 0,

    // Referral
    refCode: null,          // this manager's invite code
    referredBy: null,       // whatsappId of the manager who referred them

    // Moderation
    role: 'user',          // user | moderator | officer
    warnings: 0,
    bannedUntil: null,     // ISO string or null

    createdAt: now,
    updatedAt: now,
  };
}

// Normalize a WhatsApp jid so different serializations of the same account
// resolve identically:
//   • drop the multi-device ":<id>" suffix
//     (2349011861051:23@s.whatsapp.net → 2349011861051@s.whatsapp.net)
//   • unify personal-chat domains. Some clients surface @mentions / replies as
//     the Linked-ID form "2349011861051@lid", which is the SAME account as
//     "2349011861051@s.whatsapp.net". Map @lid → @s.whatsapp.net so challenge
//     targets (and every lookup) match the stored id.
// Group jids (…@g.us) are left untouched.
function normalizeJid(jid) {
  if (!jid) return jid;
  let s = String(jid).split(':')[0];
  if (s.endsWith('@lid')) s = s.slice(0, -4) + '@s.whatsapp.net';
  return s;
}

function getByWhatsappId(whatsappId) {
  const id = normalizeJid(whatsappId);
  return db.findOne(TABLE, (u) => normalizeJid(u.whatsappId) === id);
}

// Generate a unique 6-char invite code (avoids ambiguous chars).
function genRefCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 30; i++) {
    let c = '';
    for (let j = 0; j < 6; j++) c += chars[Math.floor(Math.random() * chars.length)];
    if (!db.findOne(TABLE, (u) => u.refCode === c)) return c;
  }
  return 'VOLTA' + Math.floor(Math.random() * 1e6);
}

function create(whatsappId, name) {
  const id = normalizeJid(whatsappId);
  const existing = getByWhatsappId(id);
  if (existing) return existing;
  const doc = newUserDoc(id, name);
  doc.refCode = genRefCode();
  return db.insert(TABLE, id, doc);
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
  create, getByWhatsappId, getOrCreate, update, winRate, all, genRefCode,
  roleRank, isOwner, isStaff, isBanned, banRemainingMs, normalizeJid,
};
