const { sendText } = require('../utils/messaging');
const { BRAND } = require('../config/constants');

const MENU = `⚽ *VOLTA* — ${BRAND}
━━━━━━━━━━━━━━━━━━━━━━━

 *🚀 START*
!start — ✨ Begin
!register [name] [code] — 📝 Profile + free pack (+referral bonus)
!invite — 📨 Get your invite code & earn Metaworks
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
!match [easy|medium|hard] — 🔒 Private AI match (locks the chat)
!challenge @user — 🥊 PvP duel
!accept — ✅ Accept
!forfeit — 🚩 Forfeit your PvP match (owner can force any)
!sub [outId] [inId] — 🔁 Sub (during PvP pause)

 *👥 SQUAD*
!squad — 📋 Team
!card [id] — 🃏 Player card (image + shows the ID)
!flex — 🔥 Flex your Starting XI
!condition — 🩺 Fitness
!autosquad / !best — 🤖 Auto best XI + GK
!swap [id1] [id2] — 🔄 Swap
!swap [id] xi|bench — ➡️ Move
!rename [id] [name] — ✏️ Nickname
!reserve [id] — 📦 Send a player to Reserves
!reserve out [id] — ↩️ Back to Bench
!preserves — 📦 List the players in your Reserves
!squads — 🗂️ Your team slots
!buysquad — 💳 Unlock a 2nd/3rd team (1500 MW)
!switchsquad [n] — 🔁 Use team 1/2/3

 *🎰 GRIND METAWORKS*
!slot [stake] — 🎰 Spin
!coinflip [amount] [heads|tails] — 🪙 Call it, coin shows the face
!highlow [stake] → !highlow [higher|lower] — 🎲 Number shown, then you guess
!wallet / !bal — 💰 Your balance + record
!give [amt] @user — 🤝 Send money (or reply / type their name)
!dash [id] @user — 🎁 Gift a player
!dash @user — 🎁 Gift your whole squad
!daily — 📅 Daily
!streak — 🔥 Streak

  *🛍️ SHOP & MARKET*
!shop — 🏪 Store
!pack starter | pro | elite — 📦 Packs (costs Metaworks)
!boost energy|form [id] — ⚡🔥
!boostall — 💪 Boost energy+form for your whole squad
!surgery — 🏥 Instant-heal an injured player (limited/day)
!train [id] / !train elite [id] — 🏋️
!market [page] — 📊 Listings
!buy [id] / !list [id] [price] — 🛒💰
!list squad [price?] / !sell squad — 📤 List your whole squad (10m)
!search [name] — 🔎 Find a player (shows their manager if not on market)

 *🏫 ACADEMY*
!academy — 🏫 View your youth prospects
!scout — 🔍 Discover a new youth talent (costs Metaworks)
!promote [id] — ⬆️ Promote a youth prospect into your squad

 *🛡️ STAFF / OWNER*
!mods — 📋 Staff list
!promote [id] officer|moderator — ⬆️ Promote a user to staff (Officer+)
!warn / !kick [id] — ⚠️ (Mod+)
!ban / !unban [id] — ⛔ (Officer+)
!auction start [id|auto] [min] — 🔨 (Officer+)
!bid [amount] — 💎 (any registered manager)
!clearpvp — 🧹 Force-clear all stuck PvP matches (Owner/Staff)
!giveaway [amt] [winners] — 🎉 (Mod+)
!tournament start classic|penalty [prize] — 🏆 (Mod+)
!join — 🎮 Enter tournament
!tourneyplay — ⚔️ Play your tournament tie
!tbet <player> <stake> — 🎲 Bet on who wins the tournament (pays out on a win)
!penalty [bet] — 🥅 Penalty shootout (vs AI or @user)
!leaderboard / !lb [mmr|wins|goals|rich|winrate] — 📊 Ranks
!top10 — 🌍 Public top-10 managers (anyone can peek)
!playerlb / !plb [ovr|goals|motm|value] — 🏆 Player leaderboard
!profile / !info — 👤 Your profile (shows your 🏅 badges)
!pong — 🏓 Bot health: uptime, latency & status
!tutorial — 🍼 Explains everything (like you're 5)

 *💡 TIP:* You can target most commands by replying to a message, @mentioning,
   or just typing the manager's NAME — e.g. *!info Oasis FC*, *!give 100 Maria*.

━━━━━━━━━━━━━━━━━━━━━━
💲 Metaworks  ·  🎮 Just type a command`;

async function handle({ sock, msg, jid }) {
  await sendText(sock, jid, MENU, msg);
}

module.exports = { handle };