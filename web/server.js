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
const { openPack, seedMarketPlayer } = require('../utils/playerGenerator');
const { PACKS, SHOP, TRAINING, PENALTY, COINFLIP, HIGHLOW, SLOT, RARITY, MARKET } = require('../config/constants');
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
const WEB_VERSION = 4;

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
      return send(res, 200, { ok: true, version: WEB_VERSION, features: ['shop', 'penalty', 'coinflip', 'slot', 'highlow', 'market', 'transfer'] });
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

server.listen(PORT, () => {
  console.log(`[VOLTA WEB] Manager app live at http://localhost:${PORT}`);
});
