// web/server.js
// Standalone web app for VOLTA managers. Log in with the password you set via
// the bot's !password command, then manage your squad from a browser.
//
//   node web/server.js            (default port 3000)
//   PORT=8080 node web/server.js
//
// Reads/writes data through the SAME models the bot uses (config/database.js +
// models/User + models/Player + utils/playerGenerator), reloading from disk on
// every request so it always reflects the live bot data. Squad/shop/penalty
// writes are persisted straight back to the JSON files.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── bot data layer (single source of truth) ────────────────────────────────
const db = require('../config/database');
const User = require('../models/User');
const Player = require('../models/Player');
const { openPack, seedMarketPlayer, buildYouthPlayer } = require('../utils/playerGenerator');
const { PACKS, SHOP, TRAINING, PENALTY, COINFLIP, HIGHLOW, SLOT, RARITY, MARKET, ACADEMY, ECONOMY, BADGES } = require('../config/constants');
const { randInt, pick, weightedRandom } = require('../utils/random');
const transfer = require('../models/transfer');
const { v4: uuid } = require('uuid');

// ─── request / JSON hardening ───────────────────────────────────────────────
// The web app persists everything as JSON (there is no SQL layer), so the real
// injection risk is prototype pollution: a crafted body like
// {"__proto__":{...}} or {"constructor":{"prototype":{...}}} could poison
// Object.prototype and tamper with downstream logic. We strip those keys on
// every parse, cap request size, and coerce inputs to safe types before they
// reach the data layer.
function stripDangerous(value) {
  if (Array.isArray(value)) return value.map(stripDangerous);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = stripDangerous(value[k]);
    }
    return out;
  }
  return value;
}

function safeParse(raw) {
  try { return raw ? stripDangerous(JSON.parse(raw)) : {}; }
  catch { return {}; }
}

function toStrArray(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
}


// Bump when new web-only endpoints/features are added so the frontend can warn
// the manager if their running backend process is stale (it loads routes at
// startup, so editing server.js requires a restart to take effect).
const WEB_VERSION = 6;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const MATCHES_FILE = path.join(DATA_DIR, 'matches.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

const KEY_BYTES = 64;

db.connectDB();
// Re-read every table from disk so web writes never clobber the bot's latest
// in-memory state (they are separate processes). Cheap for this scale.
function reload() { db.reloadAll(); }

function verifyPassword(password, hashHex, saltHex) {
  if (!hashHex || !saltHex) return false;
  const computed = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), KEY_BYTES).toString('hex');
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hashHex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Session tokens → whatsappId. Persisted to disk so a backend restart does NOT
// log managers out (they just keep using their existing token).
const sessions = new Map();
// Active penalty shootouts keyed by token.
const penaltySessions = new Map();
// In-progress high/low games keyed by token (two-step: start then guess).
const highlowSessions = new Map();

function loadSessions() {
  try {
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
    const obj = safeParse(raw);
    for (const [token, id] of Object.entries(obj)) sessions.set(token, String(id));
  } catch {}
}
function saveSessions() {
  try {
    const obj = Object.fromEntries(sessions.entries());
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj));
  } catch {}
}
loadSessions();

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function consecutiveDay(prev, now) {
  const hours = (now.getTime() - prev.getTime()) / 3.6e6;
  return hours >= 20 && hours <= 48;
}

function playerTotal(p) {
  if (!p || !p.stats) return 0;
  return p.role === 'goalkeeper'
    ? p.stats.reflex + p.stats.positioning + p.stats.anticipation + p.stats.strength + p.stats.composure
    : p.stats.pace + p.stats.skill + p.stats.shooting + p.stats.stamina + p.stats.composure;
}

function publicUser(u) {
  if (!u) return null;
  const players = db.all('players');
  const pmap = Object.fromEntries(players.map((p) => [p.id, p]));
  const ownedIds = [...(u.startingXI || []), ...(u.bench || []), ...(u.reserves || [])];
  const roster = ownedIds.map((id) => pmap[id]).filter(Boolean).map((p) => ({
    id: p.id,
    name: p.nickname || p.name,
    role: p.role,
    rarity: p.rarity,
    level: p.level,
    condition: p.condition,
    form: p.form,
    total: playerTotal(p),
    isListed: !!p.isListed,
    stats: p.stats,
  }));
  const total = (u.wins || 0) + (u.losses || 0) + (u.draws || 0);
  const winRate = total ? Math.round((u.wins / total) * 100) : 0;
  const squadPower = (u.startingXI || [])
    .map((id) => pmap[id]).filter(Boolean)
    .reduce((s, p) => s + playerTotal(p), 0);
  const teamValue = ownedIds
    .map((id) => pmap[id]).filter(Boolean)
    .reduce((s, p) => s + playerTotal(p) * 5000, 0);
  return {
    whatsappId: u.whatsappId,
    name: u.name,
    currency: u.currency,
    mmr: u.mmr,
    rank: u.rank,
    wins: u.wins,
    losses: u.losses,
    draws: u.draws,
    totalGoals: u.totalGoals,
    winRate,
    squadPower,
    teamValue,
    streak: u.dailyStreak || 0,
    startingXI: u.startingXI || [],
    bench: u.bench || [],
    reserves: u.reserves || [],
    youth: (u.youth || []).map((id) => {
      const yp = db.findById('players', id);
      if (!yp) return null;
      return {
        id: yp.id, name: yp.nickname || yp.name, role: yp.role, rarity: yp.rarity,
        level: yp.level, condition: yp.condition, form: yp.form, total: playerTotal(yp),
        potential: yp.potential, age: yp.age, stats: yp.stats, chemistry: yp.chemistry || 0,
      };
    }).filter(Boolean),
    tournamentWins: u.tournamentWins || 0,
    badges: u.badges || [],
    winStreak: u.winStreak || 0,
    isOwner: (() => { try { return User.isOwner(u.whatsappId); } catch { return false; } })(),
    roster,
  };
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS, ...headers });
  res.end(payload);
}

// CORS — lets the static frontend (e.g. GitHub Pages) call this backend from
// a different origin. Token-based auth (no cookies), so '*' is fine here.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    let tooBig = false;
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) { tooBig = true; req.destroy(); } // cap body at ~1MB
    });
    req.on('end', () => {
      if (tooBig) return resolve({});
      resolve(safeParse(data));
    });
  });
}

function authenticate(token) {
  const id = token && sessions.get(token);
  return id || null;
}

// ─── MARKET helpers (shared with the bot via models/transfer + Player) ──────
// User listings auto-expire after MARKET.USER_LISTING_TTL_MS; on expiry the
// house buys the player at market value and it rolls onto the AI Market. This
// keeps the public market flowing without manual cleanup.
function marketIsExpired(listing) {
  if (!listing.expiresAt) return false; // house listings never auto-expire
  return Date.now() > new Date(listing.expiresAt).getTime();
}

function marketProcessExpired() {
  for (const l of db.all('market')) {
    if (l.sold || !marketIsExpired(l)) continue;
    if (l.sellerId === transfer.HOUSE) { db.update('market', l.id, { sold: true }); continue; }
    const player = Player.getById(l.playerId);
    const seller = User.getByWhatsappId(l.sellerId);
    if (player && seller) {
      const payout = Player.marketValue(player);
      User.update(l.sellerId, { currency: (seller.currency || 0) + payout });
      transfer.transferPlayer(player.id, l.sellerId, transfer.HOUSE);
    }
    db.update('market', l.id, { sold: true });
  }
}

function marketEnsureSeed() {
  const active = db.all('market').filter((l) => l.sold === false && !marketIsExpired(l));
  if (active.length < MARKET.AI_SEED_COUNT) {
    const needed = MARKET.AI_SEED_COUNT - active.length;
    for (let i = 0; i < needed; i++) {
      const player = seedMarketPlayer();
      const price = Math.round(Player.marketValue(player) * (0.5 + Math.random() * 0.8));
      db.insert('market', player.id, {
        id: player.id,
        playerId: player.id,
        sellerId: transfer.HOUSE,
        sellerName: 'AI Market',
        price,
        listedAt: new Date().toISOString(),
        expiresAt: null,
        sold: false,
      });
    }
  }
}

function marketView(l, viewerId) {
  const p = db.findById('players', l.playerId);
  if (!p) return null;
  return {
    id: l.id.slice(0, 6),
    fullId: l.id,
    playerId: p.id,
    sellerId: l.sellerId,
    sellerName: l.sellerName,
    price: l.price,
    listedAt: l.listedAt,
    expiresAt: l.expiresAt || null,
    isMine: viewerId ? l.sellerId === viewerId : false,
    player: {
      id: p.id,
      name: p.nickname || p.name,
      role: p.role,
      rarity: p.rarity,
      level: p.level,
      age: p.age,
      position: p.position,
      stats: p.stats,
      condition: p.condition,
      form: p.form,
      total: playerTotal(p),
      marketValue: Player.marketValue(p),
    },
  };
}

// ─── penalty helpers ────────────────────────────────────────────────────────
function spots() { return PENALTY.SPOTS; }
function dirText(d) { return d === 'L' ? 'Left ↙' : d === 'R' ? 'Right ↘' : 'Centre ↑'; }

function penaltyState(s) {
  return {
    round: s.round,
    playerScore: s.playerScore,
    aiScore: s.aiScore,
    phase: s.phase,
    stake: s.stake,
    finished: !!s.finished,
    result: s.result || null,
    payout: s.payout || 0,
  };
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  // ── static: serve index.html for "/" ──
  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html', ...CORS });
    res.end(html);
    return;
  }

  if (!p.startsWith('/api/')) {
    send(res, 404, { error: 'not found' });
    return;
  }

  try {
    // ── LOGIN (username + password) ──
    if (p === '/api/login' && req.method === 'POST') {
      const { name, password } = await readBody(req);
      reload();
      const users = db.all('users');
      const nameKey = String(name || '').trim().toLowerCase();
      let matched = null;
      for (const u of users) {
        if (
          u.registered &&
          (u.name || '').trim().toLowerCase() === nameKey &&
          verifyPassword(password || '', u.passwordHash, u.passwordSalt)
        ) {
          matched = u;
          break;
        }
      }
      if (!matched) return send(res, 401, { error: 'Invalid team name or password.' });
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, matched.whatsappId);
      saveSessions();
      return send(res, 200, { token, user: publicUser(matched) });
    }

    // ── LOGOUT ──
    if (p === '/api/logout' && req.method === 'POST') {
      const { token } = await readBody(req);
      if (token) { sessions.delete(token); saveSessions(); }
      return send(res, 200, { ok: true });
    }

    // ── ME ──
    if (p === '/api/me' && req.method === 'GET') {
      const id = authenticate(url.searchParams.get('token'));
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      reload();
      const u = db.findById('users', id);
      return send(res, 200, { user: publicUser(u) });
    }

    // ── SAVE SQUAD ──
    if (p === '/api/squad' && req.method === 'POST') {
      const body = await readBody(req);
      const id = authenticate(body.token);
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      reload();
      const u = db.findById('users', id);
      if (!u) return send(res, 404, { error: 'Account not found.' });

      const owned = new Set([...(u.startingXI || []), ...(u.bench || []), ...(u.reserves || [])]);
      const xi = toStrArray(body.startingXI).filter((x) => owned.has(x));
      const bench = toStrArray(body.bench).filter((x) => owned.has(x));
      const xiSize = Math.min(xi.length, 4);

      // de-dupe: anything not in XI goes to bench
      const xiSet = new Set(xi.slice(0, xiSize));
      const finalBench = [...new Set([...bench, ...owned].filter((x) => !xiSet.has(x)))];

      User.update(id, { startingXI: [...xiSet], bench: finalBench });
      reload();
      return send(res, 200, { user: publicUser(db.findById('users', id)), ok: true });
    }

    // ── RENAME TEAM ──
    if (p === '/api/rename' && req.method === 'POST') {
      const body = await readBody(req);
      const id = authenticate(body.token);
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 24);
      if (!name) return send(res, 400, { error: 'Team name required.' });
      reload();
      if (!db.findById('users', id)) return send(res, 404, { error: 'Account not found.' });
      User.update(id, { name });
      reload();
      return send(res, 200, { user: publicUser(db.findById('users', id)), ok: true });
    }

    // ── LEADERBOARD (read-only, top 20 by MMR) ──
    if (p === '/api/leaderboard' && req.method === 'GET') {
      reload();
      const board = db.all('users')
        .filter((u) => u.registered)
        .sort((a, b) => (b.mmr || 0) - (a.mmr || 0))
        .slice(0, 20)
        .map((u, i) => ({ rank: i + 1, name: u.name, mmr: u.mmr, wins: u.wins, losses: u.losses, draws: u.draws }));
      return send(res, 200, { board });
    }

    // ── MATCH HISTORY (read-only, most recent 25) ──
    if (p === '/api/history' && req.method === 'GET') {
      const matches = readJsonFile(MATCHES_FILE);
      const list = Object.values(matches)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 25)
        .map((m) => ({
          id: m.id,
          date: m.date,
          homeName: m.homeName,
          awayName: m.awayName,
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          result: m.result,
          mvp: m.mvp,
          goalScorers: m.goalScorers || [],
        }));
      return send(res, 200, { matches: list });
    }

    // ── TOP PLAYERS (read-only, top 12 by OVR) ──
    if (p === '/api/topplayers' && req.method === 'GET') {
      reload();
      const list = db.all('players')
        .map((p) => {
          const t = playerTotal(p);
          return { id: p.id, name: p.nickname || p.name, rarity: p.rarity, role: p.role, ovr: t, position: p.position, goals: p.goals || 0, motm: p.manOfTheMatch || 0 };
        })
        .sort((a, b) => b.ovr - a.ovr)
        .slice(0, 12);
      return send(res, 200, { players: list });
    }

    // ── INFO (frontend compatibility check) ──
    if (p === '/api/info' && req.method === 'GET') {
      return send(res, 200, { ok: true, version: WEB_VERSION, features: ['shop', 'penalty', 'coinflip', 'slot', 'highlow', 'market', 'transfer', 'search', 'academy', 'tournament', 'heartbeat', 'badges', 'daily', 'manager', 'analyze', 'bounties', 'mymatches', 'compare'] });
    }

    // ── HEARTBEAT (heartbeat monitor pings this; reports bot liveliness) ──
    if (p === '/api/heartbeat' && req.method === 'GET') {
      reload();
      const users = db.all('users').filter((u) => u.registered).length;
      return send(res, 200, { ok: true, ts: Date.now(), users, version: WEB_VERSION });
    }

    // ── SEARCH players by name (public, read-only) ──
    if (p === '/api/search' && req.method === 'GET') {
      reload();
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const viewerId = authenticate(url.searchParams.get('token'));
      const listingByPlayer = {};
      for (const l of db.all('market')) {
        if (!l.sold) listingByPlayer[l.playerId] = l;
      }
      let results = db.all('players');
      if (q) results = results.filter((pl) => (pl.name || '').toLowerCase().includes(q));
      results = results
        .map((pl) => ({
          id: pl.id, name: pl.nickname || pl.name, role: pl.role, rarity: pl.rarity,
          level: pl.level, total: playerTotal(pl), chemistry: pl.chemistry || 0,
          ownerId: pl.ownerId, isListed: !!listingByPlayer[pl.playerId],
          price: listingByPlayer[pl.playerId] ? listingByPlayer[pl.playerId].price : null,
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 24);
      return send(res, 200, { results, q });
    }

    // ── ACADEMY (youth prospects for the logged-in manager) ──
    if (p === '/api/academy' && req.method === 'GET') {
      const id = authenticate(url.searchParams.get('token'));
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      reload();
      const u = db.findById('users', id);
      const youth = (u.youth || []).map((yid) => {
        const yp = db.findById('players', yid);
        if (!yp) return null;
        return {
          id: yp.id, name: yp.nickname || yp.name, role: yp.role, rarity: yp.rarity,
          level: yp.level, total: playerTotal(yp), potential: yp.potential, age: yp.age,
          stats: yp.stats, chemistry: yp.chemistry || 0,
        };
      }).filter(Boolean);
      return send(res, 200, { youth, scoutCost: ACADEMY.SCOUT_COST, slots: ACADEMY.SCOUT_SLOTS });
    }

    // ── ACADEMY: scout a new prospect (costs ACADEMY.SCOUT_COST) ──
    if (p === '/api/academy/scout' && req.method === 'POST') {
      const body = await readBody(req);
      const id = authenticate(body.token);
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      reload();
      const u = db.findById('users', id);
      if ((u.currency || 0) < ACADEMY.SCOUT_COST) return send(res, 400, { error: `Need ${ACADEMY.SCOUT_COST} Metaworks.` });
      const youth = u.youth || [];
      if (youth.length >= ACADEMY.SCOUT_SLOTS) return send(res, 400, { error: 'Academy full — promote a prospect first.' });
      const player = buildYouthPlayer(id);
      User.update(id, { currency: (u.currency || 0) - ACADEMY.SCOUT_COST, youth: [...youth, player.id] });
      reload();
      return send(res, 200, { ok: true, player: { id: player.id, name: player.name, role: player.role, total: playerTotal(player), potential: player.potential }, user: publicUser(db.findById('users', id)) });
    }

    // ── ACADEMY: promote a youth prospect into the squad (Reserves) ──
    if (p === '/api/academy/promote' && req.method === 'POST') {
      const body = await readBody(req);
      const id = authenticate(body.token);
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      const youthId = String(body.youthId || '').trim();
      if (!youthId) return send(res, 400, { error: 'Youth ID required.' });
      reload();
      const u = db.findById('users', id);
      if (!u.youth || !u.youth.includes(youthId)) return send(res, 400, { error: 'No such youth prospect.' });
      User.update(id, {
        youth: (u.youth || []).filter((y) => y !== youthId),
        reserves: [...(u.reserves || []), youthId],
      });
      reload();
      return send(res, 200, { ok: true, user: publicUser(db.findById('users', id)) });
    }

    // ── TOURNAMENT BRACKET VIEW (TBV) — read-only mirror of the live bracket ──
    if (p === '/api/tournament' && req.method === 'GET') {
      reload();
      const live = db.findById('tournaments', 'live');
      if (!live) return send(res, 200, { active: false });
      const nameOf = (x) => {
        if (!x || x === 'BYE') return 'BYE';
        if (typeof x === 'object') return nameOf(x.winner) || 'TBD';
        return User.getByWhatsappId(x)?.name || x.split('@')[0];
      };
      const eff = (x) => (x && typeof x === 'object' ? x.winner : x);
      const rounds = (live.rounds || []).map((round) => ({
        matches: round.map((m) => ({
          a: nameOf(m.a), b: nameOf(m.b),
          winner: m.winner ? nameOf(eff(m.a) === m.winner ? m.a : m.b) : null,
          simulated: !!m.simulated,
        })),
      }));
      return send(res, 200, {
        active: true,
        category: live.category,
        prize: live.prize,
        players: (live.players || []).length,
        rounds,
      });
    }

    // ── MARKET: browse active listings (public, read-only) ──
    if (p === '/api/market' && req.method === 'GET') {
      reload();
      marketProcessExpired();
      marketEnsureSeed();
      const viewerId = authenticate(url.searchParams.get('token'));
      const listings = db.all('market')
        .filter((l) => l.sold === false && !marketIsExpired(l))
        .sort((a, b) => new Date(b.listedAt) - new Date(a.listedAt))
        .map((l) => marketView(l, viewerId))
        .filter(Boolean);
      return send(res, 200, { listings });
    }

    // ── MARKET: buy a listing ──
    if (p === '/api/market/buy' && req.method === 'POST') {
      const body = await readBody(req);
      const id = authenticate(body.token);
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      const shortId = String(body.listingId || '').trim();
      if (!shortId) return send(res, 400, { error: 'Listing ID required.' });
      reload();
      marketProcessExpired();
      const listing = db.all('market').find((l) => l.id.startsWith(shortId) && l.sold === false && !marketIsExpired(l));
      if (!listing) return send(res, 404, { error: 'No active listing with that ID.' });
      if (listing.sellerId === id) return send(res, 400, { error: 'You cannot buy your own listing.' });
      const u = db.findById('users', id);
      if ((u.currency || 0) < listing.price) return send(res, 400, { error: `Not enough Metaworks. Need ${listing.price}.` });
      const player = Player.getById(listing.playerId);
      if (!player) return send(res, 404, { error: 'Player not found.' });
      const moved = transfer.transferPlayer(player.id, listing.sellerId, id);
      if (!moved) {
        return send(res, 409, {
          error: 'Transfer blocked: this listing is invalid (seller no longer owns the player). It has been removed; no Metaworks were charged.',
        });
      }
      User.update(id, { currency: (u.currency || 0) - listing.price });
      if (listing.sellerId !== transfer.HOUSE) {
        const seller = User.getByWhatsappId(listing.sellerId);
        if (seller) User.update(listing.sellerId, { currency: (seller.currency || 0) + listing.price });
      }
      db.update('market', listing.id, { sold: true });
      reload();
      return send(res, 200, { ok: true, user: publicUser(db.findById('users', id)), player: { id: player.id, name: Player.displayName(player) } });
    }

    // ── MARKET: list a player (or your whole squad) for sale ──
    if (p === '/api/market/list' && req.method === 'POST') {
      const body = await readBody(req);
      const id = authenticate(body.token);
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      reload();
      const squad = !!body.squad;
      const price = parseInt(body.price, 10);
      if (squad) {
        const players = Player.getSquadPlayers(id);
        if (!players.length) return send(res, 400, { error: 'You have no players to list.' });
        let listed = 0;
        for (const pl of players) {
          if (pl.isListed) continue;
          const mv = Player.marketValue(pl);
          const listPrice = price > 0 ? price : mv;
          const minPrice = Math.round(mv * MARKET.MIN_PRICE_RATIO);
          if (listPrice < minPrice) continue;
          const lid = uuid();
          db.insert('market', lid, {
            id: lid, playerId: pl.id, sellerId: id,
            sellerName: (db.findById('users', id) || {}).name || 'Manager',
            price: listPrice, listedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + MARKET.USER_LISTING_TTL_MS).toISOString(), sold: false,
          });
          Player.update(pl.id, { isListed: true, marketPrice: listPrice });
          listed++;
        }
        if (!listed) return send(res, 400, { error: 'Nothing to list (already listed or below minimum price).' });
        reload();
        return send(res, 200, { ok: true, listed, user: publicUser(db.findById('users', id)) });
      }
      const playerId = String(body.playerId || '').toUpperCase();
      if (!playerId || !price || price <= 0) return send(res, 400, { error: 'Usage: playerId + price required.' });
      const player = Player.findByQuery(id, playerId);
      if (!player) return send(res, 404, { error: 'Player not found in your squad.' });
      if (player.isListed) return send(res, 400, { error: 'Player already listed.' });
      const mv = Player.marketValue(player);
      const minPrice = Math.round(mv * MARKET.MIN_PRICE_RATIO);
      if (price < minPrice) return send(res, 400, { error: `Minimum price is ${minPrice} (50% of market value ${mv}).` });
      const lid = uuid();
      db.insert('market', lid, {
        id: lid, playerId: player.id, sellerId: id,
        sellerName: (db.findById('users', id) || {}).name || 'Manager',
        price, listedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + MARKET.USER_LISTING_TTL_MS).toISOString(), sold: false,
      });
      Player.update(player.id, { isListed: true, marketPrice: price });
      reload();
      return send(res, 200, { ok: true, listing: marketView(db.findById('market', lid), id), user: publicUser(db.findById('users', id)) });
    }

    // ── TRANSFER: dash / gift a player (or whole squad) to another manager ──
    if (p === '/api/market/dash' && req.method === 'POST') {
      const body = await readBody(req);
      const id = authenticate(body.token);
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      const targetName = String(body.target || '').trim().toLowerCase();
      if (!targetName) return send(res, 400, { error: 'Recipient team name required.' });
      reload();
      const me = db.findById('users', id);
      if (!me || !me.registered) return send(res, 404, { error: 'Account not found.' });
      const them = db.all('users').find((u) => u.registered && (u.name || '').trim().toLowerCase() === targetName);
      if (!them) return send(res, 404, { error: 'No registered manager with that team name.' });
      if (them.whatsappId === id) return send(res, 400, { error: 'You cannot dash to yourself.' });
      const squad = !!body.squad || !body.playerId;
      if (squad) {
        const players = Player.getSquadPlayers(id);
        if (!players.length) return send(res, 400, { error: 'You have no players to dash.' });
        let moved = 0;
        for (const pl of players) { if (pl.isListed) continue; transfer.transferPlayer(pl.id, id, them.whatsappId); moved++; }
        if (!moved) return send(res, 400, { error: 'Nothing dashed (all players are listed).' });
        reload();
        return send(res, 200, { ok: true, moved, to: them.name, user: publicUser(db.findById('users', id)) });
      }
      const playerId = String(body.playerId || '').toUpperCase();
      const player = Player.findByQuery(id, playerId);
      if (!player) return send(res, 404, { error: 'Player not found in your squad.' });
      if (player.isListed) return send(res, 400, { error: 'Cancel the market listing first.' });
      transfer.transferPlayer(player.id, id, them.whatsappId);
      reload();
      return send(res, 200, { ok: true, moved: 1, to: them.name, player: Player.displayName(player), user: publicUser(db.findById('users', id)) });
    }

    // ── SHOP: OPEN PACK ──
    if (p === '/api/shop/pack' && req.method === 'POST') {
      const body = await readBody(req);
      const id = authenticate(body.token);
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      const packType = String(body.pack || '').toLowerCase();
      const packConfig = { starter: PACKS.STARTER, pro: PACKS.PRO, elite: PACKS.ELITE }[packType];
      if (!packConfig) return send(res, 400, { error: 'Unknown pack. Use starter, pro or elite.' });
      reload();
      const u = db.findById('users', id);
      if ((u.currency || 0) < packConfig.cost) {
        return send(res, 400, { error: `Not enough Metaworks. Need ${packConfig.cost}.` });
      }
      User.update(id, { currency: (u.currency || 0) - packConfig.cost });
      const opened = openPack(id, packConfig);
      const fresh = db.findById('users', id);
      const reserves = [...(fresh.reserves || []), ...opened.map((pl) => pl.id)];
      User.update(id, { reserves });
      reload();
      const reveal = opened.map((pl) => ({
        id: pl.id,
        name: pl.nickname || pl.name,
        rarity: pl.rarity,
        role: pl.role,
        total: playerTotal(pl),
        stats: pl.stats,
      }));
      return send(res, 200, { ok: true, user: publicUser(db.findById('users', id)), players: reveal, cost: packConfig.cost });
    }

    // ── SHOP: BOOST (energy / form) ──
    if (p === '/api/shop/boost' && req.method === 'POST') {
      const body = await readBody(req);
      const id = authenticate(body.token);
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      const type = String(body.type || '').toLowerCase();
      const playerId = String(body.playerId || '');
      const cost = type === 'form' ? SHOP.FORM_BOOST : type === 'energy' ? SHOP.ENERGY_RESTORE : null;
      if (!cost) return send(res, 400, { error: 'Use type "energy" or "form".' });
      reload();
      const u = db.findById('users', id);
      const player = db.findById('players', playerId);
      if (!player || player.ownerId !== id) return send(res, 404, { error: 'Player not found in your squad.' });
      if ((u.currency || 0) < cost) return send(res, 400, { error: `Not enough Metaworks. Need ${cost}.` });
      if (type === 'energy') {
        if (player.condition >= 100) return send(res, 400, { error: `${player.nickname || player.name} is already at 100% condition.` });
        User.update(id, { currency: (u.currency || 0) - cost });
        Player.update(playerId, { condition: 100 });
      } else {
        if (player.form === 'Hot') return send(res, 400, { error: `${player.nickname || player.name} is already in Hot form.` });
        User.update(id, { currency: (u.currency || 0) - cost });
        Player.update(playerId, { form: 'Hot' });
      }
      reload();
      return send(res, 200, { ok: true, user: publicUser(db.findById('users', id)), player: publicUser(db.findById('users', id)).roster.find((r) => r.id === playerId) });
    }

    // ── SHOP: TRAIN ──
    if (p === '/api/shop/train' && req.method === 'POST') {
      const body = await readBody(req);
      const id = authenticate(body.token);
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      const elite = !!body.elite;
      const playerId = String(body.playerId || '');
      const cost = elite ? TRAINING.ELITE_COST : TRAINING.BASE_COST;
      reload();
      const u = db.findById('users', id);
      const player = db.findById('players', playerId);
      if (!player || player.ownerId !== id) return send(res, 404, { error: 'Player not found in your squad.' });
      if ((u.currency || 0) < cost) return send(res, 400, { error: `Not enough Metaworks. Need ${cost}.` });
      const statKeys = player.role === 'goalkeeper'
        ? ['reflex', 'positioning', 'anticipation', 'strength']
        : ['pace', 'skill', 'shooting', 'stamina'];
      const stat = pick(statKeys);
      const currentVal = player.stats[stat] || 60;
      const roll = randInt(1, 100);
      let gain = 0, outcome;
      if (elite) {
        if (roll <= TRAINING.GREAT_ROLL) { gain = randInt(3, 6); outcome = 'Excellent session! Massive improvement!'; }
        else if (roll <= 90) { gain = randInt(1, 3); outcome = 'Good session. Solid gains.'; }
        else { gain = 0; outcome = 'Tough session. No improvement this time.'; }
      } else {
        if (roll <= TRAINING.GREAT_ROLL) { gain = randInt(2, 4); outcome = 'Great session! Noticeable improvement!'; }
        else if (roll <= TRAINING.POOR_ROLL + 40) { gain = randInt(1, 2); outcome = 'Decent session. Small improvement.'; }
        else { outcome = 'Rough session. Player struggled.'; }
      }
      const newVal = Math.min(currentVal + gain, TRAINING.STAT_CAP);
      if (newVal !== currentVal) Player.update(playerId, { stats: { ...player.stats, [stat]: newVal } });
      User.update(id, { currency: (u.currency || 0) - cost });
      reload();
      const nu = db.findById('users', id);
      const rp = publicUser(nu).roster.find((r) => r.id === playerId);
      return send(res, 200, {
        ok: true,
        user: publicUser(nu),
        player: rp,
        trained: { stat, from: currentVal, to: newVal, gain: newVal - currentVal, outcome },
      });
    }

    // ── SHOP: RENAME PLAYER (nickname) ──
    if (p === '/api/shop/rename' && req.method === 'POST') {
      const body = await readBody(req);
      const id = authenticate(body.token);
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      const playerId = String(body.playerId || '');
      const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 24);
      if (!name) return send(res, 400, { error: 'Player name required.' });
      reload();
      const u = db.findById('users', id);
      const player = db.findById('players', playerId);
      if (!player || player.ownerId !== id) return send(res, 404, { error: 'Player not found in your squad.' });
      if ((u.currency || 0) < SHOP.RENAME_TOKEN) return send(res, 400, { error: `Not enough Metaworks. Need ${SHOP.RENAME_TOKEN}.` });
      User.update(id, { currency: (u.currency || 0) - SHOP.RENAME_TOKEN });
      Player.update(playerId, { nickname: name });
      reload();
      return send(res, 200, { ok: true, user: publicUser(db.findById('users', id)) });
    }

    // ── PENALTY: START ──
    if (p === '/api/penalty/start' && req.method === 'POST') {
      const body = await readBody(req);
      const id = authenticate(body.token);
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      reload();
      const u = db.findById('users', id);
      if (penaltySessions.has(body.token)) {
        return send(res, 200, { ok: true, message: 'Shootout already in progress.', ...penaltyState(penaltySessions.get(body.token)) });
      }
      let stake = parseInt(body.stake, 10) || 0;
      stake = Math.max(0, Math.min(PENALTY.MAX_STAKE, stake));
      if (stake > 0 && (u.currency || 0) < stake) {
        return send(res, 400, { error: `You need ${stake} Metaworks to stake that.` });
      }
      const s = { token: body.token, id, stake, round: 1, playerScore: 0, aiScore: 0, phase: 'shoot', finished: false };
      penaltySessions.set(body.token, s);
      return send(res, 200, {
        ok: true,
        message: `Shootout vs AI started — best of ${PENALTY.ROUNDS * 2}!${stake ? ` Stake: ${stake} (win ×${PENALTY.WIN_REWARD_MULT})` : ''}`,
        rounds: PENALTY.ROUNDS,
        ...penaltyState(s),
      });
    }

    // ── PENALTY: ACTION (shoot / save) ──
    if (p === '/api/penalty/action' && req.method === 'POST') {
      const body = await readBody(req);
      const id = authenticate(body.token);
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      const s = penaltySessions.get(body.token);
      if (!s || s.finished) return send(res, 400, { error: 'No active shootout. Start one first.' });
      const action = String(body.action || '').toLowerCase();
      const dir = String(body.dir || '').toUpperCase();
      if (!spots().includes(dir)) return send(res, 400, { error: 'Pick a spot: L, C or R.' });
      if (action !== s.phase) return send(res, 400, { error: `Wrong move — it's your turn to ${s.phase}.` });

      let message, last = null;
      if (action === 'shoot') {
        const guess = pick(spots());
        const goal = dir !== guess;
        if (goal) s.playerScore++;
        message = `You shot ${dirText(dir)}, AI dove ${dirText(guess)} → ${goal ? 'GOAL!' : 'SAVED!'}`;
        last = { type: 'shoot', dir, aiDir: guess, goal };
        s.phase = 'save';
      } else {
        const shot = pick(spots());
        const saved = dir === shot;
        if (!saved) s.aiScore++;
        message = `AI shot ${dirText(shot)}, you guessed ${dirText(dir)} → ${saved ? 'GREAT SAVE!' : 'CONCEDED'}`;
        last = { type: 'save', dir, aiDir: shot, saved };
        if (s.round >= PENALTY.ROUNDS) {
          // finish
          s.finished = true;
          const won = s.playerScore > s.aiScore;
          const draw = s.playerScore === s.aiScore;
          reload();
          const u = db.findById('users', id);
          let payout = 0;
          if (s.stake > 0) {
            if (won) { payout = Math.round(s.stake * PENALTY.WIN_REWARD_MULT); User.update(id, { currency: (u.currency || 0) + payout }); }
            else if (!draw) { User.update(id, { currency: Math.max(0, (u.currency || 0) - s.stake) }); payout = -s.stake; }
          }
          s.result = won ? 'win' : draw ? 'draw' : 'lose';
          s.payout = payout;
          penaltySessions.delete(body.token);
          reload();
          return send(res, 200, {
            ok: true,
            message: `SHOOTOUT OVER — You ${s.playerScore}–${s.aiScore} AI. ${won ? 'You win!' : draw ? 'Draw!' : 'AI wins.'}${payout ? ` Payout ${payout >= 0 ? '+' : ''}${payout}.` : ''}`,
            result: s.result,
            payout,
            user: publicUser(db.findById('users', id)),
            last,
            ...penaltyState(s),
          });
        }
        s.round++;
        s.phase = 'shoot';
      }
      return send(res, 200, { ok: true, message, last, ...penaltyState(s) });
    }

    // ── COINFLIP ──
    if (p === '/api/coinflip' && req.method === 'POST') {
      const body = await readBody(req);
      const id = authenticate(body.token);
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      let amount = parseInt(body.amount, 10);
      if (!amount || isNaN(amount)) return send(res, 400, { error: 'Amount required.' });
      amount = Math.max(COINFLIP.MIN, Math.min(COINFLIP.MAX, amount));
      reload();
      const u = db.findById('users', id);
      if ((u.currency || 0) < amount) return send(res, 400, { error: `Need ${amount} Metaworks to flip.` });
      const face = Math.random() < 0.5 ? 'heads' : 'tails';   // the coin's actual result
      const pickFace = String(body.face || '').toLowerCase();
      const predicted = pickFace === 'heads' || pickFace === 'tails';
      const win = predicted ? (face === pickFace) : (Math.random() < 0.5);
      const net = win ? amount : -amount;
      User.update(id, { currency: (u.currency || 0) + net });
      reload();
      return send(res, 200, { ok: true, face, pick: predicted ? pickFace : null, win, amount, net, currency: db.findById('users', id).currency, user: publicUser(db.findById('users', id)) });
    }

    // ── SLOT ──
    if (p === '/api/slot' && req.method === 'POST') {
      const body = await readBody(req);
      const id = authenticate(body.token);
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      let stake = parseInt(body.stake, 10);
      if (!stake || isNaN(stake)) stake = SLOT.COST;
      stake = Math.max(SLOT.COST, stake);
      reload();
      const u = db.findById('users', id);
      if ((u.currency || 0) < stake) return send(res, 400, { error: `Need ${stake} Metaworks to spin.` });
      const reels = [pick(SLOT.EMOJIS), pick(SLOT.EMOJIS), pick(SLOT.EMOJIS)];
      let mult = 0, label = 'no luck';
      if (reels[0] === reels[1] && reels[1] === reels[2]) {
        mult = reels[0] === '7️⃣' ? SLOT.JACKPOT : SLOT.THREE_SAME;
        label = reels[0] === '7️⃣' ? 'JACKPOT!' : 'TRIPLE!';
      } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
        mult = SLOT.TWO_SAME; label = 'TWO matching!';
      }
      const payout = Math.round(stake * mult);
      const net = payout - stake;
      User.update(id, { currency: (u.currency || 0) - stake + payout });
      reload();
      return send(res, 200, { ok: true, reels, mult, label, net, currency: db.findById('users', id).currency, user: publicUser(db.findById('users', id)) });
    }

    // ── HIGH / LOW (two-step: start reveals the number, then guess) ──
    if (p === '/api/highlow/start' && req.method === 'POST') {
      const body = await readBody(req);
      const id = authenticate(body.token);
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      let stake = parseInt(body.stake, 10);
      if (!stake || isNaN(stake)) stake = HIGHLOW.MIN_STAKE;
      stake = Math.max(HIGHLOW.MIN_STAKE, Math.min(HIGHLOW.MAX_STAKE, stake));
      reload();
      const u = db.findById('users', id);
      if ((u.currency || 0) < stake) return send(res, 400, { error: `Need ${stake} Metaworks to play.` });
      const first = randInt(1, 9);
      highlowSessions.set(body.token, { first, stake });
      return send(res, 200, {
        ok: true,
        first,
        stake,
        message: `Number is ${first}. Will the next be HIGHER or LOWER?`,
      });
    }

    if (p === '/api/highlow/guess' && req.method === 'POST') {
      const body = await readBody(req);
      const id = authenticate(body.token);
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      const pending = highlowSessions.get(body.token);
      if (!pending) return send(res, 400, { error: 'No game in progress. Start one first.' });
      highlowSessions.delete(body.token);
      const { first, stake } = pending;
      const dir = String(body.dir || '').toLowerCase();
      if (dir !== 'higher' && dir !== 'lower') return send(res, 400, { error: 'Use "higher" or "lower".' });
      if (first === 1 && dir === 'lower') return send(res, 400, { error: `Number is 1 — only HIGHER is possible.` });
      if (first === 9 && dir === 'higher') return send(res, 400, { error: `Number is 9 — only LOWER is possible.` });
      const winProb = dir === 'higher' ? (9 - first) / 9 : (first - 1) / 9;
      const mult = (1 / winProb) * (1 - HIGHLOW.HOUSE_EDGE);
      const next = randInt(1, 9);
      let outcome, net, label;
      if (next === first) { outcome = 'tie'; net = 0; label = 'SAME NUMBER! Stake returned.'; }
      else if ((dir === 'higher' && next > first) || (dir === 'lower' && next < first)) { outcome = 'win'; net = Math.round(stake * mult) - stake; label = `You called ${dir.toUpperCase()}!`; }
      else { outcome = 'lose'; net = -stake; label = `Wrong! It was ${dir === 'higher' ? 'LOWER' : 'HIGHER'}.`; }
      reload();
      User.update(id, { currency: (db.findById('users', id).currency || 0) + net });
      reload();
      return send(res, 200, { ok: true, first, next, dir, mult: +mult.toFixed(2), outcome, net, currency: db.findById('users', id).currency, user: publicUser(db.findById('users', id)) });
    }

    // ── BADGES: catalog (public) — labels/descriptions for the badge keys ──
    if (p === '/api/badges' && req.method === 'GET') {
      return send(res, 200, { catalog: BADGES });
    }

    // ── DAILY: claim the daily reward (mirrors the bot's !daily logic) ──
    if (p === '/api/daily' && req.method === 'POST') {
      const body = await readBody(req);
      const id = authenticate(body.token);
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      reload();
      const u = db.findById('users', id);
      if (!u) return send(res, 404, { error: 'Account not found.' });
      const now = new Date();
      const last = u.lastDaily ? new Date(u.lastDaily) : null;
      if (last && sameDay(last, now)) {
        const next = new Date(last); next.setDate(next.getDate() + 1); next.setHours(0, 0, 0, 0);
        const hoursLeft = Math.max(1, Math.ceil((next - now) / 3.6e6));
        return send(res, 400, { error: `Daily already claimed. Come back in ~${hoursLeft}h.` });
      }
      let streak = u.dailyStreak || 0;
      streak = (last && consecutiveDay(last, now)) ? streak + 1 : 1;
      const mult = 1 + (streak - 1) * (ECONOMY.STREAK_MULTIPLIER - 1);
      const reward = Math.min(Math.round(ECONOMY.DAILY_BASE * mult), ECONOMY.MAX_DAILY);
      User.update(id, { currency: (u.currency || 0) + reward, lastDaily: now.toISOString(), dailyStreak: streak });
      reload();
      return send(res, 200, { ok: true, reward, streak, user: publicUser(db.findById('users', id)) });
    }

    // ── DAILY: status (can I claim today? next reward preview) ──
    if (p === '/api/daily' && req.method === 'GET') {
      const id = authenticate(url.searchParams.get('token'));
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      reload();
      const u = db.findById('users', id);
      const now = new Date();
      const last = u.lastDaily ? new Date(u.lastDaily) : null;
      const claimedToday = !!(last && sameDay(last, now));
      const streak = u.dailyStreak || 0;
      const nextStreak = (last && consecutiveDay(last, now)) ? streak + 1 : 1;
      const preview = Math.min(Math.round(ECONOMY.DAILY_BASE * (1 + (nextStreak - 1) * (ECONOMY.STREAK_MULTIPLIER - 1))), ECONOMY.MAX_DAILY);
      return send(res, 200, { claimedToday, streak, nextReward: preview, maxDaily: ECONOMY.MAX_DAILY });
    }

    // ── MANAGER: public profile of another manager by team name ──
    if (p === '/api/manager' && req.method === 'GET') {
      reload();
      const nameKey = String(url.searchParams.get('name') || '').trim().toLowerCase();
      if (!nameKey) return send(res, 400, { error: 'Manager name required.' });
      const u = db.all('users').find((x) => x.registered && (x.name || '').trim().toLowerCase() === nameKey);
      if (!u) return send(res, 404, { error: 'No registered manager with that team name.' });
      const players = db.all('players');
      const pmap = Object.fromEntries(players.map((pl) => [pl.id, pl]));
      const squadPower = (u.startingXI || []).map((pid) => pmap[pid]).filter(Boolean).reduce((s, pl) => s + playerTotal(pl), 0);
      const topPlayers = [...(u.startingXI || []), ...(u.bench || []), ...(u.reserves || [])]
        .map((pid) => pmap[pid]).filter(Boolean)
        .map((pl) => ({ id: pl.id, name: pl.nickname || pl.name, rarity: pl.rarity, role: pl.role, total: playerTotal(pl) }))
        .sort((a, b) => b.total - a.total).slice(0, 5);
      const total = (u.wins || 0) + (u.losses || 0) + (u.draws || 0);
      return send(res, 200, {
        manager: {
          name: u.name, mmr: u.mmr, rank: u.rank,
          wins: u.wins || 0, losses: u.losses || 0, draws: u.draws || 0,
          winRate: total ? Math.round(((u.wins || 0) / total) * 100) : 0,
          squadPower, tournamentWins: u.tournamentWins || 0, winStreak: u.winStreak || 0,
          badges: u.badges || [], bounty: u.bounty || 0, topPlayers,
        },
      });
    }

    // ── SQUAD ANALYZE: rating / chemistry / condition breakdown of the XI ──
    if (p === '/api/squad/analyze' && req.method === 'GET') {
      const id = authenticate(url.searchParams.get('token'));
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      reload();
      const u = db.findById('users', id);
      const xi = (u.startingXI || []).map((pid) => db.findById('players', pid)).filter(Boolean);
      if (!xi.length) return send(res, 200, { empty: true });
      const ovrs = xi.map(playerTotal);
      const avgOvr = Math.round(ovrs.reduce((a, b) => a + b, 0) / ovrs.length);
      const avgCondition = Math.round(xi.reduce((s, pl) => s + (pl.condition || 0), 0) / xi.length);
      const avgChem = Math.round(xi.reduce((s, pl) => s + (pl.chemistry || 0), 0) / xi.length);
      const gk = xi.filter((pl) => pl.role === 'goalkeeper').length;
      const outfield = xi.length - gk;
      const hotForm = xi.filter((pl) => pl.form === 'Hot').length;
      const strongest = xi.reduce((a, b) => (playerTotal(b) > playerTotal(a) ? b : a));
      const weakest = xi.reduce((a, b) => (playerTotal(b) < playerTotal(a) ? b : a));
      const tips = [];
      if (gk === 0) tips.push('No goalkeeper in your XI — add one for a stronger defence.');
      if (avgCondition < 60) tips.push('Squad condition is low — restore energy in the Shop.');
      if (avgChem < 40) tips.push('Low chemistry — play more matches together to build it.');
      if (xi.length < 4) tips.push(`Only ${xi.length}/4 starters — fill your XI on the Dashboard.`);
      if (!tips.length) tips.push('Squad looks sharp. Go get some wins!');
      return send(res, 200, {
        size: xi.length, avgOvr, avgCondition, avgChem, gk, outfield, hotForm,
        strongest: { id: strongest.id, name: strongest.nickname || strongest.name, total: playerTotal(strongest) },
        weakest: { id: weakest.id, name: weakest.nickname || weakest.name, total: playerTotal(weakest) },
        tips,
      });
    }

    // ── BOUNTY BOARD: managers with an active bounty (public, read-only) ──
    if (p === '/api/bounties' && req.method === 'GET') {
      reload();
      const list = db.all('users')
        .filter((u) => u.registered && (u.bounty || 0) > 0)
        .sort((a, b) => (b.bounty || 0) - (a.bounty || 0))
        .map((u) => ({ name: u.name, bounty: u.bounty, mmr: u.mmr, wins: u.wins || 0, losses: u.losses || 0 }));
      return send(res, 200, { bounties: list });
    }

    // ── BOUNTY SET (owner-only, mirrors !setbounty) ──
    if (p === '/api/bounty/set' && req.method === 'POST') {
      const body = await readBody(req);
      const id = authenticate(body.token);
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      if (!User.isOwner(id)) return send(res, 403, { error: 'Bounties are owner-only.' });
      const price = parseInt(body.price, 10);
      if (!price || price <= 0) return send(res, 400, { error: 'A positive bounty price is required.' });
      const targetName = String(body.target || '').trim().toLowerCase();
      if (!targetName) return send(res, 400, { error: 'Target manager name required.' });
      reload();
      const them = db.all('users').find((u) => u.registered && (u.name || '').trim().toLowerCase() === targetName);
      if (!them) return send(res, 404, { error: 'No registered manager with that team name.' });
      User.update(them.whatsappId, { bounty: price });
      reload();
      return send(res, 200, { ok: true, target: them.name, price });
    }

    // ── MY MATCHES: match history involving the logged-in manager ──
    if (p === '/api/mymatches' && req.method === 'GET') {
      const id = authenticate(url.searchParams.get('token'));
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      reload();
      const u = db.findById('users', id);
      const myName = (u.name || '').trim().toLowerCase();
      const matches = readJsonFile(MATCHES_FILE);
      const list = Object.values(matches)
        .filter((m) => (m.homeName || '').trim().toLowerCase() === myName || (m.awayName || '').trim().toLowerCase() === myName)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 25)
        .map((m) => {
          const isHome = (m.homeName || '').trim().toLowerCase() === myName;
          const my = isHome ? m.homeScore : m.awayScore;
          const opp = isHome ? m.awayScore : m.homeScore;
          const outcome = my > opp ? 'W' : my < opp ? 'L' : 'D';
          return {
            id: m.id, date: m.date, opponent: isHome ? m.awayName : m.homeName,
            myScore: my, oppScore: opp, outcome, mvp: m.mvp, goalScorers: m.goalScorers || [],
          };
        });
      const wins = list.filter((m) => m.outcome === 'W').length;
      const losses = list.filter((m) => m.outcome === 'L').length;
      const draws = list.filter((m) => m.outcome === 'D').length;
      return send(res, 200, { matches: list, summary: { wins, losses, draws } });
    }

    send(res, 404, { error: 'unknown endpoint' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'server error' });
  }
});

function readJsonFile(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return safeParse(raw);
  } catch {
    return {};
  }
}

// Graceful startup: if the port is already taken (e.g. a stray node process
// from a previous crash), walk upward to the next free port instead of crashing
// — keeps the web app from breaking on a restart.
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    const next = PORT + 1;
    console.warn(`[VOLTA WEB] Port ${PORT} in use — trying ${next}`);
    server.listen(next, () => {
      console.log(`[VOLTA WEB] Manager app live at http://localhost:${next}`);
    });
  } else {
    console.error('[VOLTA WEB] server error:', err);
  }
});
server.listen(PORT, () => {
  console.log(`[VOLTA WEB] Manager app live at http://localhost:${PORT}`);
});
