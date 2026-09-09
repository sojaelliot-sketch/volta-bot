'use strict';
// commands/agent.js — !agent
//
// A once-a-day free look at one player generated specially for you, with a
// scout's written verdict. You can sign them, or walk away.
//
// Why this exists: packs are the only way to get players, packs cost money, and
// a new manager with an empty wallet has nothing to do but wait. This gives
// everyone one meaningful decision a day that costs nothing to receive — and a
// reason to open the chat tomorrow.

const User = require('../models/User');
const Player = require('../models/Player');
const { sendText } = require('../utils/messaging');
const { BRAND } = require('../config/constants');
const { pick } = require('../utils/random');
const { buildPlayer } = require('../utils/playerGenerator');

// Scouted players are created up front (buildPlayer persists immediately) but
// parked under this reserved owner, so they never appear in anybody's squad
// until the offer is signed. Unsigned ones are deleted when the offer dies.
const SCOUT_POOL = 'scout_pool@s.whatsapp.net';

const COOLDOWN_MS = 20 * 60 * 60 * 1000;   // slightly under a day, so it drifts earlier
const OFFER_TTL_MS = 30 * 60 * 1000;       // half an hour to decide

// Scout reports live in memory: an expired offer should simply evaporate.
const offers = new Map();   // sender -> { player, price, expires }

const VENUES = [
  'a waterlogged pitch in the lower leagues',
  'a youth tournament nobody else bothered to attend',
  'a five-a-side cage behind a shopping centre',
  'a reserve fixture on a Tuesday night',
  'a trial match in the pouring rain',
  'a village side two divisions below anyone serious',
  'a university cup tie',
  'a beach tournament, of all places',
];

const VERDICTS = {
  high: [
    'Best thing I have seen all season. Sign him before somebody with more money watches the same tape.',
    'I stopped taking notes after twenty minutes and just watched. That does not happen often.',
    'Two clubs already sent people. Neither of them stayed to the end, which is their loss.',
    'He made the game look slower than it was. You cannot coach that.',
  ],
  mid: [
    'Solid. Not a headline, but he would not embarrass you.',
    'Better than his numbers suggest. Wants the ball when it is ugly.',
    'Rough around the edges, decent underneath. Worth a punt at this price.',
    'Honest player. Does the boring things properly, which is rarer than it sounds.',
  ],
  low: [
    'Ran a lot. That is the kindest thing I can say.',
    'Squad filler. Useful if you are short, forgettable if you are not.',
    'One good moment in ninety minutes. I have seen worse afternoons.',
    'He is cheap for a reason. Your call.',
  ],
};

const overall = (p) => Player.calculateOVR(p);

// Delete a scouted player that was never signed.
function discard(offer) {
  if (offer && offer.player && offer.player.id) {
    try { Player.remove(offer.player.id); } catch { /* already gone */ }
  }
}

function priceFor(p) {
  const ovr = overall(p);
  const rarityMult = { Common: 1, Rare: 1.8, Elite: 3.2, Legendary: 6 }[p.rarity] || 1;
  // Deliberately cheaper than an equivalent pack pull — this is the reward for
  // showing up, not a shop.
  return Math.max(150, Math.round(ovr * 12 * rarityMult));
}

async function handle({ sock, msg, jid, sender, cmd, args, user }) {
  if (!user || !user.registered) {
    await sendText(sock, jid, '👋 Register first with *!start*.', msg);
    return;
  }

  const sub = (args[0] || '').toLowerCase();
  const pending = offers.get(sender);
  const live = pending && pending.expires > Date.now() ? pending : null;
  if (pending && !live) { discard(pending); offers.delete(sender); }

  // ── !agent sign ──
  if (sub === 'sign' || sub === 'buy' || sub === 'yes') {
    if (!live) {
      await sendText(sock, jid,
        `🔍 No offer on the table right now.\n\nSend *!agent* to get today's.`, msg);
      return;
    }
    const res = User.addCurrency(sender, -live.price);
    if (!res.ok) {
      await sendText(sock, jid,
        `❌ You need *${live.price.toLocaleString()}* Metaworks for ${live.player.name}.\n` +
        `You have *${res.balance.toLocaleString()}*.\n\n` +
        `The report stays open until it expires — go earn it.`, msg);
      return;
    }

    Player.update(live.player.id, { ownerId: User.normalizeJid(sender) });
    offers.delete(sender);

    await sendText(sock, jid,
      `✍️ *SIGNED*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `*${live.player.name}* joins the squad.\n` +
      `${live.player.rarity} · ${live.player.role} · OVR ${overall(live.player)}\n\n` +
      `💸 Paid: *${live.price.toLocaleString()}*\n` +
      `💳 Balance: *${res.balance.toLocaleString()}*\n\n` +
      `He goes straight to your bench — *!squad* to see him.\n${BRAND}`, msg);
    return;
  }

  // ── !agent pass ──
  if (sub === 'pass' || sub === 'no' || sub === 'reject') {
    if (!live) {
      await sendText(sock, jid, `🔍 Nothing to turn down. Send *!agent*.`, msg);
      return;
    }
    discard(live);
    offers.delete(sender);
    await sendText(sock, jid,
      `🚶 You let *${live.player.name}* walk.\n\nYour agent shrugs. There's always tomorrow.`, msg);
    return;
  }

  // ── !scout — show the live report, or generate today's ──
  if (live) {
    const mins = Math.ceil((live.expires - Date.now()) / 60000);
    await sendText(sock, jid,
      `🔍 You already have a report open on *${live.player.name}* — ` +
      `*${live.price.toLocaleString()}* Metaworks.\n\n` +
      `*!agent sign* or *!agent pass*. Expires in ${mins}m.`, msg);
    return;
  }

  const last = user.lastAgentFind ? new Date(user.lastAgentFind).getTime() : 0;
  const elapsed = Date.now() - last;
  if (elapsed < COOLDOWN_MS) {
    const remaining = COOLDOWN_MS - elapsed;
    // Rounding the remainder up on its own yields nonsense like "19h 60m".
    // Round to whole minutes first, then split.
    const totalMins = Math.max(1, Math.ceil(remaining / 60000));
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    await sendText(sock, jid,
      `🔍 *YOUR AGENT*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Your agent is still working the phones.\n\n` +
      `⏳ Next report in *${hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`}*.\n${BRAND}`, msg);
    return;
  }

  // Weighted so a Legendary find is a genuine event, not a weekly occurrence.
  const roll = Math.random() * 100;
  const rarity = roll < 55 ? 'Common' : roll < 85 ? 'Rare' : roll < 97 ? 'Elite' : 'Legendary';
  const player = buildPlayer(SCOUT_POOL, rarity);
  const price = priceFor(player);
  const ovr = overall(player);
  const band = ovr >= 78 ? 'high' : ovr >= 62 ? 'mid' : 'low';

  offers.set(sender, { player, price, expires: Date.now() + OFFER_TTL_MS });
  User.update(sender, { lastAgentFind: new Date().toISOString() });

  const bal = user.currency || 0;
  const affordable = bal >= price;

  await sendText(sock, jid,
    `🔍 *AGENT'S FIND*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `_Found at ${pick(VENUES)}._\n\n` +
    `*${player.name}*\n` +
    `${player.rarity} · ${player.role} · Age ${player.age}\n` +
    `⭐ Overall *${ovr}*  ·  Potential *${player.potential}*\n\n` +
    `🗒️ _"${pick(VERDICTS[band])}"_\n\n` +
    `💰 Asking: *${price.toLocaleString()}* Metaworks\n` +
    `💳 You have: *${bal.toLocaleString()}*${affordable ? '' : '  ⚠️ not enough'}\n\n` +
    `*!agent sign* to take him · *!agent pass* to walk\n` +
    `⏳ The offer stands for 30 minutes.\n${BRAND}`, msg);
}

module.exports = { handle };
