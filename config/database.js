// config/database.js
// VOLTA uses simple local JSON file storage instead of MongoDB — zero external
// dependencies, zero setup, and easy to inspect/back up during development.
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

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

async function connectDB() {
  ensureDataDir();
  for (const table of TABLES) {
    cache[table] = loadTable(table);
  }
  console.log(`[VOLTA] Local JSON database ready (${DATA_DIR})`);
}

// ─── GENERIC COLLECTION API ────────────────────────────────────────────────
// Documents are stored as { [id]: docObject } within each table's JSON file.

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
  if (!cache[table]) cache[table] = {};
  cache[table][id] = doc;
  persistTable(table);
  return doc;
}

function update(table, id, patch) {
  if (!cache[table]?.[id]) return null;
  cache[table][id] = { ...cache[table][id], ...patch, updatedAt: new Date().toISOString() };
  persistTable(table);
  return cache[table][id];
}

function remove(table, id) {
  if (!cache[table]?.[id]) return false;
  delete cache[table][id];
  persistTable(table);
  return true;
}

// Re-read a table (or all tables) from disk, discarding any in-memory cache.
// Used by the owner's !reload command after hand-editing the JSON data files,
// so changes take effect live without restarting the bot.
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
