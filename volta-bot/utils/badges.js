// utils/badges.js
// Collectible achievement badges. Each badge is awarded ONCE and stored as a
// key in the user's `badges` array. Badges are cosmetic/collectible only — they
// do NOT affect XP, MMR or the economy — and are displayed in the profile text.
const User = require('../models/User');
const { BADGES, BRAND } = require('../config/constants');
const { sendText } = require('./messaging');

// Return true if the user already owns a badge key.
function has(user, key) {
  return !!(user && Array.isArray(user.badges) && user.badges.includes(key));
}

// Award a badge to a manager (by jid). No-op if unknown key or already owned.
// If a live `sock` + `jid` are supplied, announces the unlock in the chat.
// Returns true if it was newly awarded.
function award(whatsappId, key, opts = {}) {
  const def = BADGES[key];
  if (!def) return false;
  const u = User.getByWhatsappId(whatsappId);
  if (!u) return false;
  const owned = Array.isArray(u.badges) ? u.badges : [];
  if (owned.includes(key)) return false;
  User.update(whatsappId, { badges: [...owned, key] });
  if (opts.sock && opts.jid) {
    sendText(opts.sock, opts.jid,
      `${def.emoji} *ACHIEVEMENT UNLOCKED!*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `*${def.label}*\n_${def.desc}_\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`,
      opts.msg || null);
  }
  return true;
}

// Format a manager's badges for profile display. Returns '' when they have none.
function formatBadges(user) {
  const owned = (user && Array.isArray(user.badges)) ? user.badges : [];
  if (!owned.length) return '';
  const line = owned
    .map((k) => (BADGES[k] ? `${BADGES[k].emoji} ${BADGES[k].label}` : null))
    .filter(Boolean)
    .join('\n');
  return line ? `🏅 *Badges (${owned.length})*\n${line}` : '';
}

// Evaluate the "milestone" badges that depend on a manager's running totals.
// Safe to call after any match / economy change. Awards any newly-earned ones.
function evaluateMilestones(whatsappId, opts = {}) {
  const u = User.getByWhatsappId(whatsappId);
  if (!u) return;
  if ((u.wins || 0) >= 100) award(whatsappId, 'centurion', opts);
  if ((u.totalGoals || 0) >= 100) award(whatsappId, 'goal_machine', opts);
  if ((u.winStreak || 0) >= 10) award(whatsappId, 'win_streak_10', opts);
  if ((u.tournamentWins || 0) >= 1) award(whatsappId, 'champion', opts);
  if ((u.currency || 0) >= 10000) award(whatsappId, 'high_roller', opts);
}

module.exports = { has, award, formatBadges, evaluateMilestones };
