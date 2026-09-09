// commands/bracket.js
//   !bracket — view the current tournament bracket with round names & match order
const User = require('../models/User');
const tourney = require('../game-engine/tournament');
const { TOURNAMENT, BRAND } = require('../config/constants');
const { sendText } = require('../utils/messaging');

function nameOf(x) {
  if (!x || x === 'BYE') return 'BYE';
  if (typeof x === 'object') return nameOf(x.winner) || 'TBD';
  return User.getByWhatsappId(x)?.name || x.split('@')[0];
}

async function handle({ sock, msg, jid, sender, cmd, args }) {
  if (cmd === 'bracket' || cmd === 'brackets' || cmd === 'tbv') {
    if (!tourney.isActive()) {
      await sendText(sock, jid, `ℹ️ No tournament is running right now.`, msg);
      return;
    }
    const t = tourney.summary();
    const rounds = t.rounds || [];
    const size = t.playerCount || t.players?.length || 0;

    let out = `🏆 *TOURNAMENT BRACKET* (${TOURNAMENT.CATEGORIES[t.category]?.label || t.category})\n`;
    out += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    out += `💲 Prize: *${t.prize}* MW   👥 ${size} players\n`;
    out += `🥇 1st: *${t.prize}* MW  🥈 2nd: *${Math.round(t.prize * 0.25)}* MW\n`;
    if (size >= 3) out += `🥉 3rd: *${Math.round(t.prize * 0.10)}* MW\n`;
    out += `━━━━━━━━━━━━━━━━━━━━━━━\n`;

    if (!rounds.length) {
      out += `\n⏳ Bracket not drawn yet — *!join* to enter, then the host runs *!tournament end*.\n`;
    } else {
      rounds.forEach((round, ri) => {
        const firstMatch = round[0];
        const label = firstMatch?.label || `Round ${ri + 1}`;
        out += `\n*${label}*\n`;
        round.forEach((m) => {
          const aWin = m.winner && tourney.eff(m.a) === m.winner;
          const bWin = m.winner && tourney.eff(m.b) === m.winner;
          const a = m.winner ? (aWin ? `✅ ${nameOf(m.a)}` : `❌ ${nameOf(m.a)}`) : nameOf(m.a);
          const b = m.winner ? (bWin ? `✅ ${nameOf(m.b)}` : `❌ ${nameOf(m.b)}`) : nameOf(m.b);
          const tag = m.simulated ? ' (sim)' : '';
          const status = m.winner ? ' ✔️' : (m.dueAt ? ' ⏳' : '');
          out += `  ${a}  vs  ${b}${tag}${status}\n`;
        });
      });

      // Show 3rd place match if it exists
      if (t.thirdPlaceMatch) {
        const tpm = t.thirdPlaceMatch;
        if (tpm.a && tpm.b) {
          const aWin = tpm.winner && tourney.eff(tpm.a) === tpm.winner;
          const bWin = tpm.winner && tourney.eff(tpm.b) === tpm.winner;
          const a = tpm.winner ? (aWin ? `✅ ${nameOf(tpm.a)}` : `❌ ${nameOf(tpm.a)}`) : nameOf(tpm.a);
          const b = tpm.winner ? (bWin ? `✅ ${nameOf(tpm.b)}` : `❌ ${nameOf(tpm.b)}`) : nameOf(tpm.b);
          const tag = tpm.simulated ? ' (sim)' : '';
          out += `\n*🥉 3RD PLACE MATCH*\n  ${a}  vs  ${b}${tag}\n`;
        } else {
          out += `\n*🥉 3RD PLACE MATCH*\n  (awaiting semifinal results)\n`;
        }
      }

      // Show pending matches
      const pending = tourney.getPendingMatches();
      if (pending.length > 0) {
        out += `\n📋 *MATCH ORDER — Play these next:*\n`;
        pending.forEach((m, i) => {
          const label = m.label || `Match ${i + 1}`;
          out += `  ${i + 1}. ${label}: ${nameOf(eff(m.a) || m.a)} vs ${nameOf(eff(m.b) || m.b)}\n`;
        });
      }
    }

    out += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    out += `💡 Play your tie with *!tchallenge* (PvP) or *!tourneyplay* (sim). ${BRAND}`;
    await sendText(sock, jid, out);
    return;
  }
}

function eff(x) {
  return tourney.eff(x);
}

module.exports = { handle };
