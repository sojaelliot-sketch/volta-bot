const User = require('../models/User');
const Player = require('../models/Player');
const { MATCH } = require('../config/constants');
const { startMatch, getActivePvPForUser, applySub, getPvpSessionFor, resolveChance } = require('../game-engine/matchSession');
const { sendText } = require('../utils/messaging');

// pendingChallenges: targetJid -> challengerJid
const pendingChallenges = new Map();
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

  if (cmd === 'play') {
    const user = User.getByWhatsappId(sender);
    if (!user || !user.registered) {
      await sendText(sock, jid, '❌ You need to register first! Type *!start*.', msg);
      return;
    }

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

  if (cmd === 'challenge') {
    const myUser = User.getByWhatsappId(sender);
    if (!myUser || !myUser.registered) {
      await sendText(sock, jid, '❌ You need to register first! Type *!start*.', msg);
      return;
    }
    // ── match cooldown (applies to everyone) ──
    const wait = matchCooldownLeft(sender);
    if (wait > 0) {
      await sendText(sock, jid, `⏳ Match cooldown — you can challenge again in *${Math.ceil(wait / 1000)}s*.`, msg);
      return;
    }
    // Target can be: a reply to their message, an @mention, or a number.
    const target = replyTo || mentioned || mentionedJid(msg) || toJid(args[0]);
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
      await sendText(sock, jid, `❌ That user isn't registered yet.`, msg);
      return;
    }
    if (tUser.inMatch || myUser.inMatch) {
      await sendText(sock, jid, `❌ One of you is already in a match!`, msg);
      return;
    }

    pendingChallenges.set(target, sender);
    await sendText(sock, jid,
      `⚔️ *Challenge sent!*\n👤 ${User.getByWhatsappId(sender).name} challenged *${tUser.name}*.\n\n@${tUser.name} type *!accept* to begin the showdown! 🔥`, msg, [target]);

    try {
      await sendText(sock, target,
        `⚔️ *${User.getByWhatsappId(sender).name}* has challenged you to a VOLTA match!\nType *!accept* in your chat to start. 🔥`, msg);
    } catch {}
    return;
  }

  if (cmd === 'accept') {
    const challenger = pendingChallenges.get(sender);
    if (!challenger) {
      await sendText(sock, jid, `❌ You have no pending challenge. Ask a friend to *!challenge* you!`, msg);
      return;
    }
    pendingChallenges.delete(sender);

    const chUser = User.getByWhatsappId(challenger);
    if (!chUser || !chUser.registered) {
      await sendText(sock, jid, `❌ Your challenger is no longer available.`, msg);
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
      `🥊 *MATCH ON!*\n👤 ${chUser.name} vs 🆚 ${User.getByWhatsappId(sender).name}\n⚡ Chances are coming — when it's YOUR turn, react with *!a / !b / !c* (the options shown in the chance)! 🔥`, msg);

    await startMatch(sock, challenger, sender, { chatJid: jid, isPvP: true, msg });
    return;
  }
}

module.exports = { handle };
