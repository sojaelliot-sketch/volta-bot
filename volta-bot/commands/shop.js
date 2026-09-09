const User = require('../models/User');
const Player = require('../models/Player');
const { openPack } = require('../utils/playerGenerator');
const { PACKS, TRAINING, SHOP: SHOP_CFG, RARITY } = require('../config/constants');
const { money, bar } = require('../utils/formatter');
const ui = require('../utils/ui');
const { sendText, typing } = require('../utils/messaging');
const { randInt, pick } = require('../utils/random');
const stadium = require('../utils/stadium');

async function handle({ sock, msg, jid, sender, cmd, args, user }) {
  if (cmd === 'shop') return cmdShop({ sock, msg, jid, user });
  if (cmd === 'pack') return cmdPack({ sock, msg, jid, sender, args, user });
  if (cmd === 'boost') return cmdBoost({ sock, msg, jid, sender, args, user });
  if (cmd === 'boostall') return cmdBoostAll({ sock, msg, jid, sender, args, user });
  if (cmd === 'surgery') return cmdSurgery({ sock, msg, jid, sender, args, user });
  if (cmd === 'train') return cmdTrain({ sock, msg, jid, sender, args, user });
}

async function cmdShop({ sock, msg, jid, user }) {
  const lines = [];
  lines.push('*📦 PACKS*');
  lines.push(`  • !pack starter — 4 players (Common–Rare)  ·  💲${money(PACKS.STARTER.cost)}`);
  lines.push(`  • !pack pro — 4 players (Common–Legendary)  ·  💲${money(PACKS.PRO.cost)}`);
  lines.push(`  • !pack elite — 5 players (Rare–Legendary)  ·  💲${money(PACKS.ELITE.cost)}`);
  lines.push('');
  lines.push('*⚡ BOOSTS*');
  lines.push(`  • !boost energy [id] — full condition restore  ·  💲${money(SHOP_CFG.ENERGY_RESTORE)}`);
  lines.push(`  • !boost form [id] — hot form 🔥  ·  💲${money(SHOP_CFG.FORM_BOOST)}`);
  lines.push(`  • !boostall energy|form — your whole squad  ·  💲${money(SHOP_CFG.ENERGY_RESTORE)} × players`);
  lines.push('');
  lines.push('*🏥 RECOVERY*');
  lines.push(`  • !surgery [id|name] — instant heal from injury  ·  💲${money(SHOP_CFG.SURGERY_COST)} (max ${SHOP_CFG.SURGERY_LIMIT}/day)`);
  lines.push('');
  lines.push('*🏋️ TRAINING*');
  lines.push(`  • !train [id|name] — basic session  ·  💲${money(TRAINING.BASE_COST)}`);
  lines.push(`  • !train elite [id|name] — elite coaching  ·  💲${money(TRAINING.ELITE_COST)}`);
  lines.push('');
  lines.push('*✏️ OTHER*');
  lines.push(`  • !rename [id] [name] — custom nickname  ·  💲${money(SHOP_CFG.RENAME_TOKEN)}`);

  await sendText(sock, jid, ui.card({
    icon: '🛍️', title: 'VOLTA SHOP',
    lead: `Your balance: *💲${ui.money(user.currency)}*`,
    body: lines,
    next: 'Use *!squad* to find player IDs — names work too (eg *!surgery Kane*)',
  }), msg);
}

async function cmdPack({ sock, msg, jid, sender, args, user }) {
  const packType = (args[0] || '').toLowerCase();
  const packConfig = { starter: PACKS.STARTER, pro: PACKS.PRO, elite: PACKS.ELITE }[packType];

  if (!packConfig) {
    await sendText(sock, jid, ui.problem(`Show me a pack: *!pack starter* | *!pack pro* | *!pack elite*`, `🎒 Starter 💲${money(PACKS.STARTER.cost)}  ·  Pro 💲${money(PACKS.PRO.cost)}  ·  Elite 💲${money(PACKS.ELITE.cost)}`), msg);
    return;
  }

  if ((user.currency || 0) < packConfig.cost) {
    await sendText(sock, jid, ui.card({
      icon: '❌', title: 'Short on Metaworks',
      rows: [
        ['Aspiring', `${packType.toUpperCase()} pack costs 💲${money(packConfig.cost)}`],
        ['Your balance', `💲${ui.money(user.currency)}`],
      ],
      next: 'Play matches or claim *!daily* to top up.',
    }), msg);
    return;
  }

  await typing(sock, jid, 800);
  User.update(sender, { currency: (user.currency || 0) - packConfig.cost });

  await sendText(sock, jid, `🎁 *OPENING ${packType.toUpperCase()} PACK...*`, msg);
  await typing(sock, jid, 1200);

  const players = openPack(sender, packConfig);

  // Players must actually land in the user's squad (reserves) or they are
  // invisible to !squad / !play. This was a long-standing orphan bug.
  const reserves = [...(user.reserves || []), ...players.map((p) => p.id)];
  User.update(sender, { reserves });

  let reveal = `✨ *${packType.toUpperCase()} PACK RESULTS* ✨
━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  let legendaryPulled = false;
  for (const p of players) {
    const emoji = RARITY[p.rarity]?.emoji || '⚪';
    const role = p.role === 'goalkeeper' ? '🧤 GK' : '⚽ OF';
    const s = p.stats;
    const statLine = p.role === 'goalkeeper'
      ? `REF ${s.reflex} POS ${s.positioning} ANT ${s.anticipation} STR ${s.strength} COM ${s.composure}`
      : `PAC ${s.pace} SKL ${s.skill} SHO ${s.shooting} STA ${s.stamina} COM ${s.composure}`;
    reveal += `${emoji} *${Player.displayName(p)}*\n`;
    reveal += `   ${p.rarity} · ${role} · Age ${p.age}\n`;
    reveal += `   ${statLine}\n`;
    reveal += `   💰 ${money(Player.marketValue(p))} · ❤️ ${bar(p.condition)} · 🆔 \`${p.id.slice(0, 6)}\`\n\n`;
    if (p.rarity === 'Legendary') { reveal += `🌟 *LEGENDARY PULL!* 🎉\n\n`; legendaryPulled = true; }
    else if (p.rarity === 'Elite') reveal += `💜 *Elite player!*\n\n`;
  }

  reveal += `━━━━━━━━━━━━━━━━━━━━━━━━
📦 Players added to your *reserves*.
Use *!squad* to view them or *!swap [id] xi* to promote to your lineup.`;

  // Legendary pulls are shareable hype — reward a bonus pack "for the flex".
  if (legendaryPulled) {
    const bonus = openPack(sender, PACKS.STARTER);
    const cur = User.getByWhatsappId(sender);
    User.update(sender, { reserves: [...(cur.reserves || []), ...bonus.map((x) => x.id)] });
    reveal += `\n\n🟡 *LEGENDARY ALERT!* Share this pull in 3 groups to flex it —
and here's a FREE Starter Pack on us for the hype! 🎁 (${bonus.length} players added)`;
  }

  await sendText(sock, jid, reveal, msg);

  // ── badge: First Legendary Pull ──
  if (legendaryPulled) {
    try {
      require('../utils/badges').award(sender, 'first_legendary', { sock, jid, msg });
    } catch { /* non-fatal */ }
  }
  // High Roller / other currency-milestone badges may have flipped from rewards.
  try { require('../utils/badges').evaluateMilestones(sender, { sock, jid, msg }); } catch {}
}

async function cmdBoost({ sock, msg, jid, sender, args, user }) {
  const boostType = (args[0] || '').toLowerCase();
  const playerId = args[1];

  if (!boostType || !playerId) {
    await sendText(sock, jid, ui.problem(`Give me a boost and a target: *!boost energy [id|name]* or *!boost form [id|name]*`,
      `⚡ energy — condition to 100%  ·  💲${money(SHOP_CFG.ENERGY_RESTORE)}\n🔥 form — set form to Hot  ·  💲${money(SHOP_CFG.FORM_BOOST)}`), msg);
    return;
  }

  const player = Player.findByQuery(sender, playerId);
  if (!player) {
    await sendText(sock, jid, `❌ No player found for *${playerId}*. Use *!squad* to find IDs or names.`, msg);
    return;
  }

  if (boostType === 'energy') {
    if ((user.currency || 0) < SHOP_CFG.ENERGY_RESTORE) {
      await sendText(sock, jid, `❌ Not enough! Energy restore costs ${money(SHOP_CFG.ENERGY_RESTORE)}.`, msg);
      return;
    }
    if (player.condition >= 100) {
      await sendText(sock, jid, `✅ *${Player.displayName(player)}* is already at 100% condition!`, msg);
      return;
    }
    User.update(sender, { currency: (user.currency || 0) - SHOP_CFG.ENERGY_RESTORE });
    Player.update(player.id, { condition: 100 });
    await sendText(sock, jid, ui.card({
      icon: '⚡', title: 'Energy restored',
      lead: `*${Player.displayName(player)}* is back to full charge.`,
      rows: [['Condition', '100% 🟢'], ['Cost', `-💲${money(SHOP_CFG.ENERGY_RESTORE)}`]],
      next: 'Ready to ball — !play or !match.',
    }), msg);

  } else if (boostType === 'form') {
    if ((user.currency || 0) < SHOP_CFG.FORM_BOOST) {
      await sendText(sock, jid, `❌ Not enough! Form boost costs ${money(SHOP_CFG.FORM_BOOST)}.`, msg);
      return;
    }
    if (player.form === 'Hot') {
      await sendText(sock, jid, `🔥 *${Player.displayName(player)}* is already in Hot form!`, msg);
      return;
    }
    User.update(sender, { currency: (user.currency || 0) - SHOP_CFG.FORM_BOOST });
    Player.update(player.id, { form: 'Hot' });
    await sendText(sock, jid, ui.card({
      icon: '🔥', title: 'Form boosted',
      lead: `*${Player.displayName(player)}* is ON FIRE.`,
      rows: [['Form', 'Hot 🔥'], ['Cost', `-💲${money(SHOP_CFG.FORM_BOOST)}`]],
      next: 'Friendly reminder they still have to actually score.',
    }), msg);

  } else {
    await sendText(sock, jid, `⚠️ Unknown boost type. Use *!boost energy [id]* or *!boost form [id]*`, msg);
  }
}

async function cmdBoostAll({ sock, msg, jid, sender, args, user }) {
  const boostType = (args[0] || '').toLowerCase();
  if (boostType !== 'energy' && boostType !== 'form') {
    await sendText(sock, jid, ui.problem(`Pick a whole-squad boost: *!boostall energy* or *!boostall form*`,
      `⚡ energy — every player's condition to 100%\n🔥 form — every player to Hot form`), msg);
    return;
  }

  const owned = Player.getByOwner(sender);
  if (!owned.length) {
    await sendText(sock, jid, `❌ You don't have any players yet. Open a pack with *!shop* first.`, msg);
    return;
  }

  const need = owned.filter((p) => boostType === 'energy' ? (p.condition || 0) < 100 : p.form !== 'Hot');
  if (!need.length) {
    await sendText(sock, jid, `✅ Your whole squad is already ${boostType === 'energy' ? 'at 100% condition' : 'in Hot form'}! 🔥`, msg);
    return;
  }

  const per = boostType === 'energy' ? SHOP_CFG.ENERGY_RESTORE : SHOP_CFG.FORM_BOOST;
  const cost = per * need.length;
  let u = User.getByWhatsappId(sender);
  if ((u.currency || 0) < cost) {
    await sendText(sock, jid, `❌ Boosting ${need.length} players costs ${money(cost)} — you have ${money(u.currency)}.`, msg);
    return;
  }

  User.update(sender, { currency: (u.currency || 0) - cost });
  for (const p of need) Player.update(p.id, boostType === 'energy' ? { condition: 100 } : { form: 'Hot' });

  await sendText(sock, jid, ui.card({
    icon: '💪', title: 'Squad boosted',
    rows: [
      ['Players', `${need.length} ${boostType === 'energy' ? 'restored to 100% 🟢' : 'set to Hot 🔥'}`],
      ['Cost', `-💲${money(cost)}`],
    ],
    next: 'That squad owes you a big win.',
  }), msg);
}

async function cmdSurgery({ sock, msg, jid, sender, args, user }) {
  const playerId = args[0];
  if (!playerId) {
    await sendText(sock, jid, ui.problem(`Who needs the surgeon? *!surgery [id|name]*`,
      `🏥 Instant heal from injury  ·  💲${money(SHOP_CFG.SURGERY_COST)}  ·  max ${SHOP_CFG.SURGERY_LIMIT}/day`), msg);
    return;
  }
  const player = Player.findByQuery(sender, playerId);
  if (!player) {
    await sendText(sock, jid, `❌ No player found for *${playerId}*. Use *!squad* to find IDs or names.`, msg);
    return;
  }
  if (!player.injuredUntil || new Date(player.injuredUntil).getTime() <= Date.now()) {
    await sendText(sock, jid, `✅ *${Player.displayName(player)}* isn't injured — no surgery needed! 🙌`, msg);
    return;
  }

  const u = User.getByWhatsappId(sender);
  const today = new Date().toISOString().slice(0, 10);
  if (u.surgeryDay !== today) {
    User.update(sender, { surgeryDay: today, surgeriesToday: 0 });
    u = User.getByWhatsappId(sender);
  }
  if ((u.surgeriesToday || 0) >= SHOP_CFG.SURGERY_LIMIT) {
    await sendText(sock, jid, `⛔ Surgery limit reached (${SHOP_CFG.SURGERY_LIMIT}/day). Try again tomorrow! 🗓️`, msg);
    return;
  }
  if ((u.currency || 0) < SHOP_CFG.SURGERY_COST) {
    await sendText(sock, jid, `❌ Not enough! Surgery costs ${money(SHOP_CFG.SURGERY_COST)}. You have ${money(u.currency)}.`, msg);
    return;
  }

  User.update(sender, { currency: (u.currency || 0) - SHOP_CFG.SURGERY_COST, surgeriesToday: (u.surgeriesToday || 0) + 1 });
  Player.update(player.id, { injuredUntil: null });

  const used = User.getByWhatsappId(sender).surgeriesToday || 0;
  await sendText(sock, jid, ui.card({
    icon: '🏥', title: 'Surgery complete',
    lead: `*${Player.displayName(player)}* is fully healed and ready to ball. 🔧`,
    rows: [
      ['Cost', `-💲${money(SHOP_CFG.SURGERY_COST)}`],
      ['Used today', `${used}/${SHOP_CFG.SURGERY_LIMIT}`],
    ],
    next: 'Straight back into the XI!',
  }), msg);
}

async function cmdTrain({ sock, msg, jid, sender, args, user }) {
  const isElite = (args[0] || '').toLowerCase() === 'elite';
  const playerId = isElite ? args[1] : args[0];

  if (!playerId) {
    await sendText(sock, jid, `⚠️ Usage: *!train [id|name]* (${money(TRAINING.BASE_COST)}) or *!train elite [id|name]* (${money(TRAINING.ELITE_COST)})`, msg);
    return;
  }

  const player = Player.findByQuery(sender, playerId);
  if (!player) {
    await sendText(sock, jid, `❌ No player found for *${playerId}*. Use *!squad* to find IDs or names.`, msg);
    return;
  }

  const baseCost = isElite ? TRAINING.ELITE_COST : TRAINING.BASE_COST;
  const levelScale = 1 + (player.level - 1) * (TRAINING.LEVEL_SCALE || 0.1);
  const cost = Math.round(baseCost * levelScale);
  if ((user.currency || 0) < cost) {
    await sendText(sock, jid, `❌ Not enough! Training costs ${money(cost)}. You have ${money(user.currency)}.`, msg);
    return;
  }

  await typing(sock, jid, 1500);

  // Pick a random stat to train
  const statKeys = player.role === 'goalkeeper'
    ? ['reflex', 'positioning', 'anticipation', 'strength']
    : ['pace', 'skill', 'shooting', 'stamina'];
  const stat = pick(statKeys);
  const currentVal = player.stats[stat] || 60;

  // Training outcome
  const roll = randInt(1, 100);
  let gain = 0;
  let outcome;

  if (isElite) {
    if (roll <= TRAINING.GREAT_ROLL) {
      gain = randInt(3, 6);
      outcome = '💥 *Excellent session!* Massive improvement!';
    } else if (roll <= 90) {
      gain = randInt(1, 3);
      outcome = '👍 *Good session.* Solid gains.';
    } else {
      gain = 0;
      outcome = '😕 *Tough session.* No improvement this time.';
    }
  } else {
    if (roll <= TRAINING.GREAT_ROLL) {
      gain = randInt(2, 4);
      outcome = '💪 *Great session!* Noticeable improvement!';
    } else if (roll <= TRAINING.POOR_ROLL + 40) {
      gain = randInt(1, 2);
      outcome = '✅ *Decent session.* Small improvement.';
    } else {
      outcome = '😓 *Rough session.* Player struggled. Try elite coaching?';
    }
  }

  // CATCH #1 (stadium): training at your own ground multiplies stat gains.
  const boosted = stadium.applyTrainingMultiplier(user, gain);

  const newVal = Math.min(currentVal + boosted, TRAINING.STAT_CAP);
  if (newVal !== currentVal) {
    Player.update(player.id, {
      stats: { ...player.stats, [stat]: newVal },
    });
  }

  User.update(sender, { currency: (user.currency || 0) - cost });

  const statLabel = stat.toUpperCase();
  const gainDisplay = boosted > 0 ? `+${boosted}` : '—';

  const stadiumLine = !stadium.isDefault(user)
    ? `\n🏟️ ${stadium.tierOf(stadium.resolveKey(user)).name} training boost ×${stadium.trainingMultiplier(user)}`
    : '';

  await sendText(sock, jid, ui.card({
    icon: '🏋️', title: isElite ? 'Elite training' : 'Training session',
    lead: `*${Player.displayName(player)}*`,
    rows: [
      ['Stat', `${statLabel} ${currentVal} → ${newVal} (${gainDisplay})`],
      ['Result', outcome.replace(/\*/g, '')],
      ['Cost', `-💲${money(cost)}`],
    ],
    body: [stadiumLine].filter(Boolean),
    next: 'Keep at it — elite coaching stacks the gains.',
  }), msg);
}

module.exports = { handle };
