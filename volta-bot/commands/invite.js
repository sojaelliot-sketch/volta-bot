const User = require('../models/User');
const { REFERRAL, BRAND } = require('../config/constants');
const { money } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');

async function handle({ sock, msg, jid, sender, user }) {
  if (!user?.registered) {
    await sendText(sock, jid, `❌ Register first with *!register [name]* to get your invite code.`, msg);
    return;
  }

  const code = user.refCode || User.genRefCode();
  if (code !== user.refCode) User.update(sender, { refCode: code });

  const text = `📨 *INVITE A MANAGER — ${BRAND}*
━━━━━━━━━━━━━━━━━━━━━━
Your invite code: *${code}*

Share it with friends 👇
"⚽ Join VOLTA — the 5-a-side football bot! Use my code *${code}* when you register and we BOTH get ${money(REFERRAL.REWARD)} Metaworks! Link your WhatsApp & type !register [name] ${code}"

Reward: 💰 ${money(REFERRAL.REWARD)} for you + ${money(REFERRAL.REFEREE_BONUS)} for them.

👥 Join the VOLTA community group:
https://chat.whatsapp.com/FD6Mvmdq8wUE1EhSB78xAd

🔥 The more friends you bring, the richer your club gets!`;

  await sendText(sock, jid, text, msg);
}

module.exports = { handle };
