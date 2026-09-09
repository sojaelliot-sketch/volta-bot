const User = require('../models/User');
const Player = require('../models/Player');
const Tournament = require('../models/Tournament');
const { sendText } = require('../utils/messaging');
const { BRAND } = require('../config/constants');
const { getCompLink, getCompName } = require('../config/competitionGCs');

async function tournamentCommand({ sock, msg, jid, sender, args, user }) {
  if (!user || !user.registered) {
    await sendText(sock, jid, `⚠️ Register first with *!register [name]*`, msg);
    return;
  }

  const subcmd = (args[0] || '').toLowerCase();

  // ─── !competitions — list all ───
  if (!subcmd || subcmd === 'list') {
    const tournaments = Tournament.getAllTournaments();
    let output = `🏆 *COMPETITIONS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    const cups = tournaments.filter(t => t.type === 'cup');
    const internationals = tournaments.filter(t => t.type === 'international');

    output += `⚽ *Club Cups:*\n`;
    for (const t of cups) {
      const spots = `${t.participants.length}/${t.maxParticipants}`;
      const status = t.status === 'registration' ? '🟢 Open' : t.status === 'active' ? '🔴 Live' : '✅ Done';
      const reqs = t.requirements || {};
      const reqText = reqs.minWins ? `${reqs.minWins}W ` : '';
      output += `${t.emoji} *${t.name}*\n`;
      output += `  🆔 ID: *${t.id}*\n`;
      output += `  💰 Prize: ${(t.prize/1000).toFixed(0)}K MW | Fee: ${t.entryFee > 0 ? (t.entryFee/1000).toFixed(0)+'K' : 'FREE'}\n`;
      output += `  👥 Spots: ${spots} | Min: ${t.minParticipants} | ${status}\n`;
      if (reqText) output += `  📋 Reqs: ${reqText}Min ${t.minOVR} OVR\n`;
      output += `\n`;
    }

    output += `🌍 *International:*\n`;
    for (const t of internationals) {
      const spots = `${t.participants.length}/${t.maxParticipants}`;
      const status = t.status === 'registration' ? '🟢 Open' : t.status === 'active' ? '🔴 Live' : '✅ Done';
      const reqs = t.requirements || {};
      const reqText = reqs.minWins ? `${reqs.minWins}W ` : '';
      output += `${t.emoji} *${t.name}*\n`;
      output += `  🆔 ID: *${t.id}*\n`;
      output += `  💰 Prize: ${(t.prize/1000).toFixed(0)}K MW | Fee: FREE\n`;
      output += `  👥 Spots: ${spots} | Min: ${t.minParticipants} | ${status}\n`;
      if (reqText) output += `  📋 Reqs: ${reqText}Min ${t.minOVR} OVR\n`;
      output += `\n`;
    }

    output += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    output += `Use *!competitions info [id]* for details\n`;
    output += `Use *!competitions join [id]* to enter\n`;
    output += `Use *!competitions bracket [id]* to view bracket\n${BRAND}`;
    await sendText(sock, jid, output, msg);
    return;
  }

  // ─── !competitions info [id] ───
  if (subcmd === 'info') {
    const id = args[1];
    if (!id) {
      await sendText(sock, jid, `Usage: *!competitions info [tournament_id]*`, msg);
      return;
    }
    const t = Tournament.getTournament(id);
    if (!t) {
      await sendText(sock, jid, `❌ Tournament not found. Use *!competitions* to see list.`, msg);
      return;
    }

    const userCheck = Tournament.canJoinTournament(sender, id);

    let output = `${t.emoji} *${t.name}*\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
    output += `${t.description}\n\n`;
    output += `💰 *Prize Pool:* ${(t.prize/1000).toFixed(0)}K MW\n`;
    output += `🎟️ *Entry Fee:* ${t.entryFee > 0 ? (t.entryFee/1000).toFixed(0)+'K MW' : 'FREE'}\n`;
    output += `👥 *Spots:* ${t.participants.length}/${t.maxParticipants} (min ${t.minParticipants} to start)\n`;
    output += `⭐ *Min OVR:* ${t.minOVR}\n`;
    output += `📊 *Status:* ${t.status}\n\n`;

    // Requirements
    const reqs = t.requirements || {};
    if (Object.keys(reqs).length > 0) {
      output += `📋 *Requirements:*\n`;
      if (reqs.minWins) output += `  • ${reqs.minWins} wins (you: ${user.wins || 0}) ${(user.wins || 0) >= reqs.minWins ? '✅' : '❌'}\n`;
      if (reqs.minTrophies) {
        const trophies = (user.trophies?.league?.length || 0) + (user.trophies?.tournaments?.length || 0) + (user.trophies?.cups?.length || 0);
        output += `  • ${reqs.minTrophies} trophies (you: ${trophies}) ${trophies >= reqs.minTrophies ? '✅' : '❌'}\n`;
      }
      if (reqs.minMMR) output += `  • ${reqs.minMMR} MMR (you: ${user.mmr || 1000}) ${(user.mmr || 1000) >= reqs.minMMR ? '✅' : '❌'}\n`;
      output += `\n`;
    }

    // Qualification
    if (t.requiresQualification) {
      output += `🔒 *Qualification Required:*\n`;
      output += `  Through: ${t.qualificationTournaments?.join(', ') || 'N/A'}\n`;
      const qualified = Tournament.qualifiesFor(sender, id);
      output += `  Your status: ${qualified ? '✅ Qualified' : '❌ Not qualified'}\n\n`;
    }

    // Your status
    output += `👤 *Your Status:* ${userCheck.ok ? '✅ Can join' : '❌ ' + userCheck.error}\n\n`;

    // Participants
    if (t.participants.length > 0) {
      output += `👥 *Participants (${t.participants.length}):*\n`;
      const lb = Tournament.getLeaderboard(id);
      for (const p of lb.slice(0, 10)) {
        const pu = User.getByWhatsappId(p.userId);
        output += `  ${p.position}. ${pu?.name || 'Unknown'} (${p.wins}W-${p.losses}L)\n`;
      }
      if (t.participants.length > 10) output += `  ... and ${t.participants.length - 10} more\n`;
    }

    // Winner
    if (t.winner) {
      const winnerUser = User.getByWhatsappId(t.winner);
      output += `\n🏆 *Winner:* ${winnerUser?.name || 'Unknown'}\n`;
    }

    output += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    output += `Use *!competitions join ${id}* to enter\n`;
    output += `Use *!competitions bracket ${id}* to view bracket\n${BRAND}`;
    await sendText(sock, jid, output, msg);
    return;
  }

  // ─── !competitions join [id] ───
  if (subcmd === 'join') {
    const id = args[1];
    if (!id) {
      await sendText(sock, jid, `Usage: *!competitions join [tournament_id]*`, msg);
      return;
    }
    const t = Tournament.getTournament(id);
    if (!t) {
      await sendText(sock, jid, `❌ Tournament not found.`, msg);
      return;
    }

    const result = Tournament.joinTournament(id, sender);
    if (result.error) {
      await sendText(sock, jid, `❌ ${result.error}`, msg);
      return;
    }

    if (result.entryFee > 0) {
      User.update(sender, { currency: (user.currency || 0) - result.entryFee });
    }

    // GC link
    const gcLink = getCompLink(id);
    const gcName = getCompName(id);

    await sendText(sock, jid,
      `✅ *JOINED ${t.name.toUpperCase()}!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Entry Fee: ${result.entryFee > 0 ? (result.entryFee/1000).toFixed(0)+'K MW' : 'FREE'}\n` +
      `Your OVR: ${result.avgOVR}\n` +
      `Spots: ${t.participants.length}/${t.maxParticipants}\n` +
      `Min to start: ${t.minParticipants}\n` +
      (t.participants.length >= t.minParticipants
        ? `\n🟢 *Tournament has enough participants!*`
        : `\n⏳ Need ${t.minParticipants - t.participants.length} more to start`) +
      (gcLink ? `\n\n📲 *Join the Competition GC:*\n${gcName}\n${gcLink}` : '') +
      `\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
    return;
  }

  // ─── !competitions leave [id] ───
  if (subcmd === 'leave') {
    const id = args[1];
    if (!id) {
      await sendText(sock, jid, `Usage: *!competitions leave [tournament_id]*`, msg);
      return;
    }
    const result = Tournament.leaveTournament(id, sender);
    if (result.error) {
      await sendText(sock, jid, `❌ ${result.error}`, msg);
      return;
    }
    await sendText(sock, jid, `✅ Left the tournament. Entry fee is non-refundable.`, msg);
    return;
  }

  // ─── !competitions bracket [id] ───
  if (subcmd === 'bracket') {
    const id = args[1];
    if (!id) {
      await sendText(sock, jid, `Usage: *!competitions bracket [tournament_id]*`, msg);
      return;
    }
    const t = Tournament.getTournament(id);
    if (!t) {
      await sendText(sock, jid, `❌ Tournament not found.`, msg);
      return;
    }
    if (!t.bracket || t.bracket.length === 0) {
      await sendText(sock, jid,
        `📋 *${t.name}*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Bracket not yet generated.\n` +
        `Status: ${t.status}\n` +
        `Participants: ${t.participants.length}/${t.maxParticipants}\n` +
        (t.status === 'registration' ? `\nUse *!competitions start ${id}* (owner) to begin!` : '') +
        `\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
      return;
    }

    let output = `${t.emoji} *${t.name} BRACKET*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (let r = 0; r < t.bracket.length; r++) {
      const round = t.bracket[r];
      const roundNames = ['First Round', 'Quarter-Finals', 'Semi-Finals', 'Final'];
      const roundIdx = t.bracket.length - 1 - r;
      const roundName = roundNames[roundIdx] || `Round ${r + 1}`;

      output += `📅 *${roundName}:*\n`;
      for (const match of round) {
        const team1 = match.team1 ? User.getByWhatsappId(match.team1) : null;
        const team2 = match.team2 ? User.getByWhatsappId(match.team2) : null;
        const t1Name = team1?.name || (match.team1 ? 'TBD' : 'BYE');
        const t2Name = team2?.name || (match.team2 ? 'TBD' : 'BYE');

        if (match.status === 'bye') {
          output += `  ⏭️ ${t1Name} advances (bye)\n`;
        } else if (match.status === 'completed') {
          const winner = User.getByWhatsappId(match.winner);
          output += `  ✅ ${t1Name} ${match.score1 || 0} - ${match.score2 || 0} ${t2Name} → ${winner?.name || 'Unknown'}\n`;
        } else if (match.status === 'pending') {
          output += `  🔜 ${t1Name} vs ${t2Name}\n`;
        } else {
          output += `  ⏳ ${t1Name} vs ${t2Name} (waiting)\n`;
        }
      }
      output += `\n`;
    }

    if (t.winner) {
      const winnerUser = User.getByWhatsappId(t.winner);
      output += `🏆 *CHAMPION:* ${winnerUser?.name || 'Unknown'}\n`;
    }

    output += `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`;
    await sendText(sock, jid, output, msg);
    return;
  }

  // ─── !competitions start [id] — owner only ───
  if (subcmd === 'start') {
    if (!User.isOwner(sender)) {
      await sendText(sock, jid, `⛔ Only the Owner can start tournaments.`, msg);
      return;
    }
    const id = args[1];
    if (!id) {
      await sendText(sock, jid, `Usage: *!competitions start [tournament_id]*`, msg);
      return;
    }
    const result = Tournament.startTournament(id);
    if (result.error) {
      await sendText(sock, jid, `❌ ${result.error}`, msg);
      return;
    }
    const t = Tournament.getTournament(id);
    await sendText(sock, jid,
      `🎉 *${t.name.toUpperCase()} STARTED!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${t.participants.length} participants\n` +
      `Bracket generated!\n\n` +
      `Use *!competitions bracket ${id}* to view\n${BRAND}`, msg);
    return;
  }

  // ─── !competitions qualify [tournamentId] @user — owner qualifies a team ───
  if (subcmd === 'qualify') {
    if (!User.isOwner(sender)) {
      await sendText(sock, jid, `⛔ Only the Owner can qualify teams.`, msg);
      return;
    }
    const id = args[1];
    const targetJid = args[2]?.includes('@') ? args[2] : (args[2] ? `${args[2]}@s.whatsapp.net` : null);
    if (!id || !targetJid) {
      await sendText(sock, jid, `Usage: *!competitions qualify [tournamentId] @user*`, msg);
      return;
    }
    Tournament.addQualifiedTeam(id, targetJid);
    const target = User.getByWhatsappId(targetJid);
    const t = Tournament.getTournament(id);
    const gcLink = getCompLink(id);
    const gcName = getCompName(id);
    await sendText(sock, jid,
      `✅ *${target?.name || 'User'} qualified for ${t?.name || id}!*` +
      (gcLink ? `\n\n📲 *Join the Competition GC:*\n${gcName}\n${gcLink}` : '') +
      `\n${BRAND}`, msg);
    return;
  }

  // ─── Default help ───
  await sendText(sock, jid,
    `🏆 *COMPETITION COMMANDS*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `*!competitions* — List all competitions\n` +
    `*!competitions info [id]* — Full details + requirements\n` +
    `*!competitions join [id]* — Enter a competition\n` +
    `*!competitions leave [id]* — Leave a competition\n` +
    `*!competitions bracket [id]* — View tournament bracket\n` +
    `*!competitions start [id]* — Start tournament (owner)\n` +
    `*!competitions qualify [id] @user* — Qualify a team (owner)\n\n` +
    `📋 Each competition has minimum requirements:\n` +
    `  • Wins needed\n` +
    `  • Trophies needed\n` +
    `  • MMR needed\n` +
    `  • Squad OVR needed\n\n` +
    `🔒 Some require qualification:\n` +
    `  • Super Cup → UCL + UEL winners\n` +
    `  • Community Shield → FA Cup + League winners\n` +
    `  • World Club Cup → Continental winners\n\n` +
    `⏳ Tournaments need min participants to start\n${BRAND}`, msg);
}

module.exports = { handle: tournamentCommand };
