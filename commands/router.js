const User = require('../models/User');
const logger = require('../utils/logger');
const { sendText } = require('../utils/messaging');
const { MODERATION } = require('../config/constants');
const { grantStarterSquad } = require('../utils/playerGenerator');
const { isChatLocked, getActivePvPForUser } = require('../game-engine/matchSession');

const PREFIX = '!';

const handlers = {
  start: () => require('./start'),
  register: () => require('./start'),
  help: () => require('./help'),
  menu: () => require('./help'),
  squad: () => require('./squad'),
  lineup: () => require('./squad'),
  bench: () => require('./squad'),
  rename: () => require('./squad'),
  condition: () => require('./squad'),
  card: () => require('./squad'),
  play: () => require('./match'),
  challenge: () => require('./match'),
  accept: () => require('./match'),
  sub: () => require('./match'),
  a: () => require('./match'),
  b: () => require('./match'),
  c: () => require('./match'),
  d: () => require('./match'),
  chance: () => require('./match'),
  daily: () => require('./daily'),
  streak: () => require('./daily'),
  shop: () => require('./shop'),
  pack: () => require('./shop'),
  boost: () => require('./shop'),
  train: () => require('./shop'),
  market: () => require('./market'),
  buy: () => require('./market'),
  sell: () => require('./market'),
  list: () => require('./market'),
  search: () => require('./search'),
  find: () => require('./search'),
  swap: () => require('./swap'),
  move: () => require('./swap'),
  autosquad: () => require('./autosquad'),
  best: () => require('./autosquad'),
  wallet: () => require('./wallet'),
  bal: () => require('./wallet'),
  give: () => require('./give'),
  squads: () => require('./squads'),
  buysquad: () => require('./squads'),
  switchsquad: () => require('./squads'),
  slot: () => require('./fun'),
  coinflip: () => require('./fun'),
  flip: () => require('./fun'),
  highlow: () => require('./highlow'),
  hl: () => require('./highlow'),
  penalty: () => require('./penalty'),
  shoot: () => require('./penalty'),
  save: () => require('./penalty'),
  bid: () => require('./auction'),
  auction: () => require('./auction'),
  giveaway: () => require('./staff'),
  gw: () => require('./staff'),
  tournament: () => require('./staff'),
  tourney: () => require('./staff'),
  tourneyplay: () => require('./staff'),
  playtourney: () => require('./staff'),
  join: () => require('./staff'),
  leaderboard: () => require('./leaderboard'),
  lb: () => require('./leaderboard'),
  playerlb: () => require('./playerlb'),
  plb: () => require('./playerlb'),
  tutorial: () => require('./tutorial'),
  tut: () => require('./tutorial'),
  setname: () => require('./profile'),
  name: () => require('./profile'),
  password: () => require('./password'),
  setpass: () => require('./password'),
  reload: () => require('./reload'),
  explain: () => require('./explain'),
  guide: () => require('./explain'),
  how: () => require('./explain'),
  ban: () => require('./mod'),
  unban: () => require('./mod'),
  warn: () => require('./mod'),
  promote: () => require('./mod'),
  demote: () => require('./mod'),
  kick: () => require('./mod'),
  mods: () => require('./mod'),
};

const PUBLIC_COMMANDS = new Set(['start', 'register', 'help', 'menu']);

// ─── spam / cooldown tracking ───────────────────────────────────────────────
const lastCommandAt = new Map();   // sender -> timestamp
const warnCount     = new Map();    // sender -> warnings

function isExempt(sender, user) {
  return User.isOwner(sender) || User.isStaff(user);
}

function extractText(message) {
  if (!message) return '';
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.buttonsResponseMessage?.selectedButtonId ||
    message.listResponseMessage?.singleSelectReply?.selectedRowId ||
    message.templateButtonReplyMessage?.selectedId ||
    ''
  );
}

// Resolve a target user jid from a command context. Precedence:
//   1. first arg if it looks like an id/number/jid
//   2. the user being replied to (quoted message participant)
//   3. the first @mention
function looksLikeJid(arg) {
  if (!arg) return false;
  return /^\d{6,}$/.test(arg) || arg.includes('@');
}

function resolveTarget(args, ctx = {}) {
  if (args && args.length && looksLikeJid(args[0])) {
    const a = args[0].trim();
    return a.includes('@') ? a : `${a}@s.whatsapp.net`;
  }
  if (ctx.replyTo) return ctx.replyTo;
  if (ctx.mentioned) return ctx.mentioned;
  return null;
}

async function handle(sock, msg) {
  try {
    const jid = msg.key?.remoteJid;
    if (!jid) return;

    const sender = User.normalizeJid(msg.key?.participant || jid);
    if (jid === 'status@broadcast') return;

    // Self-hosted bot: the owner's own messages arrive as fromMe:true, and that
    // account IS the owner. If the configured OWNER_ID doesn't match the actual
    // sender jid (number-format differences), adopt the host account as owner so
    // every owner command works. Harmless when the bot runs on a separate number
    // (there, fromMe is only the bot's own non-command replies).
    // IMPORTANT: only adopt from a 1:1 chat (never a group jid like *@g.us), or a
    // group message would hijack OWNER_ID and spawn a fake "Oasis FC" account.
    if (msg.key?.fromMe && !jid.endsWith('@g.us')) {
      const bare = sender.split('@')[0].replace(/\D/g, '');
      const ownerBare = String(MODERATION.OWNER_ID || '').replace(/\D/g, '');
      if (bare && bare !== ownerBare) MODERATION.OWNER_ID = bare;
    }

    const text = extractText(msg.message).trim();
    if (!text) return;
    if (!text.startsWith(PREFIX)) return;

    const [rawCmd, ...args] = text.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = rawCmd.toLowerCase();

    // ── reply / mention target resolution ──
    // A command can target another user by: replying to their message,
    // @mentioning them, or passing their id/number as the first arg.
    const ctxInfo = msg.message?.extendedTextMessage?.contextInfo
      || msg.message?.imageMessage?.contextInfo
      || msg.message?.videoMessage?.contextInfo
      || {};
    const replyTo = ctxInfo.participant ? User.normalizeJid(ctxInfo.participant) : null;
    const mentioned = ctxInfo.mentionedJid && ctxInfo.mentionedJid[0]
      ? User.normalizeJid(ctxInfo.mentionedJid[0])
      : null;

    logger.info({ jid, sender, cmd, args }, `cmd: ${cmd}`);

    let user = User.getByWhatsappId(sender);

    // ── ban check ──
    if (User.isBanned(user)) {
      const ms = User.banRemainingMs(user);
      const mins = Math.ceil(ms / 60000);
      await sendText(sock, jid, `🚫 You are banned. Try again in about *${mins} min*.`, msg);
      return;
    }

    // ── owner / staff can always operate (auto-profile + starter squad) ──
    if (isExempt(sender, user) && (!user || !user.registered)) {
      User.create(sender, User.isOwner(sender) ? 'Oasis FC' : (user?.name || 'Staff'));
      grantStarterSquad(sender);
      user = User.getByWhatsappId(sender);
    }

    // ── in-match sub bypasses the PvP lock for the two players ──
    if (cmd === 'sub') {
      const pvp = getActivePvPForUser(sender);
      if (pvp) {
        const mod = require('./match');
        await mod.handle({ sock, msg, jid, sender, cmd, args, user: User.getByWhatsappId(sender) });
        return;
      }
    }

    // ── cooldown + spam warnings + 3-strike auto-ban ──
    // Live gameplay reactions (chances, penalty shots) must NOT be rate-limited,
    // or legit fast play would get flagged as spam.
    const LIVE_CMDS = new Set(['a', 'b', 'c', 'd', 'chance', 'shoot', 'save', 'sub']);
    if (!isExempt(sender, user) && !LIVE_CMDS.has(cmd)) {
      const now  = Date.now();
      const last = lastCommandAt.get(sender) || 0;
      if (now - last < MODERATION.COOLDOWN_MS) {
        const w = (warnCount.get(sender) || 0) + 1;
        warnCount.set(sender, w);
        if (w >= MODERATION.WARNINGS_BEFORE_BAN) {
          warnCount.delete(sender);
          User.update(sender, { bannedUntil: new Date(now + MODERATION.BAN_DURATION_MS).toISOString(), warnings: 0 });
          await sendText(sock, jid, `⛔ *Auto-banned for 3 minutes* for spamming commands. Slow down next time! 🐢`, msg);
          return;
        }
        await sendText(sock, jid, `⚠️ Slow down! Warning *${w}/${MODERATION.WARNINGS_BEFORE_BAN}*. Space your commands out.`, msg);
        return;
      }
      lastCommandAt.set(sender, now);
      warnCount.delete(sender);
    }

    // ── PvP command lock ──
    if (isChatLocked(jid, sender)) {
      await sendText(sock, jid, `🔒 A match is in progress in this chat — commands are locked until it finishes.`, msg);
      return;
    }

    const getHandler = handlers[cmd];
    if (!getHandler) {
      await sendText(sock, jid, `❓ Unknown command *!${cmd}*. Send *!help* to see everything I can do.`, msg);
      return;
    }

    // Registration closed → unregistered strangers are silently ignored (no
    // "register" nag, and they can't create an account). The owner and any
    // already-registered staff are exempt.
    if (!MODERATION.OPEN_REGISTRATION && !User.isOwner(sender) && (!user || !user.registered)) {
      return;
    }

    if (!PUBLIC_COMMANDS.has(cmd) && (!user || !user.registered)) {
      await sendText(sock, jid, `👋 You're not registered yet. Send *!start* to create your VOLTA manager profile first.`, msg);
      return;
    }

    const mod = getHandler();
    await mod.handle({ sock, msg, jid, sender, cmd, args, user, replyTo, mentioned });
  } catch (err) {
    logger.error({ err }, 'Error handling message');
    try {
      await sendText(sock, msg.key.remoteJid, '⚠️ Something went wrong processing that command. Try again in a moment.');
    } catch {
      // swallow
    }
  }
}

module.exports = { handle, extractText, resolveTarget };
