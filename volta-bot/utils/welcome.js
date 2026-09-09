const User = require('../models/User');
const { sendText } = require('./messaging');

async function sendWelcomeMessage(sock, groupJid, userJid) {
  try {
    // Get the group metadata to find the group name
    const groupMeta = await sock.groupMetadata(groupJid).catch(() => null);
    const groupName = groupMeta?.subject || 'the group';

    // Try to find if the new user is registered
    const user = User.getByWhatsappId(userJid);
    const userName = user?.name || null;

    // Build a friendly welcome message
    const mentions = [userJid];
    const displayName = userName
      ? `@${userName}`
      : `@${userJid.split('@')[0]}`;

    const lines = [
      `⚽ *Welcome to VOLTA, ${displayName}!*`,
      ``,
      `You've joined *${groupName}*.`,
      ``,
      `📋 *Get started:*`,
      `• *!start* — Create your manager profile`,
      `• *!help* — See all available commands`,
      `• *!squad* — View your starter squad`,
      ``,
      `🏟️ *Quick tips:*`,
      `• *!daily* — Claim your daily reward`,
      `• *!play* — Start a PvP match`,
      `• *!auction* — Bid on players`,
      ``,
      `Good luck, Manager! 🏆`,
    ];

    const text = lines.join('\n');
    await sendText(sock, groupJid, text);
  } catch (err) {
    // Silently ignore errors (bot might not be admin)
  }
}

module.exports = { sendWelcomeMessage };
