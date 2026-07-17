const User = require('../models/User');
const logger = require('../utils/logger');
const { sendText } = require('../utils/messaging');
const stats = require('../utils/stats');
const { MODERATION, RATELIMIT } = require('../config/constants');
const { grantStarterSquad } = require('../utils/playerGenerator');
const { isChatLocked, getActivePvPForUser } = require('../game-engine/matchSession');
const { isEnabled: botEnabled } = require('./botstate');

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
  match: () => require('./match'),
  challenge: () => require('./match'),
  accept: () => require('./match'),
  forfeit: () => require('./match'),
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
  topchem: () => require('./topchem'),
  swap: () => require('./swap'),
  move: () => require('./swap'),
  autosquad: () => require('./autosquad'),
  best: () => require('./autosquad'),
  wallet: () => require('./wallet'),
  bal: () => require('./wallet'),
  give: () => require('./give'),
  dash: () => require('./dash'),
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
  tchallenge: () => require('./match'),
  bracket: () => require('./bracket'),
  brackets: () => require('./bracket'),
  tbv: () => require('./bracket'),
  join: () => require('./staff'),
  leaderboard: () => require('./leaderboard'),
  lb: () => require('./leaderboard'),
  top10: () => require('./leaderboard'),
  playerlb: () => require('./playerlb'),
  plb: () => require('./playerlb'),
  invite: () => require('./invite'),
  flex: () => require('./squad'),
  boostall: () => require('./shop'),
  surgery: () => require('./shop'),
  tutorial: () => require('./tutorial'),
  tut: () => require('./tutorial'),
  setname: () => require('./profile'),
  name: () => require('./profile'),
  profile: () => require('./profile'),
  info: () => require('./profile'),
  password: () => require('./password'),
  setpass: () => require('./password'),
  reserve: () => require('./reserve'),
  preserves: () => require('./preserves'),
  broadcast: () => require('./broadcast'),
  ping: () => require('./ping'),
  pong: () => require('./pong'),
  tbet: () => require('./tbet'),
  debug: () => require('./debug'),
  setbounty: () => require('./setbounty'),
  academy: () => require('./academy'),
  scout: () => require('./academy'),
  promoteacademy: () => require('./academy'),
  on: () => require('./botstate'),
  off: () => require('./botstate'),
  reload: () => require('./reload'),
  clearpvp: () => require('./pvpadmin'),
  explain: () => require('./explain'),
  guide: () => require('./explain'),
  how: () => require('./explain'),
  ban: () => require('./mod'),
  unban: () => require('./mod'),
  warn: () => require('./mod'),
  promote: () => require('./promote'),
  demote: () => require('./mod'),
  kick: () => require('./mod'),
  mods: () => require('./mod'),
};

const PUBLIC_COMMANDS = new Set(['start', 'register', 'help', 'menu', 'top10', 'leaderboard', 'lb', 'invite']);

// ─── spam / cooldown tracking ───────────────────────────────────────────────
const lastCommandAt = new Map();   // sender -> timestamp
const warnCount     = new Map();    // sender -> warnings

// ─── sliding-window rate limiter ────────────────────────────────────────────
// Tracks recent command timestamps per sender. If a sender exceeds MAX_IN_WINDOW
// commands within WINDOW_MS, they're throttled for BLOCK_MS. This catches a
// sustained flood that individually respects the per-command cooldown.
const windowHits = new Map();      // sender -> number[] of timestamps
const blockedUntil = new Map();    // sender -> timestamp until which they're blocked

function rateLimited(sender, now) {
  const until = blockedUntil.get(sender) || 0;
  if (now < until) return true;
  const hits = (windowHits.get(sender) || []).filter((t) => now - t < RATELIMIT.WINDOW_MS);
  hits.push(now);
  windowHits.set(sender, hits);
  if (hits.length > RATELIMIT.MAX_IN_WINDOW) {
    blockedUntil.set(sender, now + RATELIMIT.BLOCK_MS);
    windowHits.set(sender, []);
    return true;
  }
  return false;
}

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

// Resolve a target manager by an explicit jid/id, a reply, a @mention, or a
// manager NAME (typed as text). The name lookup lets anyone do e.g.
//   !info Oasis FC      !give 100 John     !dash @Maria
// without needing a raw number or a quoted message. Returns a normalized jid.
function resolveByName(arg) {
  if (!arg) return null;
  const s = String(arg).replace(/^@/, '').trim().toLowerCase();
  if (!s) return null;
  let found = null;
  for (const u of User.all()) {
    if (!u || !u.registered) continue;
    const name = String(u.name || '').toLowerCase();
    if (name === s) return User.normalizeJid(u.whatsappId);
    if (name.includes(s) && !found) found = u; // keep first partial match as fallback
  }
  return found ? User.normalizeJid(found.whatsappId) : null;
}

function resolveTarget(args, ctx = {}) {
  if (args && args.length && looksLikeJid(args[0])) {
    const a = args[0].trim();
    return a.includes('@') ? a : `${a}@s.whatsapp.net`;
  }
  if (ctx.replyTo) return ctx.replyTo;
  if (ctx.mentioned) return ctx.mentioned;
  // Last resort: a manager NAME passed as the first arg (e.g. !info John).
  if (args && args.length) return resolveByName(args[0]);
  return null;
}

async function handle(sock, msg) {
  try {
    const jid = msg.key?.remoteJid;
    if (!jid) return;

    // Self-hosted bot: the bot runs on the OWNER's own WhatsApp number, so every
    // message the owner sends arrives as fromMe:true — and that account IS the
    // owner. Treat any fromMe message as coming from the canonical owner jid,
    // so owner commands always work regardless of device/format suffixes, and a
    // group chat can NEVER hijack OWNER_ID. Messages from anyone else use their
    // real (normalized) jid.
    const sender = msg.key?.fromMe
      ? User.normalizeJid(`${MODERATION.OWNER_ID}@s.whatsapp.net`)
      : User.normalizeJid(msg.key?.participant || jid);
    if (jid === 'status@broadcast') return;

    const text = extractText(msg.message).trim();
    if (!text) return;
    if (!text.startsWith(PREFIX)) return;

    const [rawCmd, ...args] = text.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = rawCmd.toLowerCase();
    stats.commandSeen();

    // ── global on/off gate ──
    // When the bot is OFF, only the owner may act, and the only command that
    // works for everyone is !on (to switch it back on).
    if (!botEnabled() && cmd !== 'on' && !User.isOwner(sender)) {
      await sendText(sock, jid, '🔴 The bot is currently OFF. Only the owner can switch it back on with *!on*.', msg);
      return;
    }

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
    // Applies to EVERY command (including owner/staff) so the bot can't be
    // flooded. Live gameplay reactions (chances, penalty shots, subs) must NOT
    // be rate-limited, or legit fast play would get flagged as spam. Owner/staff
    // still get the cooldown but are never auto-banned for it.
    const LIVE_CMDS = new Set(['a', 'b', 'c', 'd', 'chance', 'shoot', 'save', 'sub']);
    if (!LIVE_CMDS.has(cmd)) {
      const now  = Date.now();
      const last = lastCommandAt.get(sender) || 0;
      if (now - last < MODERATION.COOLDOWN_MS) {
        if (isExempt(sender, user)) {
          await sendText(sock, jid, `⏳ Easy! Wait a moment between commands.`, msg);
          return;
        }
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

      // ── sliding-window flood cap (on top of the cooldown) ──
      // Owner/staff are never blocked, but everyone is counted.
      if (rateLimited(sender, now) && !isExempt(sender, user)) {
        await sendText(sock, jid, `🐢 You're sending commands too fast. Take a short break and try again in a moment.`, msg);
        return;
      }
    }

    // ── PvP command lock ──
    // Only the two players in the match may use commands while it's live; the
    // owner (and staff) are exempt so they can still operate in the chat.
    if (isChatLocked(jid, sender) && !User.isOwner(sender) && !User.isStaff(user)) {
      await sendText(sock, jid, `🔒 A match is in progress in this chat — commands are locked to the players until it finishes.`, msg);
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
    stats.commandAnswered();
    await mod.handle({ sock, msg, jid, sender, cmd, args, user, replyTo, mentioned });
  } catch (err) {
    stats.issueFound(err);
    logger.error({ err }, 'Error handling message');
    try {
      await sendText(sock, msg.key.remoteJid, '⚠️ Something went wrong processing that command. Try again in a moment.');
    } catch {
      // swallow
    }
  }
}

module.exports = { handle, extractText, resolveTarget };
