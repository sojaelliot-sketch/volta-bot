'use strict';
// utils/connectTickets.js
//
// A one-tap login ticket, shared between the bot and the web server.
//
// These are SEPARATE PROCESSES. An in-memory Map in web/server.js could never
// have worked: !site runs in the bot, and the redemption happens in the web
// server, so nothing they hold in RAM is visible to the other. The database is
// the only thing they share, so the tickets live there.
//
// (The first version of this required web/server.js from the bot. That file has
// no module.exports, so it would have returned an empty object and started a
// second HTTP server inside the bot process.)

const db = require('../config/database');
const crypto = require('crypto');

const TABLE = 'counters';          // a general-purpose table both sides can reach
const KEY = 'connect_tickets';
const TTL_MS = 10 * 60 * 1000;

function load() {
  try {
    // Force a re-read from disk. Each process keeps its own in-memory cache, so
    // without this the web server would look at a snapshot taken before the bot
    // wrote the ticket and every link would report itself expired.
    if (typeof db.reloadTable === 'function') db.reloadTable(TABLE);
    const row = db.findById(TABLE, KEY);
    return (row && Array.isArray(row.tickets)) ? row.tickets : [];
  } catch { return []; }
}

function save(tickets) {
  const live = tickets.filter((t) => t.expires > Date.now()).slice(-200);
  try {
    if (db.findById(TABLE, KEY)) db.update(TABLE, KEY, { tickets: live });
    else db.insert(TABLE, KEY, { id: KEY, tickets: live });
  } catch { /* best effort — a failed ticket just means using a password */ }
}

/** Mint a single-use ticket for this account. */
function issue(whatsappId) {
  const code = crypto.randomBytes(18).toString('base64url');
  const tickets = load();
  tickets.push({ code, whatsappId, expires: Date.now() + TTL_MS });
  save(tickets);
  return code;
}

/** Redeem a ticket. Returns the whatsappId, or null. Single use. */
function redeem(code) {
  if (!code) return null;
  const tickets = load();
  const idx = tickets.findIndex((t) => t.code === code);
  if (idx === -1) return null;
  const [t] = tickets.splice(idx, 1);
  save(tickets);
  return t.expires > Date.now() ? t.whatsappId : null;
}

/** The link the player taps. Carries the backend address and the ticket. */
function buildLink(whatsappId) {
  const backend = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
  const site = (process.env.SITE_URL || 'https://voltabot1.netlify.app').replace(/\/$/, '');
  const payload = Buffer.from(JSON.stringify({ b: backend, t: issue(whatsappId) })).toString('base64url');
  return `${site}/#c=${payload}`;
}

module.exports = { issue, redeem, buildLink, TTL_MS };
