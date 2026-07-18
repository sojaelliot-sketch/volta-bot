// utils/stadium.js
// Centralizes the three mechanical stadium "catches" so the training command,
// match engine and match flow all share one source of truth. Stadium data lives
// in config/constants.js STADIUM.TIERS (keys must match stadiumRenderer.js).
const { STADIUM } = require('../config/constants');
const User = require('../models/User');
const logger = require('./logger');

function tiers() { return STADIUM.TIERS; }
function tierOf(key) {
  if (!key) return tiers()[STADIUM.DEFAULT_KEY];
  return tiers()[key] || tiers()[STADIUM.DEFAULT_KEY];
}
function resolveKey(user) {
  return (user && user.stadium) || STADIUM.DEFAULT_KEY;
}
function isDefault(user) { return !user || !user.stadium || user.stadium === STADIUM.DEFAULT_KEY; }

// ─── CATCH #1: TRAINING MULTIPLIER ───────────────────────────────────────────
function trainingMultiplier(user) {
  return tierOf(resolveKey(user)).trainingMult || 1.0;
}

// Multiply a raw stat gain by the owner's stadium training multiplier.
function applyTrainingMultiplier(user, gain) {
  return Math.round(gain * trainingMultiplier(user));
}

// ─── UPKEEP / DORMANCY ───────────────────────────────────────────────────────
// Bonuses are dormant if upkeep is unpaid beyond the grace window. We treat the
// stadium as "active" if the owner has never been charged OR the last payment is
// within (7 + grace) days. The bot should run stadiumUpkeep() on a weekly cron /
// on login to deduct currency and stamp upkeepLastPaid.
function isActive(user) {
  if (isDefault(user)) return true; // Sunday Pitch has no upkeep
  const paid = user.upkeepLastPaid ? new Date(user.upkeepLastPaid).getTime() : 0;
  if (!paid) return true; // grace period before first charge
  const window = 7 * 24 * 3600 * 1000 + STADIUM.UPKEEP_GRACE_DAYS * 24 * 3600 * 1000;
  return (Date.now() - paid) < window;
}

// Deduct weekly upkeep. Returns { ok, cost, dormant } — dormant=true means they
// couldn't pay and bonuses are now paused (not lost).
function stadiumUpkeep(user, force = false) {
  if (isDefault(user) && !force) return { ok: true, cost: 0, dormant: false };
  const tier = tierOf(resolveKey(user));
  const cost = tier.upkeep || 0;
  if (cost <= 0) return { ok: true, cost: 0, dormant: false };
  const cur = user.currency || 0;
  if (cur < cost) {
    // Can't pay → bonuses dormant until currency restored.
    User.update(user.whatsappId, { upkeepLastPaid: new Date().toISOString() });
    return { ok: false, cost, dormant: true };
  }
  User.update(user.whatsappId, {
    currency: cur - cost,
    upkeepLastPaid: new Date().toISOString(),
  });
  return { ok: true, cost, dormant: false };
}

// ─── CATCH #2: HOME FAN-ENERGY BONUSES ───────────────────────────────────────
// Returns a bonus object { momentum, conditionRegen, currencyMult } scaled by
// fan energy (0-100). Bonuses only work at/above FULL_ENERGY, scaled linearly
// below, and are zero below LOW_ENERGY. Dormant (unpaid upkeep) = no bonuses.
function homeBonuses(user) {
  const result = { momentum: 0, conditionRegen: 0, currencyMult: 1, active: false, energy: 100, tier: 0 };
  if (isDefault(user)) return result; // Sunday Pitch: no bonuses
  const tier = tierOf(resolveKey(user));
  let energy = Math.max(0, Math.min(STADIUM.ENERGY_MAX, user.fanEnergy || 0));
  result.energy = energy;
  result.tier = tier.tier;
  if (!isActive(user)) return result; // dormant
  if (energy < STADIUM.LOW_ENERGY) return result; // no bonuses at all

  let scale;
  if (energy >= STADIUM.FULL_ENERGY) scale = 1;
  else scale = (energy - STADIUM.LOW_ENERGY) / (STADIUM.FULL_ENERGY - STADIUM.LOW_ENERGY);
  scale = Math.max(0, Math.min(1, scale));

  result.momentum = Math.round(tier.momentumBonus * STADIUM.ENERGY_MAX * scale);
  result.conditionRegen = tier.conditionRegen * scale;
  result.currencyMult = 1 + tier.currencyBonus * scale;
  result.active = scale > 0;
  return result;
}

// Adjust fan energy after a home result. dir: 'win' | 'draw' | 'loss'.
function adjustFanEnergy(user, dir) {
  if (isDefault(user)) return;
  const delta = dir === 'win' ? STADIUM.ENERGY_WIN
    : dir === 'draw' ? STADIUM.ENERGY_DRAW
    : STADIUM.ENERGY_LOSS;
  const energy = Math.max(0, Math.min(STADIUM.ENERGY_MAX, (user.fanEnergy || 0) + delta));
  User.update(user.whatsappId, { fanEnergy: energy });
}

// Decay fan energy for inactivity. days = whole days since last login/activity.
function decayFanEnergy(user, days) {
  if (isDefault(user) || !days || days <= 0) return;
  const decay = STADIUM.ENERGY_DECAY_PER_DAY * days;
  const energy = Math.max(0, Math.min(STADIUM.ENERGY_MAX, (user.fanEnergy || 0) - decay));
  if (energy !== (user.fanEnergy || 0)) User.update(user.whatsappId, { fanEnergy: energy });
}

// ─── CATCH #3: WEATHER IMMUNITY (retractable roof) ───────────────────────────
// Returns true when this HOME owner's stadium blocks rain this match:
//   • tier >= 3 (retractable roof)
//   • fan energy >= ROOF_BROKEN_BELOW (roof not "broken")
//   • upkeep paid (active)
function blocksWeather(user) {
  if (isDefault(user)) return false;
  if (!tierOf(resolveKey(user)).weatherImmune) return false;
  if (!isActive(user)) return false;
  const energy = user.fanEnergy || 0;
  return energy >= STADIUM.ROOF_BROKEN_BELOW;
}

module.exports = {
  tiers, tierOf, resolveKey, isDefault,
  trainingMultiplier, applyTrainingMultiplier,
  isActive, stadiumUpkeep,
  homeBonuses, adjustFanEnergy, decayFanEnergy,
  blocksWeather,
};
