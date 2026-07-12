// commands/tutorial.js
//   !tutorial / !tut — explains VOLTA like you're 5
const { sendText } = require('../utils/messaging');
const { BRAND } = require('../config/constants');

const TUT = `🍼 *VOLTA FOR DUMMIES* (explained like you're 5)
━━━━━━━━━━━━━━━━━━━━━━

🤖 *What is this?*
VOLTA is a pretend soccer game that lives in this chat.
You are a *manager* — that's the boss of a pretend soccer team.
You collect players, play matches, and try to be the best boss.

👶 *Step 1 — Say hello*
Type *!start* then *!register [your name]*.
Boom. You get a free team of 4 pretend players. Yay! 🎁

⚽ *Step 2 — Your team*
You have 3 outfield players + 1 goalkeeper (the guy who catches the ball).
• *!squad* — look at your whole team 📋
• *!card [id]* — look at ONE player's stats 🃏
• *!condition* — are they tired? 🩺
• *!autosquad* — auto-pick your BEST players 🤖
• *!rename [id] [name]* — give a player a funny nickname ✏️

💰 *Step 3 — Money (we call it "Metaworks" / MW)*
You need money to buy cool stuff.
• *!daily* — free money every day 📅
• *!slot [bet]* — spin the wheel 🎰
• *!coinflip [bet]* — flip a coin, maybe double it 🪙
• *!highlow [higher|lower] [bet]* — guess a number 🎲
• *!give [amount] @friend* — send money to a buddy 🤝

🛍️ *Step 4 — Get better players*
• *!shop* — the store 🏪
• *!pack starter|pro|elite* — open a surprise bag of players 📦
• *!market* — see players for sale 📊
• *!buy [id]* — buy one 🛒
• *!list [id] [price]* — sell one of yours 💰
• *!boost energy [id]* — make a tired player fresh ⚡
• *!train [id]* — make a player stronger 🏋️

⚔️ *Step 5 — Play a match!*
• *!play* — play the computer (easy/medium/hard) 🆚
• *!challenge @friend* — play a REAL person 🥊
• *!accept* — say yes to a challenge ✅
During a match, chances come one at a time. When it's YOUR team's turn you'll
see a build-up (like "Yoni Patel has the ball... dribbles into space... one on
one with the keeper!") and then a list of choices — each choice is a letter:
  type *!a* / *!b* / *!c* (or *!d*) to pick your move. 🔥
The chance shows YOUR TEAM NAME (not a colour), so you always know it's you.
⏳ You have *90 seconds* to react — if you don't, you FORFEIT the match! 😤
• *!penalty [bet]* — a shootout contest 🥅

🏆 *Step 6 — Be the best*
• *!lb* — who has the most points (MMR) 📊
• *!lb wins* — who won the most games
• *!lb goals* — who scored the most goals ⚽
• *!lb rich* — who has the most money 💰
• *!lb winrate* — who wins most often 🎯

🏟️ *Step 7 — Tournaments (a big contest!)*
A grown-up (mod/owner) types:
  *!tournament start classic [prize]* or *!tournament start penalty [prize]*
Then everyone types *!join*.
The bot pairs you up, you play, and winners move on until ONE champ remains! 👑
Type *!tourneyplay* to play your match.

🛡️ *The helpers*
Grown-ups can: *!ban* (timeout a naughty kid), *!warn*, *!kick*, *!promote*, *!giveaway* (free money for everyone 🎉), *!auction* (bid on players).

🔧 *Extra team slots*
• *!squads* — see your team slots
• *!buysquad* — buy another team slot (costs 1500 MW)
• *!switchsquad [1|2|3]* — switch between your teams

❓ *Forget something?*
• *!help* — the big menu
• *!explain [command]* — how ONE command works
• *!tutorial* — read this again 🍼

━━━━━━━━━━━━━━━━━━━━━━
Remember: it's just a game. Have fun, be nice. ⚽💛
${BRAND}`;

async function handle({ sock, msg, jid }) {
  await sendText(sock, jid, TUT, msg);
}

module.exports = { handle };
