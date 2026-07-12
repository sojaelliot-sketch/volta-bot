const User = require('../models/User');
const Player = require('../models/Player');
const { RARITY, SQUAD, SHOP, GK_POSITIONS } = require('../config/constants');
const { money, bar, formEmoji, conditionEmoji } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');

function shortId(id) {
  return id.slice(0, 6);
}

// Goalkeepers get a positional style derived from their best attribute.
// (Outfield players intentionally show no position — keeps cards clean.)
function gkPosition(p) {
  if (p.role !== 'goalkeeper') return null;
  const s = p.stats || {};
  const ranked = [
    ['Reflex Freak', s.reflex || 0],
    ['Shot Stopper', s.positioning || 0],
    ['Sweeper Keeper', s.anticipation || 0],
    ['Ball Player', s.strength || 0],
    ['Line Keeper', s.composure || 0],
  ].sort((a, b) => b[1] - a[1]);
  return ranked[0][0];
}

function findPlayerByShortId(ownerId, shortIdArg) {
  const owned = Player.getByOwner(ownerId);
  return owned.find((p) => p.id.startsWith(shortIdArg)) || null;
}

function statsLine(p) {
  const s = p.stats;
  return p.role === 'goalkeeper'
    ? `🧤 REF ${s.reflex}  POS ${s.positioning}  ANT ${s.anticipation}  STR ${s.strength}  COM ${s.composure}`
    : `⚡ PAC ${s.pace}  SKL ${s.skill}  SHO ${s.shooting}  STA ${s.stamina}  COM ${s.composure}`;
}

function squadRow(p, tag, showStats = false) {
  const emoji = RARITY[p.rarity]?.emoji || '⚪';
  const role = p.role === 'goalkeeper' ? '🧤' : '⚽';
  let line = `${tag} ${emoji}${role} *${Player.displayName(p)}* (\`${shortId(p.id)}\`)`;
  if (p.role === 'goalkeeper') line += ` · ${gkPosition(p)}`;
  line += ` — ${p.rarity} ${conditionEmoji(p.condition)}${p.condition}%`;
  if (p.form === 'Hot') line += ` 🔥`;
  if (p.form === 'Cold') line += ` 🥶`;
  if (showStats) {
    line += `\n   ${statsLine(p)}`;
  }
  return line;
}

async function cmdSquad({ sock, msg, jid, sender, user }) {
  const owned = Player.getByOwner(sender);
  const byId = Object.fromEntries(owned.map((p) => [p.id, p]));

  const xi = user.startingXI.map((id) => byId[id]).filter(Boolean);
  const bench = user.bench.map((id) => byId[id]).filter(Boolean);
  const reserves = user.reserves.map((id) => byId[id]).filter(Boolean);

  let text = `🧢 *${user.name}'s SQUAD*
━━━━━━━━━━━━━━━━━━━━━━━━
💰 ${money(user.currency)}  🏆 MMR ${user.mmr} (${user.rank})  ⚔️ ${user.wins}W ${user.losses}L ${user.draws}D\n\n`;

  text += `*⚡ STARTING XI* (${xi.length}/${SQUAD.STARTING_XI_SIZE})\n`;
  text += xi.length ? xi.map((p) => squadRow(p, '▶️')).join('\n') : '_empty — open a pack with !shop_';

  text += `\n\n*🪑 BENCH* (${bench.length}/${SQUAD.BENCH_SIZE})\n`;
  text += bench.length ? bench.map((p) => squadRow(p, '⏸️')).join('\n') : '_empty_';

  if (reserves.length) {
    text += `\n\n*📦 RESERVES* (${reserves.length})\n`;
    text += reserves.map((p) => squadRow(p, '  ')).join('\n');
  }

  text += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━
💡 *!card [id]* — Full player card
💡 *!bench [id]* — Move to bench
💡 *!rename [id] [name]* — Custom name`;

  await sendText(sock, jid, text, msg);
}

async function cmdCard({ sock, msg, jid, sender, args }) {
  const idArg = args[0];
  if (!idArg) {
    await sendText(sock, jid, `⚠️ Usage: *!card [id]* — Get the ID from *!squad*`, msg);
    return;
  }
  const p = findPlayerByShortId(sender, idArg);
  if (!p) {
    await sendText(sock, jid, `❌ No player found with ID starting *${idArg}*. Check *!squad*.`, msg);
    return;
  }

  const emoji = RARITY[p.rarity]?.emoji || '⚪';
  const roleLabel = p.role === 'goalkeeper' ? '🧤 Goalkeeper' : '⚽ Outfield';
  const potEmoji = p.potential === 'Star' ? '🌟' : p.potential === 'High' ? '💫' : p.potential === 'Medium' ? '⭐' : '🌱';

  const text =
    `${emoji} *${Player.displayName(p)}*${p.nickname ? ` (${p.name})` : ''}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${roleLabel} · ${p.rarity} · Age ${p.age} · Lv.${p.level} · ${p.nationality} 🌍\n` +
    (p.role === 'goalkeeper' ? `🧤 *Position:* ${gkPosition(p)}\n` : '') +
    `\n` +
    `*📊 STATS*\n${statsLine(p)}\n\n` +
    `*📈 OVERVIEW*\n` +
    `Total Stats: ${Player.totalStats(p)}\n` +
    `Potential: ${potEmoji} ${p.potential}\n` +
    `Condition: ${bar(p.condition)}\n` +
    `Form: ${formEmoji(p.form)} ${p.form}\n` +
    `Chemistry: ${p.chemistry}%\n\n` +
    `*🏅 CAREER*\n` +
    `📊 ${p.matchesPlayed} apps · ${p.goals}⚽ · ${p.assists}🅰️\n` +
    `🧤 ${p.saves} saves · ${p.manOfTheMatch}🌟 MOTM\n\n` +
    `💰 Market Value: ${money(Player.marketValue(p))}\n` +
    `🆔 ID: \`${p.id.slice(0, 6)}\`  (use this in *!train / !boost / !list / !swap / !bench*)\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━`;

  await sendText(sock, jid, text, msg);
}

async function cmdCondition({ sock, msg, jid, sender }) {
  const owned = Player.getByOwner(sender);
  if (!owned.length) {
    await sendText(sock, jid, `You don't have any players yet. Send *!start* to get going.`, msg);
    return;
  }
  const lines = owned
    .sort((a, b) => a.condition - b.condition)
    .map((p) => `${conditionEmoji(p.condition)} *${Player.displayName(p)}* — ${bar(p.condition)}`);

  await sendText(sock, jid, `🩺 *SQUAD CONDITION*
━━━━━━━━━━━━━━━━━━━━━━━━
${lines.join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━
⚡ *!boost energy [id]* — Restore to 100% (${money(SHOP.ENERGY_RESTORE)})`, msg);
}

async function cmdBench({ sock, msg, jid, sender, args, user }) {
  const idArg = args[0];
  if (!idArg) {
    await sendText(sock, jid, `⚠️ Usage: *!bench [id]*`, msg);
    return;
  }
  const p = findPlayerByShortId(sender, idArg);
  if (!p) {
    await sendText(sock, jid, `❌ No player found with ID starting *${idArg}*.`, msg);
    return;
  }
  if (!user.startingXI.includes(p.id)) {
    await sendText(sock, jid, `*${Player.displayName(p)}* isn't in your Starting XI.`, msg);
    return;
  }
  if (user.bench.length >= SQUAD.BENCH_SIZE) {
    await sendText(sock, jid, `⚠️ Bench is full (${SQUAD.BENCH_SIZE} max).`, msg);
    return;
  }

  const startingXI = user.startingXI.filter((id) => id !== p.id);
  const bench = [...user.bench, p.id];
  User.update(sender, { startingXI, bench });

  await sendText(sock, jid, `🔄 *${Player.displayName(p)}* moved to the bench. ✅`, msg);
}

async function cmdRename({ sock, msg, jid, sender, args, user }) {
  const idArg = args[0];
  const name = args.slice(1).join(' ').trim().slice(0, 20);

  if (!idArg || !name) {
    await sendText(sock, jid, `⚠️ Usage: *!rename [id] [new name]*\n💰 Costs ${money(SHOP.RENAME_TOKEN)}`, msg);
    return;
  }
  const p = findPlayerByShortId(sender, idArg);
  if (!p) {
    await sendText(sock, jid, `❌ No player found with ID starting *${idArg}*.`, msg);
    return;
  }

  if ((user.currency || 0) < SHOP.RENAME_TOKEN) {
    await sendText(sock, jid, `❌ Rename costs ${money(SHOP.RENAME_TOKEN)}. You only have ${money(user.currency)}.\n\n💰 Play matches or claim *!daily* to earn more.`, msg);
    return;
  }

  User.update(sender, { currency: (user.currency || 0) - SHOP.RENAME_TOKEN });
  Player.update(p.id, { nickname: name });

  await sendText(sock, jid, `✏️ *${p.name}* is now known as *${name}*!
💲 -${money(SHOP.RENAME_TOKEN)}`, msg);
}

async function handle(ctx) {
  const { cmd } = ctx;
  if (cmd === 'squad' || cmd === 'lineup') return cmdSquad(ctx);
  if (cmd === 'card') return cmdCard(ctx);
  if (cmd === 'condition') return cmdCondition(ctx);
  if (cmd === 'bench') return cmdBench(ctx);
  if (cmd === 'rename') return cmdRename(ctx);
}

module.exports = { handle };