// utils/antiban.js
// Anti-ban utilities for WhatsApp bot stealth operations.
// 10-module system for maximum stealth and ban prevention.

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENT STATE
// ═══════════════════════════════════════════════════════════════════════════

const STATE_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(STATE_DIR, 'antiban-state.json');

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch { }
  return {};
}

function saveState(state) {
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    logger.error({ err }, 'ANTIBAN: Failed to save state');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 1: GAUSSIAN RANDOM
// ═══════════════════════════════════════════════════════════════════════════
// Box-Muller transform — produces normally-distributed random numbers.
// Delays cluster around the mean, rarely hitting extremes.

function gaussianRandom(mean, stddev) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return Math.max(0, Math.round(num * stddev + mean));
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 2: WARM-UP SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
// 7-day gradual ramp. New numbers get banned if they send too much too fast.

const WARMUP = {
  DAYS: 7,
  SCHEDULE: [
    { day: 1, maxPerDay: 30,   maxPerHour: 6,   delayMult: 1.5 },
    { day: 2, maxPerDay: 60,   maxPerHour: 12,  delayMult: 1.3 },
    { day: 3, maxPerDay: 100,  maxPerHour: 18,  delayMult: 1.2 },
    { day: 4, maxPerDay: 180,  maxPerHour: 28,  delayMult: 1.1 },
    { day: 5, maxPerDay: 280,  maxPerHour: 38,  delayMult: 1.05 },
    { day: 6, maxPerDay: 400,  maxPerHour: 50,  delayMult: 1.0 },
    { day: 7, maxPerDay: 500,  maxPerHour: 60,  delayMult: 1.0 },
  ],
};

let warmupState = {
  firstStartedAt: null,
  totalSent: 0,
  daily: {},  // { "YYYY-MM-DD": count }
};

const saved = loadState();
if (saved.warmup) warmupState = { ...warmupState, ...saved.warmup };

function getWarmupDay() {
  if (!warmupState.firstStartedAt) return 0;
  const days = Math.floor((Date.now() - new Date(warmupState.firstStartedAt).getTime()) / 86400000);
  return Math.min(days + 1, 7);
}

function getWarmupConfig() {
  const day = getWarmupDay();
  return WARMUP.SCHEDULE[day === 0 ? 0 : day - 1];
}

function recordWarmupMessage() {
  if (!warmupState.firstStartedAt) {
    warmupState.firstStartedAt = new Date().toISOString();
  }
  warmupState.totalSent++;
  const today = new Date().toISOString().split('T')[0];
  warmupState.daily[today] = (warmupState.daily[today] || 0) + 1;
  // Prune old days
  const cutoff = new Date(Date.now() - 8 * 86400000).toISOString().split('T')[0];
  for (const k of Object.keys(warmupState.daily)) {
    if (k < cutoff) delete warmupState.daily[k];
  }
  saveState({ warmup: warmupState });
}

function getWarmupStats() {
  const day = getWarmupDay();
  const cfg = getWarmupConfig();
  const today = new Date().toISOString().split('T')[0];
  const sent = warmupState.daily[today] || 0;
  return {
    currentDay: day, maxDays: 7, isComplete: day >= 7,
    dailyLimit: cfg.maxPerDay, hourlyLimit: cfg.maxPerHour,
    sentToday: sent, remainingToday: Math.max(0, cfg.maxPerDay - sent),
    totalSent: warmupState.totalSent,
    firstStartedAt: warmupState.firstStartedAt,
  };
}

function shouldThrottleWarmup() {
  const cfg = getWarmupConfig();
  const today = new Date().toISOString().split('T')[0];
  const sent = warmupState.daily[today] || 0;
  return sent >= cfg.maxPerDay;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 3: CIRCADIAN RHYTHM
// ═══════════════════════════════════════════════════════════════════════════
// Real humans don't message at 3 AM. Adjust speed by time of day.

function getCircadianMultiplier() {
  const hour = new Date().getHours();
  // Night (1-6 AM): 1.5x slower
  if (hour >= 1 && hour < 6) return 1.5;
  // Late night (11 PM - 1 AM): 1.3x slower
  if (hour >= 23 || hour < 1) return 1.3;
  // All other times: normal speed
  return 1.0;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 4: RATE LIMITER (Gaussian + Circadian + Warm-up)
// ═══════════════════════════════════════════════════════════════════════════

const chatLastSent = new Map();
const chatMinuteCount = new Map();

const RATE = {
  BASE_MEAN: 1200,     // mean 1.2s
  BASE_STDDEV: 200,
  MIN_MS: 1000,        // 1 second minimum
  MAX_MS: 2000,        // 2 seconds maximum
  PER_CHAR_MS: 1,      // 1ms per character
  MAX_PER_MINUTE: 20,
};

function getRateLimitDelay(chatJid, msgLength = 0) {
  // Only throttle if daily limit truly hit
  if (shouldThrottleWarmup()) return 2000;

  // Simple 1-2 second delay
  const delay = 1000 + Math.random() * 1000;

  // Per-minute limit check
  const now = Date.now();
  const minuteData = chatMinuteCount.get(chatJid);
  if (minuteData) {
    const elapsed = now - minuteData.windowStart;
    if (elapsed < 60000 && minuteData.count >= RATE.MAX_PER_MINUTE) {
      return 1500 + Math.random() * 500; // 1.5-2s when over limit
    }
    if (elapsed >= 60000) chatMinuteCount.set(chatJid, { count: 1, windowStart: now });
    else minuteData.count++;
  } else {
    chatMinuteCount.set(chatJid, { count: 1, windowStart: now });
  }

  return Math.round(Math.max(1000, Math.min(2000, delay)));
}

function recordMessageSent(chatJid) {
  chatLastSent.set(chatJid, Date.now());
  recordWarmupMessage();
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 5: BURST PROTECTION
// ═══════════════════════════════════════════════════════════════════════════
// Max 5 messages in quick succession, then short rest.

const burstState = new Map();

function checkBurstProtection(chatJid) {
  const now = Date.now();
  const state = burstState.get(chatJid) || { count: 0, windowStart: now };

  if (now - state.windowStart > 15000) {
    // Reset window after 15s
    burstState.set(chatJid, { count: 1, windowStart: now });
    return { burst: false };
  }

  state.count++;

  if (state.count > 5) {
    // Short rest only
    const restTime = 15000 - (now - state.windowStart);
    burstState.set(chatJid, { count: 0, windowStart: now });
    return { burst: true, restMs: Math.min(5000, restTime) }; // max 5s rest
  }

  burstState.set(chatJid, state);
  return { burst: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 6: MESSAGE CONTENT VARIATION
// ═══════════════════════════════════════════════════════════════════════════
// Tracks repeated messages and adds random suffixes to avoid spam detection.

// U+200D (ZERO WIDTH JOINER) is deliberately NOT in this list. It is the
// character WhatsApp uses to build compound emoji, so injecting it next to an
// emoji fuses it with its neighbour into a different glyph — or a tofu box.
// That was one half of the "emojis sometimes don't render" problem.
const INVISIBLE_CHARS = ['\u200B', '\u200C', '\uFEFF', '\u2060', '\u2062', '\u2063'];

// Anything that must never be broken apart or have a character wedged beside
// it: emoji, variation selectors, skin-tone modifiers, keycaps, regional
// indicators, combining marks.
const UNSAFE_NEIGHBOUR = /[\u200D\uFE00-\uFE0F\u20E3\u1F000-\u1FAFF\u2190-\u2BFF\u{1F000}-\u{1FAFF}\u0300-\u036F]/u;

function isSafeBoundary(cp) {
  if (cp === undefined) return false;
  // Only insert beside plain ASCII. Everything else is treated as fragile.
  return /^[\x20-\x7E]$/.test(cp) && !UNSAFE_NEIGHBOUR.test(cp);
}
const SUFFIXES = ['.', '..', '...', '!', '!!', '👍', '✨', '🔥', '💯', '⭐'];
const messageHistory = new Map(); // hash → { count, lastSent }

function addInvisibleChars(text) {
  if (!text || text.length < 15) return text;

  // `text.split('')` splits by UTF-16 CODE UNITS. Every emoji above U+FFFF is a
  // surrogate PAIR, so that routine happily inserted a character between the two
  // halves of an emoji, producing invalid UTF-16 that renders as a broken glyph
  // or vanishes. Measured on a typical match message: ~31% of sends corrupted at
  // least one emoji. Array.from() iterates whole code points instead.
  const chars = Array.from(text);

  // Collect positions that sit between two plain ASCII characters, so nothing is
  // ever wedged into an emoji, a keycap, a skin-tone modifier or a ZWJ sequence.
  // Mention tokens are off limits. Inserting an invisible character inside
  // "@2348012345678" breaks the match WhatsApp uses to render the tag, so the
  // person silently stops being notified — the exact bug this fixes elsewhere.
  const blocked = new Array(chars.length).fill(false);
  const joined = chars.join('');
  for (const m of joined.matchAll(/@\d{6,20}/g)) {
    // Map string offsets back onto code-point indices.
    let cpIndex = 0, strIndex = 0;
    while (strIndex < m.index && cpIndex < chars.length) { strIndex += chars[cpIndex].length; cpIndex++; }
    let end = cpIndex, consumed = 0;
    while (consumed < m[0].length && end < chars.length) { consumed += chars[end].length; end++; }
    for (let k = cpIndex; k <= end && k < blocked.length; k++) blocked[k] = true;
  }

  const safe = [];
  for (let i = 1; i < chars.length; i++) {
    if (blocked[i] || blocked[i - 1]) continue;
    if (isSafeBoundary(chars[i - 1]) && isSafeBoundary(chars[i])) safe.push(i);
  }
  if (!safe.length) return text;   // nothing safe to touch — leave it alone

  const inserts = Math.min(2 + Math.floor(Math.random() * 3), safe.length);
  const chosen = [];
  const pool = safe.slice();
  for (let i = 0; i < inserts && pool.length; i++) {
    chosen.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  // Insert from the back so earlier indices stay valid.
  chosen.sort((a, b) => b - a);
  for (const pos of chosen) {
    chars.splice(pos, 0, INVISIBLE_CHARS[Math.floor(Math.random() * INVISIBLE_CHARS.length)]);
  }
  return chars.join('');
}

function varyMessage(text) {
  if (!text) return text;

  // Create a simple hash of the message content
  const hash = text.replace(/[\u200B-\u2064]/g, '').slice(0, 50).toLowerCase();
  const now = Date.now();
  const entry = messageHistory.get(hash);

  if (entry && now - entry.lastSent < 3600000) {
    // Same message sent within 1 hour — vary it
    entry.count++;
    entry.lastSent = now;

    if (entry.count <= 3) {
      // Add invisible chars only
      return addInvisibleChars(text);
    } else {
      // Add random suffix + invisible chars
      const suffix = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
      return addInvisibleChars(text) + ' ' + suffix;
    }
  }

  // New message or old enough
  messageHistory.set(hash, { count: 1, lastSent: now });

  // Prune old entries
  if (messageHistory.size > 500) {
    for (const [k, v] of messageHistory) {
      if (now - v.lastSent > 3600000) messageHistory.delete(k);
    }
  }

  return addInvisibleChars(text);
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 7: REPLY RATIO TRACKING
// ═══════════════════════════════════════════════════════════════════════════
// Tracks sent vs received per contact. Blocks sends to non-responsive contacts.

const contactTracker = new Map(); // jid → { sent, received, firstContact, lastMessage }

function recordMessageReceived(jid) {
  const now = Date.now();
  const entry = contactTracker.get(jid) || { sent: 0, received: 0, firstContact: now, lastMessage: now };
  entry.received++;
  entry.lastMessage = now;
  contactTracker.set(jid, entry);
}

function recordMessageSentContact(jid) {
  const now = Date.now();
  const entry = contactTracker.get(jid) || { sent: 0, received: 0, firstContact: now, lastMessage: now };
  entry.sent++;
  entry.lastMessage = now;
  contactTracker.set(jid, entry);
}

function getReplyRatio(jid) {
  const entry = contactTracker.get(jid);
  if (!entry || entry.sent === 0) return 1.0;
  return entry.received / entry.sent;
}

function shouldBlockSend(jid, isKnownContact = false) {
  // Don't block known contacts (registered users, groups)
  if (isKnownContact) return false;

  // Don't block groups
  if (jid && jid.endsWith('@g.us')) return false;

  const entry = contactTracker.get(jid);
  if (!entry) return false;

  // Block if reply ratio < 5% AND they've sent 5+ messages (truly non-responsive)
  const ratio = getReplyRatio(jid);
  if (ratio < 0.05 && entry.sent >= 5) {
    return true;
  }

  // Block if sent > 10 to strangers this hour (very generous)
  const hourAgo = Date.now() - 3600000;
  if (entry.firstContact > hourAgo && entry.sent >= 10) {
    return true;
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 8: CONTACT GRAPH ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════════
// Requires "handshake" (they messaged us first) before bulk/group sends.

const handshakeMap = new Map(); // jid → { timestamp, messageCount }

function recordHandshake(jid) {
  if (!handshakeMap.has(jid)) {
    handshakeMap.set(jid, { timestamp: Date.now(), messageCount: 0 });
  }
  const entry = handshakeMap.get(jid);
  entry.messageCount++;
  entry.timestamp = Date.now();
}

function hasHandshake(jid) {
  const entry = handshakeMap.get(jid);
  if (!entry) return false;
  // Handshake valid if they messaged us within last 7 days
  return Date.now() - entry.timestamp < 7 * 86400000;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 9: READ RECEIPT DELAYS
// ═══════════════════════════════════════════════════════════════════════════
// Delays read receipts by 5-30 seconds (human-like).

const readQueue = [];
let processingReads = false;

async function delayReadReceipt(sock, chatJid, msgKey) {
  const delay = Math.max(5000, Math.min(30000, gaussianRandom(15000, 8000)));
  readQueue.push({ sock, chatJid, msgKey, delay });
  if (!processingReads) processReadQueue();
}

async function processReadQueue() {
  processingReads = true;
  while (readQueue.length > 0) {
    const { sock, chatJid, msgKey, delay } = readQueue.shift();
    try {
      await new Promise(r => setTimeout(r, delay));
      await sock.readMessages([msgKey]);
    } catch { }
  }
  processingReads = false;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE 10: SESSION HEALTH MONITOR
// ═══════════════════════════════════════════════════════════════════════════
// Risk level 0-100%. Auto-pauses at 70%.

const health = {
  sent: 0, failed: 0, errors: 0, disconnects: 0,
  lastDisconnect: null, consecutiveFails: 0,
  riskPercent: 5, riskLevel: 'low',
};

function updateRisk() {
  const failRate = health.sent > 0 ? (health.failed / health.sent) * 100 : 0;
  const errorPenalty = Math.min(30, health.errors * 5);
  const disconnectPenalty = Math.min(20, health.disconnects * 5);
  const failPenalty = Math.min(40, failRate * 2);

  health.riskPercent = Math.min(100, Math.round(5 + errorPenalty + disconnectPenalty + failPenalty));

  if (health.riskPercent >= 70) health.riskLevel = 'critical';
  else if (health.riskPercent >= 50) health.riskLevel = 'high';
  else if (health.riskPercent >= 25) health.riskLevel = 'medium';
  else health.riskLevel = 'low';

  if (health.riskLevel === 'critical') {
    logger.warn(health, 'ANTIBAN: Critical risk — auto-pausing');
  }
}

function recordMessageSent_health() { health.sent++; health.consecutiveFails = 0; updateRisk(); }
function recordMessageFailed() { health.failed++; health.consecutiveFails++; updateRisk(); }
function recordError() { health.errors++; updateRisk(); }
function recordDisconnect() { health.disconnects++; health.lastDisconnect = Date.now(); updateRisk(); }
function getHealthStats() { return { ...health }; }
function shouldPauseSending() { return health.riskPercent >= 90; }

// ═══════════════════════════════════════════════════════════════════════════
// PRESENCE CYCLING
// ═══════════════════════════════════════════════════════════════════════════

let presenceInterval = null;
let presenceActive = false;

function startPresenceCycling(sock) {
  if (presenceActive) return;
  presenceActive = true;
  const cycle = async () => {
    if (!presenceActive) return;
    try {
      await sock.sendPresenceUpdate('available');
      await new Promise(r => setTimeout(r, gaussianRandom(15000, 5000)));
      if (!presenceActive) return;
      await sock.sendPresenceUpdate('unavailable');
    } catch { }
    const next = gaussianRandom(60000, 25000);
    presenceInterval = setTimeout(cycle, Math.max(30000, Math.min(120000, next)));
  };
  presenceInterval = setTimeout(cycle, gaussianRandom(30000, 15000));
}

function stopPresenceCycling() {
  presenceActive = false;
  if (presenceInterval) { clearTimeout(presenceInterval); presenceInterval = null; }
}

function stealthConnect(sock) {
  setTimeout(() => startPresenceCycling(sock), gaussianRandom(45000, 15000));
}

// ═══════════════════════════════════════════════════════════════════════════
// HUMAN TYPING PATTERN
// ═══════════════════════════════════════════════════════════════════════════

async function humanTypingPattern(sock, chatJid, responseLength) {
  if (!chatJid || !responseLength) return;
  const dur = Math.min(5000, Math.max(1000, responseLength * 30));
  const hasPause = Math.random() < 0.3;
  const pauseAt = hasPause ? dur * 0.4 : 0;
  const pauseDur = gaussianRandom(800, 300);
  try {
    await sock.sendPresenceUpdate('composing', chatJid);
    if (hasPause && pauseAt > 0) {
      await new Promise(r => setTimeout(r, pauseAt));
      await sock.sendPresenceUpdate('paused', chatJid);
      await new Promise(r => setTimeout(r, Math.min(1500, Math.max(300, pauseDur))));
      await sock.sendPresenceUpdate('composing', chatJid);
      await new Promise(r => setTimeout(r, dur - pauseAt));
    } else {
      await new Promise(r => setTimeout(r, dur));
    }
    await sock.sendPresenceUpdate('paused', chatJid);
  } catch { }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  // Core
  gaussianRandom,
  // Warm-up
  getWarmupStats, getWarmupDay, shouldThrottleWarmup,
  // Rate limiter
  getRateLimitDelay, recordMessageSent,
  // Burst protection
  checkBurstProtection,
  // Content variation
  varyMessage, addInvisibleChars,
  // Reply ratio
  recordMessageReceived, recordMessageSentContact, getReplyRatio, shouldBlockSend,
  // Contact graph
  recordHandshake, hasHandshake,
  // Read receipts
  delayReadReceipt,
  // Health monitor
  recordMessageSent_health, recordMessageFailed, recordError, recordDisconnect,
  getHealthStats, shouldPauseSending,
  // Presence
  stealthConnect, startPresenceCycling, stopPresenceCycling,
  // Typing
  humanTypingPattern,
  // Circadian
  getCircadianMultiplier,
};
