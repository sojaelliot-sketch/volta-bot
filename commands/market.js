const User = require('../models/User');
const Player = require('../models/Player');
const db = require('../config/database');
const { MARKET, RARITY } = require('../config/constants');
const { money, bar } = require('../utils/formatter');
const { sendText, typing } = require('../utils/messaging');
const { seedMarketPlayer } = require('../utils/playerGenerator');
const { v4: uuid } = require('uuid');

const MARKET_TABLE = 'market';
const LISTING_HOURS_MS = MARKET.LISTING_HOURS * 60 * 60 * 1000;

async function handle({ sock, msg, jid, sender, cmd, args, user }) {
  if (cmd === 'market') return cmdMarket({ sock, msg, jid, args });
  if (cmd === 'buy') return cmdBuy({ sock, msg, jid, sender, user, args });
  if (cmd === 'sell') return cmdSell({ sock, msg, jid, sender, user, args });
  if (cmd === 'list') return cmdList({ sock, msg, jid, sender, user, args });
}

async function ensureSeedMarket() {
  const listings = db.all(MARKET_TABLE);
  const activeListings = listings.filter(l => l.sold === false && !isExpired(l));
  if (activeListings.length < MARKET.AI_SEED_COUNT) {
    const needed = MARKET.AI_SEED_COUNT - activeListings.length;
    for (let i = 0; i < needed; i++) {
      const player = seedMarketPlayer();
      const price = Math.round(Player.marketValue(player) * (0.5 + Math.random() * 0.8));
      db.insert(MARKET_TABLE, player.id, {
        id: player.id,
        playerId: player.id,
        sellerId: 'AI_MARKET',
        sellerName: 'AI Market',
        price,
        listedAt: new Date().toISOString(),
        sold: false,
      });
    }
  }
}

function isExpired(listing) {
  const elapsed = Date.now() - new Date(listing.listedAt).getTime();
  return elapsed > LISTING_HOURS_MS;
}

async function cmdMarket({ sock, msg, jid, args }) {
  await ensureSeedMarket();

  const allListings = db.all(MARKET_TABLE);
  const activeListings = allListings
    .filter(l => l.sold === false && !isExpired(l))
    .sort((a, b) => new Date(b.listedAt) - new Date(a.listedAt));

  if (!activeListings.length) {
    await sendText(sock, jid, `📭 *Transfer Market* — No players currently listed.\n\nAI is restocking... check back soon!`, msg);
    return;
  }

  const page = Math.max(1, parseInt(args[0]) || 1);
  const pageSize = MARKET.PAGE_SIZE;
  const totalPages = Math.ceil(activeListings.length / pageSize);
  const start = (page - 1) * pageSize;
  const pageListings = activeListings.slice(start, start + pageSize);

  let text = `🏪 *TRANSFER MARKET* — Page ${page}/${totalPages}
━━━━━━━━━━━━━━━━━━━━━━━━
📦 ${activeListings.length} players available\n\n`;

  for (const listing of pageListings) {
    const p = Player.getById(listing.playerId);
    if (!p) continue;
    const emoji = RARITY[p.rarity]?.emoji || '⚪';
    const role = p.role === 'goalkeeper' ? '🧤' : '⚽';
    const id = listing.id.slice(0, 6);
    text += `${emoji} *${Player.displayName(p)}* ${role}\n`;
    text += `   ${p.rarity} · Age ${p.age} · Lv.${p.level}\n`;
    text += `   💰 ${money(listing.price)}  🆔 \`${id}\`\n\n`;
  }

  text += `━━━━━━━━━━━━━━━━━━━━━━━━
💡 *!buy [id]* — Purchase a player
💡 *!list [playerID] [price]* — Sell your player
📄 *!market 2* — Next page`;

  await sendText(sock, jid, text, msg);
}

async function cmdBuy({ sock, msg, jid, sender, user, args }) {
  const shortId = args[0];
  if (!shortId) {
    await sendText(sock, jid, `⚠️ Usage: *!buy [listingID]* — Get the listing ID from *!market*`, msg);
    return;
  }

  const allListings = db.all(MARKET_TABLE);
  const listing = allListings.find(l =>
    l.id.startsWith(shortId) && l.sold === false && !isExpired(l)
  );

  if (!listing) {
    await sendText(sock, jid, `❌ No active listing found with ID *${shortId}*. Check *!market* for available players.`, msg);
    return;
  }

  if (listing.sellerId === sender) {
    await sendText(sock, jid, `❌ You can't buy your own listing!`, msg);
    return;
  }

  if ((user.currency || 0) < listing.price) {
    await sendText(sock, jid, `❌ Insufficient funds! You need ${money(listing.price)} but only have ${money(user.currency)}.\n\n💰 Play matches or claim *!daily* to earn more.`, msg);
    return;
  }

  // Process transfer
  const player = Player.getById(listing.playerId);
  if (!player) {
    await sendText(sock, jid, `❌ Player not found in database.`, msg);
    return;
  }

  // Deduct from buyer
  User.update(sender, { currency: (user.currency || 0) - listing.price });

  // Credit seller (if not AI)
  if (listing.sellerId !== 'AI_MARKET') {
    const seller = User.getByWhatsappId(listing.sellerId);
    if (seller) {
      User.update(listing.sellerId, { currency: (seller.currency || 0) + listing.price });
    }
  }

  // Transfer player
  Player.update(player.id, { ownerId: sender, isListed: false, marketPrice: 0 });

  // Remove the player from the seller's squad lists so they can't field a
  // player they no longer own.
  if (listing.sellerId !== 'AI_MARKET') {
    const seller = User.getByWhatsappId(listing.sellerId);
    if (seller) {
      const clean = (ids) => (ids || []).filter((id) => id !== player.id);
      User.update(listing.sellerId, {
        startingXI: clean(seller.startingXI),
        bench: clean(seller.bench),
        reserves: clean(seller.reserves),
      });
    }
  }

  // Add to buyer's reserves
  const buyerUser = User.getByWhatsappId(sender);
  const newReserves = [...(buyerUser.reserves || []), player.id];
  User.update(sender, { reserves: newReserves });

  // Mark listing as sold
  db.update(MARKET_TABLE, listing.id, { sold: true });

  const emoji = RARITY[player.rarity]?.emoji || '⚪';
  const role = player.role === 'goalkeeper' ? '🧤 GK' : '⚽ OF';
  const s = player.stats;
  const statLine = player.role === 'goalkeeper'
    ? `REF ${s.reflex} POS ${s.positioning} ANT ${s.anticipation} STR ${s.strength} COM ${s.composure}`
    : `PAC ${s.pace} SKL ${s.skill} SHO ${s.shooting} STA ${s.stamina} COM ${s.composure}`;
  await typing(sock, jid, 600);
  await sendText(sock, jid, `✅ *TRANSFER COMPLETE!*
━━━━━━━━━━━━━━━━━━━━━━━
${emoji} *${Player.displayName(player)}* signed!
${player.rarity} · ${role} · Age ${player.age}
${statLine}
💰 Paid: ${money(listing.price)}
💳 New balance: ${money((user.currency || 0) - listing.price)}
🆔 \`${player.id.slice(0, 6)}\` · ❤️ ${bar(player.condition)}

📍 Player moved to reserves.
Use *!squad* to view your new signing!
━━━━━━━━━━━━━━━━━━━━━━━`, msg);
}

async function cmdSell({ sock, msg, jid, sender, user, args }) {
  // sell is an alias for list
  return cmdList({ sock, msg, jid, sender, user, args });
}

async function cmdList({ sock, msg, jid, sender, user, args }) {
  const playerId = args[0];
  const price = parseInt(args[1]);

  if (!playerId || !price || price <= 0) {
    await sendText(sock, jid, `⚠️ Usage: *!list [playerID] [price]*\nExample: *!list ab12cd 500*\n\nGet player IDs from *!squad*`, msg);
    return;
  }

  const player = Player.getByOwner(sender).find(p => p.id.startsWith(playerId));
  if (!player) {
    await sendText(sock, jid, `❌ No player found with ID *${playerId}*. Use *!squad* to view your players.`, msg);
    return;
  }

  if (player.isListed) {
    await sendText(sock, jid, `❌ *${Player.displayName(player)}* is already listed on the market!`, msg);
    return;
  }

  // Check minimum price (50% of market value)
  const marketVal = Player.marketValue(player);
  const minPrice = Math.round(marketVal * MARKET.MIN_PRICE_RATIO);
  if (price < minPrice) {
    await sendText(sock, jid, `❌ Minimum listing price for *${Player.displayName(player)}* is ${money(minPrice)} (50% of market value: ${money(marketVal)}).\n\nSet a price of at least ${money(minPrice)}.`, msg);
    return;
  }

  const emoji = RARITY[player.rarity]?.emoji || '⚪';

  // Create listing
  const listingId = uuid();
  db.insert(MARKET_TABLE, listingId, {
    id: listingId,
    playerId: player.id,
    sellerId: sender,
    sellerName: user.name,
    price,
    listedAt: new Date().toISOString(),
    sold: false,
  });

  Player.update(player.id, { isListed: true, marketPrice: price });

  await sendText(sock, jid, `📋 *PLAYER LISTED ON MARKET!*
━━━━━━━━━━━━━━━━━━━━━━━━
${emoji} *${Player.displayName(player)}*
📊 Market Value: ${money(marketVal)}
🏷️ Listed at: ${money(price)}
⏳ Expires: ${MARKET.LISTING_HOURS}h

Other managers can now buy them via *!market*!
━━━━━━━━━━━━━━━━━━━━━━━━`, msg);
}

module.exports = { handle };