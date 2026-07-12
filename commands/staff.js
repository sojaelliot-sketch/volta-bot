// commands/staff.js
//   !giveaway [amount] [winners] — owner/officer/moderator (limited)
//   !tournament start [cat] [prize] — owner/officer/moderator; opens join window
//       cat: classic | penalty   (default classic)
//   !join                        — any registered user joins the open tournament
//   !tourneyplay                 — resolve your current bracket tie (simulated)
//   !tournament end              — owner/officer closes joins & builds the bracket
const User = require('../models/User');
const { GIVEAWAY, TOURNAMENT, BRAND } = require('../config/constants');
const { sendText } = require('../utils/messaging');
const tourney = require('../game-engine/tournament');

let lastGiveaway = 0;
let lastTournament = 0;
let joinTimer = null;

function canHost(sender) {
  if (User.isOwner(sender)) return true;
  const u = User.getByWhatsappId(sender);
  return User.roleRank(u?.role) >= User.roleRank('moderator');
}

function announceBracket(sock, t) {
  const rounds = t.rounds || [];
  let out = `🏆 *TOURNAMENT BRACKET* (${TOURNAMENT.CATEGORIES[t.category]?.label || t.category})\n`;
  out += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  rounds.forEach((round, ri) => {
    out += `*\nRound ${ri + 1}*\n`;
    round.forEach((m) => {
      const a = m.winner ? (tourney.eff(m.a) === m.winner ? `✅ ${nameOf(m.a)}` : nameOf(m.a)) : nameOf(m.a);
      const b = m.winner ? (tourney.eff(m.b) === m.winner ? `✅ ${nameOf(m.b)}` : nameOf(m.b)) : nameOf(m.b);
      out += `  ${a}  vs  ${b}\n`;
    });
  });
  out += `━━━━━━━━━━━━━━━━━━━━━━━\n💡 Resolve your tie by playing (!challenge / !penalty) — auto-sim if you miss the window.`;
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
    announceBracket(sock, tourney.summary());
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
    // find this player's first pending tie
    const m = (t.rounds || []).flat().find(mm => !mm.winner && !mm.simulated && (tourney.eff(mm.a) === sender || tourney.eff(mm.b) === sender));
    if (!m) { await sendText(sock, jid, `ℹ️ You have no pending tie (or it already resolved).`, msg); return; }
    const opp = tourney.eff(m.a) === sender ? tourney.eff(m.b) : tourney.eff(m.a);
    const winner = Math.random() < 0.5 ? sender : opp; // 50/50 simulated; real play via challenge/penalty overrides
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

      // category + prize (order flexible): [cat] [prize] or [prize] [cat]
      let cat = 'classic';
      let prize = 1000;
      for (const a of args.slice(1)) {
        if (TOURNAMENT.CATEGORIES[a.toLowerCase()]) cat = a.toLowerCase();
        else if (!isNaN(parseInt(a, 10))) prize = parseInt(a, 10);
      }
      prize = Math.min(TOURNAMENT.MAX_PRIZE, Math.max(100, prize));

      tourney.create({ category: cat, prize, host: sender, chatJid: jid, sock });
      lastTournament = now;
      joinTimer = setTimeout(() => startBracket(sock), TOURNAMENT.JOIN_WINDOW_MS);

      await sendText(sock, jid,
        `🏆 *TOURNAMENT OPEN!* 🔥\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🎮 Category: *${TOURNAMENT.CATEGORIES[cat].label}*\n` +
        `💲 Prize pool: *${prize}* Metaworks\n` +
        `🎮 Type *!join* to enter (max ${TOURNAMENT.MAX_PLAYERS})\n` +
        `⏳ Joins close in ${TOURNAMENT.JOIN_WINDOW_MS / 1000}s — then the bracket is drawn!\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
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

    await sendText(sock, jid, `⚠️ Usage:\n*!tournament start [classic|penalty] [prize]*\n*!tournament end*`, msg);
    return;
  }

  if (cmd === 'join') {
    if (!tourney.isActive()) { await sendText(sock, jid, `ℹ️ No tournament open right now.`, msg); return; }
    if (tourney.summary().rounds) { await sendText(sock, jid, `⚠️ Bracket already drawn — joins closed.`, msg); return; }
    const u = User.getByWhatsappId(sender);
    if (!u || !u.registered) { await sendText(sock, jid, `❌ Register first!`, msg); return; }
    if (tourney.addPlayer(sender)) {
      await sendText(sock, jid, `✅ *${u.name}* is IN! (${tourney.summary().players.length}/${TOURNAMENT.MAX_PLAYERS}) 🔥`, msg);
    } else {
      await sendText(sock, jid, `ℹ️ You're already in, or it's full.`, msg);
    }
    return;
  }
}

module.exports = { handle };
