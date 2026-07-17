// commands/tbet.js
//   !tbet                      — show the open tournament & who you can back
//   !tbet <player> <stake>     — bet <stake> Metaworks on <player> to win it all
// The pick can be a manager name (partial ok), a number, or an @mention/reply.
// Bets pay out TBET.PAYOUT_MULT × stake if your pick wins the tournament.
const User = require('../models/User');
const tourney = require('../game-engine/tournament');
const { money } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');
const { TBET, BRAND } = require('../config/constants');

function resolvePick(arg, players, ctx) {
  if (ctx.replyTo && players.includes(ctx.replyTo)) return ctx.replyTo;
  if (ctx.mentioned && players.includes(ctx.mentioned)) return ctx.mentioned;
  if (!arg) return null;
  const raw = String(arg).replace(/^@/, '').trim();
  // number → jid
  if (/^\d{6,}$/.test(raw)) {
    const jid = `${raw}@s.whatsapp.net`;
    return players.find((p) => User.normalizeJid(p) === User.normalizeJid(jid)) || null;
  }
  // name (exact then partial) among the tournament players
  const s = raw.toLowerCase();
  let exact = null, partial = null;
  for (const jid of players) {
    const name = String(User.getByWhatsappId(jid)?.name || '').toLowerCase();
    if (name === s) exact = jid;
    else if (name.includes(s) && !partial) partial = jid;
  }
  return exact || partial;
}

function listPlayers() {
  const t = tourney.summary();
  if (!t) return '';
  return t.players
    .map((jid) => `• *${User.getByWhatsappId(jid)?.name || jid.split('@')[0]}*`)
    .join('\n');
}

async function handle({ sock, msg, jid, sender, args, replyTo, mentioned }) {
  const t = tourney.summary();
  if (!t) {
    await sendText(sock, jid, `🎲 There's no tournament running right now. Bets open when one is created.`, msg);
    return;
  }

  // ── show status / your current bet ──
  if (!args.length) {
    const mine = tourney.getBet(sender);
    const open = tourney.bettingOpen();
    let out = `🎲 *TOURNAMENT BETTING*\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
    out += open
      ? `🟢 Betting is *OPEN* (until the bracket starts)\n`
      : `🔴 Betting is *CLOSED* (tournament already underway)\n`;
    out += `👥 Contenders:\n${listPlayers() || '_none yet_'}\n`;
    out += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    if (mine) {
      out += `🎯 Your bet: *${money(mine.stake)}* on *${User.getByWhatsappId(mine.pick)?.name || '???'}*\n`;
      out += `   Pays *${money(Math.round(mine.stake * TBET.PAYOUT_MULT))}* if they win.\n`;
    } else if (open) {
      out += `💡 Place one with:\n*!tbet <player> <stake>*\n`;
      out += `Stake ${money(TBET.MIN_STAKE)}–${money(TBET.MAX_STAKE)} · pays *${TBET.PAYOUT_MULT}×* on a win.\n`;
    }
    out += BRAND;
    await sendText(sock, jid, out, msg);
    return;
  }

  if (!tourney.bettingOpen()) {
    await sendText(sock, jid, `🔴 Betting is closed — the tournament is already underway.`, msg);
    return;
  }

  // ── parse: last numeric arg is the stake, the rest is the player pick ──
  const stakeArg = args[args.length - 1];
  const stake = parseInt(stakeArg, 10);
  if (!Number.isFinite(stake)) {
    await sendText(sock, jid, `⚠️ Usage: *!tbet <player> <stake>*\nExample: *!tbet Oasis FC 200*`, msg);
    return;
  }
  const pickArg = args.slice(0, -1).join(' ').trim();
  const pickJid = resolvePick(pickArg, t.players, { replyTo, mentioned });
  if (!pickJid) {
    await sendText(sock, jid, `❌ Couldn't match *${pickArg || '(nobody)'}* to a contender. Send *!tbet* to see who's in.`, msg);
    return;
  }

  const res = tourney.placeBet(sender, pickJid, stake);
  if (!res.ok) {
    const reasons = {
      closed: '🔴 Betting is closed.',
      not_a_player: '❌ That manager isn\'t in the tournament.',
      already_bet: '⚠️ You already placed a bet on this tournament.',
      bad_stake: `⚠️ Stake must be between ${money(TBET.MIN_STAKE)} and ${money(TBET.MAX_STAKE)}.`,
      poor: '❌ You don\'t have enough Metaworks for that stake.',
      no_user: '❌ Register first with *!start*.',
      no_tournament: '🎲 No tournament running.',
    };
    await sendText(sock, jid, reasons[res.error] || '❌ Could not place that bet.', msg);
    return;
  }

  const payout = Math.round(stake * TBET.PAYOUT_MULT);
  await sendText(sock, jid,
    `🎯 *Bet placed!*\nYou staked *${money(stake)}* on *${User.getByWhatsappId(pickJid)?.name}* to win it all.\n` +
    `💰 Pays *${money(payout)}* if they lift the trophy. Good luck!\n${BRAND}`, msg);
}

module.exports = { handle };
