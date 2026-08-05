const { sendText } = require('../utils/messaging');
const { BRAND } = require('../config/constants');

const MENU = `⚽ *VOLTA* — ${BRAND}
━━━━━━━━━━━━━━━━━━━━━━━━

*🚀 START*
!start  !register  !invite  !help

*🌐 WEB*
!password  →  https://voltabot1.netlify.app

*⚔️ MATCHES*
!play  !match  !challenge  !accept  !pk  !forfeit  !sub
!rivalry  !formcheck  !press  !curse

*👥 SQUAD*
!squad  !card  !flex  !condition  !autosquad  !swap  !rename
!reserve  !reserve out  !preserves  !squads  !buysquad  !switchsquad
!trade  !shield  !chant  !retire

*🎰 GRIND*
!slot  !coinflip  !highlow  !wallet  !give  !dash  !daily  !streak  !hustle

*🛍️ SHOP*
!shop  !pack  !boost  !boostall  !surgery  !train
!market  !buy  !list  !sell  !search

*🏫 ACADEMY*
!academy  !scout  !youthpromote

*🏟️ STADIUMS*
!stadium  !buystadium  !sellstadium

*🛡️ STAFF*
!mods  !promote  !kick  !kickgc  !warn  !ban  !unban
!auction  !bid  !giveaway  !clearpvp
!tournament  !join  !tourneyplay  !tbet  !penalty

*🔧 OWNER*
!on  !off  !afk  !afk off  !debug

*📊 RANKS*
!leaderboard  !top10  !playerlb  !profile  !pong
!weeklyawards

*🔧 OTHER*
!tutorial  !explain  !bracket  !password

━━━━━━━━━━━━━━━━━━━━━━━━
💲 Metaworks · just type a command`;

async function handle({ sock, msg, jid }) {
  await sendText(sock, jid, MENU, msg);
}

module.exports = { handle };