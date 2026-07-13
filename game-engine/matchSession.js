const { v4: uuid } = require('uuid');
const User    = require('../models/User');
const Player  = require('../models/Player');
const engine  = require('./matchEngine');
const comm    = require('./commentary');
const ai      = require('../ai/aiOpponent');
const tourney = require('./tournament');
const situ    = require('./situations');
const { MATCH, ECONOMY, MMR, BRAND, INJURY } = require('../config/constants');
const { pick, clamp, randInt } = require('../utils/random');
const { sleep, sendText } = require('../utils/messaging');
const logger  = require('../utils/logger');
const db      = require('../config/database');

// Generic "the keeper catches it cleanly" lines (used for the catch save variant).
const CATCH_LINES = [
  '🧤 *CLAIMED!* The keeper gathers it into his gloves — no rebound!',
  '🤲 *CATCH!* Clean claiming from the keeper — attack smothered!',
  '🧤 Keeper plucks it out the air and holds on tight!',
];

// Generic "the defender nicks it during the buildup" lines (possession lost mid-buildup).
const INTERCEPT_LINES = [
  '🪤 *INTERCEPTED!* A defender reads it and nicks the ball away before the chance even develops! 🔄',
  '⚡ *TURNED OVER!* The opponent steps in and wins possession during the buildup! 🛡️',
  '🧱 *SNUFFED OUT!* The defender sticks out a leg and steals it — attack dead!',
  '🔄 *PICKED OFF!* A perfectly timed tackle kills the move before it starts!',
];

const activeSessions = new Map();
const lockedChats = new Map();   // chatJid -> { matchId, participants: [id,id] }

// Interactive PvP chance sessions (keyed by matchId)
const pvpChances = new Map();

function isChatLocked(chatJid, sender) {
  const lock = lockedChats.get(chatJid);
  if (!lock) return false;
  return !lock.participants.includes(sender);
}

function getActivePvPForUser(sender) {
  for (const [, s] of activeSessions) {
    if (s.isPvP && (s.homeId === sender || s.awayId === sender)) return s;
  }
  return null;
}

function squadStrength(squad) {
  return squad.reduce((sum, p) => {
    const s = p.stats || {};
    return sum + (p.role === 'goalkeeper'
      ? (s.reflex + s.positioning + s.anticipation + s.composure || 240)
      : (s.pace + s.skill + s.shooting + s.stamina + s.composure || 300));
  }, 0);
}

// Small random chance a player picks up an injury during a match. Returns the
// injury info (hours + ISO until) or null. Sets injuredUntil on the player.
function rollInjury(player) {
  if (!player || player.injuredUntil) return null;
  const hours = randInt(INJURY.MIN_HOURS, INJURY.MAX_HOURS);
  const until = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  Player.update(player.id, { injuredUntil: until });
  return { until, hours };
}

// Build the 3 outfield + 1 keeper match squad for a user.
function assembleMatchSquad(user) {
  const outfield = user.startingXI
    .map(id => Player.getById(id))
    .filter(p => p && p.role === 'outfield');

  if (outfield.length < MATCH.OUTFIELD_PER_SIDE) {
    return { error: `You need *${MATCH.OUTFIELD_PER_SIDE} outfield* players in your Starting XI. Use *!swap [id] xi*.` };
  }

  const keeper =
    user.startingXI.map(id => Player.getById(id)).find(p => p && p.role === 'goalkeeper') ||
    user.bench.map(id => Player.getById(id)).find(p => p && p.role === 'goalkeeper') ||
    user.reserves.map(id => Player.getById(id)).find(p => p && p.role === 'goalkeeper');

  if (!keeper) {
    return { error: `You need a *goalkeeper*! Open a pack or grab one from the market. 🧤` };
  }

  const squad = [
    ...outfield.slice(0, MATCH.OUTFIELD_PER_SIDE).map(p => ({ ...p, fielded: true })),
    { ...keeper, fielded: true },
  ];

  const injured = squad.filter(p => p.injuredUntil && new Date(p.injuredUntil).getTime() > Date.now());
  if (injured.length) {
    const names = injured.map(p => Player.displayName(p)).join(', ');
    return { error: `🚑 These players are injured: ${names}.\nHeal them with *!surgery [id]* or *!swap* in a fit player, then try again.` };
  }

  return { squad };
}

function decidePossession(session) {
  const total = session._homeStr + session._awayStr || 1;
  const base  = session._homeStr / total;
  const homeProb = 0.5 + (base - 0.5) * 0.6 + (session.homeMomentum - 50) * 0.004;
  return Math.random() < Math.max(0.15, Math.min(0.85, homeProb)) ? 'home' : 'away';
}

function findOwnedByShortId(ownerId, short) {
  // Only consider the manager's ACTIVE squad — never leak a player from a
  // different saved squad into a live match.
  const owned = Player.getSquadPlayers(ownerId);
  return owned.find(p => p.id.startsWith(short)) || null;
}

// Apply a substitution during a paused PvP segment.
function applySub(session, sender, args) {
  if (!session || session.phase !== 'paused') {
    return { ok: false, msg: '⏸️ Subs only count during the pause window!' };
  }
  const side = session.homeId === sender ? 'home' : 'away';
  const user = User.getByWhatsappId(sender);
  if (!user) return { ok: false, msg: '❌ Who are you?' };

  const outArg = args[0];
  const inArg  = args[1];
  if (!outArg) return { ok: false, msg: '⚠️ Usage: *!sub [outId] [inId]*' };

  const inPlayer = findOwnedByShortId(sender, inArg);
  if (!inPlayer) return { ok: false, msg: '❌ That player isn\'t yours.' };

  const isFielded = (id) => session[`${side}Squad`].some(p => p.id === id);
  if (isFielded(inPlayer.id)) return { ok: false, msg: 'ℹ️ That player is already on the pitch.' };

  let outPlayer;
  if (outArg) {
    outPlayer = findOwnedByShortId(sender, outArg);
    if (!outPlayer) return { ok: false, msg: '❌ Out-player not found.' };
    if (!isFielded(outPlayer.id)) return { ok: false, msg: 'ℹ️ That out-player isn\'t on the pitch.' };
  } else {
    const fielded = session[`${side}Squad`].filter(p => p.role === 'outfield');
    fielded.sort((a, b) => Player.totalStats(a) - Player.totalStats(b));
    outPlayer = fielded[0];
  }

  if (outPlayer.role !== inPlayer.role) {
    return { ok: false, msg: `⚠️ Sub must be the same role (you\'re swapping a *${outPlayer.role}*).` };
  }

  session[`${side}Squad`] = session[`${side}Squad`].map(p =>
    p.id === outPlayer.id ? { ...inPlayer, fielded: true } : p);

  const lists = {
    startingXI: user.startingXI.slice(),
    bench: user.bench.slice(),
    reserves: user.reserves.slice(),
  };
  for (const k of ['startingXI', 'bench', 'reserves']) {
    lists[k] = lists[k].filter(id => id !== inPlayer.id && id !== outPlayer.id);
  }
  lists.startingXI.push(inPlayer.id);
  lists.bench.push(outPlayer.id);
  User.update(sender, lists);

  if (side === 'home') session._homeStr = squadStrength(session.homeSquad);
  else session._awayStr = squadStrength(session.awaySquad);

  return { ok: true, msg: `✅ Subbed *${Player.displayName(inPlayer)}* in for *${Player.displayName(outPlayer)}*! 🔥` };
}

async function startMatch(sock, homeId, awayId = 'AI', options = {}) {
  const { aiDifficulty = 'Medium', chatJid = homeId, isPvP = false } = options;
  const isAI = awayId === 'AI' && !isPvP;

  const homeUser = User.getByWhatsappId(homeId);
  if (!homeUser || !homeUser.registered) {
    await sendText(sock, chatJid, '❌ Register first! Type *!start*.');
    return;
  }

  const homeBuilt = assembleMatchSquad(homeUser);
  if (homeBuilt.error) {
    await sendText(sock, chatJid, homeBuilt.error);
    return;
  }
  if (homeUser.inMatch) {
    await sendText(sock, chatJid, '❌ You\'re already in a match!');
    return;
  }

  const matchId = uuid();
  let awaySquad, awayName;

  if (isAI) {
    awaySquad = ai.generateAISquad(aiDifficulty);
    awayName  = ai.randomClub();
  } else {
    const awayUser = User.getByWhatsappId(awayId);
    if (!awayUser || !awayUser.registered) {
      await sendText(sock, chatJid, '❌ Opponent isn\'t registered!');
      return;
    }
    const awayBuilt = assembleMatchSquad(awayUser);
    if (awayBuilt.error) {
      await sendText(sock, chatJid, `❌ ${awayUser.name}: ${awayBuilt.error}`);
      return;
    }
    if (awayUser.inMatch) {
      await sendText(sock, chatJid, '❌ Opponent is already in a match!');
      return;
    }
    awaySquad = awayBuilt.squad;
    awayName  = awayUser.name;
    User.update(awayId, { inMatch: true, currentMatchId: matchId });
    await sendText(sock, awayId, `⚔️ *${homeUser.name}* just challenged you! Match is LIVE — sit tight for the result. 🔥`);
  }

  const homeName = homeUser.name;

  const session = {
    matchId, sock, chatJid,
    homeId, awayId, isAI, isPvP, aiDifficulty,
    homeName, awayName,
    homeSquad: homeBuilt.squad.map(p => ({ ...p })),
    awaySquad: awaySquad.map(p => ({ ...p })),
    homeScore: 0, awayScore: 0,
    timeElapsed: 0,
    homeMomentum: 50, awayMomentum: 50,
    _homeStr: squadStrength(homeBuilt.squad),
    _awayStr: squadStrength(awaySquad),
    goalScorers: [],
    phase: 'running',
    lastMsg: options.msg || null,
  };

  if (isPvP) {
    // Interactive PvP: a series of chances the two managers react to live.
    session.phase = 'idle';
    session.chanceNo = 0;
    session.totalChances = MATCH.PVP_CHANCES;
    session.timer = null;
    session.goalScorers = [];
    session.scorerStats = {};   // id -> { goals, shots, name, team }
    pvpChances.set(matchId, session);
    User.update(homeId, { inMatch: true, currentMatchId: matchId });
    User.update(awayId, { inMatch: true, currentMatchId: matchId });
    lockedChats.set(chatJid, { matchId, participants: [homeId, awayId] });

    await sendText(sock, awayId,
      `🥊 *MATCH ON!* vs *${homeName}*\nWhen it's *your* turn you'll get a chance with options like *!a / !b / !c*. React fast — 90s or you forfeit! 🔥`);

    nextChance(session);
    return session;
  }

  activeSessions.set(matchId, session);
  User.update(homeId, { inMatch: true, currentMatchId: matchId });

  // Private match (e.g. !match): lock the chat to just the manager so nobody
  // else in a group can fire commands while it runs.
  if (options.private) {
    lockedChats.set(chatJid, { matchId, participants: [homeId] });
  }

  try {
    await sock.sendPresenceUpdate('composing', chatJid);
    await sleep(1200);

    const { lines, scorers } = simulateChunk(session, 14 + Math.floor(Math.random() * 9));
    session.goalScorers = scorers;
    await sendText(sock, chatJid, comm.buildMatchReport({
      homeName, awayName,
      homeScore: session.homeScore, awayScore: session.awayScore,
      lines, scorers, brand: BRAND,
    }));
    await sleep(800);
    await endMatch(session);
  } catch (err) {
    logger.error({ err, matchId }, 'Match crashed');
    try { await sendText(sock, chatJid, '⚠️ Match ended early due to an error. Sorry!'); } catch {}
  } finally {
    User.update(homeId, { inMatch: false, currentMatchId: null });
    lockedChats.delete(chatJid);
    activeSessions.delete(matchId);
  }

  return session;
}

async function runPvP(session) {
  const { sock, chatJid, homeName, awayName } = session;
  const segments = MATCH.PVP_SEGMENTS;
  const totalLines = [`🏟️ *Kick-off!* ${homeName} vs ${awayName} — tension THROUGH THE ROOF. Let's ball. 🔥`];
  const allScorers = [];

  for (let seg = 0; seg < segments; seg++) {
    const { lines, scorers } = simulateChunk(session, 5 + Math.floor(Math.random() * 4));
    totalLines.push(...lines);
    allScorers.push(...scorers);
    session.goalScorers = allScorers;

    if (seg < segments - 1) {
      session.phase = 'paused';
      await sendText(sock, chatJid,
        `⏸️ *Segment ${seg + 1} done* — ${homeName} ${session.homeScore}–${session.awayScore} ${awayName}\n` +
        `🔁 Managers, *!sub [outId] [inId]* now (15s) ⚡`);
      await sleep(MATCH.SUB_WINDOW_MS);
      session.phase = 'running';
      totalLines.push(`\n🔥 *Segment ${seg + 2} kicks off!* No let-up!`);
    }
  }

  await sendText(sock, chatJid, comm.buildMatchReport({
    homeName, awayName,
    homeScore: session.homeScore, awayScore: session.awayScore,
    lines: totalLines, scorers: allScorers, brand: BRAND,
  }));
  await sleep(800);
  await endMatch(session);
}

// ─── INTERACTIVE PvP (chances) ──────────────────────────────────────────────

function clearPvpTimer(s) { if (s.timer) { clearTimeout(s.timer); s.timer = null; } }

// Send a match message to everyone involved. In a group that's just the group;
// in a 1-on-1 it also reaches both managers' personal chats.
function matchRecipients(s) {
  if (s.chatJid.endsWith('@g.us')) return [s.chatJid];
  return [s.chatJid, s.homeId, s.awayId].filter((v, i, a) => a.indexOf(v) === i);
}
async function broadcast(s, text) {
  for (const r of matchRecipients(s)) {
    try { await sendText(s.sock, r, text); } catch {}
  }
}

function decideAttacker(s) {
  const total = (s._homeStr + s._awayStr) || 1;
  let homeProb = 0.5 + ((s._homeStr / total) - 0.5) * 0.6 + (s.homeMomentum - 50) * 0.004;
  homeProb = Math.max(0.15, Math.min(0.85, homeProb));
  return Math.random() < homeProb ? 'home' : 'away';
}

// If the attacking manager doesn't react in time, they FORFEIT the match.
function armForfeit(s, attackerSide) {
  clearPvpTimer(s);
  s.timer = setTimeout(() => {
    if (!pvpChances.get(s.matchId)) return;
    const offenderId = attackerSide === 'home' ? s.homeId : s.awayId;
    const winnerId  = attackerSide === 'home' ? s.awayId : s.homeId;
    forfeitPvP(s, offenderId, winnerId);
  }, MATCH.PVP_FORFEIT_MS);
}

async function presentChance(s) {
  const attackerSide = decideAttacker(s);
  const defSide = attackerSide === 'home' ? 'away' : 'home';
  const sit = situ.pickSituation();
  const isDefend = sit.type === 'defend';

  const atkSquad = attackerSide === 'home' ? s.homeSquad : s.awaySquad;
  const atkName  = attackerSide === 'home' ? s.homeName : s.awayName;
  const defName  = defSide === 'home' ? s.homeName : s.awayName;

  const outfield = atkSquad.filter(p => p.role === 'outfield');
  const player   = pick(outfield.length ? outfield : atkSquad);
  const ctx      = { player: Player.displayName(player) || player.name, team: atkName, opp: defName };

  s.attacker  = attackerSide;
  s.responder = isDefend ? defSide : attackerSide;
  s.currentType = isDefend ? 'defend' : 'attack';
  s.currentSituation = sit;
  s.currentOptions = sit.options;
  s.phase = 'await';

  // Build-up commentary — several tense lines land BEFORE the choice appears.
  let bi = 0;
  for (const line of sit.build) {
    await broadcast(s, situ.fillPlaceholders(line, ctx));
    await sleep(MATCH.PVP_BUILDUP_DELAY_MS);
    // Mid-buildup possession loss: after the first beat, the defender may step
    // in and steal the ball before the attacking manager ever reacts (~once
    // per chance, so it doesn't compound across many build-up lines).
    if (!isDefend && bi === 0 && Math.random() < MATCH.PVP_INTERCEPT_PCT) {
      const iline = pick(INTERCEPT_LINES);
      await broadcast(s, situ.fillPlaceholders(iline, ctx));
      if (attackerSide === 'home') {
        s.homeMomentum = engine.updateMomentum(s.homeMomentum, 'MISS');
        s.awayMomentum = engine.updateMomentum(s.awayMomentum, 'BIG_SAVE');
      } else {
        s.awayMomentum = engine.updateMomentum(s.awayMomentum, 'MISS');
        s.homeMomentum = engine.updateMomentum(s.homeMomentum, 'BIG_SAVE');
      }
      s.phase = 'idle';
      s.currentSituation = null;
      setTimeout(() => nextChance(s), MATCH.PVP_CHANCE_GAP_MS);
      return;
    }
    bi++;
  }

  // One Gen Z connective line after the buildup to keep the vibe flowing.
  const genCat = isDefend ? 'DEFENSE' : 'BUILDUP';
  await broadcast(s, comm.genZFlow(genCat, ctx));
  await sleep(MATCH.PVP_BUILDUP_DELAY_MS);

  const optText = sit.options.map(o => `!${o.key} ${o.label}`).join('   ');
  if (isDefend) {
    await broadcast(s,
      `🛡️ *YOUR TURN — ${defName}!*\n` +
      `⚠️ ${atkName}'s *${ctx.player}* is bearing down — pick your defensive move!\n` +
      `👉 React: ${optText}\n` +
      `⏳ You have *${(MATCH.PVP_FORFEIT_MS / 1000)}s* — don't stall!`);
  } else {
    await broadcast(s,
      `⚽ *YOUR TURN — ${atkName}!*\n` +
      `👤 ${ctx.player} is live on the ball!\n` +
      `👉 React: ${optText}\n` +
      `⏳ You have *${(MATCH.PVP_FORFEIT_MS / 1000)}s* — don't stall!`);
  }

  armForfeit(s, s.responder);
}

async function nextChance(s) {
  s.chanceNo++;
  if (s.chanceNo > s.totalChances) { await finishPvP(s); return; }

  // Half-time break in the middle of the match. The phase is set to 'paused'
  // so managers can use !sub during the break (just like the segment windows).
  if (!s.halftimeDone && s.chanceNo > Math.floor(s.totalChances / 2)) {
    s.halftimeDone = true;
    s.phase = 'paused';
    await broadcast(s,
      `⏸️ *HALF TIME!*\n${s.homeName} ${s.homeScore} – ${s.awayScore} ${s.awayName}\n` +
      `☕ Catch your breath… second half kicks off in *${MATCH.PVP_HALF_TIME_MS / 1000}s*! 🔁 *!sub [outId] [inId]* now!`);
    await sleep(MATCH.PVP_HALF_TIME_MS);
    s.phase = 'idle';
    await broadcast(s, `🔥 *SECOND HALF KICKS OFF!* No mercy now! ⚔️`);
  }

  await presentChance(s);
}

async function resolveChance(s, sender, raw) {
  if (s.phase !== 'await') return;
  const responderId = s.responder === 'home' ? s.homeId : s.awayId;
  const responderName = s.responder === 'home' ? s.homeName : s.awayName;
  if (sender !== responderId) {
    await sendText(s.sock, sender, `⏳ Not your turn — wait for *${responderName}*'s chance!`);
    return;
  }

  const letter = (raw || '').toLowerCase();
  let idx = { a: 0, b: 1, c: 2, d: 3 }[letter];
  if (idx === undefined) {
    idx = (s.currentOptions || []).findIndex(o => o.label.toLowerCase() === letter || (o.aliases || []).includes(letter));
  }
  const opt = s.currentOptions ? s.currentOptions[idx] : null;
  if (!opt) {
    const optText = (s.currentOptions || []).map(o => `!${o.key} ${o.label}`).join(' | ');
    await broadcast(s, `⚠️ Pick one of: ${optText}`);
    return;
  }

  clearPvpTimer(s);
  s.phase = 'resolving';

  const attackerSide = s.attacker;
  const defenderSide = attackerSide === 'home' ? 'away' : 'home';
  const atkStr = attackerSide === 'home' ? s._homeStr : s._awayStr;
  const defStr = defenderSide === 'home' ? s._homeStr : s._awayStr;

  const atkName  = attackerSide === 'home' ? s.homeName : s.awayName;
  const defName  = defenderSide === 'home' ? s.homeName : s.awayName;
  const atkSquad = attackerSide === 'home' ? s.homeSquad : s.awaySquad;
  const outfield = atkSquad.filter(p => p.role === 'outfield');
  const player   = pick(outfield.length ? outfield : atkSquad);
  const ctx      = { player: Player.displayName(player) || player.name, team: atkName, opp: defName };

  // Advance the clock and track this attacker's contribution for the MVP vote.
  s.timeElapsed = Math.min(s.timeElapsed + engine.eventDuration('shoot'), MATCH.TOTAL_SECONDS);
  const fm = engine.toFootballMinute(s.timeElapsed);
  const sid = player.id;
  s.scorerStats[sid] = s.scorerStats[sid] || { goals: 0, shots: 0, name: Player.displayName(player) || player.name, team: attackerSide };
  s.scorerStats[sid].shots++;

  let line;

  if (s.currentType === 'defend') {
    // Defensive duel: the responder (defender) tries to win the ball.
    const dp = (defStr / 4) * opt.gw * MATCH.PVP_DEFEND_WEIGHT * 0.5;
    const ap = (atkStr / 4) * 0.5 + 20;
    const winP = 1 / (1 + Math.exp(-((dp - ap) / 60)));
    const won = Math.random() < winP;

    if (won) {
      s[`${defenderSide}Momentum`] = engine.updateMomentum(s[`${defenderSide}Momentum`], 'BIG_SAVE');
      s[`${attackerSide}Momentum`] = engine.updateMomentum(s[`${attackerSide}Momentum`], 'MISS');
      line = situ.fillPlaceholders(pick(s.currentSituation.win), ctx);
    } else {
      s[`${attackerSide}Momentum`] = clamp(s[`${attackerSide}Momentum`] + 6, 0, 100);
      s[`${defenderSide}Momentum`] = clamp(s[`${defenderSide}Momentum`] - 4, 0, 100);
      line = situ.fillPlaceholders(pick(s.currentSituation.lose), ctx);
    }
  } else {
    // Attacking chance: goal probability from option weight vs defender strength.
    const ap = (atkStr / 4) * opt.gw * 0.5;
    const dp = (defStr / 4) * 0.5 + 20;
    const goalP = 1 / (1 + Math.exp(-((ap - dp) / 60)));
    const isGoal = Math.random() < goalP;

    if (isGoal) {
      if (attackerSide === 'home') s.homeScore++; else s.awayScore++;
      s.scorerStats[sid].goals++;
      s.goalScorers.push({ player: Player.displayName(player) || player.name, minute: fm, team: attackerSide, id: player.id });
      s[`${attackerSide}Momentum`] = engine.updateMomentum(s[`${attackerSide}Momentum`], 'GOAL');
      s[`${defenderSide}Momentum`] = engine.updateMomentum(s[`${defenderSide}Momentum`], 'MISS');
      line = situ.fillPlaceholders(pick(s.currentSituation.goal), ctx);
    } else {
      s[`${attackerSide}Momentum`] = engine.updateMomentum(s[`${attackerSide}Momentum`], 'MISS');
      // Keeper catch (clean claim) vs block/save.
      const caught = Math.random() < MATCH.PVP_CATCH_PCT;
      if (caught) {
        s[`${defenderSide}Momentum`] = engine.updateMomentum(s[`${defenderSide}Momentum`], 'BIG_SAVE');
        line = situ.fillPlaceholders(pick(CATCH_LINES), ctx);
      } else {
        s[`${defenderSide}Momentum`] = engine.updateMomentum(s[`${defenderSide}Momentum`], 'BIG_SAVE');
        line = situ.fillPlaceholders(pick(s.currentSituation.miss), ctx);
      }
    }
  }

  const hype = isGoal ? `\n${comm.genZFlow('HYPE', { team: atkName })}` : '';
  await broadcast(s, `${s.homeName} ${s.homeScore}–${s.awayScore} ${s.awayName}\n${line}${hype}`.trim());

  // Injury roll in interactive play.
  if (Math.random() < INJURY.CHANCE_PER_CHANCE) {
    const defSquad = defenderSide === 'home' ? s.homeSquad : s.awaySquad;
    const defPlayer = pick(defSquad.filter(p => p.role === 'outfield')) || null;
    const victim = Math.random() < 0.5 ? player : defPlayer;
    const inj = rollInjury(victim);
    if (inj) await broadcast(s, `🚑 *INJURY!* ${Player.displayName(victim) || victim.name} is hurt — out for ~${inj.hours}h! 😣`);
  }

  s.phase = 'idle';
  s.currentSituation = null;
  setTimeout(() => nextChance(s), MATCH.PVP_CHANCE_GAP_MS);
}

async function forfeitPvP(s, offenderId, winnerId) {
  clearPvpTimer(s);
  pvpChances.delete(s.matchId);
  const offName = offenderId === s.homeId ? s.homeName : s.awayName;
  const winName = winnerId === s.homeId ? s.homeName : s.awayName;
  if (winnerId === s.homeId) s.homeScore = Math.max(s.homeScore, s.awayScore + 1);
  else s.awayScore = Math.max(s.awayScore, s.homeScore + 1);
  await broadcast(s, `🚩 *FORFEIT!* ${offName} didn't react in time — *${winName}* wins on walkover! 😤`);
  await finishPvP(s);
}

// Forfeit the PvP match the given user is part of. If the caller is a participant
// they forfeit (opponent wins); the owner may also force-forfeit any match.
async function forfeitPvPForUser(sender) {
  const s = getActivePvPForUser(sender);
  if (!s) return null;
  let offender, winner;
  if (sender === s.homeId) { offender = s.homeId; winner = s.awayId; }
  else if (sender === s.awayId) { offender = s.awayId; winner = s.homeId; }
  else { offender = s.homeId; winner = s.awayId; } // owner override on others' match
  await forfeitPvP(s, offender, winner);
  return s;
}

async function finishPvP(s) {
  clearPvpTimer(s);
  pvpChances.delete(s.matchId);

  const winnerId = s.homeScore > s.awayScore ? s.homeId : s.awayScore > s.homeScore ? s.awayId : null;
  const isDraw = s.homeScore === s.awayScore;
  const homeWon = winnerId === s.homeId;

  const homeReward = homeWon ? ECONOMY.WIN_REWARD : isDraw ? ECONOMY.DRAW_REWARD : ECONOMY.LOSS_REWARD;
  const awayReward = (winnerId === s.awayId) ? ECONOMY.WIN_REWARD : isDraw ? ECONOMY.DRAW_REWARD : ECONOMY.LOSS_REWARD;
  const homeMmr = homeWon ? MMR.WIN : isDraw ? MMR.DRAW : MMR.LOSS;
  const awayMmr = (winnerId === s.awayId) ? MMR.WIN : isDraw ? MMR.DRAW : MMR.LOSS;

  const h = User.getByWhatsappId(s.homeId) || {};
  User.update(s.homeId, {
    inMatch: false, currentMatchId: null,
    currency: (h.currency || 0) + homeReward,
    wins: (h.wins || 0) + (homeWon ? 1 : 0),
    losses: (h.losses || 0) + ((!homeWon && !isDraw) ? 1 : 0),
    draws: (h.draws || 0) + (isDraw ? 1 : 0),
    mmr: (h.mmr || 1000) + homeMmr,
    totalGoals: (h.totalGoals || 0) + s.homeScore,
  });
  const a = User.getByWhatsappId(s.awayId) || {};
  User.update(s.awayId, {
    inMatch: false, currentMatchId: null,
    currency: (a.currency || 0) + awayReward,
    wins: (a.wins || 0) + ((winnerId === s.awayId) ? 1 : 0),
    losses: (a.losses || 0) + ((!homeWon && !isDraw && winnerId !== s.awayId) ? 1 : 0),
    draws: (a.draws || 0) + (isDraw ? 1 : 0),
    mmr: (a.mmr || 1000) + awayMmr,
    totalGoals: (a.totalGoals || 0) + s.awayScore,
  });

  const hu = User.getByWhatsappId(s.homeId);
  const newRank = calcRank(hu.mmr);
  if (newRank !== hu.rank) User.update(s.homeId, { rank: newRank });
  const au = User.getByWhatsappId(s.awayId);
  const newRankA = calcRank(au.mmr);
  if (newRankA !== au.rank) User.update(s.awayId, { rank: newRankA });

  tourney.resolveByResult(s.homeId, s.awayId, winnerId);

  // ── MVP: top scorer, tie-broken by total involvement ──
  const statEntries = Object.entries(s.scorerStats || {});
  let mvp = null;
  if (statEntries.length) {
    statEntries.sort((a, b) => (b[1].goals - a[1].goals) || (b[1].shots - a[1].shots));
    mvp = statEntries[0][1];
  }

  let mvpBonus = 0;
  if (mvp && mvp.team) {
    const mvpOwner = mvp.team === 'home' ? s.homeId : s.awayId;
    mvpBonus = ECONOMY.MVP_BONUS;
    const mu = User.getByWhatsappId(mvpOwner) || {};
    User.update(mvpOwner, { currency: (mu.currency || 0) + mvpBonus });
    if (mvp.id && Player.getById(mvp.id)) {
      Player.update(mvp.id, { manOfTheMatch: (Player.getById(mvp.id).manOfTheMatch || 0) + 1 });
    }
  }

  // ── match timeline: every goal stamped with its football minute ──
  const teamNameOf = (t) => (t === 'home' ? s.homeName : s.awayName);
  const timeline = [...(s.goalScorers || [])]
    .sort((a, b) => (a.minute || 0) - (b.minute || 0))
    .map((g) => `⚽ ${g.minute}'  ${teamNameOf(g.team)} — ${g.player}`)
    .join('\n');

  const resultTxt = homeWon ? `🏆 ${s.homeName} wins!` : (winnerId === s.awayId ? `🏆 ${s.awayName} wins!` : `🤝 Draw!`);

  let report = `━━━━━━━━━━━━━━━━━━━━━━━\n🏟️ *FULL TIME — VOLTA*\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
  report += `🏠 *${s.homeName}*  ${s.homeScore} – ${s.awayScore}  *${s.awayName}* 🚗\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  report += timeline
    ? `📋 *MATCH LOG*\n${timeline}\n`
    : `📋 *MATCH LOG*\nNo goals — a cagey ${s.homeScore}–${s.awayScore} draw.\n`;
  report += `\n💲 +${homeReward} (${s.homeName}) | +${awayReward} (${s.awayName})\n`;
  if (mvp) report += `⭐ MVP: *${mvp.name}*${mvpBonus ? ` (+${mvpBonus})` : ''}\n`;
  report += `${resultTxt}\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`;

  await broadcast(s, report);

  // ── persist a match record for the web-app history view ──
  try {
    const matchRecord = {
      id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      date: new Date().toISOString(),
      homeId: s.homeId, awayId: s.awayId, homeName: s.homeName, awayName: s.awayName,
      homeScore: s.homeScore, awayScore: s.awayScore,
      result: homeWon ? 'W' : (winnerId === s.awayId ? 'L' : 'D'),
      mvp: mvp && mvp.id ? { id: mvp.id, name: mvp.name } : null,
      goalScorers: (s.goalScorers || []).map((g) => ({ minute: g.minute, player: g.player, team: g.team })),
      pvp: true,
    };
    db.insert('matches', matchRecord.id, matchRecord);
  } catch (err) {
    logger.error({ err }, 'Failed to record PvP match history');
  }

  await decayConditions(s.homeSquad);
  await decayConditions(s.awaySquad);

  lockedChats.delete(s.chatJid);
}

function getPvpSessionFor(sender) {
  for (const [, s] of pvpChances) {
    if (s.homeId === sender || s.awayId === sender) return s;
  }
  return null;
}

function simulateChunk(session, count) {
  const lines = [];
  const scorers = [];

  for (let i = 0; i < count; i++) {
    if (Math.random() < 0.22 && lines.length) {
      lines.push(`\n${comm.atmosphereLine()}`);
    }

    const team   = decidePossession(session);
    const isHome = team === 'home';
    const squad  = isHome ? session.homeSquad : session.awaySquad;
    const opp    = isHome ? session.awaySquad : session.homeSquad;

    const attackerPool = squad.filter(p => p.role === 'outfield');
    const attacker = pick(attackerPool.length ? attackerPool : squad);

    const action = (session.isAI && !isHome)
      ? ai.chooseAction(session, team, attacker)
      : pick(['pass', 'shoot', 'dribble', 'skillmove']);

    session.timeElapsed = Math.min(session.timeElapsed + engine.eventDuration(action), MATCH.TOTAL_SECONDS);
    const fm = engine.toFootballMinute(session.timeElapsed);

    const defenders = opp.filter(p => p.role === 'outfield');
    const gk        = opp.find(p => p.role === 'goalkeeper');
    const myMom     = isHome ? session.homeMomentum : session.awayMomentum;
    const oppMom    = isHome ? session.awayMomentum : session.homeMomentum;

    const ap = engine.calcActionPower(attacker, action, myMom, fm);

    let eventType;
    let isGoal = false;

    if (action === 'shoot') {
      const gkOnly  = engine.calcDefensePower([], gk, oppMom, fm);
      eventType     = engine.resolveShotOutcome(ap, gkOnly, fm);
      isGoal        = eventType === 'goal';
    } else if (action === 'dribble' || action === 'skillmove') {
      const dp      = engine.calcDefensePower(defenders, gk, oppMom, fm);
      eventType     = engine.resolveDribbleOutcome(ap, dp);
    } else {
      const dp      = engine.calcDefensePower(defenders, gk, oppMom, fm);
      const o       = engine.resolveOutcome(ap, dp);
      eventType     = o === 'failure' ? 'tackled' : 'pass';
    }

    if (isGoal) {
      if (isHome) session.homeScore++;
      else        session.awayScore++;
      scorers.push({ player: attacker.displayName || attacker.name, minute: fm, team, id: attacker.id });
      const cur = Player.getById(attacker.id);
      if (cur) Player.update(attacker.id, { goals: (cur.goals || 0) + 1 });
    }

    const momEvent = isGoal ? 'GOAL' : eventType === 'save' ? 'BIG_SAVE' : eventType === 'tackled' ? 'TURNOVER' : null;
    if (momEvent) {
      if (isHome) {
        session.homeMomentum = engine.updateMomentum(session.homeMomentum, momEvent);
        session.awayMomentum = engine.updateMomentum(session.awayMomentum, isGoal ? 'MISS' : 'GOAL');
      } else {
        session.awayMomentum = engine.updateMomentum(session.awayMomentum, momEvent);
        session.homeMomentum = engine.updateMomentum(session.homeMomentum, isGoal ? 'MISS' : 'GOAL');
      }
    }

    lines.push(...comm.buildBurst(eventType, { player: attacker.displayName || attacker.name, team }, session.timeElapsed));

    // Injury roll — a player can go down at any moment.
    if (Math.random() < INJURY.CHANCE_PER_EVENT) {
      const victim = Math.random() < 0.5 ? attacker : pick(defenders.length ? defenders : [attacker]);
      const inj = rollInjury(victim);
      if (inj) lines.push(`🚑 *INJURY!* ${Player.displayName(victim) || victim.name} goes down — out for ~${inj.hours}h! 😣`);
    }

    // Gen Z connective tissue between events — a hype/atmosphere beat that
    // never repeats within the match.
    if (isGoal) {
      lines.push(comm.genZFlow('HYPE', { team }));
    } else if (Math.random() < 0.35) {
      lines.push(comm.genZFlow(Math.random() < 0.5 ? 'BUILDUP' : 'PRESSURE', { team, player: attacker.displayName || attacker.name }));
    }
  }

  return { lines, scorers };
}

async function endMatch(session) {
  const { sock, chatJid, awayId, isAI, homeName, awayName, homeScore, awayScore, goalScorers, homeId } = session;

  const winnerId = homeScore > awayScore ? homeId : awayScore > homeScore ? awayId : null;
  const isDraw   = homeScore === awayScore;
  const homeWon  = winnerId === homeId;

  // ── match timeline: every goal stamped with its football minute ──
  const teamNameOf = (t) => (t === 'home' ? homeName : awayName);
  const timeline = [...(goalScorers || [])]
    .sort((a, b) => (a.minute || 0) - (b.minute || 0))
    .map(g => `⚽ ${g.minute}'  ${teamNameOf(g.team)} — ${g.player}`)
    .join('\n');

  const homeReward = homeWon ? ECONOMY.WIN_REWARD : isDraw ? ECONOMY.DRAW_REWARD : ECONOMY.LOSS_REWARD;
  const mmrDelta   = homeWon ? MMR.WIN : isDraw ? MMR.DRAW : MMR.LOSS;

  const h = User.getByWhatsappId(homeId) || {};
  User.update(homeId, {
    inMatch: false, currentMatchId: null,
    currency: (h.currency || 0) + homeReward,
    wins: (h.wins || 0) + (homeWon ? 1 : 0),
    losses: (h.losses || 0) + ((!homeWon && !isDraw) ? 1 : 0),
    draws: (h.draws || 0) + (isDraw ? 1 : 0),
    mmr: (h.mmr || 1000) + mmrDelta,
    totalGoals: (h.totalGoals || 0) + homeScore,
  });

  const homeScorer = goalScorers.find(g => g.team === 'home');
  if (homeWon && homeScorer?.id) {
    const mvp = Player.getById(homeScorer.id);
    if (mvp) {
      Player.update(homeScorer.id, { manOfTheMatch: (mvp.manOfTheMatch || 0) + 1 });
      const hu = User.getByWhatsappId(homeId) || {};
      User.update(homeId, { currency: (hu.currency || 0) + ECONOMY.MVP_BONUS });
    }
  }

  const updatedUser = User.getByWhatsappId(homeId);
  const newRank = calcRank(updatedUser.mmr);
  const rewards = [
    `🏁 *${homeName} ${homeScore}–${awayScore} ${awayName}*`,
    timeline ? `📋 *MATCH LOG*\n${timeline}` : `📋 *MATCH LOG*\nNo goals — a cagey ${homeScore}–${awayScore} draw.`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `💰 *REWARDS — ${homeName}*`,
    `💲 +${homeReward} Metaworks`,
    `📈 MMR ${mmrDelta >= 0 ? '+' : ''}${mmrDelta}`,
    `🏆 ${newRank}`,
  ];
  if (homeWon && homeScorer?.id) {
    const mvp = Player.getById(homeScorer.id);
    rewards.push(`⭐ MVP: ${mvp ? Player.displayName(mvp) : homeScorer.player} (+${ECONOMY.MVP_BONUS})`);
  }
  rewards.push(`━━━━━━━━━━━━━━━━━━━━━━━━`);
  rewards.push(`*!play* to run it back.`);

  if (newRank !== updatedUser.rank) {
    User.update(homeId, { rank: newRank });
    rewards.push(`🏅 *RANK UP!* You're *${newRank}* now! 🚀`);
  }
  await sendText(sock, chatJid, rewards.join('\n'));

  if (!isAI && awayId) {
    // if these two were a tournament tie, record the result
    tourney.resolveByResult(homeId, awayId, winnerId);

    const a = User.getByWhatsappId(awayId) || {};
    const awayWon   = winnerId === awayId;
    const awayReward = awayWon ? ECONOMY.WIN_REWARD : isDraw ? ECONOMY.DRAW_REWARD : ECONOMY.LOSS_REWARD;
    const awayMmr   = awayWon ? MMR.WIN : isDraw ? MMR.DRAW : MMR.LOSS;
    User.update(awayId, {
      inMatch: false, currentMatchId: null,
      currency: (a.currency || 0) + awayReward,
      wins: (a.wins || 0) + (awayWon ? 1 : 0),
      losses: (a.losses || 0) + ((!awayWon && !isDraw) ? 1 : 0),
      draws: (a.draws || 0) + (isDraw ? 1 : 0),
      mmr: (a.mmr || 1000) + awayMmr,
      totalGoals: (a.totalGoals || 0) + awayScore,
    });
    const awayScorer = goalScorers.find(g => g.team === 'away');
    if (awayWon && awayScorer?.id) {
      const mvp = Player.getById(awayScorer.id);
      if (mvp) {
        Player.update(awayScorer.id, { manOfTheMatch: (mvp.manOfTheMatch || 0) + 1 });
        const au = User.getByWhatsappId(awayId) || {};
        User.update(awayId, { currency: (au.currency || 0) + ECONOMY.MVP_BONUS });
      }
    }
    const awayRank = calcRank(User.getByWhatsappId(awayId).mmr);
    let awayMsg = `🏁 *${awayName} ${awayScore}–${homeScore} ${homeName}*\n`;
    awayMsg += timeline ? `📋 *MATCH LOG*\n${timeline}\n` : `📋 *MATCH LOG*\nNo goals — a cagey ${awayScore}–${homeScore} draw.\n`;
    awayMsg += `💲 +${awayReward} | 📈 MMR ${awayMmr >= 0 ? '+' : ''}${awayMmr} | 🏆 ${awayRank}`;
    if (awayWon && awayScorer?.id) {
      const mvp = Player.getById(awayScorer.id);
      awayMsg += `\n⭐ MVP: ${mvp ? Player.displayName(mvp) : awayScorer.player} (+${ECONOMY.MVP_BONUS})`;
    }
    await sendText(sock, awayId, awayMsg);
  }

  // ── persist a match record for the web-app history view ──
  try {
    const winningScorer = homeWon ? homeScorer : awayWon ? awayScorer : null;
    const matchRecord = {
      id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      date: new Date().toISOString(),
      homeId, awayId, homeName, awayName,
      homeScore, awayScore,
      result: homeWon ? 'W' : awayWon ? 'L' : 'D',
      mvp: winningScorer?.id
        ? { id: winningScorer.id, name: Player.displayName(Player.getById(winningScorer.id)) || winningScorer.player }
        : null,
      goalScorers: (goalScorers || []).map((g) => ({ minute: g.minute, player: g.player, team: g.team })),
    };
    db.insert('matches', matchRecord.id, matchRecord);
  } catch (err) {
    logger.error({ err }, 'Failed to record match history');
  }

  await decayConditions(session.homeSquad);
  if (!isAI) await decayConditions(session.awaySquad);
}

function calcRank(mmr) {
  const { RANKS } = MMR;
  let rank = 'Bronze';
  for (const r of RANKS) if (mmr >= r.min) rank = r.label;
  return rank;
}

async function decayConditions(squad) {
  for (const p of squad) {
    if (!p.id) continue;
    const cur = Player.getById(p.id);
    if (!cur) continue;
    Player.update(p.id, { condition: Math.max(0, (cur.condition || 100) - 5), matchesPlayed: (cur.matchesPlayed || 0) + 1 });
  }
}

// Force-clear every in-progress PvP match + interactive chance session + the
// chat locks they hold. Used by the owner's !clearpvp recovery command when a
// PvP game gets stuck (e.g. a player goes offline mid-match and the chat stays
// locked). Does NOT touch single-player AI matches.
function clearAllPvP() {
  let cleared = 0;
  for (const [id, s] of activeSessions) {
    if (s && s.isPvP) {
      clearPvpTimer(s);
      activeSessions.delete(id);
      cleared++;
    }
  }
  pvpChances.clear();
  for (const [jid, lock] of [...lockedChats]) {
    // PvP locks carry two participants (home + away); AI locks carry one.
    if (lock.participants && lock.participants.length === 2) lockedChats.delete(jid);
  }
  return cleared;
}

module.exports = { startMatch, isChatLocked, getActivePvPForUser, applySub, getPvpSessionFor, resolveChance, clearAllPvP, forfeitPvPForUser };
