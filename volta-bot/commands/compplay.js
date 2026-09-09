// commands/compplay.js
// Competition match command - only works in competition GCs
// !compplay [comp_id] — start a competition match
// Auto-detects which competition based on GC name

const User = require('../models/User');
const Player = require('../models/Player');
const Tournament = require('../models/Tournament');
const { sendText } = require('../utils/messaging');
const { BRAND } = require('../config/constants');
const { startMatch } = require('../game-engine/matchSession');
const { getCompLink, getCompName } = require('../config/competitionGCs');

// Map GC names to competition IDs
const GC_TO_COMP = {
  'champions league': 'champions_league',
  'europa league': 'europa_league',
  'conference league': 'conference_league',
  'fa cup': 'fa_cup',
  'carabao cup': 'carabao_cup',
  'community shield': 'community_shield',
  'copa libertadores': 'copa_libertadores',
  'intercontinental': 'intercontinental_cup',
};

// Detect competition from GC group name
function detectCompetition(jid, groupName) {
  if (!groupName) return null;
  const lower = groupName.toLowerCase();
  
  for (const [keyword, compId] of Object.entries(GC_TO_COMP)) {
    if (lower.includes(keyword)) {
      return compId;
    }
  }
  return null;
}

async function compplayCommand({ sock, msg, jid, sender, args, user }) {
  if (!user || !user.registered) {
    await sendText(sock, jid, `⚠️ Register first with *!register [name]*`, msg);
    return;
  }

  // Get group name from JID
  let groupName = null;
  try {
    const groupMeta = await sock.groupMetadata(jid);
    groupName = groupMeta.subject;
  } catch (e) {
    // Not a group or can't get metadata
  }

  // Detect or get competition ID
  let compId = args[0] ? args[0].toLowerCase() : null;
  
  // Auto-detect from GC name if no argument provided
  if (!compId && groupName) {
    compId = detectCompetition(jid, groupName);
  }
  
  // Normalize aliases
  if (compId === 'ucl' || compId === 'cl') compId = 'champions_league';
  if (compId === 'uel' || compId === 'el') compId = 'europa_league';
  if (compId === 'ecl') compId = 'conference_league';
  if (compId === 'fac') compId = 'fa_cup';
  if (compId === 'cc') compId = 'carabao_cup';
  if (compId === 'cs') compId = 'community_shield';
  if (compId === 'clib') compId = 'copa_libertadores';
  if (compId === 'ic') compId = 'intercontinental_cup';

  if (!compId) {
    await sendText(sock, jid,
      `⚔️ *COMPETITION MATCH*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Usage: *!compplay [competition]*\n\n` +
      `Competitions:\n` +
      `• *ucl* — Champions League\n` +
      `• *uel* — Europa League\n` +
      `• *ecl* — Conference League\n` +
      `• *fac* — FA Cup\n` +
      `• *cc* — Carabao Cup\n` +
      `• *cs* — Community Shield\n` +
      `• *clib* — Copa Libertadores\n` +
      `• *ic* — Intercontinental Cup\n\n` +
      `Or just type *!compplay* in the competition GC\n` +
      `and it will auto-detect!\n${BRAND}`, msg);
    return;
  }

  // Get tournament
  const tournament = Tournament.getTournament(compId);
  if (!tournament) {
    await sendText(sock, jid, `❌ Competition not found: *${compId}*`, msg);
    return;
  }

  // Check if tournament is active
  if (tournament.status !== 'active') {
    await sendText(sock, jid,
      `❌ *${tournament.name}* is not active yet.\n` +
      `Status: ${tournament.status}\n` +
      `Participants: ${tournament.participants.length}/${tournament.minParticipants} needed\n\n` +
      `Use *!competitions join ${compId}* to enter!`, msg);
    return;
  }

  // Check if user is in this tournament
  const participant = tournament.participants.find(p => p.userId === sender);
  if (!participant) {
    await sendText(sock, jid,
      `❌ You're not in *${tournament.name}*.\n` +
      `Use *!competitions join ${compId}* to enter!`, msg);
    return;
  }

  // Find user's next match in bracket
  let nextMatch = null;
  let roundNum = 0;
  
  for (let r = 0; r < tournament.bracket.length; r++) {
    for (const match of tournament.bracket[r]) {
      if (match.status === 'pending') {
        if (match.team1 === sender || match.team2 === sender) {
          nextMatch = match;
          roundNum = r + 1;
          break;
        }
      }
    }
    if (nextMatch) break;
  }

  if (!nextMatch) {
    await sendText(sock, jid,
      `✅ No pending matches for you in *${tournament.name}*.\n` +
      (tournament.winner ? `🏆 Winner: ${User.getByWhatsappId(tournament.winner)?.name || 'Unknown'}` : `Wait for next round...`), msg);
    return;
  }

  // Get opponent
  const opponentId = nextMatch.team1 === sender ? nextMatch.team2 : nextMatch.team1;
  const opponent = User.getByWhatsappId(opponentId);

  if (!opponent) {
    await sendText(sock, jid, `❌ Opponent not found.`, msg);
    return;
  }

  // Get squads
  const userSquad = Player.getByOwner(sender);
  const oppSquad = Player.getByOwner(opponentId);

  if (userSquad.length === 0 || oppSquad.length === 0) {
    await sendText(sock, jid, `❌ Both players need a squad to play.`, msg);
    return;
  }

  const roundNames = ['First Round', 'Quarter-Final', 'Semi-Final', 'Final'];
  const roundName = roundNames[roundNum - 1] || `Round ${roundNum}`;

  // Start the match
  const gcLink = getCompLink(compId);
  const gcName = getCompName(compId);
  let output =
    `⚔️ *${tournament.name} — ${roundName}*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `⚽ *${user.name}* vs *${opponent.name}*\n\n` +
    `📊 Your Squad OVR: ${Math.round(userSquad.reduce((s, p) => s + Player.calculateOVR(p), 0) / userSquad.length)}\n` +
    `📊 Opponent OVR: ${Math.round(oppSquad.reduce((s, p) => s + Player.calculateOVR(p), 0) / oppSquad.length)}\n\n` +
    `Use *!match* to play the match!\n` +
    `Winner advances to next round.\n` +
    (gcLink ? `\n📲 *Competition GC:*\n${gcName}\n${gcLink}\n` : '') +
    `${BRAND}`;

  await sendText(sock, jid, output, msg);
}

module.exports = { handle: compplayCommand, detectCompetition, GC_TO_COMP };
