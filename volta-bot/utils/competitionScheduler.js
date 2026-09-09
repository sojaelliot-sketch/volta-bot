// utils/competitionScheduler.js
// Auto-starts competitions weekly and announces winners

const Tournament = require('../models/Tournament');
const League = require('../models/League');
const User = require('../models/User');
const { sendText } = require('./messaging');
const logger = require('./logger');

const WEEKLY_CHECK_INTERVAL = 60 * 60 * 1000; // Check every hour

let sock = null;
let scheduledIntervals = [];

function setSocket(s) {
  sock = s;
}

// Auto-start competitions that have enough participants
function autoStartCompetitions() {
  if (!sock) return;
  
  const tournaments = Tournament.getAllTournaments();
  
  for (const t of tournaments) {
    if (t.status === 'registration' && t.participants.length >= t.minParticipants) {
      logger.info(`Auto-starting tournament: ${t.name}`);
      const result = Tournament.startTournament(t.id);
      
      if (result.success) {
        // Announce to relevant GC
        announceTournamentStart(t);
      }
    }
  }
}

// Announce tournament started
function announceTournamentStart(tournament) {
  if (!sock) return;
  
  const message = 
    `🎉 *${tournament.name.toUpperCase()} STARTED!*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${tournament.participants.length} teams competing\n` +
    `Prize: ${(tournament.prize/1000).toFixed(0)}K MW\n\n` +
    `Use *!competitions bracket ${tournament.id}* to view bracket\n` +
    `Good luck to all participants! 🍀`;
  
  broadcastToCompGCs(message);
}

// Check for completed tournaments and announce winners
function checkCompletedTournaments() {
  if (!sock) return;
  
  const tournaments = Tournament.getAllTournaments();
  
  for (const t of tournaments) {
    if (t.status === 'active' && t.winner) {
      // Tournament completed - announce winner
      announceWinner(t);
      
      // Award prize
      awardPrize(t);
      
      // Mark as completed
      Tournament.updateTournament(t.id, { status: 'completed' });
    }
  }
}

// Announce tournament winner
function announceWinner(tournament) {
  if (!sock) return;
  
  const winnerUser = User.getByWhatsappId(tournament.winner);
  const winnerName = winnerUser?.name || 'Unknown';
  
  const message =
    `🏆 *${tournament.name.toUpperCase()} — CHAMPION!*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🎉 *${winnerName}* wins the ${tournament.name}!\n\n` +
    `💰 Prize: ${(tournament.prize/1000).toFixed(0)}K MW\n` +
    `👥 Teams: ${tournament.participants.length}\n` +
    `📊 Matches: ${tournament.results?.length || 0}\n\n` +
    `Congratulations! 🎊`;
  
  broadcastToCompGCs(message);
  
  // Also DM the winner
  if (winnerUser) {
    sendText(sock, winnerUser.whatsappId,
      `🎉 *YOU WON ${tournament.name.toUpperCase()}!*\n` +
      `💰 Prize: ${(tournament.prize/1000).toFixed(0)}K MW has been added to your balance!\n` +
      `Congratulations! 🏆`);
  }
}

// Announce tournament not completed (no winner)
function announceNotCompleted(tournament) {
  if (!sock) return;
  
  const message =
    `📋 *${tournament.name.toUpperCase()} — NOT COMPLETED*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `The ${tournament.name} ended without a winner.\n` +
    `Reason: ${tournament.participants.length < tournament.minParticipants ? 'Not enough participants' : 'Not enough matches played'}\n\n` +
    `Entry fees have been refunded.\n` +
    `Next cycle starts soon! ⏳`;
  
  broadcastToCompGCs(message);
}

// Award prize to winner
function awardPrize(tournament) {
  if (!tournament.winner) return;
  
  const user = User.getByWhatsappId(tournament.winner);
  if (user) {
    User.update(tournament.winner, { 
      balance: (user.balance || 0) + tournament.prize 
    });
  }
}

// Refund entry fees if tournament not completed
function refundEntryFees(tournament) {
  for (const p of tournament.participants) {
    const user = User.getByWhatsappId(p.userId);
    if (user && tournament.entryFee > 0) {
      User.update(p.userId, { 
        balance: (user.balance || 0) + tournament.entryFee 
      });
    }
  }
}

// Broadcast message to all competition GCs
function broadcastToCompGCs(message) {
  if (!sock) return;
  
  // This will be configured when user provides GC links
  // For now, log the message
  logger.info(`[COMP BROADCAST] ${message}`);
}


// ─── LEAGUE WEEK ROLLOVER ───────────────────────────────────────────────────
// The league had a weekEnd timestamp and a startNewWeek() function, but NOTHING
// ever called it on a timer — the only way a week ever ended was the owner
// typing !league start by hand. Left alone, weekEnd would drift into the past
// and the same table would sit there forever, so nobody was ever promoted and
// no champion was ever paid.
function rollOverLeagueWeek() {
  try {
    if (League.isPaused && League.isPaused()) return;
    if (!League.isWeekOver || !League.isWeekOver()) return;

    const before = League.getWeekInfo();
    const { results, paid, week } = League.startNewWeek();

    logger.info(
      { week, promoted: results.promoted.length, relegated: results.relegated.length, paid: paid.length },
      'League week rolled over'
    );

    const lines = [];
    lines.push(`🏆 *LEAGUE — WEEK ${before.week} COMPLETE*`);
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━');

    if (results.champions.length) {
      for (const champ of results.champions) {
        const u = User.getByWhatsappId(champ.jid);
        const name = (u && u.name) || champ.name || 'Unknown';
        const wasPaid = paid.find((x) => x.jid === champ.jid);
        lines.push(`👑 *Division 1 champion:* ${name} — ${champ.points} pts`);
        if (wasPaid) lines.push(`💰 Prize paid: 💲${wasPaid.amount.toLocaleString()}`);
      }
      lines.push('');
    }

    if (results.promoted.length) {
      lines.push(`⬆️ *Promoted (${results.promoted.length})*`);
      for (const m of results.promoted.slice(0, 10)) {
        const u = User.getByWhatsappId(m.jid);
        if (!u) continue;
        lines.push(`  ${u.name} → Division ${m.to}`);
      }
      lines.push('');
    }

    if (results.relegated.length) {
      lines.push(`⬇️ *Relegated (${results.relegated.length})*`);
      for (const m of results.relegated.slice(0, 10)) {
        const u = User.getByWhatsappId(m.jid);
        if (!u) continue;
        lines.push(`  ${u.name} → Division ${m.to}`);
      }
      lines.push('');
    }

    lines.push(`📅 Week ${week} has begun. Tables are reset — everyone starts on 0.`);
    lines.push('Send *!league* to see where you stand.');

    broadcastToCompGCs(lines.join('\n'));
    notifyMovedManagers(results, week);
  } catch (err) {
    logger.error({ err }, 'League week rollover failed');
  }
}

// Tell each affected manager personally. A promotion nobody hears about is not
// much of a reward.
function notifyMovedManagers(results, week) {
  if (!sock) return;
  const tell = async (jid, text) => {
    try { await sendText(sock, jid, text); } catch (err) { /* user may have blocked the bot */ }
  };
  for (const m of results.promoted) {
    const u = User.getByWhatsappId(m.jid);
    if (!u || !u.registered) continue;
    tell(m.jid, `⬆️ *PROMOTED!*\n\nYou finished top of Division ${m.from} and move up to *Division ${m.to}* for week ${week}.\n\nThe table has reset. Go again.`);
  }
  for (const m of results.relegated) {
    const u = User.getByWhatsappId(m.jid);
    if (!u || !u.registered) continue;
    tell(m.jid, `⬇️ *Relegated.*\n\nYou finished bottom of Division ${m.from} and drop to *Division ${m.to}* for week ${week}.\n\nClean slate — win it back.`);
  }
  for (const champ of results.champions) {
    const u = User.getByWhatsappId(champ.jid);
    if (!u || !u.registered) continue;
    tell(champ.jid, `👑 *DIVISION 1 CHAMPION*\n\n${champ.points} points. Nobody was better.\n\n💰 💲${(champ.reward || 0).toLocaleString()} has been paid into your account.`);
  }
}

// Main weekly cycle - called every hour
function weeklyCycle() {
  logger.info('Running competition weekly cycle check...');
  
  // 0a. AI clubs play a round of fixtures, so the table moves between your own
  //     matches instead of sitting frozen all week.
  try {
    if (!(League.isPaused && League.isPaused())) {
      const played = League.playAiRound();
      const total = Object.values(played).reduce((a, b) => a + b, 0);
      if (total) logger.info({ played }, `AI league round: ${total} fixtures`);
    }
  } catch (err) {
    logger.error({ err }, 'AI league round failed');
  }

  // 0b. Roll the league week over if its end time has passed
  rollOverLeagueWeek();

  // 1. Auto-start tournaments with enough participants
  autoStartCompetitions();
  
  // 2. Check for completed tournaments
  checkCompletedTournaments();
  
  // 3. Check for tournaments that expired without enough participants
  const tournaments = Tournament.getAllTournaments();
  for (const t of tournaments) {
    if (t.status === 'registration' && t.participants.length < t.minParticipants) {
      // Check if registration period is over (7 days from first entry)
      if (t.participants.length > 0) {
        const firstEntry = new Date(t.participants[0].joinedAt);
        const daysSinceFirstEntry = (Date.now() - firstEntry.getTime()) / (1000 * 60 * 60 * 24);
        
        if (daysSinceFirstEntry >= 7) {
          // Registration period over, not enough participants
          announceNotCompleted(t);
          refundEntryFees(t);
          Tournament.updateTournament(t.id, { status: 'cancelled' });
        }
      }
    }
  }
}

// Start the scheduler
function startScheduler() {
  logger.info('Starting competition scheduler...');
  
  // Run immediately
  weeklyCycle();
  
  // Then every hour
  const interval = setInterval(weeklyCycle, WEEKLY_CHECK_INTERVAL);
  scheduledIntervals.push(interval);
}

// Stop the scheduler
function stopScheduler() {
  for (const interval of scheduledIntervals) {
    clearInterval(interval);
  }
  scheduledIntervals = [];
  logger.info('Competition scheduler stopped.');
}

module.exports = {
  setSocket,
  startScheduler,
  stopScheduler,
  weeklyCycle,
  rollOverLeagueWeek,
  autoStartCompetitions,
  announceWinner,
  announceNotCompleted,
};
