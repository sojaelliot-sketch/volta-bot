// commands/reserve.js
//   !reserve [id]   — move a player from your Starting XI / Bench into Reserves
//   !reserve out [id] — move a player from Reserves back into the Bench
// The id can be a full or partial player ID, or the player's name/nickname,
// and may be wrapped in backticks — all forms are tolerated.
const User = require('../models/User');
const Player = require('../models/Player');
const { SQUAD } = require('../config/constants');
const { sendText } = require('../utils/messaging');

function cleanId(raw) {
  return String(raw || '').replace(/[`*_\s]/g, '').trim();
}

function findPlayer(ownerId, rawArg) {
  const arg = cleanId(rawArg);
  if (!arg) return null;
  // exact / prefix id
  let p = Player.findByQuery(ownerId, arg);
  if (p) return p;
  // the user may have pasted a longer id; match by startsWith on the real id
  const owned = Player.getSquadPlayers(ownerId);
  p = owned.find((x) => x.id.toLowerCase().startsWith(arg.toLowerCase()));
  if (p) return p;
  // or by name/nickname
  return owned.find((x) =>
    (x.name || '').toLowerCase().includes(arg.toLowerCase()) ||
    (x.nickname || '').toLowerCase().includes(arg.toLowerCase()));
}

async function handle({ sock, msg, jid, sender, args, user }) {
  if (!args.length) {
    await sendText(sock, jid,
      `⚠️ Usage:\n*!reserve [id]* — send a player to Reserves\n*!reserve out [id]* — bring them back to the Bench`, msg);
    return;
  }

  const out = (args[0] || '').toLowerCase() === 'out';
  const idArg = out ? args[1] : args[0];

  if (!idArg) {
    await sendText(sock, jid,
      `⚠️ Give me a player ID (or name). Usage:\n*!reserve [id]* — to Reserves\n*!reserve out [id]* — back to Bench`, msg);
    return;
  }

  const p = findPlayer(sender, idArg);
  if (!p) {
    await sendText(sock, jid, `❌ No player found for *${cleanId(idArg)}*. Use *!squad* to see your players and their IDs.`, msg);
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
    await sendText(sock, jid, `*${Player.displayName(p)}* isn't in your Starting XI or Bench — nothing to reserve.`, msg);
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
