// commands/dash.js
//   !dash [playerID] @user   — gift one of your players to another manager
//   !dash @user              — gift your WHOLE squad to another manager
//   !dash squad @user        — same as above (explicit)
// Works by reply / @mention, or by passing the recipient's number as last arg.
const User = require('../models/User');
const Player = require('../models/Player');
const transfer = require('../models/transfer');
const { RARITY } = require('../config/constants');
const { money } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');
const { resolveTarget } = require('./router');

function looksLikeJid(arg) {
  if (!arg) return false;
  return /^\d{6,}$/.test(arg) || arg.includes('@');
}

async function handle({ sock, msg, jid, sender, args, replyTo, mentioned }) {
  // ── resolve recipient ──
  let targetJid = replyTo || mentioned;
  let playerId = null;
  let squadMode = false;

  for (const a of args) {
    const lower = (a || '').toLowerCase();
    if (lower === 'squad') squadMode = true;
    else if (looksLikeJid(a)) {
      if (!targetJid) targetJid = a.includes('@') ? a : `${a}@s.whatsapp.net`;
    } else if (!playerId) {
      playerId = a;
    }
  }

  // Fall back to a manager NAME typed as text (e.g. !dash John).
  if (!targetJid) targetJid = resolveTarget(args, { replyTo, mentioned });

  if (!targetJid) {
    await sendText(sock, jid, `⚠️ Tag, reply to, or type the name of the manager you want to dash to.\nUsage:\n*!dash [playerID] @user* — one player\n*!dash @user* — whole squad`, msg);
    return;
  }
  if (targetJid === sender) {
    await sendText(sock, jid, `😅 You can't dash to yourself!`, msg);
    return;
  }

  const me = User.getByWhatsappId(sender);
  const them = User.getByWhatsappId(targetJid);
  if (!me || !me.registered) {
    await sendText(sock, jid, `❌ You need to register first (*!start*).`, msg);
    return;
  }
  if (!them || !them.registered) {
    await sendText(sock, jid, `❌ That manager isn't registered yet.`, msg);
    return;
  }

  // ── whole-squad dash ──
  if (squadMode || !playerId) {
    const players = Player.getSquadPlayers(sender);
    if (!players.length) {
      await sendText(sock, jid, `❌ You have no players to dash. Build a squad with *!start* first!`, msg);
      return;
    }
    let moved = 0;
    for (const p of players) {
      if (p.isListed) continue; // skip anything currently on the market
      transfer.transferPlayer(p.id, sender, targetJid);
      moved++;
    }
    if (!moved) {
      await sendText(sock, jid, `ℹ️ Nothing dashed — your players are all listed on the market.`, msg);
      return;
    }
    await sendText(sock, jid,
      `🎁 *SQUAD DASHED!* 🔥\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `You sent your entire squad (${moved} player(s)) to *${them.name}*!\n` +
      `⚠️ Your roster is now empty — sign new players via *!market* / *!shop*.`, msg, [targetJid]);
    return;
  }

  // ── single-player dash ──
  const player = Player.findByQuery(sender, playerId);
  if (!player) {
    await sendText(sock, jid, `❌ No player found with ID *${playerId}*. Use *!squad* to view your players.`, msg);
    return;
  }
  if (player.isListed) {
    await sendText(sock, jid, `❌ *${Player.displayName(player)}* is listed on the market — cancel the listing first.`, msg);
    return;
  }

  transfer.transferPlayer(player.id, sender, targetJid);

  const emoji = RARITY[player.rarity]?.emoji || '⚪';
  await sendText(sock, jid,
    `🎁 *PLAYER DASHED!* 🔥\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${emoji} *${Player.displayName(player)}* (${player.rarity}) is now *${them.name}*'s!\n` +
    `🆔 \`${player.id}\``, msg, [targetJid]);
}

module.exports = { handle };
