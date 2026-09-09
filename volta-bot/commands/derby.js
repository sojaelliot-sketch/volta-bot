'use strict';
// commands/derby.js — !derby
//
// A group prediction game. Any manager opens a fixture between two real squads
// in the chat, everyone else calls the winner, and when the match is simulated
// the correct callers split a pot. Nobody has to own anything to join.
//
// Why this exists: almost every command in VOLTA is single-player. You open
// packs alone, train alone, check your squad alone. This is the one thing that
// only works because there are other people in the group — which is the whole
// reason the bot lives in a group chat.

const User = require('../models/User');
const Player = require('../models/Player');
const { sendText } = require('../utils/messaging');
const { BRAND } = require('../config/constants');
const { pick } = require('../utils/random');

const STAKE = 250;
const OPEN_MS = 5 * 60 * 1000;      // five minutes to get your call in
const MIN_CALLERS = 2;

// One derby per chat at a time.
const derbies = new Map();   // chatJid -> derby

function squadStrength(jid) {
  const squad = Player.getByOwner(jid) || [];
  if (!squad.length) return null;
  const rated = squad.map((p) => Player.calculateOVR(p)).sort((a, b) => b - a).slice(0, 5);
  return Math.round(rated.reduce((a, b) => a + b, 0) / rated.length);
}

// Simulate on squad strength with enough noise that the favourite loses often
// enough to keep it interesting.
function simulate(homeStr, awayStr) {
  const edge = (homeStr - awayStr) / 12;
  const swing = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.6;
  const home = Math.max(0, Math.round(1.3 + edge * 0.5 + swing()));
  const away = Math.max(0, Math.round(1.3 - edge * 0.5 + swing()));
  return { home, away };
}

const FLAVOUR = [
  'Settled by a deflection nobody will admit was lucky.',
  'Six minutes of stoppage time. Of course there were.',
  'The keeper will be thinking about that one tonight.',
  'A red card on the half hour changed everything.',
  'Two goals in as many minutes turned it upside down.',
  'Not a classic. Nobody watching cared by the end.',
  'Decided by the only shot on target in the second half.',
];

function timeLeft(d) {
  return Math.max(0, Math.ceil((d.closes - Date.now()) / 1000));
}

async function settle(sock, chatJid, d) {
  derbies.delete(chatJid);

  const homeUser = User.getByWhatsappId(d.home);
  const awayUser = User.getByWhatsappId(d.away);
  const score = simulate(d.homeStr, d.awayStr);
  const outcome = score.home > score.away ? 'home' : score.away > score.home ? 'away' : 'draw';

  const winners = d.calls.filter((c) => c.call === outcome);
  const pot = d.calls.length * STAKE;
  const share = winners.length ? Math.floor(pot / winners.length) : 0;

  const lines = [];
  lines.push(`🏟️ *FULL TIME*\n━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`*${homeUser?.name || 'Home'}*  ${score.home} — ${score.away}  *${awayUser?.name || 'Away'}*`);
  lines.push(`_${pick(FLAVOUR)}_\n`);
  lines.push(`📣 Called: *${outcome === 'draw' ? 'a draw' : outcome === 'home' ? homeUser?.name : awayUser?.name}*`);
  lines.push(`💰 Pot: *${pot.toLocaleString()}*\n`);

  if (!winners.length) {
    lines.push(`Nobody got it. The pot goes up in smoke.`);
  } else {
    lines.push(`✅ *${winners.length} correct* — *${share.toLocaleString()}* each:`);
    for (const w of winners) {
      const u = User.getByWhatsappId(w.jid);
      User.addCurrency(w.jid, share);
      lines.push(`  • ${u?.name || 'Someone'}`);
    }
  }

  const wrong = d.calls.filter((c) => c.call !== outcome);
  if (wrong.length) {
    lines.push(`\n❌ ${wrong.length} got it wrong.`);
  }
  lines.push(`\nStart another with *!derby @someone*.\n${BRAND}`);

  await sendText(sock, chatJid, lines.join('\n'));
}

async function handle({ sock, msg, jid, sender, args, user, replyTo, mentioned }) {
  if (!user || !user.registered) {
    await sendText(sock, jid, '👋 Register first with *!start*.', msg);
    return;
  }
  if (!jid.endsWith('@g.us')) {
    await sendText(sock, jid,
      `🏟️ *!derby* only works in a group — the whole point is calling it against other people.`, msg);
    return;
  }

  const sub = (args[0] || '').toLowerCase();
  const existing = derbies.get(jid);

  // Auto-settle an expired derby before doing anything else.
  if (existing && Date.now() >= existing.closes) {
    if (existing.calls.length >= MIN_CALLERS) {
      await settle(sock, jid, existing);
    } else {
      derbies.delete(jid);
      for (const c of existing.calls) User.addCurrency(c.jid, STAKE);   // refund
      await sendText(sock, jid,
        `🏟️ The derby fell through — only ${existing.calls.length} call${existing.calls.length === 1 ? '' : 's'} came in. Stakes refunded.`);
    }
    if (!sub) return;
  }

  const live = derbies.get(jid);

  // ── Calling a result ──
  if (['home', 'away', 'draw', 'h', 'a', 'd'].includes(sub)) {
    if (!live) {
      await sendText(sock, jid, `🏟️ No derby running. Start one with *!derby @someone*.`, msg);
      return;
    }
    if (live.calls.some((c) => c.jid === sender)) {
      await sendText(sock, jid, `📣 You've already called this one.`, msg);
      return;
    }
    const call = sub.startsWith('h') ? 'home' : sub.startsWith('a') ? 'away' : 'draw';
    const res = User.addCurrency(sender, -STAKE);
    if (!res.ok) {
      await sendText(sock, jid,
        `❌ It costs *${STAKE}* to call. You have *${res.balance.toLocaleString()}*.`, msg);
      return;
    }
    live.calls.push({ jid: sender, call });

    const homeUser = User.getByWhatsappId(live.home);
    const awayUser = User.getByWhatsappId(live.away);
    const label = call === 'home' ? homeUser?.name : call === 'away' ? awayUser?.name : 'a draw';
    await sendText(sock, jid,
      `📣 *${user.name}* calls *${label}*.  (${live.calls.length} in, pot ${(live.calls.length * STAKE).toLocaleString()}, ${timeLeft(live)}s left)`, msg);
    return;
  }

  // ── Status ──
  if (sub === 'status') {
    if (!live) {
      await sendText(sock, jid, `🏟️ Nothing running. *!derby @someone* starts one.`, msg);
      return;
    }
    await sendText(sock, jid,
      `🏟️ ${live.calls.length} call${live.calls.length === 1 ? '' : 's'} in · pot *${(live.calls.length * STAKE).toLocaleString()}* · closes in *${timeLeft(live)}s*`, msg);
    return;
  }

  // ── Opening a derby ──
  if (live) {
    await sendText(sock, jid,
      `🏟️ A derby is already running here — closes in *${timeLeft(live)}s*.\n` +
      `Call it with *!derby home*, *!derby away* or *!derby draw*.`, msg);
    return;
  }

  const { resolveTarget } = require('./router');
  const opponent = resolveTarget(args, { replyTo, mentioned });
  if (!opponent) {
    await sendText(sock, jid,
      `🏟️ *DERBY*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Put two squads head to head and let the group call the winner.\n\n` +
      `*!derby @someone* — open the fixture\n` +
      `*!derby home / away / draw* — call it (${STAKE} each)\n` +
      `*!derby status* — how long is left\n\n` +
      `Everyone who calls it right splits the pot. You don't need to be\n` +
      `playing to bet on it.\n${BRAND}`, msg);
    return;
  }
  if (opponent === sender) {
    await sendText(sock, jid, `😅 You can't play yourself.`, msg);
    return;
  }

  const oppUser = User.getByWhatsappId(opponent);
  if (!oppUser || !oppUser.registered) {
    await sendText(sock, jid, `❌ That manager isn't registered yet.`, msg);
    return;
  }

  const homeStr = squadStrength(sender);
  const awayStr = squadStrength(opponent);
  if (!homeStr || !awayStr) {
    await sendText(sock, jid, `❌ Both managers need a squad. Try *!start* / *!squad*.`, msg);
    return;
  }

  const d = {
    home: sender, away: opponent, homeStr, awayStr,
    calls: [], closes: Date.now() + OPEN_MS,
  };
  derbies.set(jid, d);

  const fav = homeStr > awayStr ? user.name : awayStr > homeStr ? oppUser.name : null;
  await sendText(sock, jid,
    `🏟️ *DERBY — CALLS OPEN*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `*${user.name}* (${homeStr})  vs  *${oppUser.name}* (${awayStr})\n` +
    `${fav ? `_${fav} start as favourites._` : `_Nothing between them on paper._`}\n\n` +
    `Call it — *${STAKE}* Metaworks:\n` +
    `  *!derby home*  → ${user.name}\n` +
    `  *!derby away*  → ${oppUser.name}\n` +
    `  *!derby draw*\n\n` +
    `⏳ Closes in *5 minutes*. Correct callers split the pot.\n` +
    `Needs at least ${MIN_CALLERS} calls or everyone gets refunded.\n${BRAND}`, msg, [opponent]);

  // Settle on its own even if nobody sends another message.
  setTimeout(async () => {
    const still = derbies.get(jid);
    if (!still || still !== d) return;
    try {
      if (still.calls.length >= MIN_CALLERS) {
        await settle(sock, jid, still);
      } else {
        derbies.delete(jid);
        for (const c of still.calls) User.addCurrency(c.jid, STAKE);
        await sendText(sock, jid,
          `🏟️ Derby called off — not enough calls came in. Stakes refunded.`);
      }
    } catch { /* chat may be gone */ }
  }, OPEN_MS + 1000).unref();
}

module.exports = { handle };
