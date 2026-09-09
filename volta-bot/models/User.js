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
    bannedUntil: null,      // ISO string or null
    cooldownUntil: null,    // ISO string or null — staff-set command cooldown

    // Stadium ownership (catch system). key is one of STADIUM.TIERS, or omitted
    // for the default Sunday Pitch. fanEnergy (0-100) gates home bonuses.
    stadium: null,          // e.g. 'volta_colosseum' or null = Sunday Pitch
    fanEnergy: 100,         // 0-100, decays when inactive
    upkeepLastPaid: null,   // ISO date of last weekly upkeep payment

    // Normal-match penalty preference: if true, a drawn normal PvP/!match goes
    // to a penalty shootout instead of a draw result.
    pkEnabled: false,

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


/**
 * Change a balance atomically. Use this for EVERY currency movement instead of
 * reading the balance and writing back an absolute value — see db.mutate().
 *
 * Returns { ok, balance, applied }. When `allowNegative` is false (the default)
 * a debit larger than the balance is refused outright rather than quietly
 * pushing the account below zero.
 */
function addCurrency(whatsappId, delta, { allowNegative = false } = {}) {
  const amount = Math.round(Number(delta) || 0);
  let result = { ok: false, balance: 0, applied: 0 };
  db.mutate(TABLE, whatsappId, (u) => {
    const before = Math.max(0, Math.round(u.currency || 0));
    const after = before + amount;
    if (!allowNegative && after < 0) {
      result = { ok: false, balance: before, applied: 0, reason: 'insufficient' };
      return null;
    }
    const finalBalance = Math.max(0, after);
    result = { ok: true, balance: finalBalance, applied: finalBalance - before };
    return { currency: finalBalance };
  });
  return result;
}

/**
 * Move currency between two accounts without any window in which the money
 * exists in both places or neither. The debit is attempted first; the credit
 * only happens if it succeeded, and is rolled back if the credit fails.
 */
function transferCurrency(fromJid, toJid, amount) {
  const amt = Math.round(Number(amount) || 0);
  if (amt <= 0) return { ok: false, reason: 'invalid_amount' };
  if (fromJid === toJid) return { ok: false, reason: 'same_account' };

  const debit = addCurrency(fromJid, -amt);
  if (!debit.ok) return { ok: false, reason: 'insufficient', balance: debit.balance };

  const credit = addCurrency(toJid, amt);
  if (!credit.ok) {
    addCurrency(fromJid, amt, { allowNegative: true });   // roll back
    return { ok: false, reason: 'credit_failed' };
  }
  return { ok: true, from: debit.balance, to: credit.balance, amount: amt };
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

// Find a registered user by exact name (case-insensitive), then by partial match.
// Used by commands that accept a manager NAME instead of a raw number/jid.
function findByName(name) {
  if (!name) return null;
  const s = String(name).trim().toLowerCase();
  const users = db.all(TABLE).filter((u) => u && u.registered);
  return (
    users.find((u) => String(u.name || '').toLowerCase() === s) ||
    users.find((u) => String(u.name || '').toLowerCase().includes(s)) ||
    null
  );
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

function isOnCooldown(user) {
  if (!user || !user.cooldownUntil) return false;
  return new Date(user.cooldownUntil).getTime() > Date.now();
}

function cooldownRemainingMs(user) {
  if (!user || !user.cooldownUntil) return 0;
  return Math.max(0, new Date(user.cooldownUntil).getTime() - Date.now());
}

module.exports = {
  create, getByWhatsappId, getByWhatsAppId: getByWhatsappId, getOrCreate, update, addCurrency, transferCurrency, winRate, all, genRefCode, findByName,
  roleRank, isOwner, isStaff, isBanned, banRemainingMs, isOnCooldown, cooldownRemainingMs, normalizeJid,
};
