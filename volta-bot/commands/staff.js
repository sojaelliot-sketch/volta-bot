// commands/staff.js
//   !giveaway [amount] [winners] — owner/officer/moderator
//   !tournament start [cat] [prize] — opens join window
//   !tournament end — closes joins & builds bracket
//   !tournament prize [amount] — adjust prize pool before start
//   !join — join the open tournament
//   !tourneyplay — simulate your current bracket tie
const User = require('../models/User');
const { GIVEAWAY, TOURNAMENT, BRAND } = require('../config/constants');
const { sendText } = require('../utils/messaging');
const tourney = require('../game-engine/tournament');

let lastGiveaway = 0;
let lastTournament = 0;
let joinTimer = null;
let customJoinWindowMs = null;   // staff-adjustable join window
let customMatchWindowMs = null;  // staff-adjustable match window

function canHost(sender) {
  if (User.isOwner(sender)) return true;
  const u = User.getByWhatsappId(sender);
  return User.roleRank(u?.role) >= User.roleRank('moderator');
}

function announceBracket(sock, t) {
  const rounds = t.rounds || [];
  let out = `🏆 *TOURNAMENT BRACKET* (${TOURNAMENT.CATEGORIES[t.category]?.label || t.category})\n`;
  out += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  out += `💲 Prize: *${t.prize}* MW   👥 ${t.playerCount || t.players?.length || 0} players\n`;
  out += `🥇 1st: *${t.prize}* MW  🥈 2nd: *${Math.round(t.prize * 0.25)}* MW\n`;
  if (t.playerCount >= 3) {
    out += `🥉 3rd: *${Math.round(t.prize * 0.10)}* MW\n`;
  }
  out += `━━━━━━━━━━━━━━━━━━━━━━━\n`;

  rounds.forEach((round, ri) => {
    const firstMatch = round[0];
    const label = firstMatch?.label || `Round ${ri + 1}`;
    out += `\n*${label}*\n`;
    round.forEach((m) => {
      const a = m.winner ? (tourney.eff(m.a) === m.winner ? `✅ ${nameOf(m.a)}` : nameOf(m.a)) : nameOf(m.a);
      const b = m.winner ? (tourney.eff(m.b) === m.winner ? `✅ ${nameOf(m.b)}` : nameOf(m.b)) : nameOf(m.b);
      const tag = m.simulated ? ' (sim)' : '';
      const status = m.winner ? ' ✔️' : (m.dueAt ? ' ⏳' : '');
      out += `  ${a}  vs  ${b}${tag}${status}\n`;
    });
  });

  // Show 3rd place match placeholder if applicable
  if (t.thirdPlaceMatch && t.playerCount >= 3) {
    out += `\n*🥉 3RD PLACE MATCH*\n  (awaiting semifinal results)\n`;
  }

  out += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  out += `💡 Play your tie with *!tchallenge* (PvP) or *!tourneyplay* (sim).`;
  sendText(sock, t.chatJid, out);
}

function nameOf(x) {
  if (!x || x === 'BYE') return 'BYE';
  if (typeof x === 'object') return nameOf(x.winner) || 'TBD';
  return User.getByWhatsappId(x)?.name || x.split('@')[0];
}

function startBracket(sock) {
  if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
  if (tourney.start()) {
    const t = tourney.summary();
    announceBracket(sock, t);
    // Announce match order
    setTimeout(() => tourney.announceMatchOrder(), 1500);
  } else {
    const chat = tourney.summary()?.chatJid;
    tourney.cancel();
    if (chat) sendText(sock, chat, `⚠️ Not enough players joined (need 2+). Tournament cancelled.`);
  }
}

async function handle({ sock, msg, jid, sender, cmd, args }) {
  if (cmd === 'giveaway' || cmd === 'gw') {
    if (!canHost(sender)) {
      await sendText(sock, jid, `⛔ Only Moderators, Officers and the Owner can host giveaways.`, msg);
      return;
    }
    const now = Date.now();
    if (now - lastGiveaway < GIVEAWAY.COOLDOWN_MS) {
      const wait = Math.ceil((GIVEAWAY.COOLDOWN_MS - (now - lastGiveaway)) / 1000);
      await sendText(sock, jid, `⏳ Giveaway cooldown — wait *${wait}s*.`, msg);
      return;
    }
    let amount = parseInt(args[0], 10);
    let winners = parseInt(args[1], 10) || 1;
    if (!amount || isNaN(amount)) {
      await sendText(sock, jid, `⚠️ Usage: *!giveaway [amount] [winners]*`, msg);
      return;
    }
    amount = Math.min(GIVEAWAY.MAX_AMOUNT, amount);
    winners = Math.min(GIVEAWAY.MAX_WINNERS, Math.max(1, winners));

    const pool = User.all().filter(u => u.registered);
    if (!pool.length) { await sendText(sock, jid, `❌ No registered players to give to.`, msg); return; }

    const picks = [];
    const clone = pool.slice();
    for (let i = 0; i < winners && clone.length; i++) {
      const idx = Math.floor(Math.random() * clone.length);
      picks.push(clone.splice(idx, 1)[0]);
    }
    for (const p of picks) {
      User.update(p.whatsappId, { currency: (p.currency || 0) + amount });
    }
    lastGiveaway = now;

    const mentions = picks.map(p => p.whatsappId);
    const tagged = picks.map(p => `@${p.name}`).join('  ');
    await sendText(sock, jid,
      `🎉 *GIVEAWAY!* 💸\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💲 *${amount}* Metaworks each to:\n${tagged}\n` +
      `🧑‍🤝‍🧑 ${picks.length} winner(s)\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg, mentions);
    return;
  }

  if (cmd === 'tourneyplay') {
    if (!tourney.isActive()) { await sendText(sock, jid, `ℹ️ No tournament running.`, msg); return; }
    const t = tourney.summary();
    const m = (t.rounds || []).flat().find(mm => !mm.winner && !mm.simulated && (tourney.eff(mm.a) === sender || tourney.eff(mm.b) === sender));
    if (!m) { await sendText(sock, jid, `ℹ️ You have no pending tie (or it already resolved).`, msg); return; }
    const opp = tourney.eff(m.a) === sender ? tourney.eff(m.b) : tourney.eff(m.a);
    const winner = Math.random() < 0.5 ? sender : opp;
    m.winner = winner; m.simulated = true;
    await sendText(sock, jid, `⚽ *${User.getByWhatsappId(sender)?.name}*'s tie simulated — winner: *${User.getByWhatsappId(winner)?.name}*.`, msg);
    return;
  }

  if (cmd === 'tournament' || cmd === 'tourney') {
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'start') {
      if (!canHost(sender)) {
        await sendText(sock, jid, `⛔ Only Moderators, Officers and the Owner can host tournaments.`, msg);
        return;
      }
      const now = Date.now();
      if (now - lastTournament < TOURNAMENT.COOLDOWN_MS) {
        const wait = Math.ceil((TOURNAMENT.COOLDOWN_MS - (now - lastTournament)) / 1000);
        await sendText(sock, jid, `⏳ Tournament cooldown — wait *${wait}s*.`, msg);
        return;
      }
      if (tourney.isActive()) { await sendText(sock, jid, `⚠️ A tournament is already open.`, msg); return; }

      let cat = 'classic';
      let prize = 1000;
      for (const a of args.slice(1)) {
        if (TOURNAMENT.CATEGORIES[a.toLowerCase()]) cat = a.toLowerCase();
        else if (!isNaN(parseInt(a, 10))) prize = parseInt(a, 10);
      }
      prize = Math.min(TOURNAMENT.MAX_PRIZE, Math.max(100, prize));

      const joinWindowMs = customJoinWindowMs || TOURNAMENT.JOIN_WINDOW_MS;
      tourney.create({ category: cat, prize, host: sender, chatJid: jid, sock, matchWindowMs: customMatchWindowMs });
      lastTournament = now;
      joinTimer = setTimeout(() => startBracket(sock), joinWindowMs);

      const joinMins = Math.round(joinWindowMs / 60000);
      await sendText(sock, jid,
        `🏆 *TOURNAMENT OPEN!* 🔥\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🎮 Category: *${TOURNAMENT.CATEGORIES[cat].label}*\n` +
        `💲 Prize pool: *${prize}* Metaworks\n` +
        `🥇 1st: *${prize}* MW  🥈 2nd: *${Math.round(prize * 0.25)}* MW\n` +
        `🥉 3rd: *${Math.round(prize * 0.10)}* MW (if 3+ players)\n` +
        `👥 Type *!join* to enter (max ${TOURNAMENT.MAX_PLAYERS})\n` +
        `⏰ Joins close in ${joinMins} min\n` +
        `💡 Adjust with *!tournament time [min]* or *!tournament matchtime [min]*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
      return;
    }

    if (sub === 'prize') {
      if (!canHost(sender)) {
        await sendText(sock, jid, `⛔ Only staff can adjust the prize.`, msg);
        return;
      }
      if (!tourney.isActive()) { await sendText(sock, jid, `ℹ️ No tournament open.`, msg); return; }
      if (tourney.summary().rounds) { await sendText(sock, jid, `⚠️ Bracket already drawn — can't change prize now.`, msg); return; }
      const newPrize = parseInt(args[1], 10);
      if (!newPrize || isNaN(newPrize) || newPrize < 100) {
        await sendText(sock, jid, `⚠️ Usage: *!tournament prize [amount]* (min 100)`, msg);
        return;
      }
      const capped = Math.min(TOURNAMENT.MAX_PRIZE, newPrize);
      const t = tourney.summary();
      t.prize = capped;
      await sendText(sock, jid,
        `✅ Prize pool updated to *${capped}* Metaworks!\n` +
        `🥇 1st: *${capped}* MW  🥈 2nd: *${Math.round(capped * 0.25)}* MW\n` +
        `🥉 3rd: *${Math.round(capped * 0.10)}* MW`, msg);
      return;
    }

    if (sub === 'time') {
      if (!canHost(sender)) {
        await sendText(sock, jid, `⛔ Only staff can adjust tournament time.`, msg);
        return;
      }
      const mins = parseInt(args[1], 10);
      if (!mins || isNaN(mins) || mins < 1 || mins > 60) {
        const cur = (customJoinWindowMs || TOURNAMENT.JOIN_WINDOW_MS) / 60000;
        await sendText(sock, jid, `⚠️ Usage: *!tournament time [1-60 minutes]*\nCurrent join window: *${cur} min*`, msg);
        return;
      }
      customJoinWindowMs = mins * 60000;
      await sendText(sock, jid, `✅ Join window set to *${mins} min*.`, msg);
      return;
    }

    if (sub === 'matchtime') {
      if (!canHost(sender)) {
        await sendText(sock, jid, `⛔ Only staff can adjust match time.`, msg);
        return;
      }
      const mins = parseInt(args[1], 10);
      if (!mins || isNaN(mins) || mins < 1 || mins > 120) {
        const cur = (customMatchWindowMs || TOURNAMENT.MATCH_WINDOW_MS) / 60000;
        await sendText(sock, jid, `⚠️ Usage: *!tournament matchtime [1-120 minutes]*\nCurrent match window: *${cur} min*`, msg);
        return;
      }
      customMatchWindowMs = mins * 60000;
      await sendText(sock, jid, `✅ Match window set to *${mins} min*.`, msg);
      return;
    }

    if (sub === 'end') {
      if (!canHost(sender)) {
        await sendText(sock, jid, `⛔ Only Moderators, Officers and the Owner can close the tournament.`, msg);
        return;
      }
      if (!tourney.isActive()) { await sendText(sock, jid, `ℹ️ No tournament open.`, msg); return; }
      if (tourney.summary().rounds) { await sendText(sock, jid, `ℹ️ Bracket already drawn.`, msg); return; }
      startBracket(sock);
      return;
    }

    if (sub === 'cancel') {
      if (!canHost(sender)) {
        await sendText(sock, jid, `⛔ Only staff can cancel a tournament.`, msg);
        return;
      }
      if (!tourney.isActive()) { await sendText(sock, jid, `ℹ️ No tournament open.`, msg); return; }
      tourney.cancel();
      if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
      await sendText(sock, jid, `🚫 Tournament cancelled.`, msg);
      return;
    }

    await sendText(sock, jid,
      `⚠️ Usage:\n` +
      `*!tournament start [classic|penalty] [prize]* — create tournament\n` +
      `*!tournament prize [amount]* — adjust prize before start\n` +
      `*!tournament time [1-60 min]* — set join window\n` +
      `*!tournament matchtime [1-120 min]* — set match window\n` +
      `*!tournament end* — draw bracket & start\n` +
      `*!tournament cancel* — cancel the tournament`, msg);
    return;
  }

  if (cmd === 'join') {
    if (!tourney.isActive()) { await sendText(sock, jid, `ℹ️ No tournament open right now.`, msg); return; }
    if (tourney.summary().rounds) { await sendText(sock, jid, `⚠️ Bracket already drawn — joins closed.`, msg); return; }
    const u = User.getByWhatsappId(sender);
    if (!u || !u.registered) { await sendText(sock, jid, `❌ Register first!`, msg); return; }
    if (tourney.addPlayer(sender)) {
      const count = tourney.summary().players.length;
      await sendText(sock, jid, `✅ *${u.name}* is IN! (${count}/${TOURNAMENT.MAX_PLAYERS}) 🔥`, msg);
    } else {
      await sendText(sock, jid, `ℹ️ You're already in, or it's full.`, msg);
    }
    return;
  }
}

module.exports = { handle };
