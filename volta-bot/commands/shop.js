const User = require('../models/User');
const Player = require('../models/Player');
const { openPack } = require('../utils/playerGenerator');
const { PACKS, TRAINING, SHOP: SHOP_CFG, RARITY } = require('../config/constants');
const { money, bar } = require('../utils/formatter');
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
  await sendText(sock, jid, `🛍️ *VOLTA SHOP* — 𝙈𝙀𝙏𝘼𝙒𝙊𝙍𝙆𝙎™
━━━━━━━━━━━━━━━━━━━━━
💳 Your balance: ${money(user.currency)}

*📦 PACKS*
!pack starter — 4 players (Common–Rare)  — ${money(PACKS.STARTER.cost)}
!pack pro — 4 players (Common–Legendary)  — ${money(PACKS.PRO.cost)}
!pack elite — 5 players (Rare–Legendary)  — ${money(PACKS.ELITE.cost)}

*⚡ BOOSTS*
!boost energy [id] — Full condition restore — ${money(SHOP_CFG.ENERGY_RESTORE)}
!boost form [id] — Hot form 🔥 — ${money(SHOP_CFG.FORM_BOOST)}
!boostall energy|form — Boost your WHOLE squad — ${money(SHOP_CFG.ENERGY_RESTORE)}×players

*🏥 RECOVERY*
!surgery [id] — Instant heal from injury — ${money(SHOP_CFG.SURGERY_COST)} (max ${SHOP_CFG.SURGERY_LIMIT}/day)

*🏋️ TRAINING*
!train [id] — Basic session — ${money(TRAINING.BASE_COST)}
!train elite [id] — Elite coaching — ${money(TRAINING.ELITE_COST)}

*✏️ OTHER*
!rename [id] [name] — Custom nickname — ${money(SHOP_CFG.RENAME_TOKEN)}

━━━━━━━━━━━━━━━━━━━━━
💡 Use *!squad* to find player IDs`, msg);
}

async function cmdPack({ sock, msg, jid, sender, args, user }) {
  const packType = (args[0] || '').toLowerCase();
  const packConfig = { starter: PACKS.STARTER, pro: PACKS.PRO, elite: PACKS.ELITE }[packType];

  if (!packConfig) {
    await sendText(sock, jid, `⚠️ Usage: *!pack starter* | *!pack pro* | *!pack elite*\n\n🎒 Starter: ${money(PACKS.STARTER.cost)} | Pro: ${money(PACKS.PRO.cost)} | Elite: ${money(PACKS.ELITE.cost)}`, msg);
    return;
  }

  if ((user.currency || 0) < packConfig.cost) {
    await sendText(sock, jid, `❌ Not enough Metaworks! You need ${money(packConfig.cost)} but only have ${money(user.currency)}.\n\n💰 Play matches or claim *!daily* to earn more.`, msg);
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
      ? `REF ${s.reflex} POS ${s.positioning} ANT ${s.anticipation} STR ${s.strength} COM ${s.composer}`
      : `PAC ${s.pace} SKL ${s.skill} SHO ${s.shooting} STA ${s.stamina} COM ${s.composer}`;
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
    await sendText(sock, jid, `⚠️ Usage: *!boost energy [id]* or *!boost form [id]*\n\n⚡ energy — Restore condition to 100% (${money(SHOP_CFG.ENERGY_RESTORE)})\n🔥 form — Set form to Hot (${money(SHOP_CFG.FORM_BOOST)})`, msg);
    return;
  }

  const player = Player.findByQuery(sender, playerId);
  if (!player) {
    await sendText(sock, jid, `❌ No player found with ID *${playerId}*. Use *!squad* to find IDs.`, msg);
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
    await sendText(sock, jid, `⚡ *Energy Restored!*\n🟢 *${Player.displayName(player)}* is back to 100% condition!\n💰 -${money(SHOP_CFG.ENERGY_RESTORE)}`, msg);

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
    await sendText(sock, jid, `🔥 *Form Boosted!*\n*${Player.displayName(player)}* is now on FIRE! 🔥\n💰 -${money(SHOP_CFG.FORM_BOOST)}`, msg);

  } else {
    await sendText(sock, jid, `⚠️ Unknown boost type. Use *!boost energy [id]* or *!boost form [id]*`, msg);
  }
}

async function cmdBoostAll({ sock, msg, jid, sender, args, user }) {
  const boostType = (args[0] || '').toLowerCase();
  if (boostType !== 'energy' && boostType !== 'form') {
    await sendText(sock, jid, `⚠️ Usage: *!boostall energy* or *!boostall form*\n\n⚡ energy — restore every player's condition to 100%\n🔥 form — set every player to Hot form`, msg);
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
    await sendText(sock, jid, `❌ Not enough! Boosting ${need.length} players costs ${money(cost)} (you have ${money(u.currency)}).`, msg);
    return;
  }

  User.update(sender, { currency: (u.currency || 0) - cost });
  for (const p of need) Player.update(p.id, boostType === 'energy' ? { condition: 100 } : { form: 'Hot' });

  await sendText(sock, jid, `⚡ *SQUAD BOOSTED!*\n${need.length} players ${boostType === 'energy' ? 'restored to 100% 🟢' : 'set to Hot form 🔥'}\n💰 -${money(cost)}`, msg);
}

async function cmdSurgery({ sock, msg, jid, sender, args, user }) {
  const playerId = args[0];
  if (!playerId) {
    await sendText(sock, jid, `⚠️ Usage: *!surgery [id]* — Instantly heal an injured player.\n💰 ${money(SHOP_CFG.SURGERY_COST)} · max ${SHOP_CFG.SURGERY_LIMIT}/day`, msg);
    return;
  }
  const player = Player.getByOwner(sender).find((p) => p.id.startsWith(playerId));
  if (!player) {
    await sendText(sock, jid, `❌ No player found with ID *${playerId}*. Use *!squad* to find IDs.`, msg);
    return;
  }
  if (!player.injuredUntil || new Date(player.injuredUntil).getTime() <= Date.now()) {
    await sendText(sock, jid, `✅ *${Player.displayName(player)}* isn't injured — no surgery needed! 🙌`, msg);
    return;
  }

  let u = User.getByWhatsappId(sender);
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
  await sendText(sock, jid, `🏥 *SURGERY COMPLETE!* 🔧\n⚡ *${Player.displayName(player)}* is fully healed and ready to ball!\n💰 -${money(SHOP_CFG.SURGERY_COST)} · Surgeries today: ${used}/${SHOP_CFG.SURGERY_LIMIT}`, msg);
}

async function cmdTrain({ sock, msg, jid, sender, args, user }) {
  const isElite = (args[0] || '').toLowerCase() === 'elite';
  const playerId = isElite ? args[1] : args[0];

  if (!playerId) {
    await sendText(sock, jid, `⚠️ Usage: *!train [id]* (${money(TRAINING.BASE_COST)}) or *!train elite [id]* (${money(TRAINING.ELITE_COST)})`, msg);
    return;
  }

  const player = Player.findByQuery(sender, playerId);
  if (!player) {
    await sendText(sock, jid, `❌ No player found with ID *${playerId}*. Use *!squad* to find IDs.`, msg);
    return;
  }

  const cost = isElite ? TRAINING.ELITE_COST : TRAINING.BASE_COST;
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

  await sendText(sock, jid, `🏋️ *TRAINING ${isElite ? 'ELITE' : 'SESSION'}*
━━━━━━━━━━━━━━━━━━━━━━━
🧑‍🏫 *${Player.displayName(player)}*
📊 Stat: ${statLabel} ${currentVal} → ${newVal} (${gainDisplay})
${outcome}${stadiumLine || ''}
💰 Cost: -${money(cost)}
━━━━━━━━━━━━━━━━━━━━━━━`, msg);
}

module.exports = { handle };
