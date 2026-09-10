const User = require('../models/User');
const { ECONOMY, BRAND } = require('../config/constants');
const { money } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');

const SALARY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const RANK_SALARIES = {
  Bronze:   100,
  Silver:   200,
  Gold:     350,
  Platinum: 550,
  Diamond:  800,
  Legend:   1200,
};

async function handle({ sock, msg, jid, sender, cmd, args, user }) {
  if (!user || !user.registered) {
    await sendText(sock, jid, `⚠️ Register first with *!register [name]*`, msg);
    return;
  }

  if (cmd === 'salary') return cmdSalary({ sock, msg, jid, sender, user });
  if (cmd === 'interest') return cmdInterest({ sock, msg, jid, sender, user });
}

async function cmdSalary({ sock, msg, jid, sender, user }) {
  const now = Date.now();
  const lastSalary = user.lastSalary ? new Date(user.lastSalary).getTime() : 0;
  const elapsed = now - lastSalary;

  if (elapsed < SALARY_COOLDOWN_MS) {
    const daysLeft = Math.ceil((SALARY_COOLDOWN_MS - elapsed) / (24 * 60 * 60 * 1000));
    await sendText(sock, jid, `⏳ Your next salary check is in *${daysLeft} days*.\n\n💡 Win matches to rank up and earn a bigger salary!`, msg);
    return;
  }

  const rank = user.rank || 'Bronze';
  const salary = RANK_SALARIES[rank] || 100;

  User.addCurrency(sender, salary);
  User.update(sender, { lastSalary: new Date().toISOString() });

  await sendText(sock, jid,
    `💰 *WEEKLY SALARY PAID!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🏆 Rank: *${rank}*\n` +
    `💵 Salary: *${money(salary)}*\n` +
    `💳 Balance: ${money((user.currency || 0) + salary)}\n\n` +
    `📈 Win more matches to rank up!\n` +
    `⏰ Next salary in 7 days.\n${BRAND}`, msg);
}

const INTEREST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

async function cmdInterest({ sock, msg, jid, sender, user }) {
  const balance = user.currency || 0;

  // The rate is described as "1% DAILY", but nothing ever enforced the day.
  // !interest could be run back to back, compounding 1% every message: a
  // manager sitting on 1,000 could reach a million in about 700 sends. This
  // was, by a distance, the largest money faucet in the game.
  const lastInterest = user.lastInterest ? new Date(user.lastInterest).getTime() : 0;
  const elapsed = Date.now() - lastInterest;
  if (elapsed < INTEREST_COOLDOWN_MS) {
    const remaining = INTEREST_COOLDOWN_MS - elapsed;
    const totalMins = Math.max(1, Math.ceil(remaining / 60000));
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    await sendText(sock, jid,
      `🏦 *SAVINGS ACCOUNT*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💳 Balance: ${money(balance)}\n\n` +
      `⏳ Interest is paid once a day. Next payment in ` +
      `*${hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`}*.\n${BRAND}`, msg);
    return;
  }

  if (balance < ECONOMY.SAVINGS_MIN) {
    await sendText(sock, jid,
      `🏦 *SAVINGS ACCOUNT*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💳 Balance: ${money(balance)}\n\n` +
      `❌ You need at least ${money(ECONOMY.SAVINGS_MIN)} to earn interest.\n` +
      `📈 Current rate: ${(ECONOMY.SAVINGS_INTEREST * 100).toFixed(0)}% daily\n` +
      `💡 Keep grinding to reach the minimum!\n${BRAND}`, msg);
    return;
  }

  const interest = Math.round(balance * ECONOMY.SAVINGS_INTEREST);
  User.addCurrency(sender, interest);
  User.update(sender, { lastInterest: new Date().toISOString() });

  await sendText(sock, jid,
    `🏦 *INTEREST EARNED!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💳 Balance: ${money(balance)}\n` +
    `📈 Rate: ${(ECONOMY.SAVINGS_INTEREST * 100).toFixed(0)}% daily\n` +
    `💰 Interest Earned: *+${money(interest)}*\n` +
    `💳 New Balance: ${money(balance + interest)}\n\n` +
    `💡 Interest accrues daily on balances over ${money(ECONOMY.SAVINGS_MIN)}.\n${BRAND}`, msg);
}

module.exports = { handle };
