// commands/league.js
//   !league              — show all division tables
//   !league [div]        — show specific division (1-4)
//   !league table [div]  — show specific division table
//   !league start        — start new week (staff only)
//   !league end          — end current week & process promotions (staff only)
//   !league init         — initialize all existing players (owner only)
//   !league ai [count]   — add AI players to populate divisions (owner only)
//   !league ai remove    — remove all AI players (owner only)
//   !league info         — show current week info
//   !league history      — show promotion/relegation history
//   !league me           — show your division & stats
//   !league clear        — wipe all league data (owner only)
//   !league pause        — pause league (officer+)
//   !league resume       — resume league (officer+)
//   !league promote @user [div] — manual promote (officer+)
//   !league reset [div]  — reset all to division (officer+)

const User = require('../models/User');
const League = require('../models/League');
const { BRAND } = require('../config/constants');
const { sendText } = require('../utils/messaging');
const { resolveTarget } = require('./router');

function formString(form) {
  if (!form || form.length === 0) return '-';
  return form.map(r => {
    if (r === 'W') return '✅';
    if (r === 'D') return '🟡';
    return '❌';
  }).join('');
}

function divisionHeader(div, info) {
  const medal = div === 1 ? '🥇' : div === 2 ? '🥈' : div === 3 ? '🥉' : '🎓';
  return `${medal} *${info.name}* — ${info.subtitle} ${info.emoji}\n━━━━━━━━━━━━━━━━━━━━━━━`;
}

function formatDivisionTable(div, info, players, User) {
  let out = divisionHeader(div, info);

  if (players.length === 0) {
    out += '\n_No managers in this division yet._\n';
    return out;
  }

  out += '\n';
  players.forEach((p, i) => {
    const pos = i + 1;
    const name = User.getByWhatsappId(p.jid)?.name || 'Unknown';
    const crown = User.isOwner(p.jid) ? ' 👑' : '';
    const form = formString(p.form);
    const gd = p.goalDifference >= 0 ? `+${p.goalDifference}` : `${p.goalDifference}`;
    out += `${pos}. *${name}*${crown} — ${p.points}pts (${p.wins}W ${p.draws}D ${p.losses}L) GD:${gd} ${form}\n`;
  });

  return out;
}

async function handle({ sock, msg, jid, sender, args, user, replyTo, mentioned }) {
  const subcmd = (args[0] || '').toLowerCase();

  // ─── !league (no args) — show all divisions ──
  if (!subcmd || !isNaN(parseInt(subcmd))) {
    const targetDiv = parseInt(subcmd) || null;

    if (targetDiv) {
      // Show specific division
      if (targetDiv < 1 || targetDiv > League.TOTAL_DIVISIONS) {
        await sendText(sock, jid, `⚠️ Division must be between *1* and *4*.`, msg);
        return;
      }
      const info = League.DIVISIONS[targetDiv];
      const players = League.getDivisionStandings(targetDiv);
      const week = League.getWeekInfo();
      let out = `📅 *Week ${week.timeLeft} remaining*\n\n`;
      out += formatDivisionTable(targetDiv, info, players, User);
      out += `\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`;
      await sendText(sock, jid, out, msg);
      return;
    }

    // Show all divisions
    const allDivs = League.getAllDivisions();
    const week = League.getWeekInfo();
    let out = `⚽ *VOLTA LEAGUE* — Week ${week.timeLeft}\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (let div = 1; div <= League.TOTAL_DIVISIONS; div++) {
      const info = allDivs[div];
      out += divisionHeader(div, info) + '\n';

      if (info.players.length === 0) {
        out += '_Empty_\n\n';
        continue;
      }

      info.players.slice(0, 5).forEach((p, i) => {
        const name = User.getByWhatsappId(p.jid)?.name || p.name || 'Unknown';
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : `${i + 1}.`;
        out += `${medal} *${name}* — ${p.points}pts\n`;
      });

      if (info.players.length > 5) {
        out += `_...and ${info.players.length - 5} more_\n`;
      }
      out += '\n';
    }

    out += `💡 *!league [1-4]* for full table · *!league me* for your division\n`;
    out += `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`;
    await sendText(sock, jid, out, msg);
    return;
  }

  // ─── !league me — show user's division ──
  if (subcmd === 'me') {
    const me = User.getByWhatsappId(sender);
    if (!me?.registered) {
      await sendText(sock, jid, `⚠️ Register first with *!start*.`, msg);
      return;
    }

    const myDiv = League.getPlayerDivision(sender);
    if (!myDiv) {
      // Auto-assign to Division 3
      League.assignDivision(sender);
      const newDiv = League.getPlayerDivision(sender);
      let out = `🎓 *You've been placed in ${newDiv.name}!*\n\n`;
      out += formatDivisionTable(newDiv.division, newDiv, League.getDivisionStandings(newDiv.division), User);
      out += `\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`;
      await sendText(sock, jid, out, msg);
      return;
    }

    const stats = myDiv.stats;
    const form = formString(stats.form);
    const gd = stats.goalDifference >= 0 ? `+${stats.goalDifference}` : `${stats.goalDifference}`;
    const week = League.getWeekInfo();

    let out = `📅 *Week ${week.timeLeft} remaining*\n\n`;
    out += `${myDiv.emoji} *${myDiv.name}* — ${myDiv.subtitle}\n\n`;
    out += `📊 *Your Stats:*\n`;
    out += `• Points: *${stats.points}*\n`;
    out += `• Record: ${stats.wins}W ${stats.draws}D ${stats.losses}L\n`;
    out += `• Goals: ${stats.goalsFor} scored, ${stats.goalsAgainst} conceded\n`;
    out += `• Goal Diff: ${gd}\n`;
    out += `• Form: ${form}\n`;

    // Show position in division
    const divPlayers = League.getDivisionStandings(myDiv.division);
    const pos = divPlayers.findIndex(p => p.jid === sender) + 1;
    out += `• Position: #${pos} of ${divPlayers.length}\n`;

    // Promotion/relegation zone info
    if (divPlayers.length > 2) {
      if (pos <= 2 && myDiv.division > 1) {
        out += `\n📈 *Promotion Zone!* (Top 2 get promoted)`;
      } else if (pos >= divPlayers.length - 1 && myDiv.division < League.TOTAL_DIVISIONS) {
        out += `\n📉 *Relegation Zone!* (Bottom 2 get relegated)`;
      }
    }

    out += `\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`;
    await sendText(sock, jid, out, msg);
    return;
  }

  // ─── !league info — show week info ──
  if (subcmd === 'info') {
    const week = League.getWeekInfo();
    let out = `📅 *LEAGUE INFO*\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
    out += `• Current Week: *${week.timeLeft}*\n`;
    out += `• Week Ends: *${week.timeLeft}*\n`;
    out += `• Status: ${week.isActive ? '🟢 Active' : '🔴 Ended'}\n`;
    out += `\n🏆 *Champion gets 1,000,000 Metaworks!*\n`;
    out += `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`;
    await sendText(sock, jid, out, msg);
    return;
  }

  // ─── !league history — show history ──
  if (subcmd === 'history') {
    const history = League.getLeagueHistory();
    let out = `📜 *LEAGUE HISTORY*\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
    out += `• Total Weeks: *${history.totalWeeks}*\n`;

    if (history.champions.length > 0) {
      out += `\n🏆 *Champions:*\n`;
      history.champions.forEach(c => {
        const name = User.getByWhatsappId(c.jid)?.name || c.name || 'Unknown';
        out += `• Week ${c.week}: *${name}* (${c.points}pts)\n`;
      });
    } else {
      out += `\n_No champions yet._\n`;
    }

    out += `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`;
    await sendText(sock, jid, out, msg);
    return;
  }

  // ─── Staff/Owner commands below ──

  // ─── !league init — initialize all players (owner only) ──
  if (subcmd === 'init') {
    if (!User.isOwner(sender)) {
      await sendText(sock, jid, `⛔ Only the Owner can initialize the league.`, msg);
      return;
    }

    League.initializeExistingPlayers();
    const state = League.getState();
    let total = 0;
    for (let div = 1; div <= League.TOTAL_DIVISIONS; div++) {
      total += Object.keys(state.standings[div] || {}).length;
    }

    await sendText(sock, jid,
      `✅ *League initialized!*\n` +
      `• *${total}* players placed in 4 divisions\n` +
      `• Existing players → Division 3 (Junior)\n` +
      `• Hudson → Division 4 (Academy)\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
    return;
  }

  // ─── !league ai [count] — add AI players (owner only) ──
  if (subcmd === 'ai') {
    if (!User.isOwner(sender)) {
      await sendText(sock, jid, `⛔ Only the Owner can add AI players.`, msg);
      return;
    }

    const action = (args[1] || '').toLowerCase();

    if (action === 'remove') {
      const removed = League.removeAiPlayers();
      await sendText(sock, jid,
        `✅ *Removed ${removed} AI players* from the league.\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
      return;
    }

    const count = parseInt(args[1]) || 250;
    const aiPlayers = League.addAiPlayers(count);

    await sendText(sock, jid,
      `✅ *Added ${aiPlayers.length} AI players* to the league!\n` +
      `• Divisions populated with AI teams\n` +
      `• Use *!league ai remove* to clear them\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
    return;
  }

  // ─── !league start — start new week (staff only) ──
  if (subcmd === 'start') {
    if (!User.isStaff(user) && !User.isOwner(sender)) {
      await sendText(sock, jid, `⛔ Only staff can start a new league week.`, msg);
      return;
    }

    const result = League.startNewWeek();

    let out = `🆕 *WEEK ${result.week} STARTED!*\n━━━━━━━━━━━━━━━━━━━━━━━\n`;

    if (result.results.promoted.length > 0) {
      out += `\n📈 *PROMOTED:*\n`;
      result.results.promoted.forEach(p => {
        const name = User.getByWhatsappId(p.jid)?.name || p.name || 'Unknown';
        out += `• ${name}: Division ${p.from} → ${p.to}\n`;
      });
    }

    if (result.results.relegated.length > 0) {
      out += `\n📉 *RELEGATED:*\n`;
      result.results.relegated.forEach(r => {
        const name = User.getByWhatsappId(r.jid)?.name || r.name || 'Unknown';
        out += `• ${name}: Division ${r.from} → ${r.to}\n`;
      });
    }

    if (result.results.champions.length > 0) {
      out += `\n🏆 *CHAMPION:*\n`;
      result.results.champions.forEach(c => {
        const name = User.getByWhatsappId(c.jid)?.name || c.name || 'Unknown';
        const paid = (result.paid || []).find(x => x.jid === c.jid);
        out += `• ${name} — *${(c.reward || 0).toLocaleString()} Metaworks*${paid ? ' ✅ paid' : ' (not paid — AI or unregistered)'}\n`;
      });
      out += `\n♻️ All tables reset to zero for the new week.\n`;
    }

    out += `\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`;
    await sendText(sock, jid, out, msg);
    return;
  }

  // ─── !league end — end current week (staff only) ──
  if (subcmd === 'end') {
    if (!User.isStaff(user) && !User.isOwner(sender)) {
      await sendText(sock, jid, `⛔ Only staff can end the league week.`, msg);
      return;
    }

    const results = League.endCurrentWeek();

    let out = `📅 *WEEK ENDED!*\n━━━━━━━━━━━━━━━━━━━━━━━\n`;

    if (results.promoted.length > 0) {
      out += `\n📈 *PROMOTED:*\n`;
      results.promoted.forEach(p => {
        const name = User.getByWhatsappId(p.jid)?.name || p.name || 'Unknown';
        out += `• ${name}: Division ${p.from} → ${p.to}\n`;
      });
    }

    if (results.relegated.length > 0) {
      out += `\n📉 *RELEGATED:*\n`;
      results.relegated.forEach(r => {
        const name = User.getByWhatsappId(r.jid)?.name || r.name || 'Unknown';
        out += `• ${name}: Division ${r.from} → ${r.to}\n`;
      });
    }

    if (results.champions.length > 0) {
      out += `\n🏆 *CHAMPION:*\n`;
      results.champions.forEach(c => {
        const name = User.getByWhatsappId(c.jid)?.name || c.name || 'Unknown';
        // NOTE: the prize is paid inside League.endCurrentWeek() via
        // payChampions(). Do not credit it again here.
        const paid = (results.paid || []).find(x => x.jid === c.jid);
        out += `• ${name} — *${c.reward.toLocaleString()} Metaworks*${paid ? ' ✅ paid' : ' (not paid — AI or unregistered)'}\n`;
      });
    }

    out += `\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`;
    await sendText(sock, jid, out, msg);
    return;
  }

  // ─── !league form — the division ranked by recent results ───
  if (subcmd === 'form') {
    const arg = parseInt(args[1], 10);
    const mine = League.getPlayerDivision(sender);
    const div = (arg >= 1 && arg <= 4) ? arg : (mine ? mine.division : 3);
    const rows = League.getFormTable(div);
    if (!rows.length) {
      await sendText(sock, jid, `📊 Division ${div} is empty.`, msg);
      return;
    }
    let out = `📈 *DIVISION ${div} — FORM*\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
    out += `_Last five games. Not the table — who is playing well right now._\n\n`;
    rows.slice(0, 12).forEach((r, i) => {
      const u = r.isAi ? null : User.getByWhatsappId(r.jid);
      const name = (u && u.name) || r.name || 'Unknown';
      const you = r.jid === sender ? ' ⬅️' : '';
      out += `${String(i + 1).padStart(2)}. *${name}*${you}\n`;
      out += `    ${r.form}  ·  ${r.formPoints} pts\n`;
    });
    out += `\n━━━━━━━━━━━━━━━━━━━━━━━\n*!league* for the real table.\n${BRAND}`;
    await sendText(sock, jid, out, msg);
    return;
  }

  // ─── !league repair — fix corrupted standings (owner only) ───
  if (subcmd === 'repair') {
    if (!User.isOwner(sender)) {
      await sendText(sock, jid, `⛔ Only the Owner can repair league data.`, msg);
      return;
    }
    const fixed = League.repairIntegrity();
    const clean = fixed.duplicates === 0 && fixed.rebuiltStats === 0 && fixed.recalculatedPoints === 0;
    let out = `🔧 *LEAGUE INTEGRITY CHECK*\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
    if (clean) {
      out += `\n✅ Nothing to fix — every table is consistent.\n`;
    } else {
      out += `\n• Duplicate entries removed: *${fixed.duplicates}*\n`;
      out += `• Records rebuilt: *${fixed.rebuiltStats}*\n`;
      out += `• Point totals recalculated: *${fixed.recalculatedPoints}*\n`;
      out += `\nThese are managers who were sitting in two divisions at once, or\nwhose points disagreed with their W/D/L record.\n`;
    }
    out += `\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`;
    await sendText(sock, jid, out, msg);
    return;
  }

  // ─── !league clear — wipe all league data (owner only) ───
  if (subcmd === 'clear') {
    if (!User.isOwner(sender)) {
      await sendText(sock, jid, `⛔ Only the Owner can clear league data.`, msg);
      return;
    }
    League.clearAll();
    await sendText(sock, jid,
      `🗑️ *ALL LEAGUE DATA CLEARED!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `All divisions wiped. Use *!league init* to re-populate.\n${BRAND}`, msg);
    return;
  }

  // ─── !league pause — pause league (officer+) ───
  if (subcmd === 'pause') {
    if (!User.isOwner(sender) && !User.isStaff(user)) {
      await sendText(sock, jid, `⛔ Only staff can pause the league.`, msg);
      return;
    }
    League.setPaused(true);
    await sendText(sock, jid,
      `⏸️ *LEAGUE PAUSED*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `No new weeks will process until resumed.\n` +
      `Use *!league resume* to continue.\n${BRAND}`, msg);
    return;
  }

  // ─── !league resume — resume league (officer+) ───
  if (subcmd === 'resume') {
    if (!User.isOwner(sender) && !User.isStaff(user)) {
      await sendText(sock, jid, `⛔ Only staff can resume the league.`, msg);
      return;
    }
    League.setPaused(false);
    await sendText(sock, jid,
      `▶️ *LEAGUE RESUMED*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `League is active again!\n${BRAND}`, msg);
    return;
  }

  // ─── !league promote @user [div] — manual promote (officer+) ───
  if (subcmd === 'promote') {
    if (!User.isOwner(sender) && !User.isStaff(user)) {
      await sendText(sock, jid, `⛔ Only staff can manually promote players.`, msg);
      return;
    }
    const targetJid = resolveTarget(args.slice(1), { replyTo, mentioned });
    if (!targetJid) {
      await sendText(sock, jid, `⚠️ Usage: *!league promote @user [division]*\nDivision: 1-4`, msg);
      return;
    }
    const targetDiv = parseInt(args[2]) || 3;
    const targetUser = User.getByWhatsappId(targetJid);
    const result = League.promoteToDivision(targetJid, targetDiv);
    if (result.error) {
      await sendText(sock, jid, `❌ ${result.error}`, msg);
      return;
    }
    await sendText(sock, jid,
      `📈 *MANUAL PROMOTION!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `*${targetUser?.name || targetJid.split('@')[0]}* moved: Division ${result.from} → ${result.to}\n` +
      `${League.DIVISIONS[result.to].emoji} ${League.DIVISIONS[result.to].name} — ${League.DIVISIONS[result.to].subtitle}\n` +
      `Stats reset for fresh start.\n${BRAND}`, msg);
    return;
  }

  // ─── !league reset [div] — reset all players to a division (officer+) ───
  if (subcmd === 'reset') {
    if (!User.isOwner(sender) && !User.isStaff(user)) {
      await sendText(sock, jid, `⛔ Only staff can reset league divisions.`, msg);
      return;
    }
    const targetDiv = parseInt(args[1]) || 3;
    const result = League.resetAllToDivision(targetDiv);
    if (result.error) {
      await sendText(sock, jid, `❌ ${result.error}`, msg);
      return;
    }
    await sendText(sock, jid,
      `🔄 *ALL PLAYERS RESET!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `*${result.moved}* players moved to ${League.DIVISIONS[result.division].emoji} ${League.DIVISIONS[result.division].name}\n` +
      `All stats cleared. Everyone starts fresh.\n${BRAND}`, msg);
    return;
  }

  // Unknown subcommand
  await sendText(sock, jid,
    `❓ Usage:\n` +
    `*!league* — show all divisions\n` +
    `*!league [1-4]* — show specific division\n` +
    `*!league me* — your division & stats\n` +
    `*!league info* — current week info\n` +
    `*!league history* — past champions\n` +
    `*!league pause/resume* — pause or resume (staff)\n` +
    `*!league promote @user [div]* — manual promote (staff)\n` +
    `*!league reset [div]* — reset all to division (staff)\n` +
    `*!league clear* — wipe all data (owner)\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
}

module.exports = { handle };
