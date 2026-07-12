// commands/swap.js
// Move / swap players between Starting XI, Bench and Reserves.
// Usage:
//   !swap [id1] [id2]            -> swap the two players' slots (XI <-> bench <-> reserves)
//   !swap [id] xi|bench|reserves -> move one player into that list
//                                   (if the target is full it auto-swaps the weakest player out)
const User = require('../models/User');
const Player = require('../models/Player');
const { SQUAD } = require('../config/constants');
const { sendText } = require('../utils/messaging');

const LIST_ALIASES = {
  xi: 'startingXI', starting: 'startingXI', startingxi: 'startingXI', line: 'startingXI', lineup: 'startingXI',
  bench: 'bench',
  reserve: 'reserves', reserves: 'reserves', res: 'reserves',
};

function shortId(id) { return (id || '').slice(0, 6); }

function findPlayerByShortId(ownerId, shortIdArg) {
  const owned = Player.getByOwner(ownerId);
  return owned.find((p) => p.id.startsWith(shortIdArg)) || null;
}

function whichList(user, playerId) {
  if (user.startingXI.includes(playerId)) return 'startingXI';
  if (user.bench.includes(playerId)) return 'bench';
  if (user.reserves.includes(playerId)) return 'reserves';
  return null;
}

function listLabel(list) {
  return list === 'startingXI' ? 'Starting XI' : list === 'bench' ? 'Bench' : 'Reserves';
}

function weakestIn(list, user) {
  const ids = user[list];
  let worst = null;
  for (const id of ids) {
    const p = Player.getById(id);
    if (!p) continue;
    const score = Player.totalStats(p);
    if (!worst || score < worst.score) worst = { id, score };
  }
  return worst ? worst.id : null;
}

async function handle({ sock, msg, jid, sender, args, user }) {
  const a = args[0];
  const b = args[1];

  if (!a) {
    await sendText(sock, jid, `🔄 *SWAP PLAYERS*
━━━━━━━━━━━━━━━━━━━━━━━━
Swap two players:
*!swap [id1] [id2]*

Or move one player into a list:
*!swap [id] xi* | *!swap [id] bench* | *!swap [id] reserves*

💡 Use *!squad* to see player IDs.`, msg);
    return;
  }

  const p1 = findPlayerByShortId(sender, a);
  if (!p1) {
    await sendText(sock, jid, `❌ No player found with ID *${a}*. Use *!squad* to check IDs.`, msg);
    return;
  }

  // ── Mode 2: move into a named list ──
  if (b && LIST_ALIASES[b.toLowerCase()]) {
    const target = LIST_ALIASES[b.toLowerCase()];
    const from = whichList(user, p1.id);
    if (!from) {
      await sendText(sock, jid, `❌ *${Player.displayName(p1)}* isn't in your squad lists.`, msg);
      return;
    }
    if (from === target) {
      await sendText(sock, jid, `ℹ️ *${Player.displayName(p1)}* is already in *${listLabel(target)}*.`, msg);
      return;
    }

    const max = target === 'startingXI' ? SQUAD.STARTING_XI_SIZE : target === 'bench' ? SQUAD.BENCH_SIZE : Infinity;
    const lists = {
      startingXI: user.startingXI.slice(),
      bench: user.bench.slice(),
      reserves: user.reserves.slice(),
    };

    // Remove p1 from its current list
    lists[from] = lists[from].filter((id) => id !== p1.id);

    // If target full, swap out the weakest player back to the source list
    let bumped = null;
    if (lists[target].length >= max) {
      const weakestId = weakestIn(target, user);
      if (weakestId) {
        lists[target] = lists[target].filter((id) => id !== weakestId);
        lists[from].push(weakestId);
        bumped = Player.getById(weakestId);
      }
    }
    lists[target].push(p1.id);

    User.update(sender, lists);

    let text = `✅ *${Player.displayName(p1)}* moved to *${listLabel(target)}*!`;
    if (bumped) text += `\n↔️ *${Player.displayName(bumped)}* dropped to *${listLabel(from)}*.`;
    await sendText(sock, jid, text, msg);
    return;
  }

  // ── Mode 1: swap two specific players ──
  if (!b) {
    await sendText(sock, jid, `⚠️ Give a second player ID to swap, or a list name (xi/bench/reserves).\nExample: *!swap ${shortId(p1.id)} ef34gh*`, msg);
    return;
  }

  const p2 = findPlayerByShortId(sender, b);
  if (!p2) {
    await sendText(sock, jid, `❌ No player found with ID *${b}*. Use *!squad* to check IDs.`, msg);
    return;
  }
  if (p1.id === p2.id) {
    await sendText(sock, jid, `ℹ️ That's the same player!`, msg);
    return;
  }

  const list1 = whichList(user, p1.id);
  const list2 = whichList(user, p2.id);
  if (!list1 || !list2) {
    await sendText(sock, jid, `❌ Both players must be in your squad (Starting XI, Bench, or Reserves).`, msg);
    return;
  }
  if (list1 === list2) {
    // Same list: just reorder isn't meaningful — tell them
    await sendText(sock, jid, `ℹ️ Both players are already in *${listLabel(list1)}*. Use a different list to swap across groups.`, msg);
    return;
  }

  const lists = {
    startingXI: user.startingXI.slice(),
    bench: user.bench.slice(),
    reserves: user.reserves.slice(),
  };
  lists[list1] = lists[list1].map((id) => (id === p1.id ? p2.id : id));
  lists[list2] = lists[list2].map((id) => (id === p2.id ? p1.id : id));
  User.update(sender, lists);

  await sendText(sock, jid,
    `🔄 *Swap complete!*\n*${Player.displayName(p1)}* (${listLabel(list1)}) ⇄ *${Player.displayName(p2)}* (${listLabel(list2)})`, msg);
}

module.exports = { handle };
