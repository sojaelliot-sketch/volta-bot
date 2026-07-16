// commands/reserve.js
//   !reserve [id]   — move a player from your Starting XI / Bench into Reserves
//   !reserve out [id] — move a player from Reserves back into the Bench
const User = require('../models/User');
const Player = require('../models/Player');
const { SQUAD } = require('../config/constants');
const { sendText } = require('../utils/messaging');

function findPlayerByShortId(ownerId, shortIdArg) {
  return Player.findByQuery(ownerId, shortIdArg);
}

async function handle({ sock, msg, jid, sender, args, user }) {
  const out = (args[0] || '').toLowerCase() === 'out';
  const idArg = out ? args[1] : args[0];
  if (!idArg) {
    await sendText(sock, jid,
      `⚠️ Usage:\n*!reserve [id]* — send a player to Reserves\n*!reserve out [id]* — bring them back to the Bench`, msg);
    return;
  }
  const p = findPlayerByShortId(sender, idArg);
  if (!p) {
    await sendText(sock, jid, `❌ No player found with ID starting *${idArg}*. Check *!squad*.`, msg);
    return;
  }

  const { startingXI, bench, reserves } = user;
  if (out) {
    if (!reserves.includes(p.id)) {
      await sendText(sock, jid, `*${Player.displayName(p)}* isn't in your Reserves.`, msg);
      return;
    }
    User.update(sender, {
      reserves: reserves.filter((id) => id !== p.id),
      bench: [...bench, p.id],
    });
    await sendText(sock, jid, `↩️ *${Player.displayName(p)}* moved from Reserves to Bench.`, msg);
    return;
  }

  // into reserves
  if (reserves.includes(p.id)) {
    await sendText(sock, jid, `*${Player.displayName(p)}* is already in your Reserves.`, msg);
    return;
  }
  const newXI = startingXI.filter((id) => id !== p.id);
  const newBench = bench.filter((id) => id !== p.id);
  if (newXI.length === startingXI.length && newBench.length === bench.length) {
    await sendText(sock, jid, `*${Player.displayName(p)}* isn't in your Starting XI or Bench.`, msg);
    return;
  }
  User.update(sender, {
    startingXI: newXI,
    bench: newBench,
    reserves: [...reserves, p.id],
  });
  await sendText(sock, jid, `📦 *${Player.displayName(p)}* moved to Reserves.`, msg);
}

module.exports = { handle };
