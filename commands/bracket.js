// commands/bracket.js
//   !bracket — view the current tournament bracket with round names
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
    const size = t.players?.length || rounds[0]?.length * 2 || 0;
    let out = `🏆 *TOURNAMENT BRACKET* (${TOURNAMENT.CATEGORIES[t.category]?.label || t.category})\n`;
    out += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    out += `💲 Prize: *${t.prize}* Metaworks   👥 ${t.players?.length || 0} entrants\n`;
    if (!rounds.length) {
      out += `\n⏳ Bracket not drawn yet — *!join* to enter, then the host runs *!tournament end*.\n`;
    } else {
      rounds.forEach((round, ri) => {
        const label = roundLabel(round.length) || `Round ${ri + 1}`;
        out += `\n*${label}*\n`;
        round.forEach((m) => {
          const aWin = m.winner && tourney.eff(m.a) === m.winner;
          const bWin = m.winner && tourney.eff(m.b) === m.winner;
          const a = m.winner ? (aWin ? `✅ ${nameOf(m.a)}` : nameOf(m.a)) : nameOf(m.a);
          const b = m.winner ? (bWin ? `✅ ${nameOf(m.b)}` : nameOf(m.b)) : nameOf(m.b);
          const tag = m.simulated ? ' (sim)' : '';
          out += `  ${a}  vs  ${b}${tag}\n`;
        });
      });
    }
    out += `━━━━━━━━━━━━━━━━━━━━━━━\n💡 Resolve your tie with *!tchallenge* (real PvP) or *!tourneyplay* (sim). ${BRAND}`;
    await sendText(sock, jid, out);
    return;
  }
}

function roundLabel(n) {
  return tourney.roundLabelForSize(n);
}

module.exports = { handle };
