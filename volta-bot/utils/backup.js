// utils/backup.js
// Automated JSON data backups. Snapshots every table file in the data dir into
// a timestamped folder under DATA_DIR/<BACKUP.DIR>, and prunes to the most
// recent BACKUP.KEEP snapshots. Backups live alongside (but separate from) the
// live data, so a bad edit / corruption can always be rolled back by hand.
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { BACKUP } = require('../config/constants');

// Mirror config/database.js resolution so we back up the SAME files the bot uses.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const BACKUP_ROOT = path.join(DATA_DIR, BACKUP.DIR);

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// Copy all *.json table files into a new timestamped snapshot folder.
// Returns the snapshot path, or null on failure.
function runBackup() {
  try {
    if (!fs.existsSync(DATA_DIR)) return null;
    if (!fs.existsSync(BACKUP_ROOT)) fs.mkdirSync(BACKUP_ROOT, { recursive: true });

    const dest = path.join(BACKUP_ROOT, timestamp());
    fs.mkdirSync(dest, { recursive: true });

    const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
    let copied = 0;
    for (const f of files) {
      try {
        fs.copyFileSync(path.join(DATA_DIR, f), path.join(dest, f));
        copied++;
      } catch (err) {
        logger.error({ err, file: f }, 'Backup: failed to copy a table file');
      }
    }

    prune();
    logger.info({ dest, copied }, 'Data backup complete');
    return dest;
  } catch (err) {
    logger.error({ err }, 'Data backup failed');
    return null;
  }
}

// Keep only the most recent BACKUP.KEEP snapshot folders; delete older ones.
function prune() {
  try {
    if (!fs.existsSync(BACKUP_ROOT)) return;
    const dirs = fs.readdirSync(BACKUP_ROOT)
      .map((name) => ({ name, full: path.join(BACKUP_ROOT, name) }))
      .filter((d) => {
        try { return fs.statSync(d.full).isDirectory(); } catch { return false; }
      })
      .sort((a, b) => a.name.localeCompare(b.name)); // ISO names sort chronologically

    const excess = dirs.length - BACKUP.KEEP;
    for (let i = 0; i < excess; i++) {
      try { fs.rmSync(dirs[i].full, { recursive: true, force: true }); } catch {}
    }
  } catch (err) {
    logger.error({ err }, 'Backup prune failed');
  }
}

// Start the periodic backup timer. Runs one immediately, then on an interval.
// Returns the timer so callers can clear it if needed.
function startBackupScheduler() {
  runBackup();
  const t = setInterval(runBackup, BACKUP.INTERVAL_MS);
  if (t.unref) t.unref();
  return t;
}

module.exports = { runBackup, prune, startBackupScheduler, BACKUP_ROOT };
