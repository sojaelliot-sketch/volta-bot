// game-engine/tournament.js
// Single-elimination bracket tournament with smart bracket detection.
// - 2 players → straight to Grand Final (no 3rd place)
// - 3 players → Semifinal (1 BYE) + Grand Final + 3rd Place
// - 4+ players → Full bracket + Grand Final + 3rd Place
// Auto-detects when 2 players remain and labels it as THE FINAL.
const User = require('../models/User');
const db = require('../config/database');
const { TOURNAMENT, MATCH } = require('../config/constants');
const { sendText } = require('../utils/messaging');
const { pick } = require('../utils/random');

function persist() {
  try {
    if (current) db.update('tournaments', 'live', current);
    else db.remove('tournaments', 'live');
  } catch {}
}

let current = null;

function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function nameOf(x) {
  if (!x || x === 'BYE') return 'BYE';
  if (typeof x === 'object') return nameOf(x.winner) || 'TBD';
  return User.getByWhatsappId(x)?.name || x.split('@')[0];
}

function eff(x) {
  if (x && typeof x === 'object') return x.winner;
  return x;
}

function teamStrength(jid) {
  if (!jid || jid === 'BYE') return 0;
  const u = User.getByWhatsappId(jid);
  if (!u) return 0;
  return (u.mmr || 1000) + (u.currency || 0) / 50;
}

function simulateWinner(a, b) {
  const sa = teamStrength(a), sb = teamStrength(b);
  const total = sa + sb || 1;
  return Math.random() < (sa / total) ? a : b;
}

// ─── Bracket builder ──────────────────────────────────────────────────────
// Returns { rounds, thirdPlaceMatch? }
// rounds[0] = first round, rounds[last] = Grand Final
function buildBracket(players) {
  const n = players.length;
  const rounds = [];
  let thirdPlaceMatch = null;

  if (n === 2) {
    // Straight to Grand Final
    rounds.push([makeMatch(players[0], players[1], 1, '🏆 GRAND FINAL')]);
    return { rounds, thirdPlaceMatch };
  }

  if (n === 3) {
    // 1 BYE → Semifinal (2 matches: BYE auto-wins, 1 real match) → Grand Final + 3rd Place
    const byeIdx = Math.floor(Math.random() * n);
    const byePlayer = players[byeIdx];
    const remaining = players.filter((_, i) => i !== byeIdx);
    grantBye(byePlayer);

    const semiRound = [
      makeMatch(byePlayer, 'BYE', 1, '⚔️ SEMIFINAL'),
      makeMatch(remaining[0], remaining[1], 1, '⚔️ SEMIFINAL'),
    ];
    // BYE match auto-resolves
    semiRound[0].winner = byePlayer;
    semiRound[0].simulated = true;
    rounds.push(semiRound);

    // Grand Final placeholder (resolved after semis)
    rounds.push([makeMatch(null, null, 2, '🏆 GRAND FINAL')]);

    // 3rd place match placeholder
    thirdPlaceMatch = makeMatch(null, null, 1, '🥉 3RD PLACE MATCH');
    return { rounds, thirdPlaceMatch };
  }

  // 4+ players → standard bracket
  // Find nearest power of 2 >= n
  let bracketSize = 2;
  while (bracketSize < n) bracketSize *= 2;

  let cur = players.slice();
  // Pad with BYEs to fill bracket
  while (cur.length < bracketSize) {
    const byeIdx = Math.floor(Math.random() * (cur.length + 1));
    const byeTarget = cur.length > 0 ? cur[0] : null;
    if (byeTarget) grantBye(byeTarget);
    cur.splice(byeIdx, 0, 'BYE');
  }

  cur = shuffle(cur);

  // Build rounds up to semifinal
  while (cur.length > 2) {
    const r = [];
    for (let i = 0; i < cur.length; i += 2) {
      const a = cur[i], b = cur[i + 1];
      const roundNum = rounds.length + 1;
      const label = roundLabel(roundNum, cur.length);
      const m = makeMatch(a, b, roundNum, label);
      if (a === 'BYE') { m.winner = b; m.simulated = true; }
      else if (b === 'BYE') { m.winner = a; m.simulated = true; }
      else m.dueAt = Date.now() + current.matchWindowMs;
      r.push(m);
    }
    rounds.push(r);
    cur = r.slice();
  }

  // Semifinal round (2 matches → produces 2 finalists + 2 losers)
  const semiRound = [];
  for (let i = 0; i < cur.length; i += 2) {
    const a = cur[i], b = cur[i + 1];
    const m = makeMatch(a, b, rounds.length + 1, '⚔️ SEMIFINAL');
    if (a === 'BYE') { m.winner = b; m.simulated = true; }
    else if (b === 'BYE') { m.winner = a; m.simulated = true; }
    else m.dueAt = Date.now() + current.matchWindowMs;
    semiRound.push(m);
  }
  rounds.push(semiRound);

  // Grand Final
  rounds.push([makeMatch(null, null, rounds.length + 1, '🏆 GRAND FINAL')]);

  // 3rd Place Match (semifinal losers)
  thirdPlaceMatch = makeMatch(null, null, 1, '🥉 3RD PLACE MATCH');

  return { rounds, thirdPlaceMatch };
}

function makeMatch(a, b, roundNum, label) {
  return { a, b, winner: null, dueAt: null, simulated: false, round: roundNum, label: label || '' };
}

function grantBye(jid) {
  if (!jid || jid === 'BYE') return;
  const u = User.getByWhatsappId(jid);
  if (u) User.update(jid, { currency: (u.currency || 0) + TOURNAMENT.CONSOLATION_REWARD });
  sendText(current.sock, current.chatJid,
    `🍀 *${nameOf(jid)}* drew a BYE — free pass + *${TOURNAMENT.CONSOLATION_REWARD}* MW!`);
}

// ─── Match order announcement ─────────────────────────────────────────────
function announceMatchOrder() {
  if (!current) return;
  const pending = getPendingMatches();
  if (pending.length === 0) return;

  let out = `📋 *MATCH ORDER*\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
  pending.forEach((m, i) => {
    const label = m.label || `Match ${i + 1}`;
    const aName = nameOf(eff(m.a) || m.a);
    const bName = nameOf(eff(m.b) || m.b);
    out += `*${i + 1}. ${label}*\n   ${aName}  vs  ${bName}\n`;
  });
  out += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  out += `⏰ Each match has ${current.matchWindowMs / 60000} min to be played.\n`;
  out += `💡 Use *!tchallenge* to start a real PvP match, or *!tourneyplay* to simulate.`;
  sendText(current.sock, current.chatJid, out);
}

function getPendingMatches() {
  if (!current || !current.rounds) return [];
  const all = current.rounds.flat();
  const pending = all.filter(m => !m.winner && !m.simulated && eff(m.a) && eff(m.b));
  // Also include the 3rd place match if it has both players resolved
  if (current.thirdPlaceMatch && !current.thirdPlaceMatch.winner) {
    const tpm = current.thirdPlaceMatch;
    if (eff(tpm.a) && eff(tpm.b) && !pending.includes(tpm)) {
      pending.push(tpm);
    }
  }
  return pending;
}

// ─── Core API ─────────────────────────────────────────────────────────────
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
    thirdPlaceMatch: null,
    startedAt: null,
    endsAt: null,
    bets: {},
    playerCount: 0,
    matchWindowMs: opts.matchWindowMs || TOURNAMENT.MATCH_WINDOW_MS,
  };
  persist();
  return current;
}

function addPlayer(jid) {
  if (!current) return false;
  if (current.rounds) return false;
  if (current.players.includes(jid)) return false;
  if (current.players.length >= TOURNAMENT.MAX_PLAYERS) return false;
  current.players.push(jid);
  persist();
  return true;
}

function start() {
  if (!current || current.rounds) return;
  if (current.players.length < 2) return false;

  current.playerCount = current.players.length;
  const { rounds, thirdPlaceMatch } = buildBracket(current.players);
  current.rounds = rounds;
  current.thirdPlaceMatch = thirdPlaceMatch;
  current.startedAt = Date.now();
  persist();

  // Arm auto-sim timers
  for (const round of current.rounds) {
    for (const m of round) {
      if (m.simulated || m.winner) continue;
      setTimeout(() => autoSim(m), current.matchWindowMs + 1000).unref();
    }
  }
  if (current.thirdPlaceMatch && !current.thirdPlaceMatch.winner) {
    setTimeout(() => autoSim(current.thirdPlaceMatch), current.matchWindowMs + 1000).unref();
  }

  return true;
}

function allMatches() {
  if (!current || !current.rounds) return [];
  const matches = current.rounds.flat();
  if (current.thirdPlaceMatch) matches.push(current.thirdPlaceMatch);
  return matches;
}

function findMatch(a, b) {
  for (const m of allMatches()) {
    if (m.winner || m.simulated) continue;
    const ea = eff(m.a), eb = eff(m.b);
    if (!ea || !eb) continue;
    if ((ea === a && eb === b) || (ea === b && eb === a)) return m;
  }
  return null;
}

function pendingMatchFor(jid) {
  for (const m of allMatches()) {
    if (m.winner || m.simulated) continue;
    const ea = eff(m.a), eb = eff(m.b);
    if (ea === jid || eb === jid) return m;
  }
  return null;
}

function startTChallenge(jid) {
  const m = pendingMatchFor(jid);
  if (!m) return null;
  const opp = eff(m.a) === jid ? eff(m.b) : eff(m.a);
  return opp && opp !== 'BYE' ? opp : null;
}

function resolveByResult(a, b, winnerId) {
  if (!current || !current.rounds) return false;
  const m = findMatch(a, b);
  if (!m) return false;
  return recordWinner(m, winnerId);
}

function recordWinner(m, winnerId) {
  m.winner = winnerId;
  m.simulated = false;

  // Check if this was a semifinal → set up 3rd place match
  if (isSemifinalMatch(m) && current.thirdPlaceMatch) {
    setupThirdPlace();
  }

  // Check if this was the Grand Final
  if (isGrandFinal(m)) {
    announceFinalWinner(m.winner);
  }

  // Check if 2 players remain in the bracket → auto-label as FINAL
  checkFinalsDetection();

  // After any match resolves, announce remaining match order
  announceMatchOrder();

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

  if (isSemifinalMatch(m) && current.thirdPlaceMatch) {
    setupThirdPlace();
  }
  if (isGrandFinal(m)) {
    announceFinalWinner(m.winner);
  }
  checkFinalsDetection();
  announceMatchOrder();
  checkComplete();
  persist();
}

// ─── Smart detection ──────────────────────────────────────────────────────
function isSemifinalMatch(m) {
  return m.label && m.label.includes('SEMIFINAL');
}

function isGrandFinal(m) {
  return m.label && m.label.includes('GRAND FINAL');
}

function setupThirdPlace() {
  if (!current || !current.thirdPlaceMatch) return;
  const tpm = current.thirdPlaceMatch;
  if (tpm.a && tpm.b) return; // already set up

  // Get semifinal losers
  const semiRound = current.rounds.length >= 2
    ? current.rounds[current.rounds.length - 2]
    : current.rounds[current.rounds.length - 1];

  const losers = [];
  for (const m of semiRound) {
    if (!m.winner) continue;
    const loser = eff(m.a) === m.winner ? eff(m.b) : eff(m.a);
    if (loser && loser !== 'BYE') losers.push(loser);
  }

  if (losers.length >= 2) {
    tpm.a = losers[0];
    tpm.b = losers[1];
    tpm.dueAt = Date.now() + current.matchWindowMs;
    setTimeout(() => autoSim(tpm), current.matchWindowMs + 1000).unref();

    sendText(current.sock, current.chatJid,
      `🥉 *3RD PLACE MATCH*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `⚔️ *${nameOf(losers[0])}*  vs  *${nameOf(losers[1])}*\n` +
      `⏰ You have ${current.matchWindowMs / 60000} min to play.\n` +
      `💡 Use *!tchallenge* or *!tourneyplay*.\n━━━━━━━━━━━━━━━━━━━━━━━`);
  }
}

function checkFinalsDetection() {
  if (!current || !current.rounds) return;
  // Count unresolved non-final matches
  const allRounds = current.rounds;
  const finalRound = allRounds[allRounds.length - 1];
  const earlierRounds = allRounds.slice(0, -1);
  const unresolvedEarlier = earlierRounds.flat().filter(m => !m.winner);

  // If all earlier rounds are resolved and only the final remains, announce it
  if (unresolvedEarlier.length === 0 && finalRound.length === 1 && !finalRound[0].winner) {
    const fm = finalRound[0];
    if (!fm.announcedFinal) {
      fm.announcedFinal = true;
      const aName = nameOf(eff(fm.a) || fm.a);
      const bName = nameOf(eff(fm.b) || fm.b);
      sendText(current.sock, current.chatJid,
        `🏆 *THIS IS THE FINAL!* 🔥\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `⚔️ *${aName}*  vs  *${bName}*\n` +
        `🏆 Winner takes *${current.prize}* Metaworks!\n` +
        `🥈 Runner-up gets *${Math.round(current.prize * 0.25)}* Metaworks!\n` +
        `⏰ ${current.matchWindowMs / 60000} min to play — *!tchallenge* or *!tourneyplay*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━`);
    }
  }
}

// ─── Announce final winner ────────────────────────────────────────────────
function announceFinalWinner(winnerJid) {
  if (!current) return;
  const final = current.rounds[current.rounds.length - 1][0];
  const runnerUp = (eff(final.a) === winnerJid) ? eff(final.b) : eff(final.a);

  // Prize payouts
  const firstPrize = current.prize;
  const secondPrize = Math.round(current.prize * 0.25);

  payUser(winnerJid, firstPrize);
  if (runnerUp && runnerUp !== 'BYE') payUser(runnerUp, secondPrize);

  // Settle bets
  settleBets(winnerJid);

  // Track tournament win
  const wu = User.getByWhatsappId(winnerJid);
  if (wu) User.update(winnerJid, { tournamentWins: (wu.tournamentWins || 0) + 1 });

  // Build announcement
  const wName = User.getByWhatsappId(winnerJid)?.name || '???';
  const ruName = runnerUp && runnerUp !== 'BYE' ? (User.getByWhatsappId(runnerUp)?.name || '???') : '—';
  const mentions = [winnerJid, runnerUp].filter(j => j && j !== 'BYE');

  sendText(current.sock, current.chatJid,
    `🏆 *TOURNAMENT CHAMPION: ${wName}!* 🏆\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🥇 *Winner:* ${wName}\n` +
    `💰 *Prize:* +${firstPrize} Metaworks\n\n` +
    `🥈 *Runner-up:* ${ruName}\n` +
    `💰 *Prize:* +${secondPrize} Metaworks\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🎮 Category: ${TOURNAMENT.CATEGORIES[current.category]?.label || current.category}\n` +
    `👥 Players: ${current.playerCount}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━`,
    null, mentions);
}

function payUser(jid, amt) {
  if (!jid || jid === 'BYE') return;
  const u = User.getByWhatsappId(jid);
  if (u) User.update(jid, { currency: (u.currency || 0) + amt });
}

// ─── Check complete ───────────────────────────────────────────────────────
function checkComplete() {
  if (!current || !current.rounds) return;
  const final = current.rounds[current.rounds.length - 1][0];
  if (!final.winner) return;

  // Also check 3rd place match
  let thirdWinner = null;
  if (current.thirdPlaceMatch && current.thirdPlaceMatch.winner) {
    thirdWinner = current.thirdPlaceMatch.winner;
    const thirdName = User.getByWhatsappId(thirdWinner)?.name || '???';
    const thirdPrize = Math.round(current.prize * 0.10);
    payUser(thirdWinner, thirdPrize);
    sendText(current.sock, current.chatJid,
      `🥉 *3RD PLACE: ${thirdName}!*\n💰 *Prize:* +${thirdPrize} Metaworks`);
  }

  current = null;
  persist();
}

// ─── Betting ──────────────────────────────────────────────────────────────
function bettingOpen() {
  return !!current && !current.rounds;
}

function getBet(bettorJid) {
  if (!current || !current.bets) return null;
  return current.bets[bettorJid] || null;
}

function placeBet(bettorJid, pickJid, stake) {
  if (!current) return { ok: false, error: 'no_tournament' };
  if (!bettingOpen()) return { ok: false, error: 'closed' };
  if (!current.players.includes(pickJid)) return { ok: false, error: 'not_a_player' };
  if (current.bets && current.bets[bettorJid]) return { ok: false, error: 'already_bet' };
  const s = Math.round(stake);
  if (!Number.isFinite(s) || s < 50 || s > 5000) return { ok: false, error: 'bad_stake' };
  const u = User.getByWhatsappId(bettorJid);
  if (!u) return { ok: false, error: 'no_user' };
  if ((u.currency || 0) < s) return { ok: false, error: 'poor' };
  User.update(bettorJid, { currency: (u.currency || 0) - s });
  if (!current.bets) current.bets = {};
  current.bets[bettorJid] = { pick: pickJid, stake: s };
  persist();
  return { ok: true, bet: current.bets[bettorJid] };
}

function settleBets(championJid) {
  if (!current || !current.bets) return;
  for (const [bettor, bet] of Object.entries(current.bets)) {
    if (bet.pick === championJid) {
      const payout = Math.round(bet.stake * 2);
      const bu = User.getByWhatsappId(bettor);
      if (bu) User.update(bettor, { currency: (bu.currency || 0) + payout });
      try {
        sendText(current.sock, bettor,
          `🎯 *Your tournament bet HIT!*\nYou backed *${nameOf(championJid)}* and won *${payout}* MW! 💰`);
      } catch {}
    } else {
      try {
        sendText(current.sock, bettor,
          `💔 *Your tournament bet missed.*\n*${nameOf(championJid)}* won. Stake of *${bet.stake}* MW forfeited.`);
      } catch {}
    }
  }
}

function summary() {
  if (!current) return null;
  return current;
}

module.exports = {
  isActive, cancel, create, addPlayer, start, resolveByResult, findMatch,
  allMatches, summary, teamStrength, eff, pendingMatchFor, startTChallenge,
  bettingOpen, getBet, placeBet, nameOf, announceMatchOrder, getPendingMatches,
};
