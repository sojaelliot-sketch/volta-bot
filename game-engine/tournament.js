// game-engine/tournament.js
// Single-elimination bracket tournament with categories (classic / penalty).
// Players are auto-paired; each tie has a deadline — if the players don't
// resolve it (by playing a real PvP / penalty match, or via !tourneyplay),
// it is auto-simulated from team strength when the deadline passes.
const User = require('../models/User');
const { TOURNAMENT, MATCH } = require('../config/constants');
const { sendText } = require('../utils/messaging');
const { pick } = require('../utils/random');

let current = null; // { category, prize, host, chatJid, sock, rounds, startedAt, endsAt }

function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function toEven(arr) {
  const a = arr.slice();
  while (a.length % 2 !== 0) a.push('BYE');
  return a;
}

// a match participant is either a player jid, 'BYE', or a match object
// (whose winner becomes the participant once decided).
function eff(x) {
  if (x && typeof x === 'object') return x.winner;
  return x;
}

function buildRounds(players) {
  let cur = toEven(shuffle(players));
  const rounds = [];
  while (cur.length > 1) {
    const r = [];
    for (let i = 0; i < cur.length; i += 2) {
      const a = cur[i], b = cur[i + 1];
      const m = { a, b, winner: null, dueAt: null, simulated: false, round: rounds.length + 1 };
      if (a === 'BYE') { m.winner = b; m.simulated = true; }
      else if (b === 'BYE') { m.winner = a; m.simulated = true; }
      else m.dueAt = Date.now() + TOURNAMENT.MATCH_WINDOW_MS;
      r.push(m);
    }
    rounds.push(r);
    cur = r.slice();
  }
  return rounds;
}

function teamStrength(jid) {
  if (!jid || jid === 'BYE') return 0;
  const u = User.getByWhatsappId(jid);
  if (!u) return 0;
  // crude strength proxy from MMR + currency
  return (u.mmr || 1000) + (u.currency || 0) / 50;
}

function simulateWinner(a, b) {
  const sa = teamStrength(a), sb = teamStrength(b);
  const total = sa + sb || 1;
  const pA = sa / total;
  return Math.random() < pA ? a : b;
}

function isActive() { return !!current; }

function cancel() { current = null; }

function create(opts) {
  current = {
    category: opts.category,
    prize: opts.prize,
    host: opts.host,
    chatJid: opts.chatJid,
    sock: opts.sock,
    players: [],
    rounds: null,
    startedAt: null,
    endsAt: null,
  };
  return current;
}

function addPlayer(jid) {
  if (!current) return false;
  if (current.rounds) return false; // already started
  if (current.players.includes(jid)) return false;
  if (current.players.length >= TOURNAMENT.MAX_PLAYERS) return false;
  current.players.push(jid);
  return true;
}

function start() {
  if (!current || current.rounds) return;
  if (current.players.length < 2) return false;
  current.rounds = buildRounds(current.players);
  current.startedAt = Date.now();
  // arm auto-sim timers for every real match
  for (const round of current.rounds) {
    for (const m of round) {
      if (m.simulated || m.winner) continue;
      setTimeout(() => autoSim(m), TOURNAMENT.MATCH_WINDOW_MS + 1000);
    }
  }
  return true;
}

function allMatches() {
  if (!current || !current.rounds) return [];
  return current.rounds.flat();
}

// Find the pending match involving both players (eff participants resolved).
function findMatch(a, b) {
  for (const m of allMatches()) {
    if (m.winner || m.simulated) continue;
    const ea = eff(m.a), eb = eff(m.b);
    if (!ea || !eb) continue;
    if ((ea === a && eb === b) || (ea === b && eb === a)) return m;
  }
  return null;
}

// Called when a real match between a and b finishes with winnerId.
function resolveByResult(a, b, winnerId) {
  if (!current || !current.rounds) return false;
  const m = findMatch(a, b);
  if (!m) return false;
  m.winner = winnerId;
  m.simulated = false;
  checkComplete();
  return true;
}

function autoSim(m) {
  if (!current || m.winner) return;
  const a = eff(m.a), b = eff(m.b);
  if (!a || !b) return;
  m.winner = simulateWinner(a, b);
  m.simulated = true;
  checkComplete();
}

function checkComplete() {
  if (!current || !current.rounds) return;
  const final = current.rounds[current.rounds.length - 1][0];
  if (!final.winner) return;
  // tournament over — pay out
  const winner = final.winner;
  const runnerUp = (eff(final.a) === winner) ? eff(final.b) : eff(final.a);

  // semifinal losers
  const semis = current.rounds.length >= 2 ? current.rounds[current.rounds.length - 2] : [];
  const semiLosers = semis.map((m) => (m.winner === eff(m.a) ? eff(m.b) : eff(m.a))).filter(Boolean);

  const pay = (jid, amt) => {
    if (!jid || jid === 'BYE') return;
    const u = User.getByWhatsappId(jid);
    if (u) User.update(jid, { currency: (u.currency || 0) + amt });
  };

  pay(winner, current.prize);
  pay(runnerUp, Math.round(current.prize * 0.4));
  semiLosers.forEach((j) => pay(j, Math.round(current.prize * 0.15)));

  const wName = User.getByWhatsappId(winner)?.name || '???';
  const mentions = [winner, runnerUp].filter(Boolean);
  sendText(current.sock, current.chatJid,
    `🏆 *TOURNAMENT CHAMPION: ${wName}!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💲 Prize: *${current.prize}* Metaworks\n` +
    `🎮 Category: ${TOURNAMENT.CATEGORIES[current.category]?.label || current.category}\n` +
    `🥈 Runner-up: ${User.getByWhatsappId(runnerUp)?.name || '—'}\n━━━━━━━━━━━━━━━━━━━━━━━`,
    null, mentions);

  current = null;
}

function summary() {
  if (!current) return null;
  return current;
}

module.exports = {
  isActive, cancel, create, addPlayer, start, resolveByResult, findMatch,
  allMatches, summary, teamStrength, eff,
};
