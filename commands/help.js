const { sendText } = require('../utils/messaging');
const { BRAND } = require('../config/constants');

const MENU = `⚽ *VOLTA* — ${BRAND}
━━━━━━━━━━━━━━━━━━━━━━━

*🚀 START*
!start — ✨ Begin
!register [name] — 📝 Profile + free pack
!help / !menu — 📖 This menu

*🌐 WEB MANAGER*
!password [pwd] — 🔑 Set a password for the web app
🌍 Manage your team on the web:
   https://sojaelliot-sketch.github.io/volta-bot/
   • Log in with your TEAM NAME + the password above
   • Build your squad, open packs & train players
   • Play live Penalty shootouts + coinflip / slot / high-low

*⚔️ MATCHES*
!play — 🆚 vs Medium AI
!play easy / hard — 🟢 / 🔴
!challenge @user — 🥊 PvP duel
!accept — ✅ Accept
!sub [outId] [inId] — 🔁 Sub (during PvP pause)

*👥 SQUAD*
!squad — 📋 Team
!card [id] — 🃏 Player card (shows the ID)
!condition — 🩺 Fitness
!autosquad / !best — 🤖 Auto best XI + GK
!swap [id1] [id2] — 🔄 Swap
!swap [id] xi|bench — ➡️ Move
!rename [id] [name] — ✏️ Nickname
!squads — 🗂️ Your team slots
!buysquad — 💳 Unlock a 2nd/3rd team (1500 MW)
!switchsquad [n] — 🔁 Use team 1/2/3

*🎰 GRIND METAWORKS*
!slot [stake] — 🎰 Spin
!coinflip [amount] — 🪙 50/50
!highlow [higher|lower] [stake] — 🎲 High/Low (1–9)
!wallet / !bal — 💰 Your balance + record
!give [amt] @user — 🤝 Send money
!daily — 📅 Daily
!streak — 🔥 Streak

*🛍️ SHOP & MARKET*
!shop — 🏪 Store
!pack starter | pro | elite — 📦 Packs
!boost energy|form [id] — ⚡🔥
!train [id] / !train elite [id] — 🏋️
!market [page] — 📊 Listings
!buy [id] / !list [id] [price] — 🛒💰

*🛡️ STAFF / OWNER*
!mods — 📋 Staff list
!promote [id] officer|moderator — ⬆️ (Officer+)
!warn / !kick [id] — ⚠️ (Mod+)
!ban / !unban [id] — ⛔ (Officer+)
!auction start [id|auto] [min] — 🔨 (Officer+)
!bid [amount] — 💎 (Mod+)
!giveaway [amt] [winners] — 🎉 (Mod+)
!tournament start classic|penalty [prize] — 🏆 (Mod+)
!join — 🎮 Enter tournament
!tourneyplay — ⚔️ Play your tournament tie
!penalty [bet] — 🥅 Penalty shootout (vs AI or @user)
!leaderboard / !lb [mmr|wins|goals|rich|winrate] — 📊 Ranks
!tutorial — 🍼 Explains everything (like you're 5)

━━━━━━━━━━━━━━━━━━━━━━
💲 Metaworks  ·  🎮 Just type a command`;

async function handle({ sock, msg, jid }) {
  await sendText(sock, jid, MENU, msg);
}

module.exports = { handle };