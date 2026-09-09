// commands/compgcs.js
// Shows all competition GC links

const { sendText } = require('../utils/messaging');
const { BRAND } = require('../config/constants');
const { COMPETITION_GCS } = require('../config/competitionGCs');

async function compgcsCommand({ sock, msg, jid, sender, args }) {
  let output = `📲 *COMPETITION GROUP CHATS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  for (const [id, gc] of Object.entries(COMPETITION_GCS)) {
    output += `${gc.name}\n${gc.link}\n\n`;
  }

  output += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  output += `Join each comp GC to play matches!\n${BRAND}`;
  await sendText(sock, jid, output, msg);
}

module.exports = { handle: compgcsCommand };
