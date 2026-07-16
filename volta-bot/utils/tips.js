// utils/tips.js
// Onboarding tip series. 10 minutes after a manager registers, they start
// receiving one short, helpful tip at a time (cycling through TIPS) until they
// have seen them all. Each user's progress (tipIndex / tipStart) lives on their
// User doc, so it survives bot restarts and never floods — at most one tip per
// user per scheduler tick (1/min), with a global per-tick cap for safety.
const User = require('../models/User');
const { sendText } = require('../utils/messaging');
const { TIPS: TIPS_CFG } = require('../config/constants');

const TIP_INTERVAL_MS = (TIPS_CFG && TIPS_CFG.INTERVAL_MS) || 10 * 60 * 1000;
const TICK_MS = 60 * 1000;
const PER_TICK_CAP = 50;

// ~30 bite-sized tips covering every part of the game. Keep them short and
// actionable — each references a real command the manager can try right away.
const TIPS = [
  '💡 *VOLTA Tip:* Kick things off with *!daily* — free Metaworks every day, and streaks pay out even more. Don\'t skip it! 📅',
  '💡 *VOLTA Tip:* Ready to ball? Type *!play* to face the AI (easy / medium / hard). Win matches to climb the MMR ladder. ⚽',
  '💡 *VOLTA Tip:* See your whole team anytime with *!squad*. It shows your Starting XI, bench and reserves. 📋',
  '💡 *VOLTA Tip:* Not sure who to start? *!autosquad* auto-picks your strongest 4 players for you. 🤖',
  '💡 *VOLTA Tip:* Grow your roster in *!shop* — open a *!pack starter*, *pro* or *elite* for surprise players. 📦',
  '💡 *VOLTA Tip:* The *!market* lists players for sale. Scroll it and find hidden gems from other managers. 🏪',
  '💡 *VOLTA Tip:* Spotted a player you want? *!buy [id]* signs them straight into your reserves. 🛒',
  '💡 *VOLTA Tip:* Need cash? *!list [playerID] [price]* puts one of your players up for sale. They expire in 10 min if unsold. 💰',
  '💡 *VOLTA Tip:* Make a player stronger with *!train [playerID]* — it bumps a random stat. Elite training = bigger gains. 🏋️',
  '💡 *VOLTA Tip:* Tired player? *!boost energy [playerID]* restores condition to 100%. *!boost form* sets them to Hot form. ⚡',
  '💡 *VOLTA Tip:* Give a player a funny nickname with *!rename [playerID] [name]* (costs a little Metaworks). ✏️',
  '💡 *VOLTA Tip:* Fancy a shootout? *!penalty [stake]* is a best-of-5 vs the AI — you shoot AND save. Win your stake ×1.8. 🥅',
  '💡 *VOLTA Tip:* Quick gamble: *!coinflip [amount]* — call heads or tails and maybe double your Metaworks. 🪙',
  '💡 *VOLTA Tip:* Spin *!slot [bet]* for the reels. Three matching = big payout, two matching = smaller. 🎰',
  '💡 *VOLTA Tip:* *!highlow [stake]* — guess if the next card is higher or lower. Payout scales with the real odds. 🎲',
  '💡 *VOLTA Tip:* Check the ranks with *!lb* (MMR), *!lb wins*, *!lb goals*, *!lb rich* or *!lb winrate*. 📊',
  '💡 *VOLTA Tip:* Play a REAL person: *!challenge @friend*, then they type *!accept*. Bragging rights included. 🥊',
  '💡 *VOLTA Tip:* During a match, chances come one at a time. When it\'s your turn, reply *!a*, *!b* or *!c* to pick your move. 🔥',
  '💡 *VOLTA Tip:* Don\'t ghost a match! You have ~90s to react each chance — wait too long and you FORFEIT. ⏳',
  '💡 *VOLTA Tip:* Tournaments are big contests: a mod runs *!tournament start classic [prize]*, everyone *!join*, winners advance. 👑',
  '💡 *VOLTA Tip:* Invite friends with *!invite* — you both earn bonus Metaworks when they register with your code. 👥',
  '💡 *VOLTA Tip:* Send a buddy some cash with *!give [amount] @friend*. Spot them a pack! 🤝',
  '💡 *VOLTA Tip:* Gift a player (or your whole squad) to a friend with *!dash [playerID] @friend* or *!dash squad @friend*. 🎁',
  '💡 *VOLTA Tip:* Players get tired & can get injured. *!condition* shows fitness; *!surgery* instantly heals an injury. 🩺',
  '💡 *VOLTA Tip:* Manage everything from the web app! Set a password with *!password*, then log in at the Manager site. 💻',
  '💡 *VOLTA Tip:* Forgot a command? *!help* shows the full menu of everything you can do. 📖',
  '💡 *VOLTA Tip:* Want detail on ONE command? *!explain [command]* breaks it down step by step. 🔍',
  '💡 *VOLTA Tip:* New here? *!tutorial* explains the whole game like you\'re 5. Read it anytime. 🍼',
  '💡 *VOLTA Tip:* Rename your team any time with *!rename [new name]* — make it yours. 🏟️',
  '💡 *VOLTA Tip:* Want more teams? *!squads* shows your slots, *!buysquad* unlocks another, *!switchsquad [1|2|3]* swaps between them. 🗂️',
  '💡 *VOLTA Tip:* Peek at any player\'s full stats with *!card [playerID]*. Compare before you buy or train. 🃏',
  '💡 *VOLTA Tip:* That\'s the gist! Play daily, trade smart, and climb the leaderboard. Welcome to VOLTA. ⚽💛',
];

let getSock = null;

function tick() {
  const sock = getSock && getSock();
  if (!sock) return;
  const now = Date.now();
  let sent = 0;
  for (const u of User.all()) {
    if (sent >= PER_TICK_CAP) break;
    if (!u.registered || !u.tipStart) continue;
    if (typeof u.tipIndex !== 'number' || u.tipIndex >= TIPS.length) continue;
    const start = new Date(u.tipStart).getTime();
    const dueAt = start + (u.tipIndex + 1) * TIP_INTERVAL_MS;
    if (now < dueAt) continue;
    const tip = TIPS[u.tipIndex % TIPS.length];
    User.update(u.whatsappId, { tipIndex: u.tipIndex + 1 });
    sendText(sock, u.whatsappId, tip).catch(() => {});
    sent++;
  }
}

// sockGetter returns the currently-active WhatsApp socket (it changes on
// reconnect), so the scheduler always sends through a live connection.
function startTipScheduler(sockGetter, intervalMs) {
  getSock = sockGetter;
  setTimeout(tick, 5000); // fire soon after boot so already-due tips go out
  setInterval(tick, intervalMs || TICK_MS);
}

module.exports = { TIPS, TIP_INTERVAL_MS, startTipScheduler };
