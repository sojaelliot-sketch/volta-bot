// commands/penalty.js
//   !penalty [stake]            — 5-round shootout vs the AI keeper (interactive)
//   !penalty [stake] @user     — simulated head-to-head shootout vs a friend
//   During a live shootout use:
//     !shoot L|C|R   — pick your shot placement
//     !save  L|C|R   — guess the AI's shot placement
const User = require('../models/User');
const Player = require('../models/Player');
const { PENALTY, MATCH } = require('../config/constants');
const { money } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');
const { pick } = require('../utils/random');
const { resolveTarget } = require('./router');
const tourney = require('../game-engine/tournament');

// active shootouts keyed by user jid (vs AI) or pair key (pvp)
const sessions = new Map();

function spots() { return PENALTY.SPOTS; }
function dirText(d) { return d === 'L' ? '↙️ Left' : d === 'R' ? '↘️ Right' : '⬆️ Centre'; }

// best shooting (outfield) + best reflex (keeper) for a user — from the
// ACTIVE squad only (each saved squad has its own roster).
function penaltyPower(sender) {
  const owned = Player.getSquadPlayers(sender);
  const out = owned.filter((p) => p.role === 'outfield').sort((a, b) => Player.totalStats(b) - Player.totalStats(a))[0];
  const gk = owned.filter((p) => p.role === 'goalkeeper').sort((a, b) => Player.totalStats(b) - Player.totalStats(a))[0];
  const shoot = out ? (out.stats.shooting || 60) : 60;
  const reflex = gk ? (gk.stats.reflex || 60) : 60;
  return { shoot, reflex };
}

function clearTimer(s) { if (s.timer) { clearTimeout(s.timer); s.timer = null; } }

function armTimeout(sock, jid, s, autoPick) {
  clearTimer(s);
  s.timer = setTimeout(() => {
    if (!sessions.get(s.key)) return;
    const auto = pick(spots());
    sendText(sock, jid, `⏱️ No response — auto-picked *${dirText(auto)}*.`, s.lastMsg);
    autoPick(auto);
  }, MATCH.CHANCE_TIMEOUT_MS);
}

async function handle({ sock, msg, jid, sender, cmd, args, replyTo, mentioned }) {
  // ── resume an in-progress shootout ──
  if (cmd === 'shoot' || cmd === 'save') {
    const s = sessions.get(sender);
    if (!s) {
      await sendText(sock, jid, `⚽ You're not in a penalty shootout. Start one with *!penalty*.`, msg);
      return;
    }
    const dir = (args[0] || '').toUpperCase();
    if (!spots().includes(dir)) {
      await sendText(sock, jid, `⚠️ Pick a spot: *!${cmd} L|C|R*.`, msg);
      return;
    }
    clearTimer(s);
    s.lastMsg = msg;
    if (cmd === 'shoot') await resolveShoot(sock, s, dir);
    else await resolveSave(sock, s, dir);
    return;
  }

  if (cmd !== 'penalty') return;

  // ── PvP simulated shootout ──
  const target = resolveTarget(args, { replyTo, mentioned });
  if (target && target !== sender) {
    const me = User.getByWhatsappId(sender);
    const them = User.getByWhatsappId(target);
    if (!me || !me.registered || !them || !them.registered) {
      await sendText(sock, jid, `❌ Both players must be registered.`, msg);
      return;
    }
    let stake = parseInt(args[0], 10) || 0;
    stake = Math.max(0, Math.min(PENALTY.MAX_STAKE, stake));
    if (stake > 0 && (me.currency || 0) < stake) {
      await sendText(sock, jid, `❌ You need *${money(stake)}* to stake that.`, msg);
      return;
    }
    const a = penaltyPower(sender), b = penaltyPower(target);
    const myScore = simulateShootout(a.shoot, b.reflex);
    const theirScore = simulateShootout(b.shoot, a.reflex);
    let result;
    if (myScore > theirScore) {
      if (stake > 0) {
        User.update(sender, { currency: (me.currency || 0) + stake });
        User.update(target, { currency: Math.max(0, (them.currency || 0) - stake) });
      }
      result = `🏆 *${me.name}* wins *${myScore}–${theirScore}*!`;
    } else if (theirScore > myScore) {
      if (stake > 0) {
        User.update(sender, { currency: Math.max(0, (me.currency || 0) - stake) });
        User.update(target, { currency: (them.currency || 0) + stake });
      }
      result = `🏆 *${them.name}* wins *${theirScore}–${myScore}*!`;
    } else {
      result = `🤝 Draw *${myScore}–${theirScore}* — stake returned.`;
    }
    // if these two were a tournament penalty tie, record it
    tourney.resolveByResult(sender, target, myScore > theirScore ? sender : theirScore > myScore ? target : null);
    await sendText(sock, jid,
      `⚽ *PENALTY SHOOTOUT* (simulated)\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${me.name} ${myScore}–${theirScore} ${them.name}\n${result}\n━━━━━━━━━━━━━━━━━━━━━━━`,
      msg, [target]);
    return;
  }

  // ── vs AI interactive shootout ──
  let stake = parseInt(args[0], 10) || 0;
  stake = Math.max(0, Math.min(PENALTY.MAX_STAKE, stake));
  if (stake > 0 && (User.getByWhatsappId(sender).currency || 0) < stake) {
    await sendText(sock, jid, `❌ You need *${money(stake)}* to stake that.`, msg);
    return;
  }
  if (sessions.has(sender)) {
    await sendText(sock, jid, `⚽ You're already in a shootout! Finish it first.`, msg);
    return;
  }

  const s = {
    key: sender, sock, jid, msg, lastMsg: msg,
    stake, round: 1, playerScore: 0, aiScore: 0,
    phase: 'shoot', timer: null,
  };
  sessions.set(sender, s);
  await sendText(sock, jid,
    `⚽ *PENALTY SHOOTOUT vs AI* — best of ${PENALTY.ROUNDS * 2}!\n` +
    (stake ? `💰 Stake: *${money(stake)}* (win ×${PENALTY.WIN_REWARD_MULT})\n` : '') +
    `━━━━━━━━━━━━━━━━━━━━━━━\n*Round 1:* pick your spot — *!shoot L|C|R*`, msg);
  armTimeout(sock, jid, s, (auto) => resolveShoot(sock, s, auto));
}

// Each side takes PENALTY.ROUNDS kicks. Returns goals scored.
function simulateShootout(shoot, reflex) {
  let goals = 0;
  for (let i = 0; i < PENALTY.ROUNDS; i++) {
    const edge = (shoot - reflex) / 40; // -ish
    const p = Math.min(0.95, Math.max(0.1, 0.5 + edge * 0.15 + (Math.random() - 0.5) * 0.3));
    if (Math.random() < p) goals++;
  }
  return goals;
}

async function resolveShoot(sock, s, dir) {
  const guess = pick(spots());
  const goal = dir !== guess;
  if (goal) s.playerScore++;
  await sendText(sock, s.jid,
    `🦶 You shot ${dirText(dir)}, AI dove ${dirText(guess)} → ${goal ? '⚽ GOAL!' : '🧤 SAVED!'}`, s.lastMsg);
  s.phase = 'save';
  await sendText(sock, s.jid,
    `🧤 *AI's kick ${s.round}/${PENALTY.ROUNDS}* — guess: *!save L|C|R*`, s.lastMsg);
  armTimeout(sock, s.jid, s, (auto) => resolveSave(sock, s, auto));
}

async function resolveSave(sock, s, dir) {
  const shot = pick(spots());
  const saved = dir === shot;
  if (!saved) s.aiScore++;
  await sendText(sock, s.jid,
    `🤖 AI shot ${dirText(shot)}, you guessed ${dirText(dir)} → ${saved ? '🧤 GREAT SAVE!' : '⚽ CONCEDED'}`, s.lastMsg);
  if (s.round >= PENALTY.ROUNDS) { await finish(sock, s); return; }
  s.round++;
  s.phase = 'shoot';
  await sendText(sock, s.jid,
    `⚽ *Your kick ${s.round}/${PENALTY.ROUNDS}* — pick: *!shoot L|C|R*`, s.lastMsg);
  armTimeout(sock, s.jid, s, (auto) => resolveShoot(sock, s, auto));
}

async function finish(sock, s) {
  clearTimer(s);
  sessions.delete(s.key);
  const me = User.getByWhatsappId(s.key) || {};
  const won = s.playerScore > s.aiScore;
  let payoutLine = '';
  if (s.stake > 0) {
    if (won) {
      const payout = Math.round(s.stake * PENALTY.WIN_REWARD_MULT);
      User.update(s.key, { currency: (me.currency || 0) + payout });
      payoutLine = `\n💰 You won *${money(payout)}*!`;
    } else {
      User.update(s.key, { currency: Math.max(0, (me.currency || 0) - s.stake) });
      payoutLine = `\n💰 You lost *${money(s.stake)}*.`;
    }
  }
  await sendText(sock, s.jid,
    `🏁 *SHOOTOUT OVER* — You ${s.playerScore}–${s.aiScore} AI\n` +
    (won ? `🏆 You win!` : s.playerScore === s.aiScore ? `🤝 Draw!` : `😔 AI wins.`) +
    payoutLine, s.lastMsg);
}

module.exports = { handle };
