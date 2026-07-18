// game-engine/tournament.js
// Single-elimination bracket tournament with categories (classic / penalty).
// Players are auto-paired; each tie has a deadline — if the players don't
// resolve it (by playing a real PvP / penalty match, or via !tourneyplay),
// it is auto-simulated from team strength when the deadline passes.
//
// Odd brackets: if the number of players is odd, one player draws a BYE in the
// first round (a free pass to the next round) and receives a small consolation
// reward for the walkover.
const User = require('../models/User');
const db = require('../config/database');
const { TOURNAMENT, MATCH, TBET } = require('../config/constants');
const { sendText } = require('../utils/messaging');
const { pick } = require('../utils/random');

// Persist the live bracket to the `tournaments` table so the WEB app (which
// runs as a separate process) can render the bracket view (TBV) without
// sharing in-memory state. Bot is the only writer; web only reads.
function persist() {
  try {
    if (current) db.update('tournaments', 'live', current);
    else db.remove('tournaments', 'live');
  } catch {}
}

let current = null; // { category, prize, host, chatJid, sock, players, rounds, startedAt, endsAt }

function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

// ─── round labels for common bracket sizes ─────────────────────────────────
function roundLabelForSize(size) {
  switch (size) {
    case 2:  return 'Final';
    case 4:  return 'Semi-finals';
    case 8:  return 'Quarter-finals';
    case 16: return 'Round of 16';
    default: return '';
  }
}

function nameOf(x) {
  if (!x || x === 'BYE') return 'BYE';
  if (typeof x === 'object') return nameOf(x.winner) || 'TBD';
  return User.getByWhatsappId(x)?.name || x.split('@')[0];
}

// a match participant is either a player jid, 'BYE', or a match object
// (whose winner becomes the participant once decided).
function eff(x) {
  if (x && typeof x === 'object') return x.winner;
  return x;
}

function buildRounds(players) {
  let cur = shuffle(players);
  const rounds = [];

  // Odd number of players → one draws a BYE (free pass + consolation reward).
  const odd = cur.length % 2 !== 0;
  if (odd) {
    const byeIdx = Math.floor(Math.random() * cur.length);
    const byePlayer = cur.splice(byeIdx, 1)[0];
    const u = User.getByWhatsappId(byePlayer);
    if (u) User.update(byePlayer, { currency: (u.currency || 0) + TOURNAMENT.CONSOLATION_REWARD });
    cur.push('BYE');
    sendText(current.sock, current.chatJid,
      `🎟️ *${nameOf(byePlayer)}* drew a BYE this round — free pass to the next round + *${TOURNAMENT.CONSOLATION_REWARD}* Metaworks! 🍀`);
  }

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

function cancel() { current = null; persist(); }

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
    bets: {},
  };
  persist();
  return current;
}

function addPlayer(jid) {
  if (!current) return false;
  if (current.rounds) return false; // already started
  if (current.players.includes(jid)) return false;
  if (current.players.length >= TOURNAMENT.MAX_PLAYERS) return false;
  current.players.push(jid);
  persist();
  return true;
}

// ─── TOURNAMENT WINNER BETTING (!tbet) ──────────────────────────────────────
// Bets are held on the live tournament object (persisted) and settled when the
// champion is decided. A manager may place ONE bet per tournament. Bets can be
// placed until the tournament STARTS (bracket is built).
function bettingOpen() {
  return !!current && !current.rounds; // open until bracket is built
}

function getBet(bettorJid) {
  if (!current || !current.bets) return null;
  return current.bets[bettorJid] || null;
}

// Place a bet. Returns { ok, error?, bet? }. Stake is deducted immediately.
function placeBet(bettorJid, pickJid, stake) {
  if (!current) return { ok: false, error: 'no_tournament' };
  if (!bettingOpen()) return { ok: false, error: 'closed' };
  if (!current.players.includes(pickJid)) return { ok: false, error: 'not_a_player' };
  if (current.bets && current.bets[bettorJid]) return { ok: false, error: 'already_bet' };
  const s = Math.round(stake);
  if (!Number.isFinite(s) || s < TBET.MIN_STAKE || s > TBET.MAX_STAKE) return { ok: false, error: 'bad_stake' };
  const u = User.getByWhatsappId(bettorJid);
  if (!u) return { ok: false, error: 'no_user' };
  if ((u.currency || 0) < s) return { ok: false, error: 'poor' };
  User.update(bettorJid, { currency: (u.currency || 0) - s });
  if (!current.bets) current.bets = {};
  current.bets[bettorJid] = { pick: pickJid, stake: s };
  persist();
  return { ok: true, bet: current.bets[bettorJid] };
}

// Pay out all winning bets for the given champion. Called from checkComplete.
function settleBets(championJid) {
  if (!current || !current.bets) return;
  for (const [bettor, bet] of Object.entries(current.bets)) {
    if (bet.pick !== championJid) continue;
    const payout = Math.round(bet.stake * TBET.PAYOUT_MULT);
    const bu = User.getByWhatsappId(bettor);
    if (bu) User.update(bettor, { currency: (bu.currency || 0) + payout });
    try {
      sendText(current.sock, bettor,
        `🎯 *Your tournament bet HIT!*\nYou backed *${nameOf(championJid)}* and won *${payout}* Metaworks! 💰`);
    } catch {}
  }
}

function start() {
  if (!current || current.rounds) return;
  if (current.players.length < 2) return false;
  current.rounds = buildRounds(current.players);
  current.startedAt = Date.now();
  persist();
  // arm auto-sim timers for every real match
  for (const round of current.rounds) {
    for (const m of round) {
      if (m.simulated || m.winner) continue;
      setTimeout(() => autoSim(m), TOURNAMENT.MATCH_WINDOW_MS + 1000).unref();
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

// Return the pending match (if any) for a single player.
function pendingMatchFor(jid) {
  for (const m of allMatches()) {
    if (m.winner || m.simulated) continue;
    const ea = eff(m.a), eb = eff(m.b);
    if (ea === jid || eb === jid) return m;
  }
  return null;
}

// Find the opponent a player should face for their next tie, then return the
// opponent jid so the caller can start a real PvP match. Returns null if the
// player has no pending tie.
function startTChallenge(jid) {
  const m = pendingMatchFor(jid);
  if (!m) return null;
  const opp = eff(m.a) === jid ? eff(m.b) : eff(m.a);
  return opp && opp !== 'BYE' ? opp : null;
}

// Called when a real match between a and b finishes with winnerId.
function resolveByResult(a, b, winnerId) {
  if (!current || !current.rounds) return false;
  const m = findMatch(a, b);
  if (!m) return false;
  return recordWinner(m, winnerId);
}

function recordWinner(m, winnerId) {
  m.winner = winnerId;
  m.simulated = false;
  checkComplete();
  persist();
  return true;
}

function autoSim(m) {
  if (!current || m.winner) return;
  const a = eff(m.a), b = eff(m.b);
  if (!a || !b) return;
  m.winner = simulateWinner(a, b);
  m.simulated = true;
  checkComplete();
  persist();
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

  // settle any winner bets before we tear the tournament down
  settleBets(winner);

  // track tournament wins
  const wu = User.getByWhatsappId(winner);
  if (wu) User.update(winner, { tournamentWins: (wu.tournamentWins || 0) + 1 });

  const wName = User.getByWhatsappId(winner)?.name || '???';
  const mentions = [winner, runnerUp].filter(Boolean);
  sendText(current.sock, current.chatJid,
    `🏆 *TOURNAMENT CHAMPION: ${wName}!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💲 Prize: *${current.prize}* Metaworks\n` +
    `🎮 Category: ${TOURNAMENT.CATEGORIES[current.category]?.label || current.category}\n` +
    `🥈 Runner-up: ${User.getByWhatsappId(runnerUp)?.name || '—'}\n━━━━━━━━━━━━━━━━━━━━━━━`,
    null, mentions);

  current = null;
  persist();
}

function summary() {
  if (!current) return null;
  return current;
}

module.exports = {
  isActive, cancel, create, addPlayer, start, resolveByResult, findMatch,
  allMatches, summary, teamStrength, eff, pendingMatchFor, startTChallenge,
  roundLabelForSize, bettingOpen, getBet, placeBet, nameOf,
};
