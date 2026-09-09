const User = require('../models/User');
const { ECONOMY, BRAND } = require('../config/constants');
const { money } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');

const JOBS = [
  { name: 'Ball Boy', minPay: 10, maxPay: 25, reqWins: 0 },
  { name: 'Kit Manager', minPay: 20, maxPay: 40, reqWins: 5 },
  { name: 'Scout Assistant', minPay: 30, maxPay: 55, reqWins: 15 },
  { name: 'Fitness Coach', minPay: 40, maxPay: 70, reqWins: 30 },
  { name: 'Assistant Manager', minPay: 55, maxPay: 90, reqWins: 50 },
  { name: 'Tactical Analyst', minPay: 70, maxPay: 110, reqWins: 80 },
  { name: 'First Team Coach', minPay: 90, maxPay: 140, reqWins: 120 },
  { name: 'Director of Football', minPay: 120, maxPay: 180, reqWins: 200 },
];

const WORK_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours

async function handle({ sock, msg, jid, sender, cmd, args, user }) {
  if (!user || !user.registered) {
    await sendText(sock, jid, `⚠️ Register first with *!register [name]*`, msg);
    return;
  }

  if (cmd === 'work') return cmdWork({ sock, msg, jid, sender, user });
  if (cmd === 'jobs') return cmdJobs({ sock, msg, jid, user });
}

async function cmdWork({ sock, msg, jid, sender, user }) {
  const now = Date.now();
  const lastWork = user.lastWork ? new Date(user.lastWork).getTime() : 0;
  const elapsed = now - lastWork;

  if (elapsed < WORK_COOLDOWN_MS) {
    const hoursLeft = Math.ceil((WORK_COOLDOWN_MS - elapsed) / (60 * 60 * 1000));
    await sendText(sock, jid, `⏳ You're still tired from your last shift!\nCome back in *${hoursLeft}h*.\n\n💡 Higher ranks unlock better jobs with bigger paychecks.`, msg);
    return;
  }

  const wins = user.wins || 0;
  const eligible = JOBS.filter(j => wins >= j.reqWins);
  const job = eligible[eligible.length - 1]; // best job they qualify for

  const pay = Math.floor(Math.random() * (job.maxPay - job.minPay + 1)) + job.minPay;

  // Rank bonus
  const rankBonus = { Bronze: 0, Silver: 5, Gold: 10, Platinum: 15, Diamond: 25, Legend: 40 };
  const bonus = rankBonus[user.rank] || 0;
  const totalPay = pay + bonus;

  User.update(sender, {
    currency: (user.currency || 0) + totalPay,
    lastWork: new Date().toISOString(),
  });

  const messages = [
    `You fetched the water bottles and cones. Hard work pays off! 💧`,
    `You organized the training equipment. Coach is impressed! 📋`,
    `You helped set up the pitch for the big match. Fans love you! ⚽`,
    `You ran drills with the youth players. Great coaching energy! 🏃`,
    `You analyzed the opponent's tactics and shared notes with the team. 📊`,
    `You helped with the press conference. Media trained! 🎤`,
    `You organized the locker room. Team morale is up! 🧹`,
    `You scouted a young talent at the local park. Eye for talent! 🔍`,
  ];
  const flavor = messages[Math.floor(Math.random() * messages.length)];

  await sendText(sock, jid,
    `💼 *WORK SHIFT COMPLETE!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📋 Job: *${job.name}*\n` +
    `📝 ${flavor}\n\n` +
    `💰 Base Pay: ${money(pay)}` +
    (bonus > 0 ? `\n🏆 Rank Bonus: +${money(bonus)} (${user.rank})` : '') +
    `\n💵 Total Earned: *${money(totalPay)}*\n` +
    `💳 Balance: ${money((user.currency || 0) + totalPay)}\n\n` +
    `⏰ Next shift in 4 hours.\n` +
    `📈 Win more matches to unlock better jobs!\n${BRAND}`, msg);
}

async function cmdJobs({ sock, msg, jid, user }) {
  const wins = user.wins || 0;
  let text = `💼 *AVAILABLE JOBS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  for (const job of JOBS) {
    const unlocked = wins >= job.reqWins;
    const icon = unlocked ? '✅' : '🔒';
    const pay = `${money(job.minPay)}-${money(job.maxPay)}`;
    text += `${icon} *${job.name}*\n   Pay: ${pay}/shift\n`;
    if (!unlocked) text += `   Requires: ${job.reqWins} wins\n`;
    text += `\n`;
  }

  text += `📊 Your wins: *${wins}*\n`;
  text += `⏰ Work cooldown: 4 hours\n${BRAND}`;
  await sendText(sock, jid, text, msg);
}

module.exports = { handle };
