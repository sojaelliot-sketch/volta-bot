const User = require('../models/User');
const Player = require('../models/Player');
const { buildStarterSquad } = require('../utils/playerGenerator');
const { RARITY, MODERATION, REFERRAL, BRAND } = require('../config/constants');
const { money, bar } = require('../utils/formatter');
const { sendText, typing } = require('../utils/messaging');

// ref codes are 6 chars from A-Z / 2-9
const REF_CODE_RE = /^[A-Z0-9]{6}$/;

async function handle({ sock, msg, jid, sender, cmd, args }) {
  // Registration is closed — only the owner account exists. Strangers can't
  // create a profile (and the owner never needs to register).
  if (!MODERATION.OPEN_REGISTRATION && !User.isOwner(sender)) {
    await sendText(sock, jid, `🔒 Registration is closed — this bot is owner-only.`, msg);
    return;
  }

  const existing = User.getByWhatsappId(sender);

  if (cmd === 'start') {
    if (existing?.registered) {
      await sendText(sock, jid, `👋 Welcome back, *${existing.name}*!\n━━━━━━━━━━━━━━━━━━━━━━━━\n💳 ${money(existing.currency)}  🏆 MMR ${existing.mmr} (${existing.rank})\n⚔️ ${existing.wins}W ${existing.losses}L ${existing.draws}D\n━━━━━━━━━━━━━━━━━━━━━━━━\n📋 *!squad* — Your team\n🆚 *!play* — Jump into a match\n🏪 *!shop* — Browse packs\n📅 *!daily* — Claim rewards`, msg);
      return;
    }
    await sendText(sock, jid,
      `⚽ *WELCOME TO VOLTA* — ${BRAND}
━━━━━━━━━━━━━━━━━━━━━━
🎮 *The 5-a-side football bot for WhatsApp*

Build your squad 🧢
Open packs 📦
Play matches ⚽
Trade players 🏪
Climb the ranks 🏆

━━━━━━━━━━━━━━━━━━━━━━━
👉 To get started, type:

*!register [your name]*

Example: *!register Elliot*

━━━━━━━━━━━━━━━━━━━━━━━
💲 You'll receive starter pack + ${money(500)} Metaworks!`, msg);
    return;
  }

  // cmd === 'register'
  if (existing?.registered) {
    await sendText(sock, jid, `✅ Already registered as *${existing.name}*!\n📋 Send *!squad* to see your team or *!play* for a match.`, msg);
    return;
  }

  // Parse: trailing token that looks like a referral code becomes the code,
  // everything else is the manager name. eg !register Elliot VOLTA7
  const raw = args.slice();
  let code = null;
  if (raw.length > 1 && REF_CODE_RE.test(raw[raw.length - 1])) {
    code = raw.pop().toUpperCase();
  }
  const name = raw.join(' ').trim().slice(0, 24);
  if (!name) {
    await sendText(sock, jid, `⚠️ Give me a manager name:\n*!register [name]* *(optional: referral code)*\n\nExample: *!register Elliot*`, msg);
    return;
  }

  // Resolve referrer (by code) before creating the account.
  let referrer = null;
  if (code) {
    referrer = User.all().find((u) => u.refCode === code && u.whatsappId !== User.normalizeJid(sender));
  }

  User.create(sender, name);
  await typing(sock, jid, 600);
  await sendText(sock, jid, `✅ *Manager Profile Created!*
━━━━━━━━━━━━━━━━━━━━━━
🧑‍💼 Name: *${name}*
💰 Balance: ${money(500)}

🎁 Signing your free *Starter Squad*...`, msg);

  const players = buildStarterSquad(sender);

  const startingXI = players.map((p) => p.id);
  const bench = [];

  const patch = { registered: true, startingXI, bench, tipStart: new Date().toISOString(), tipIndex: 0 };
  if (referrer) {
    patch.referredBy = referrer.whatsappId;
    // reward the new manager
    patch.currency = 500 + (REFERRAL.REFEREE_BONUS || 0);
  }
  User.update(sender, patch);

  // Pay the referrer their reward.
  if (referrer) {
    User.update(referrer.whatsappId, {
      currency: (referrer.currency || 0) + (REFERRAL.REWARD || 0),
    });
  }

  let reveal = `✨ *STARTER SQUAD SIGNED!* ✨
━━━━━━━━━━━━━━━━━━━━
📋 *3 outfield + 1 keeper* — ready to ball!\n\n`;
  for (const p of players) {
    const emoji = RARITY[p.rarity]?.emoji || '⚪';
    const role = p.role === 'goalkeeper' ? '🧤 GK' : '⚽ OF';
    const s = p.stats;
    const statLine = p.role === 'goalkeeper'
      ? `REF ${s.reflex} POS ${s.positioning} ANT ${s.anticipation} STR ${s.strength} COM ${s.composer}`
      : `PAC ${s.pace} SKL ${s.skill} SHO ${s.shooting} STA ${s.stamina} COM ${s.composer}`;
    reveal += `${emoji} *${Player.displayName(p)}* — ${role} · ${p.rarity} · Age ${p.age}\n`;
    reveal += `   ${statLine}\n`;
    reveal += `   💰 ${money(Player.marketValue(p))} · ❤️ ${bar(p.condition)} · 🆔 \`${p.id.slice(0, 6)}\`\n\n`;
  }
  reveal += `━━━━━━━━━━━━━━━━━━━━━━━━
⚡ Your Starting XI is locked in.
`;

  if (referrer) {
    reveal += `\n🤝 Referred by *${referrer.name}*! You both earned bonus Metaworks.`;
    reveal += `\n👥 Join the VOLTA community group: https://chat.whatsapp.com/FD6Mvmdq8wUE1EhSB78xAd`;
  }
  reveal += `
📋 *!squad* — View your team
🆚 *!play* — First match!
🏪 *!shop* — Buy more packs
📅 *!daily* — Claim free rewards
📨 *!invite* — Invite friends & earn`;

  await sendText(sock, jid, reveal, msg);
}

module.exports = { handle };
