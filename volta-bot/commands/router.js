const User = require('../models/User');
const onboarding = require('../utils/onboarding');
const logger = require('../utils/logger');
const { sendText, startTyping, stopTyping, smartTypingPause } = require('../utils/messaging');
const stats = require('../utils/stats');
const { MODERATION, BRAND } = require('../config/constants');
const { grantStarterSquad } = require('../utils/playerGenerator');
const { isChatLocked, getActivePvPForUser } = require('../game-engine/matchSession');
const { isEnabled: botEnabled, isAfk, isCmdDisabled } = require('./botstate');


const PREFIX = '!';

const handlers = {
  start: () => require('./start'),
  register: () => require('./start'),
  help: () => require('./help'),
  menu: () => require('./help'),
  announce: () => require('./help'),
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
  subtract: () => require('./subtract'),
  take: () => require('./subtract'),
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
  work: () => require('./work'),
  jobs: () => require('./work'),
  salary: () => require('./salary'),
  interest: () => require('./salary'),
  insurance: () => require('./insurance'),
  contract: () => require('./contract'),
  repair: () => require('./contract'),
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
  diag: () => require('./diag'),
  agent: () => require('./agent'),
  bargain: () => require('./agent'),
  derby: () => require('./derby'),
  borrow: () => require('./loan'),
  lend: () => require('./loan'),

  health: () => require('./diag'),
  setbounty: () => require('./setbounty'),
  academy: () => require('./academy'),
  scout: () => require('./academy'),
  youthpromote: () => require('./academy'),
  on: () => require('./botstate'),
  off: () => require('./botstate'),
  disable: () => require('./botstate'),
  afk: () => require('./botstate'),
  reload: () => require('./reload'),
  clearpvp: () => require('./pvpadmin'),
  explain: () => require('./explain'),
  guide: () => require('./explain'),
  how: () => require('./explain'),
  ban: () => require('./mod'),
  unban: () => require('./mod'),
  warn: () => require('./mod'),
  cooldown: () => require('./mod'),
  uncooldown: () => require('./mod'),
  promote: () => require('./mod'),
  demote: () => require('./mod'),
  kick: () => require('./mod'),
  kickgc: () => require('./mod'),
  mods: () => require('./mod'),
  stadium: () => require('./stadium'),
  buystadium: () => require('./stadium'),
  sellstadium: () => require('./stadium'),
  pk: () => require('./stadium'),
  hustle: () => require('./hustle'),
  rivalry: () => require('./rivalry'),
  trade: () => require('./trade'),
  press: () => require('./press'),
  curse: () => require('./curse'),
  chant: () => require('./chant'),
  shield: () => require('./shield'),
  weeklyawards: () => require('./weeklyawards'),
  formcheck: () => require('./formcheck'),
  retire: () => require('./retire'),
  league: () => require('./league'),
  captain: () => require('./captain'),
  injuries: () => require('./injuries'),
  season: () => require('./season'),
  trophies: () => require('./trophies'),
  teamchem: () => require('./teamchem'),
  competitions: () => require('./tournament'),
  compgcs: () => require('./compgcs'),
  loan: () => require('./loan'),
  awards: () => require('./awards'),
  compplay: () => require('./compplay'),
  redeem: () => require('./redeem'),
};

const PUBLIC_COMMANDS = new Set(['start', 'register', 'help', 'menu', 'top10', 'leaderboard', 'lb', 'invite', 'announce']);

// ─── spam / cooldown tracking ───────────────────────────────────────────────
const lastCommandAt = new Map();   // sender -> timestamp
const warnCount     = new Map();    // sender -> warnings
const afkUsers      = new Set();    // sender -> muted until !afk off

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
    // Modern native-flow reply. WhatsApp sends the tapped button's payload as
    // JSON here; the command lives in `id`. Without this, taps on interactive
    // messages were parsed as empty text and silently dropped.
    nativeFlowId(message) ||
    ''
  );
}

function nativeFlowId(message) {
  const raw = message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    return parsed.id || parsed.selectedId || parsed.selectedRowId || '';
  } catch {
    return '';
  }
}

// Resolve a target user jid from a command context. Precedence:
//   1. first arg if it looks like an id/number/jid
//   2. the user being replied to (quoted message participant)
//   3. the first @mention
function looksLikeJid(arg) {
  if (!arg) return false;
  // Match phone numbers (6+ digits) or full JIDs (e.g. 1234567890@s.whatsapp.net)
  return /^\d{6,}$/.test(arg) || /^\d+@s\.whatsapp\.net$/.test(arg);
}

// Resolve a target manager by an explicit jid/id, a reply, a @mention, or a
// manager NAME (typed as text). The name lookup lets anyone do e.g.
//   !info Oasis FC      !give 100 John     !dash @Maria
// without needing a raw number or a quoted message. Returns a normalized jid or null.
// If the name matches multiple people, prefer the exact match and warn
// if the first result is only a partial match.
function resolveByName(arg) {
  if (!arg) return null;
  const s = String(arg).replace(/^@/, '').trim().toLowerCase();
  if (!s) return null;
  let exact = null;
  let partial = null;
  for (const u of User.all()) {
    if (!u || !u.registered) continue;
    const name = String(u.name || '').toLowerCase();
    if (name === s) { exact = u; break; }
    if (name.includes(s) && !partial) partial = u;
  }
  if (exact) return User.normalizeJid(exact.whatsappId);
  return partial ? User.normalizeJid(partial.whatsappId) : null;
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

    // The bot may be logged in as the HOST number (different from OWNER_ID).
    // Only map fromMe → owner when the logged-in account IS the owner,
    // so the host has their own identity and the real owner is recognized
    // regardless of which number the bot is paired with.
    const botJid = sock?.user?.id ? User.normalizeJid(sock.user.id) : null;
    const botIsOwner = botJid ? User.isOwner(botJid) : false;
    const sender = msg.key?.fromMe && botIsOwner
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

    // ── AFK mode ──
    // When the bot is AFK, it still responds to commands but sends no auto-chat.
    // Owner can always use all commands. Non-owners get commands but no fluff.
    const botAfk = isAfk();

    let user = User.getByWhatsappId(sender);

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

    // Terminal log: only show commands with prefix (clean format)
    const senderName = User.getByWhatsappId(sender)?.name || sender.split('@')[0];
    console.log(`[CMD] ${senderName}: !${cmd} ${args.join(' ')}`.trim());

    // ── ban check ──
    if (User.isBanned(user)) {
      const ms = User.banRemainingMs(user);
      const mins = Math.ceil(ms / 60000);
      await sendText(sock, jid, `🚫 You are banned. Try again in about *${mins} min*.`, msg);
      return;
    }

    // ── cooldown check ──
    // Staff are exempt from cooldowns. Cooldown blocks all commands except
    // uncooldown (so staff can remove it).
    if (User.isOnCooldown(user) && !User.isStaff(user) && !User.isOwner(sender) && cmd !== 'uncooldown') {
      const ms = User.cooldownRemainingMs(user);
      const mins = Math.ceil(ms / 60000);
      await sendText(sock, jid, `⏳ You are on cooldown. Try again in about *${mins} min*.`, msg);
      return;
    }

    // ── afk (spam-muted) check ──
    // When a user spams, they get silently ignored for all commands except !afk off
    if (afkUsers.has(sender) && cmd !== 'afk') {
      return;
    }

    // ── !afk off — unmute yourself ──
    if (cmd === 'afk') {
      if (args[0] === 'off') {
        afkUsers.delete(sender);
        warnCount.delete(sender);
        await sendText(sock, jid, `✅ You're unmuted. Take it easy next time! 🐢`, msg);
      } else if (afkUsers.has(sender)) {
        await sendText(sock, jid, `💤 You're muted for spamming. Say *!afk off* to start chatting again.`, msg);
      } else {
        await sendText(sock, jid, `✅ You're not muted. Keep chatting!`, msg);
      }
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
          afkUsers.add(sender);
          await sendText(sock, jid, `🐢 *Too fast!* You're muted until you say *!afk off*. Take a breather.`, msg);
          return;
        }
        await sendText(sock, jid, `⚠️ Slow down! Warning *${w}/${MODERATION.WARNINGS_BEFORE_BAN}*. Space your commands out.`, msg);
        return;
      }
      lastCommandAt.set(sender, now);
      warnCount.delete(sender);
    }

    // ── PvP command lock ──
    // Only the two players in the match may use commands while it's live; the
    // owner (and staff) are exempt so they can still operate in the chat.
    if (isChatLocked(jid, sender) && !User.isOwner(sender) && !User.isStaff(user)) {
      await sendText(sock, jid, `🔒 A match is in progress in this chat — commands are locked to the players until it finishes.`, msg);
      return;
    }

    // !skiptour is handled inline rather than as a command file — it is one
    // line and only matters during a manager's first session. It must sit
    // above the unknown-command guard or it never reaches here.
    if (cmd === 'skiptour') {
      onboarding.skip(sender);
      await sendText(sock, jid, `👍 Tour skipped. Send *!help* whenever you want the full list.`, msg);
      return;
    }

    const getHandler = handlers[cmd];
    if (!getHandler) {
      // Suggest something instead of dead-ending on a typo.
      let hint = '';
      try {
        const { COMMANDS } = require('../config/commandIndex');
        const names = Object.keys(COMMANDS);
        const near = [
          ...names.filter((n) => n.startsWith(cmd.slice(0, 3))),
          ...names.filter((n) => n.includes(cmd) && !n.startsWith(cmd.slice(0, 3))),
        ].slice(0, 3);
        if (near.length) hint = `\n\nDid you mean: ${near.map((n) => `*!${n}*`).join('  ')}`;
      } catch { /* index unavailable — fall back to the plain message */ }
      await sendText(sock, jid, `❓ There's no *!${cmd}*.${hint}\n\nSend *!help* to see everything.`, msg);
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

    // ── disabled command check ──
    if (isCmdDisabled(cmd) && !User.isOwner(sender)) {
      await sendText(sock, jid, `🚫 The command *!${cmd}* is currently disabled by the owner.`, msg);
      return;
    }

    // ── !skiptour ──
    if (cmd === 'skiptour') {
      onboarding.skip(sender);
      await sendText(sock, jid, `👍 Tour skipped. *!help* whenever you need it.`, msg);
      return;
    }

    const mod = getHandler();
    stats.commandAnswered();
    // Smart typing pause: shows "typing..." for a natural duration based on
    // expected response length, then sends the response.
    await smartTypingPause(sock, jid, 150);
    await mod.handle({ sock, msg, jid, sender, cmd, args, user, replyTo, mentioned });

    // A new manager gets ONE instruction after each step they complete, rather
    // than a wall of 96 commands at registration. Never fails the command.
    // Only touches the database when a step is actually completed. `user` is
    // the record already loaded above — do not re-fetch it here.
    try {
      const nudge = onboarding.advance(user, cmd);
      if (nudge) await sendText(sock, jid, nudge);
    } catch (err) {
      logger.error({ err }, 'Onboarding nudge failed');
    }
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
