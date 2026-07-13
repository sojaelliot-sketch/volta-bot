// commands/auction.js
//   !auction start [playerId|auto] [minPrice] — owner/officer lists a HIGH player
//   !bid [amount]                            — moderators / officers / owner only
//   !auction end                             — owner/officer closes & awards
const User = require('../models/User');
const Player = require('../models/Player');
const transfer = require('../models/transfer');
const { buildPlayer } = require('../utils/playerGenerator');
const { AUCTION, BRAND, RARITY } = require('../config/constants');
const { money, bar } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');

let active = null;          // current auction
let endTimer = null;

function canHost(sender) {
  if (User.isOwner(sender)) return true;
  const u = User.getByWhatsappId(sender);
  return User.roleRank(u?.role) >= User.roleRank('officer');
}
function canBid(sender) {
  // Bidding is open to everyone who has a registered manager profile
  // (the router already blocks unregistered users at the command gate).
  if (User.isOwner(sender)) return true;
  const u = User.getByWhatsappId(sender);
  return !!(u && u.registered);
}

function shortId(id) { return (id || '').slice(0, 6); }

function endAuction(sock) {
  if (endTimer) { clearTimeout(endTimer); endTimer = null; }
  if (!active) return;
  const a = active;
  active = null;

  if (!a.highestBidder) {
    sendText(sock, a.chatJid, `🔨 *Auction closed* — no bids. *${Player.displayName(Player.getById(a.itemId))}* stays with the house.`);
    return;
  }

  const winner = User.getByWhatsappId(a.highestBidder);
  const item = Player.getById(a.itemId);
  if (!winner || !item) {
    sendText(sock, a.chatJid, `🔨 *Auction closed* — winner not found.`);
    return;
  }
  if ((winner.currency || 0) < a.highestBid) {
    sendText(sock, a.chatJid, `🔨 *Auction closed* — ${winner.name} couldn't cover *${a.highestBid}*. No sale.`);
    return;
  }

  // Pay the winner's bid; the host (auctioneer) collects the proceeds.
  User.update(a.highestBidder, { currency: (winner.currency || 0) - a.highestBid });
  User.update(a.host, { currency: (User.getByWhatsappId(a.host)?.currency || 0) + a.highestBid });

  // Transfer the player from its CURRENT owner (the house for "auto", or the
  // player's existing owner for a specific id) into the winner's reserves. This
  // also removes it from the seller's squad lists so it can't be double-owned.
  transfer.transferPlayer(a.itemId, item.ownerId, a.highestBidder);

  const emoji = RARITY[item.rarity]?.emoji || '⚪';
  const role = item.role === 'goalkeeper' ? '🧤 GK' : '⚽ OF';
  sendText(sock, a.chatJid,
    `🔨 *SOLD!* 💎\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🏆 @${winner.name} won *${Player.displayName(item)}*!\n` +
    `💲 Price: *${a.highestBid}* Metaworks\n` +
    `💳 ${winner.name} balance: *${User.getByWhatsappId(a.highestBidder).currency}*\n\n` +
    `${emoji} *${Player.displayName(item)}* — ${item.rarity} · ${role} · Age ${item.age}\n` +
    `🆔 \`${item.id.slice(0, 6)}\` · ❤️ ${bar(item.condition || 100)}\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, undefined, [a.highestBidder]);
}

async function handle({ sock, msg, jid, sender, cmd, args }) {
  if (cmd === 'auction') {
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'start') {
      if (!canHost(sender)) {
        await sendText(sock, jid, `⛔ Only the Owner or an Officer can start an auction.`, msg);
        return;
      }
      if (active) {
        await sendText(sock, jid, `⚠️ An auction is already live.`, msg);
        return;
      }
      const minPrice = Math.max(0, parseInt(args[2], 10) || 500);

      let item;
      const givenId = args[1];
      if (givenId && givenId !== 'auto') {
        // Resolve by exact id first, then by id prefix / name across the WHOLE
        // pool (an officer/owner can auction any player, not just ones they own).
        item = Player.getById(givenId) || Player.findAny(givenId);
        if (!item) { await sendText(sock, jid, `❌ Player *${givenId}* not found.`, msg); return; }
      } else {
        item = buildPlayer(sender, AUCTION.HIGH_PLAYER_RARITY);
      }

      active = { itemId: item.id, minPrice, highestBid: 0, highestBidder: null, host: sender, chatJid: jid, endsAt: Date.now() + AUCTION.DURATION_MS };
      endTimer = setTimeout(() => endAuction(sock), AUCTION.DURATION_MS);

      await sendText(sock, jid,
        `🔨 *AUCTION LIVE!* 💎\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🏆 Item: *${Player.displayName(item)}* (${item.rarity})\n` +
        `💲 Starting price: *${minPrice}* Metaworks\n` +
        `🎯 Any registered manager can *!bid*! (auction hosted by Owner/Officer)\n` +
        `⏳ Closes in ${AUCTION.DURATION_MS / 1000}s or *!auction end*.\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
      return;
    }

    if (sub === 'end') {
      if (!canHost(sender)) {
        await sendText(sock, jid, `⛔ Only the Owner or an Officer can close the auction.`, msg);
        return;
      }
      if (!active) { await sendText(sock, jid, `ℹ️ No auction running.`, msg); return; }
      endAuction(sock);
      return;
    }

    await sendText(sock, jid, `⚠️ Usage:\n*!auction start [playerId|auto] [minPrice]*\n*!auction end*`, msg);
    return;
  }

  if (cmd === 'bid') {
    if (!canBid(sender)) {
      await sendText(sock, jid, `⛔ Only registered managers can bid. Send *!start* first.`, msg);
      return;
    }
    if (!active) { await sendText(sock, jid, `ℹ️ No auction running. Start one with *!auction start*.`, msg); return; }
    const amount = parseInt(args[0], 10);
    if (!amount || isNaN(amount)) {
      await sendText(sock, jid, `⚠️ Usage: *!bid [amount]*`, msg);
      return;
    }
    const minReq = Math.max(active.minPrice, active.highestBid + AUCTION.MIN_BID_STEP);
    if (amount < minReq) {
      await sendText(sock, jid, `⚠️ Bid must be at least *${minReq}* Metaworks.`, msg);
      return;
    }
    const u = User.getByWhatsappId(sender);
    if ((u.currency || 0) < amount) {
      await sendText(sock, jid, `❌ You only have *${u.currency || 0}* Metaworks.`, msg);
      return;
    }
    active.highestBid = amount;
    active.highestBidder = sender;
    await sendText(sock, jid, `📈 *${u.name}* bids *${amount}* Metaworks! 💎`, msg);
    return;
  }
}

module.exports = { handle };
