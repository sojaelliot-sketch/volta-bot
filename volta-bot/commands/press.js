// commands/press.js
//   !press @user — pre-match trash talk
const User = require('../models/User');
const { sendText } = require('../utils/messaging');
const { resolveTarget } = require('./router');
const { BRAND } = require('../config/constants');

const TRASH_TALK = [
  "I hope you brought your A-game, because I'm bringing mine. 🥊",
  "Your squad looks decent... on paper. Let's see what happens on the pitch. 😏",
  "I've been training all week for this. You're just another Tuesday for me. 🥱",
  "They say you're good. I say you haven't played ME yet. 😤",
  "I'd wish you luck, but luck won't help you today. 🔥",
  "Your formation is cute. I'll send a postcard from your goal. 📮",
  "I hope you stretched, because you're about to run a lot. 🏃",
  "Don't worry, I'll take it easy on you. Just kidding. 💀",
  "I can smell the fear from here. Oh wait, that's just your kit. 😂",
  "Ready to lose? Of course not. Nobody ever is. 🤷",
  "My players are hungry. Yours look like they just had lunch. 😴",
  "I've got more chemistry than a science lab. ⚗️",
  "See you on the pitch. Bring tissues for the tears. 😭",
  "Your tactics are as outdated as a flip phone. 📱",
  "I'm not saying I'm going to destroy you, but... actually, yeah I am. 💥",
];

async function handle({ sock, msg, jid, sender, args, replyTo, mentioned }) {
  const user = User.getByWhatsappId(sender);
  if (!user || !user.registered) {
    await sendText(sock, jid, `❌ Register first with *!start*.`, msg);
    return;
  }

  const targetJid = resolveTarget(args, { replyTo, mentioned });
  if (!targetJid || targetJid === sender) {
    await sendText(sock, jid, `⚠️ Usage: *!press @user* — send pre-match trash talk.`, msg);
    return;
  }

  const target = User.getByWhatsappId(targetJid);
  if (!target) {
    await sendText(sock, jid, `❌ Manager not found.`, msg);
    return;
  }

  const trash = TRASH_TALK[Math.floor(Math.random() * TRASH_TALK.length)];
  await sendText(sock, jid,
    `🎤 *PRE-MATCH PRESS*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${user.name} challenges ${target.name}!\n\n` +
    `"${trash}"\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `_${target.name}, your response?_\n${BRAND}`, msg);
}

module.exports = { handle };
