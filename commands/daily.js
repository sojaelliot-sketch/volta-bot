const User = require('../models/User');
const { ECONOMY } = require('../config/constants');
const { money } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');

async function handle({ sock, msg, jid, sender, cmd, args }) {
  const user = User.getByWhatsappId(sender);
  if (!user) {
    await sendText(sock, jid, `❌ You're not registered yet. Send *!start* to get started.`, msg);
    return;
  }

  if (cmd === 'daily') {
    return cmdDaily({ sock, msg, jid, sender, user });
  }

  if (cmd === 'streak') {
    return cmdStreak({ sock, msg, jid, user });
  }
}

async function cmdDaily({ sock, msg, jid, sender, user }) {
  const now = new Date();
  const last = user.lastDaily ? new Date(user.lastDaily) : null;

  // Check if already claimed today
  if (last && isSameDay(last, now)) {
    const nextClaim = new Date(last);
    nextClaim.setDate(nextClaim.getDate() + 1);
    nextClaim.setHours(0, 0, 0, 0);
    const hoursLeft = Math.ceil((nextClaim - now) / (1000 * 60 * 60));
    await sendText(sock, jid, `⏳ *Daily already claimed!*\nCome back in ~${hoursLeft}h for your next reward.\n\n💡 Send *!streak* to check your streak.`, msg);
    return;
  }

  // Calculate streak
  let streak = user.dailyStreak || 0;
  if (last && isConsecutiveDay(last, now)) {
    streak += 1;
  } else {
    streak = 1;
  }

  // Calculate reward
  const base = ECONOMY.DAILY_BASE;
  const multiplier = 1 + (streak - 1) * (ECONOMY.STREAK_MULTIPLIER - 1);
  let reward = Math.round(base * multiplier);
  reward = Math.min(reward, ECONOMY.MAX_DAILY);

  // Update user
  User.update(sender, {
    currency: (user.currency || 0) + reward,
    lastDaily: now.toISOString(),
    dailyStreak: streak,
  });

  // Streak emoji
  const streakEmoji = streak >= 7 ? '🔥' : streak >= 3 ? '✨' : '⭐';

  await sendText(sock, jid, `🎁 *DAILY REWARD CLAIMED!*
━━━━━━━━━━━━━━━━━━━━━━━━
${streakEmoji} Streak: *${streak} day${streak > 1 ? 's' : ''}*
💰 Reward: *+${money(reward)}*
💳 Balance: ${money((user.currency || 0) + reward)}

${streak >= 7 ? '🔥 *7-DAY STREAK!* You\'re on fire!' : streak >= 3 ? '✨ Keep it going!' : '💪 Come back tomorrow to build your streak!'}
━━━━━━━━━━━━━━━━━━━━━━━━`, msg);
}

async function cmdStreak({ sock, msg, jid, user }) {
  const now = new Date();
  const last = user.lastDaily ? new Date(user.lastDaily) : null;
  const streak = user.dailyStreak || 0;

  let status;
  if (last && isSameDay(last, now)) {
    status = `✅ *Claimed today!* 🔥 Streak: ${streak} days`;
  } else if (last && isConsecutiveDay(last, now)) {
    status = `⏳ *Not yet claimed today!* Current streak: ${streak} days\nSend *!daily* to claim!`;
  } else if (streak > 0) {
    status = `💔 *Streak broken!* You missed a day.\nSend *!daily* to start a new streak!`;
  } else {
    status = `🌱 No streak yet. Send *!daily* to start your first streak!`;
  }

  const nextReward = streak > 0
    ? Math.min(ECONOMY.DAILY_BASE * (1 + streak * (ECONOMY.STREAK_MULTIPLIER - 1)), ECONOMY.MAX_DAILY)
    : ECONOMY.DAILY_BASE;

  await sendText(sock, jid, `📅 *DAILY STREAK*
━━━━━━━━━━━━━━━━━━━━━━━━
${status}

📈 *Next reward:* ${money(Math.round(nextReward))}
🏆 *Max daily:* ${money(ECONOMY.MAX_DAILY)}
━━━━━━━━━━━━━━━━━━━━━━━━`, msg);
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

function isConsecutiveDay(previous, now) {
  const diff = now.getTime() - previous.getTime();
  const hours = diff / (1000 * 60 * 60);
  return hours >= 20 && hours <= 48;
}

module.exports = { handle };