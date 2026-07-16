// commands/autosquad.js
//   !autosquad  (alias !best) — auto-pick your strongest XI:
//   3 best outfield + your best goalkeeper, rest to bench/reserves.
const User = require('../models/User');
const Player = require('../models/Player');
const { SQUAD } = require('../config/constants');
const { sendText } = require('../utils/messaging');

async function handle({ sock, msg, jid, sender, user }) {
  // Only consider the player's ACTIVE squad — never pull players from a
  // different saved squad into this one.
  const owned = Player.getSquadPlayers(sender);
  if (owned.length < SQUAD.STARTING_XI_SIZE) {
    await sendText(sock, jid, `❌ You need at least ${SQUAD.STARTING_XI_SIZE} players. Open a pack!`, msg);
    return;
  }

  const outfield = owned.filter((p) => p.role === 'outfield')
    .sort((a, b) => Player.totalStats(b) - Player.totalStats(a));
  const keepers = owned.filter((p) => p.role === 'goalkeeper')
    .sort((a, b) => Player.totalStats(b) - Player.totalStats(a));

  if (outfield.length < 3) {
    await sendText(sock, jid, `❌ You need *3 outfield* players for a VOLTA XI.`, msg);
    return;
  }
  if (!keepers.length) {
    await sendText(sock, jid, `❌ You need a *goalkeeper*! 🧤`, msg);
    return;
  }

  const startingXI = [
    ...outfield.slice(0, 3).map((p) => p.id),
    keepers[0].id,
  ];

  let rest = [...outfield.slice(3).map((p) => p.id), ...keepers.slice(1).map((p) => p.id)];
  const bench = rest.slice(0, SQUAD.BENCH_SIZE);
  const reserves = rest.slice(SQUAD.BENCH_SIZE);

  User.update(sender, { startingXI, bench, reserves });

  const xiLines = startingXI.map((id) => {
    const p = Player.getById(id);
    return `▶️ ${p.role === 'goalkeeper' ? '🧤' : '⚽'} *${Player.displayName(p)}*`;
  }).join('\n');

  await sendText(sock, jid,
    `⚡ *BEST XI LOCKED IN!*\n━━━━━━━━━━━━━━━━━━━━━━━\n${xiLines}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\nYour strongest 3 + keeper are now starting. 🔥`, msg);
}

module.exports = { handle };
