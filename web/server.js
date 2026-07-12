// web/server.js
// Standalone web app for VOLTA managers. Log in with the password you set via
// the bot's !password command, then manage your squad from a browser.
//
//   node web/server.js            (default port 3000)
//   PORT=8080 node web/server.js
//
// Reads data/users.json + data/players.json fresh on every request so it always
// reflects the live bot data. Squad/rename writes are merged back into the file.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const MATCHES_FILE = path.join(DATA_DIR, 'matches.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

const KEY_BYTES = 64;

// ─── data helpers (read straight from disk, fresh each call) ─────────────────
function readJson(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function writeUsers(obj) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(obj, null, 2));
}
function verifyPassword(password, hashHex, saltHex) {
  if (!hashHex || !saltHex) return false;
  const computed = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), KEY_BYTES).toString('hex');
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hashHex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// In-memory session tokens → whatsappId. Restarts clear sessions (managers
// just log in again). Good enough for a self-hosted single-owner tool.
const sessions = new Map();

function publicUser(u) {
  if (!u) return null;
  const players = readJson(PLAYERS_FILE);
  const ownedIds = [...(u.startingXI || []), ...(u.bench || []), ...(u.reserves || [])];
  const roster = ownedIds.map((id) => players[id]).filter(Boolean).map((p) => ({
    id: p.id,
    name: p.nickname || p.name,
    role: p.role,
    rarity: p.rarity,
    level: p.level,
    condition: p.condition,
    form: p.form,
    total: p.role === 'goalkeeper'
      ? p.stats.reflex + p.stats.positioning + p.stats.anticipation + p.stats.strength + p.stats.composure
      : p.stats.pace + p.stats.skill + p.stats.shooting + p.stats.stamina + p.stats.composure,
    stats: p.stats,
  }));
  const total = (u.wins || 0) + (u.losses || 0) + (u.draws || 0);
  const winRate = total ? Math.round((u.wins / total) * 100) : 0;
  const playerTotal = (p) => p.role === 'goalkeeper'
    ? p.stats.reflex + p.stats.positioning + p.stats.anticipation + p.stats.strength + p.stats.composure
    : p.stats.pace + p.stats.skill + p.stats.shooting + p.stats.stamina + p.stats.composure;
  const squadPower = (u.startingXI || [])
    .map((id) => players[id]).filter(Boolean)
    .reduce((s, p) => s + playerTotal(p), 0);
  const teamValue = ownedIds
    .map((id) => players[id]).filter(Boolean)
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
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
  });
}

function authenticate(token) {
  const id = token && sessions.get(token);
  return id || null;
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
      const users = readJson(USERS_FILE);
      const nameKey = String(name || '').trim().toLowerCase();
      let matched = null;
      for (const u of Object.values(users)) {
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
      return send(res, 200, { token, user: publicUser(matched) });
    }

    // ── ME ──
    if (p === '/api/me' && req.method === 'GET') {
      const id = authenticate(url.searchParams.get('token'));
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      const users = readJson(USERS_FILE);
      return send(res, 200, { user: publicUser(users[id]) });
    }

    // ── SAVE SQUAD ──
    if (p === '/api/squad' && req.method === 'POST') {
      const body = await readBody(req);
      const id = authenticate(body.token);
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      const users = readJson(USERS_FILE);
      const u = users[id];
      if (!u) return send(res, 404, { error: 'Account not found.' });

      const owned = new Set([...(u.startingXI || []), ...(u.bench || []), ...(u.reserves || [])]);
      const xi = Array.isArray(body.startingXI) ? body.startingXI.filter((x) => owned.has(x)) : u.startingXI;
      const bench = Array.isArray(body.bench) ? body.bench.filter((x) => owned.has(x)) : u.bench;
      const xiSize = Math.min(xi.length, 4);

      // de-dupe: anything not in XI goes to bench
      const xiSet = new Set(xi.slice(0, xiSize));
      const finalBench = [...new Set([...bench, ...owned].filter((x) => !xiSet.has(x)))];

      u.startingXI = [...xiSet];
      u.bench = finalBench;
      u.updatedAt = new Date().toISOString();
      users[id] = u;
      writeUsers(users);
      return send(res, 200, { user: publicUser(u), ok: true });
    }

    // ── RENAME TEAM ──
    if (p === '/api/rename' && req.method === 'POST') {
      const body = await readBody(req);
      const id = authenticate(body.token);
      if (!id) return send(res, 401, { error: 'Not logged in.' });
      const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 24);
      if (!name) return send(res, 400, { error: 'Team name required.' });
      const users = readJson(USERS_FILE);
      if (!users[id]) return send(res, 404, { error: 'Account not found.' });
      users[id].name = name;
      users[id].updatedAt = new Date().toISOString();
      writeUsers(users);
      return send(res, 200, { user: publicUser(users[id]), ok: true });
    }

    // ── LEADERBOARD (read-only, top 20 by MMR) ──
    if (p === '/api/leaderboard' && req.method === 'GET') {
      const users = readJson(USERS_FILE);
      const board = Object.values(users)
        .filter((u) => u.registered)
        .sort((a, b) => (b.mmr || 0) - (a.mmr || 0))
        .slice(0, 20)
        .map((u, i) => ({ rank: i + 1, name: u.name, mmr: u.mmr, wins: u.wins, losses: u.losses, draws: u.draws }));
      return send(res, 200, { board });
    }

    // ── MATCH HISTORY (read-only, most recent 25) ──
    if (p === '/api/history' && req.method === 'GET') {
      const matches = readJson(MATCHES_FILE);
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
      const players = readJson(PLAYERS_FILE);
      const list = Object.values(players)
        .map((p) => {
          const t = p.role === 'goalkeeper'
            ? p.stats.reflex + p.stats.positioning + p.stats.anticipation + p.stats.strength + p.stats.composure
            : p.stats.pace + p.stats.skill + p.stats.shooting + p.stats.stamina + p.stats.composure;
          return { id: p.id, name: p.nickname || p.name, rarity: p.rarity, role: p.role, ovr: t, position: p.position, goals: p.goals || 0, motm: p.manOfTheMatch || 0 };
        })
        .sort((a, b) => b.ovr - a.ovr)
        .slice(0, 12);
      return send(res, 200, { players: list });
    }

    send(res, 404, { error: 'unknown endpoint' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'server error' });
  }
});

server.listen(PORT, () => {
  console.log(`[VOLTA WEB] Manager app live at http://localhost:${PORT}`);
});
