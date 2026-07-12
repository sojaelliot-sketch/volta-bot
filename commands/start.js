const User = require('../models/User');
const Player = require('../models/Player');
const { buildStarterSquad } = require('../utils/playerGenerator');
const { RARITY, MODERATION } = require('../config/constants');
const { money, bar } = require('../utils/formatter');
const { sendText, typing } = require('../utils/messaging');

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
━━━━━━━━━━━━━━━━━━━━━━━
🎮 *The 5-a-side football bot for WhatsApp*

Build your squad 🧢
Open packs 📦
Play matches ⚽
Trade players 🏪
Climb the ranks 🏆

━━━━━━━━━━━━━━━━━━━━━━━━
👉 To get started, type:

*!register [your name]*

Example: *!register Elliot*

━━━━━━━━━━━━━━━━━━━━━━━━
💲 You'll receive starter pack + ${money(500)} Metaworks!`, msg);
    return;
  }

  // cmd === 'register'
  if (existing?.registered) {
    await sendText(sock, jid, `✅ Already registered as *${existing.name}*!\n📋 Send *!squad* to see your team or *!play* for a match.`, msg);
    return;
  }

  const name = args.join(' ').trim().slice(0, 24);
  if (!name) {
    await sendText(sock, jid, `⚠️ Give me a manager name:\n*!register [name]*\n\nExample: *!register Elliot*`, msg);
    return;
  }

  User.create(sender, name);
  await typing(sock, jid, 600);
  await sendText(sock, jid, `✅ *Manager Profile Created!*
━━━━━━━━━━━━━━━━━━━━━━━
🧑‍💼 Name: *${name}*
💰 Balance: ${money(500)}

🎁 Signing your free *Starter Squad*...`, msg);

  const players = buildStarterSquad(sender);

  const startingXI = players.map((p) => p.id);
  const bench = [];

  User.update(sender, { registered: true, startingXI, bench });

  let reveal = `✨ *STARTER SQUAD SIGNED!* ✨
━━━━━━━━━━━━━━━━━━━━━━
📋 *3 outfield + 1 keeper* — ready to ball!\n\n`;
  for (const p of players) {
    const emoji = RARITY[p.rarity]?.emoji || '⚪';
    const role = p.role === 'goalkeeper' ? '🧤 GK' : '⚽ OF';
    const s = p.stats;
    const statLine = p.role === 'goalkeeper'
      ? `REF ${s.reflex} POS ${s.positioning} ANT ${s.anticipation} STR ${s.strength} COM ${s.composure}`
      : `PAC ${s.pace} SKL ${s.skill} SHO ${s.shooting} STA ${s.stamina} COM ${s.composure}`;
    reveal += `${emoji} *${Player.displayName(p)}* — ${role} · ${p.rarity} · Age ${p.age}\n`;
    reveal += `   ${statLine}\n`;
    reveal += `   💰 ${money(Player.marketValue(p))} · ❤️ ${bar(p.condition)} · 🆔 \`${p.id.slice(0, 6)}\`\n\n`;
  }
  reveal += `━━━━━━━━━━━━━━━━━━━━━━━━
⚡ Your Starting XI is locked in.

📋 *!squad* — View your team
🆚 *!play* — First match!
🏪 *!shop* — Buy more packs
📅 *!daily* — Claim free rewards`;

  await sendText(sock, jid, reveal, msg);
}

module.exports = { handle };
