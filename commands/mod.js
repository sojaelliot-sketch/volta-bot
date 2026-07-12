// commands/mod.js
// Staff moderation commands.
//   !ban [id]              — owner + officer: ban a user (permanent, until unbanned)
//   !unban [id]            — owner + officer: remove a ban
//   !warn [id]             — owner + officer + moderator: warn a user (3 warns → 3-min ban)
//   !promote [id] officer|moderator — owner + officer: promote a user
//   !demote [id]           — owner + officer: demote back to user
//   !kick [target]         — owner + officer + moderator: remove from group (best effort)
//   !mods                  — anyone: list staff + owner
const User = require('../models/User');
const Player = require('../models/Player');
const { MODERATION } = require('../config/constants');
const { sendText } = require('../utils/messaging');

function toJid(arg) {
  const a = (arg || '').trim();
  if (!a) return null;
  return a.includes('@') ? a : `${a}@s.whatsapp.net`;
}

// Resolve a target user from reply / mention / id-arg (no need to type IDs).
function looksLikeJid(arg) {
  if (!arg) return false;
  // Only treat it as an explicit id if it's a raw number or a real WhatsApp
  // jid — a plain "@DisplayName" mention must fall through to the mention/reply.
  return /^\d{6,}$/.test(arg) || arg.includes('@s.whatsapp.net');
}
function resolveTarget(args, ctx = {}) {
  if (args && args.length && looksLikeJid(args[0])) {
    return toJid(args[0]);
  }
  if (ctx.replyTo) return ctx.replyTo;
  if (ctx.mentioned) return ctx.mentioned;
  return null;
}

function can(actor, action) {
  if (User.isOwner(actor)) return true;
  const u = User.getByWhatsappId(actor);
  const rank = User.roleRank(u?.role);
  const req = {
    ban:    User.roleRank('officer'),
    unban:  User.roleRank('officer'),
    promote: User.roleRank('moderator'),
    demote: User.roleRank('officer'),
    warn:   User.roleRank('moderator'),
    kick:   User.roleRank('moderator'),
    mods:   0,
  }[action];
  return rank >= (req ?? 99);
}

function roleLabel(role) {
  if (role === 'officer') return '👮 Officer';
  if (role === 'moderator') return '🛡️ Moderator';
  return '👤 User';
}

async function handle({ sock, msg, jid, sender, cmd, args, replyTo, mentioned }) {
  if (cmd === 'mods') {
    const all = User.all();
    const staff = all.filter(u => u.role === 'officer' || u.role === 'moderator');
    let out = `📋 *VOLTA STAFF*\n━━━━━━━━━━━━━━━━━━━━━━━\n👑 *Owner:* ${MODERATION.OWNER_ID}\n`;
    if (staff.length) {
      for (const s of staff) {
        out += `${roleLabel(s.role)} — ${s.name} (${s.whatsappId.split('@')[0]})\n`;
      }
    } else {
      out += `🛡️ No moderators or officers yet.\n`;
    }
    out += `━━━━━━━━━━━━━━━━━━━━━━━`;
    await sendText(sock, jid, out, msg);
    return;
  }

  if (cmd === 'ban' || cmd === 'unban' || cmd === 'warn' || cmd === 'promote' || cmd === 'demote' || cmd === 'kick') {
    if (!can(sender, cmd)) {
      await sendText(sock, jid, `⛔ You don't have permission to use *!${cmd}*.`, msg);
      return;
    }

    if (cmd === 'mods') return; // handled above

    const targetJid = resolveTarget(args, { replyTo, mentioned });
    if (!targetJid) {
      await sendText(sock, jid, `⚠️ Reply to the user, @mention them, or use *!${cmd} [id]*.`, msg);
      return;
    }

    if (User.isOwner(targetJid)) {
      await sendText(sock, jid, `⛔ You can't use *!${cmd}* on the owner!`, msg);
      return;
    }

    const target = User.getByWhatsappId(targetJid);
    if (!target) {
      await sendText(sock, jid, `❌ No registered user found for that target.`, msg);
      return;
    }

    if (cmd === 'ban') {
      User.update(targetJid, { bannedUntil: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 100).toISOString() });
      await sendText(sock, jid, `⛔ *${target.name}* has been **BANNED** by staff.`, msg);
      return;
    }

    if (cmd === 'unban') {
      User.update(targetJid, { bannedUntil: null, warnings: 0 });
      await sendText(sock, jid, `✅ *${target.name}* has been **UNBANNED**.`, msg);
      return;
    }

    if (cmd === 'warn') {
      const w = (target.warnings || 0) + 1;
      if (w >= MODERATION.WARNINGS_BEFORE_BAN) {
        User.update(targetJid, { warnings: 0, bannedUntil: new Date(Date.now() + MODERATION.BAN_DURATION_MS).toISOString() });
        await sendText(sock, jid, `⚠️ *${target.name}* hit ${w} warnings and is auto-banned for 3 minutes.`, msg);
      } else {
        User.update(targetJid, { warnings: w });
        await sendText(sock, jid, `⚠️ *${target.name}* warned (${w}/${MODERATION.WARNINGS_BEFORE_BAN}).`, msg);
      }
      return;
    }

    if (cmd === 'promote') {
      const role = (args[1] || 'moderator').toLowerCase();
      if (role !== 'officer' && role !== 'moderator') {
        await sendText(sock, jid, `⚠️ Usage: *!promote [@mention or reply] [moderator|officer]*`, msg);
        return;
      }
      // an officer can only promote to moderator, not to officer
      if (User.roleRank(target.role) >= User.roleRank(role)) {
        await sendText(sock, jid, `ℹ️ *${target.name}* is already ${roleLabel(role)} or higher.`, msg);
        return;
      }
      // Only the Owner can grant the Officer rank; anyone ranked (mod+)
      // can promote others to Moderator.
      if (role === 'officer' && !User.isOwner(sender)) {
        await sendText(sock, jid, `⛔ Only the Owner can promote to Officer.`, msg);
        return;
      }
      User.update(targetJid, { role });
      await sendText(sock, jid, `✅ *${target.name}* promoted to *${roleLabel(role)}*!`, msg);
      return;
    }

    if (cmd === 'demote') {
      if (target.role === 'user') {
        await sendText(sock, jid, `ℹ️ *${target.name}* is already a regular user.`, msg);
        return;
      }
      User.update(targetJid, { role: 'user' });
      await sendText(sock, jid, `⬇️ *${target.name}* demoted to regular user.`, msg);
      return;
    }

    if (cmd === 'kick') {
      // best-effort group removal
      try {
        if (jid.endsWith('@g.us')) {
          await sock.groupParticipantsUpdate(jid, [targetJid], 'remove');
        }
      } catch (e) {
        // ignore — bot may lack admin rights
      }
      await sendText(sock, jid, `🥾 *${target.name}* has been kicked${jid.endsWith('@g.us') ? ' from the group' : ''}.`, msg);
      return;
    }
  }
}

module.exports = { handle };
