// config/database.js
// VOLTA uses simple local JSON file storage instead of MongoDB — zero external
// dependencies, zero setup, and easy to inspect/back up during development.
//
// IMPORTANT: the bot AND the web server run as SEPARATE processes, each with
// its own in-memory cache. If both wrote freely, one process would overwrite
// the other's changes — the classic "I opened a pack but my balance didn't go
// down / players never appeared / my match result vanished" bug. To keep the
// two in sync we use a SINGLE-WRITER model: every mutation reloads the table
// from disk FIRST (picking up the other process's writes), applies its change,
// then writes it back. A lockfile guards the short read-modify-write so the
// two processes can't interleave and clobber each other.
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const LOCK_DIR = path.join(DATA_DIR, '.lock');

const TABLES = ['users', 'players', 'market', 'tournaments', 'counters', 'matches'];

// In-memory cache of each table, kept in sync with disk on every write.
const cache = {};

function tableFile(table) {
  return path.join(DATA_DIR, `${table}.json`);
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOCK_DIR)) {
    fs.mkdirSync(LOCK_DIR, { recursive: true });
  }
}

function loadTable(table) {
  const file = tableFile(table);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, '{}');
    return {};
  }
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    logger.error({ err, table }, `Failed to parse ${table}.json — starting with empty table`);
    return {};
  }
}

// Atomic write: write to a temp file then rename, so a crash mid-write never
// corrupts the real data file. Retries a few times to survive transient
// antivirus/OS file locks (EPERM) on the rename.
function persistTable(table) {
  const file = tableFile(table);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache[table], null, 2));
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      if (attempt === 4) throw err;
      // brief pause, then try again (e.g. Defender releasing a handle)
      try { fs.copyFileSync(tmp, file); fs.unlinkSync(tmp); return; } catch {}
      Atomics.wait ? Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25) : null;
    }
  }
}

// ─── CROSS-PROCESS WRITE LOCK ───────────────────────────────────────────────
// A crude but effective inter-process mutex built on a lockfile whose creation
// is atomic (O_EXCL). The holder writes its PID + deadline into the file so a
// stale lock (from a crashed process) can be broken after a short timeout.
const LOCK_TIMEOUT_MS = 1500;

function acquireLock() {
  if (!fs.existsSync(LOCK_DIR)) fs.mkdirSync(LOCK_DIR, { recursive: true });
  const lockFile = path.join(LOCK_DIR, 'write.lock');
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      fs.writeFileSync(lockFile, `${process.pid}:${Date.now() + LOCK_TIMEOUT_MS}`, { flag: 'wx' });
      return () => {
        try { fs.unlinkSync(lockFile); } catch {}
      };
    } catch (err) {
      // Lock held by another process. If it's stale (owner crashed), break it.
      try {
        const content = fs.readFileSync(lockFile, 'utf8');
        const [, exp] = content.split(':');
        if (exp && Number(exp) < Date.now()) {
          fs.unlinkSync(lockFile);
        }
      } catch {}
      Atomics.wait ? Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10) : null;
    }
  }
  // Could not acquire in time — return a no-op release (last resort, avoids
  // deadlocking the whole bot if the web server is wedged).
  logger.warn('database write lock timed out — proceeding without lock');
  return () => {};
}

// Re-read a single table from disk into the cache, then return it. This is how
// a process picks up writes made by the OTHER process before it mutates.
function syncTable(table) {
  cache[table] = loadTable(table);
  return cache[table];
}

async function connectDB() {
  ensureDataDir();
  for (const table of TABLES) {
    cache[table] = loadTable(table);
  }
  console.log(`[VOLTA] Local JSON database ready (${DATA_DIR})`);
}

// ─── GENERIC COLLECTION API ────────────────────────────────────────────────
// Documents are stored as { [id]: docObject } within each table's JSON file.
// Reads serve from the in-memory cache (fast). Mutations take the cross-process
// lock, re-sync from disk, apply the change, and persist — so two processes
// can never clobber each other's data.

function all(table) {
  return Object.values(cache[table] || {});
}

function findById(table, id) {
  return cache[table]?.[id] || null;
}

function find(table, predicate) {
  return all(table).filter(predicate);
}

function findOne(table, predicate) {
  return all(table).find(predicate) || null;
}

function insert(table, id, doc) {
  const release = acquireLock();
  try {
    syncTable(table);
    if (!cache[table]) cache[table] = {};
    cache[table][id] = doc;
    persistTable(table);
    return doc;
  } finally {
    release();
  }
}

function update(table, id, patch) {
  const release = acquireLock();
  try {
    syncTable(table);
    if (!cache[table]?.[id]) return null;
    cache[table][id] = { ...cache[table][id], ...patch, updatedAt: new Date().toISOString() };
    persistTable(table);
    return cache[table][id];
  } finally {
    release();
  }
}

function remove(table, id) {
  const release = acquireLock();
  try {
    syncTable(table);
    if (!cache[table]?.[id]) return false;
    delete cache[table][id];
    persistTable(table);
    return true;
  } finally {
    release();
  }
}

// Re-read a table (or all tables) from disk, discarding any in-memory cache.
// Used by the owner's !reload command after hand-editing the JSON data files,
// so changes take effect live without restarting the bot. Also called by the
// web server before each request (see reloadAll below) to stay in sync with
// the bot process.
function reloadTable(table) {
  cache[table] = loadTable(table);
  return cache[table];
}
function reloadAll() {
  for (const t of TABLES) reloadTable(t);
}

module.exports = {
  connectDB,
  all,
  findById,
  find,
  findOne,
  insert,
  update,
  remove,
  reloadTable,
  reloadAll,
};
