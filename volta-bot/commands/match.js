const User = require('../models/User');
const Player = require('../models/Player');
const tourney = require('../game-engine/tournament');
const { MATCH } = require('../config/constants');
const { startMatch, getActivePvPForUser, getActiveMatchForUser, applySub, getPvpSessionFor, resolveChance, forfeitPvPForUser } = require('../game-engine/matchSession');
const { sendText } = require('../utils/messaging');

// Self-heal: a user can be flagged inMatch from a match that crashed or was
// cleared while the bot was down. If there's no live session for them, drop the
// stale flag so they aren't permanently locked out of !play / !challenge.
function healIfStuck(user) {
  if (user && user.inMatch && !getActiveMatchForUser(user.whatsappId)) {
    User.update(user.whatsappId, { inMatch: false, currentMatchId: null });
    return true;
  }
  return false;
}

// pendingChallenges: targetJid -> { challenger, expires }
const pendingChallenges = new Map();
const CHALLENGE_TTL_MS = 2 * 60 * 1000;

function challengeExpired(entry) {
  return entry && entry.expires && entry.expires < Date.now();
}
// lastPlayAt: sender -> timestamp (cooldown between matches, AI + PvP)
const lastPlayAt = new Map();

// Unified match cooldown. Applies to everyone (incl. owner/staff) so you can't
// immediately re-queue another match after one finishes.
function matchCooldownLeft(sender) {
  const last = lastPlayAt.get(sender) || 0;
  return Math.max(0, MATCH.PLAY_COOLDOWN_MS - (Date.now() - last));
}

function mentionedJid(msg) {
  return msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || null;
}

function toJid(arg) {
  const a = (arg || '').trim();
  if (!a) return null;
  return a.includes('@') ? a : `${a}@s.whatsapp.net`;
}

async function handle({ sock, msg, jid, sender, cmd, args, replyTo, mentioned }) {
  // ── live PvP chance reactions (letters a/b/c/d, or !chance for a hint) ──
  if (cmd === 'a' || cmd === 'b' || cmd === 'c' || cmd === 'd' || cmd === 'chance') {
    const session = getPvpSessionFor(sender);
    if (!session) {
      await sendText(sock, jid, `⚽ You're not in a live match right now.`, msg);
      return;
    }
    await resolveChance(session, sender, cmd === 'chance' ? '' : cmd);
    return;
  }

  if (cmd === 'sub') {
    const session = getActivePvPForUser(sender);
    if (!session) {
      await sendText(sock, jid, '❌ You\'re not in a live PvP match. Use *!challenge* to start one.', msg);
      return;
    }
    const res = applySub(session, sender, args);
    await sendText(sock, jid, res.msg, msg);
    return;
  }

  if (cmd === 'forfeit') {
    const session = getActivePvPForUser(sender);
    const isParticipant = session && (sender === session.homeId || sender === session.awayId);
    if (!session || (!isParticipant && !User.isOwner(sender))) {
      await sendText(sock, jid, `❌ You can only forfeit a PvP match you're playing in. (Owners may force-forfeit any match.)`, msg);
      return;
    }
    const ended = await forfeitPvPForUser(sender);
    if (!ended) {
      await sendText(sock, jid, `❌ No active PvP match found to forfeit.`, msg);
      return;
    }
    const me = User.getByWhatsappId(sender);
    await sendText(sock, jid,
      `🚩 *MATCH FORFEITED*\n━━━━━━━━━━━━━━\n` +
      `The match between *${ended.homeName}* and *${ended.awayName}* has ended by forfeit.\n` +
      (User.isOwner(sender) && !isParticipant ? `(Force-forfeited by owner ${me?.name || ''}.)` : `You threw in the towel.`), msg);
    return;
  }

  if (cmd === 'play') {
    const user = User.getByWhatsappId(sender);
    if (!user || !user.registered) {
      await sendText(sock, jid, '❌ You need to register first! Type *!start*.', msg);
      return;
    }
    healIfStuck(user);

    // ── match cooldown (applies to everyone) ──
    const wait = matchCooldownLeft(sender);
    if (wait > 0) {
      await sendText(sock, jid, `⏳ Match cooldown — you can *!play* again in *${Math.ceil(wait / 1000)}s*.`, msg);
      return;
    }
    lastPlayAt.set(sender, Date.now());

    const difficulty = args[0] && ['easy', 'medium', 'hard'].includes(args[0].toLowerCase())
      ? args[0].charAt(0).toUpperCase() + args[0].slice(1).toLowerCase()
      : 'Medium';

    await startMatch(sock, sender, 'AI', { aiDifficulty: difficulty, chatJid: jid });
    return;
  }

  if (cmd === 'match') {
    const user = User.getByWhatsappId(sender);
    if (!user || !user.registered) {
      await sendText(sock, jid, '❌ You need to register first! Type *!start*.', msg);
      return;
    }
    healIfStuck(user);
    const wait = matchCooldownLeft(sender);
    if (wait > 0) {
      await sendText(sock, jid, `⏳ Match cooldown — you can *!match* again in *${Math.ceil(wait / 1000)}s*.`, msg);
      return;
    }
    lastPlayAt.set(sender, Date.now());

    const difficulty = args[0] && ['easy', 'medium', 'hard'].includes(args[0].toLowerCase())
      ? args[0].charAt(0).toUpperCase() + args[0].slice(1).toLowerCase()
      : 'Medium';

    await sendText(sock, jid,
      `🔒 *PRIVATE MATCH* vs ${difficulty} AI starting… the chat is locked to you until full time so nobody else can fire commands. 🤫\n` +
      `🎮 It's interactive: react with *!a / !b / !c* on your turns, and the AI plays its own turns automatically. 🔥`, msg);
    await startMatch(sock, sender, 'AI', { aiDifficulty: difficulty, chatJid: jid, interactiveAI: true });
    return;
  }

  if (cmd === 'challenge') {
    const myUser = User.getByWhatsappId(sender);
    if (!myUser || !myUser.registered) {
      await sendText(sock, jid, '❌ You need to register first! Type *!start*.', msg);
      return;
    }
    healIfStuck(myUser);
    // ── match cooldown (applies to everyone) ──
    const wait = matchCooldownLeft(sender);
    if (wait > 0) {
      await sendText(sock, jid, `⏳ Match cooldown — you can challenge again in *${Math.ceil(wait / 1000)}s*.`, msg);
      return;
    }
    // Target can be: a reply to their message, an @mention, or a number.
    const target = User.normalizeJid(replyTo || mentioned || mentionedJid(msg) || toJid(args[0]));
    if (!target) {
      await sendText(sock, jid, `⚔️ *Challenge a friend!*\nReply to their message with *!challenge*, tag them: *!challenge @username*, or use *!challenge [number]*`, msg);
      return;
    }
    if (target === sender) {
      await sendText(sock, jid, `😅 You can't challenge yourself!`, msg);
      return;
    }
    const tUser = User.getByWhatsappId(target);
    if (!tUser || !tUser.registered) {
      await sendText(sock, jid, `❌ That user isn't registered yet. Ask them to *!start* first.`, msg);
      return;
    }
    if (target === sender) {
      await sendText(sock, jid, `😅 You can't challenge yourself!`, msg);
      return;
    }
    if (tUser.inMatch || myUser.inMatch) {
      await sendText(sock, jid, `❌ One of you is already in a match!`, msg);
      return;
    }
    // drop any stale challenge for this target
    pendingChallenges.delete(target);

    pendingChallenges.set(target, { challenger: sender, expires: Date.now() + CHALLENGE_TTL_MS });
    await sendText(sock, jid,
      `⚔️ *Challenge sent!*\n👤 ${myUser.name} challenged *${tUser.name}*.\n\n@${tUser.name} type *!accept* to begin the showdown! 🔥`, msg, [target]);

    try {
      await sendText(sock, target,
        `⚔️ *${myUser.name}* has challenged you to a VOLTA match!\nType *!accept* in your chat to start. 🔥`, msg);
    } catch {}
    return;
  }

  if (cmd === 'accept') {
    const entry = pendingChallenges.get(sender);
    if (!entry || challengeExpired(entry)) {
      pendingChallenges.delete(sender);
      await sendText(sock, jid, `❌ You have no pending challenge (or it expired). Ask a friend to *!challenge* you!`, msg);
      return;
    }
    const challenger = entry.challenger;
    pendingChallenges.delete(sender);

    const myUser = User.getByWhatsappId(sender);
    const chUser = User.getByWhatsappId(challenger);
    if (!myUser || !myUser.registered) {
      await sendText(sock, jid, `❌ You need to register first! Type *!start*.`, msg);
      return;
    }
    healIfStuck(myUser);
    healIfStuck(chUser);
    if (!chUser || !chUser.registered || chUser.inMatch || myUser.inMatch) {
      await sendText(sock, jid, `❌ Your challenger is no longer available (registered/in a match).`, msg);
      return;
    }

    // ── match cooldown (applies to everyone) — lock both players out briefly ──
    const wait = matchCooldownLeft(sender);
    if (wait > 0) {
      await sendText(sock, jid, `⏳ Match cooldown — you can accept in *${Math.ceil(wait / 1000)}s*.`, msg);
      return;
    }
    lastPlayAt.set(sender, Date.now());
    lastPlayAt.set(challenger, Date.now());

    await sendText(sock, jid,
      `🥊 *MATCH ON!*\n👤 ${chUser.name} vs 🆚 ${myUser.name}\n⚡ Chances are coming — when it's YOUR turn, react with *!a / !b / !c* (the options shown in the chance)! 🔥`, msg);

    await startMatch(sock, challenger, sender, {
      chatJid: jid, isPvP: true, msg,
      pkEnabled: chUser.pkEnabled === true || myUser.pkEnabled === true,
    });
    return;
  }

  if (cmd === 'tchallenge') {
    if (!tourney.isActive() || !tourney.summary().rounds) {
      await sendText(sock, jid, `ℹ️ No active tournament bracket to challenge within.`, msg);
      return;
    }
    const myUser = User.getByWhatsappId(sender);
    if (!myUser || !myUser.registered) {
      await sendText(sock, jid, '❌ You need to register first! Type *!start*.', msg);
      return;
    }
    healIfStuck(myUser);
    const wait = matchCooldownLeft(sender);
    if (wait > 0) {
      await sendText(sock, jid, `⏳ Match cooldown — you can challenge again in *${Math.ceil(wait / 1000)}s*.`, msg);
      return;
    }
    const opponent = tourney.startTChallenge(sender);
    if (!opponent) {
      await sendText(sock, jid, `ℹ️ You have no pending tournament tie (or it already resolved). Use *!bracket* to check.`, msg);
      return;
    }
    const oppUser = User.getByWhatsappId(opponent);
    const oppName = oppUser?.name || opponent.split('@')[0];
    if (oppUser?.inMatch || myUser.inMatch) {
      await sendText(sock, jid, `❌ You or your opponent is already in a match!`, msg);
      return;
    }
    if (oppUser && oppUser.whatsappId === sender) {
      await sendText(sock, jid, `😅 That's a BYE — no opponent to challenge. You advance automatically!`, msg);
      return;
    }
    lastPlayAt.set(sender, Date.now());
    lastPlayAt.set(opponent, Date.now());
    await sendText(sock, jid,
      `🏆 *TOURNAMENT TIE!*\n👤 ${myUser.name} vs 🆚 ${oppName}\n⚡ Chances are coming — when it's YOUR turn, react with *!a / !b / !c*! 🔥\n(Win to advance in the bracket.)`, msg, [opponent]);
    await startMatch(sock, sender, opponent, {
      chatJid: jid, isPvP: true, msg,
      isTournament: true, // tournament ties go to penalties on a draw
    });
    return;
  }
}

module.exports = { handle };
