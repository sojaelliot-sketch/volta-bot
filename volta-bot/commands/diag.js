'use strict';
// commands/diag.js — !diag
//
// One command that answers "why is the bot behaving oddly right now" without
// needing terminal access. Previously the only way to know that image
// rendering had silently died, or that a table had stopped growing, was to
// read the server logs — which is not an option from a phone.
//
// Owner-only.

const os = require('os');
const User = require('../models/User');
const db = require('../config/database');
const safeCanvas = require('../utils/safeCanvas');
const { sendText } = require('../utils/messaging');
const { BRAND } = require('../config/constants');

function humanBytes(n) {
  if (n < 0) return '?';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function humanUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

async function handle({ sock, msg, jid, sender }) {
  if (!User.isOwner(sender)) {
    await sendText(sock, jid, '⛔ *!diag* is owner-only.', msg);
    return;
  }

  const started = globalThis.__botStartTime || Date.now();
  const mem = process.memoryUsage();

  const lines = [];
  lines.push('🩺 *VOLTA DIAGNOSTICS*');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━');

  // ── Process ──
  lines.push('*Process*');
  lines.push(`Uptime: ${humanUptime(Date.now() - started)}`);
  lines.push(`Node: ${process.version}  ·  ${process.platform}/${process.arch}`);
  lines.push(`Heap: ${humanBytes(mem.heapUsed)} / ${humanBytes(mem.heapTotal)}`);
  lines.push(`RSS: ${humanBytes(mem.rss)}  ·  free RAM ${humanBytes(os.freemem())}`);
  lines.push(`Load: ${os.loadavg().map((n) => n.toFixed(2)).join(' ')}`);
  lines.push('');

  // ── Connection ──
  lines.push('*WhatsApp*');
  try {
    const me = sock && sock.user && String(sock.user.id || '').split(':')[0];
    lines.push(`Linked as: ${me || 'unknown'}`);
    lines.push(`Registered: ${sock?.authState?.creds?.registered ? 'yes' : 'no'}`);
  } catch { lines.push('Linked as: unavailable'); }
  lines.push('');

  // ── Rendering ──
  lines.push('*Image rendering*');
  if (safeCanvas.available()) {
    lines.push('canvas: ✅ working — cards render as images');
  } else {
    lines.push('canvas: ❌ unavailable — cards fall back to text');
    lines.push(`reason: ${String(safeCanvas.reason() || 'unknown').slice(0, 120)}`);
    lines.push('fix: run `npm rebuild canvas` on the host');
  }
  const fam = safeCanvas.fontFamily();
  if (fam.startsWith('Volta')) {
    lines.push('fonts: ✅ bundled font in use');
  } else {
    lines.push('fonts: ⚠️ system default — text may be blank on a bare server');
    lines.push('fix: drop a .ttf into assets/fonts/ and restart');
  }
  lines.push('');

  // ── Data ──
  lines.push('*Database*');
  try {
    const snap = db.healthSnapshot();
    for (const [table, info] of Object.entries(snap)) {
      lines.push(`${table}: ${info.rows} rows · ${humanBytes(info.bytes)}`);
    }
  } catch (err) {
    lines.push(`snapshot failed: ${err && err.message}`);
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(BRAND);

  await sendText(sock, jid, lines.join('\n'), msg);
}

module.exports = { handle };
