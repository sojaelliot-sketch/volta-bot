const User = require('../models/User');
const Player = require('../models/Player');
const transfer = require('../models/transfer');
const db = require('../config/database');
const { MARKET, RARITY } = require('../config/constants');
const { money, bar } = require('../utils/formatter');
const { sendText, typing } = require('../utils/messaging');
const { seedMarketPlayer } = require('../utils/playerGenerator');
const { v4: uuid } = require('uuid');

const MARKET_TABLE = 'market';
const LISTING_HOURS_MS = MARKET.LISTING_HOURS * 60 * 60 * 1000;
const USER_LISTING_TTL_MS = MARKET.USER_LISTING_TTL_MS;

async function handle({ sock, msg, jid, sender, cmd, args, user }) {
  botSock = sock;
  if (cmd === 'market') return cmdMarket({ sock, msg, jid, args });
  if (cmd === 'buy') return cmdBuy({ sock, msg, jid, sender, user, args });
  if (cmd === 'sell') return cmdSell({ sock, msg, jid, sender, user, args });
  if (cmd === 'list') return cmdList({ sock, msg, jid, sender, user, args });
}

// Periodic sweep so user listings auto-expire (house buyout) even if nobody
// opens the market. Runs every minute.
setInterval(() => {
  try { processExpired(botSock); } catch {}
}, 60 * 1000);

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
        expiresAt: null, // house listings never auto-expire; they rotate when bought
        sold: false,
      });
    }
  }
}

function isExpired(listing) {
  // AI/house listings carry no expiresAt, so they only rotate when bought.
  if (!listing.expiresAt) return false;
  return Date.now() > new Date(listing.expiresAt).getTime();
}

// Run on every market access + on a timer: any user listing past its 10-minute
// TTL is auto-bought by the house at the player's market value (the seller gets
// the "normal price"), and the player is dropped onto the AI Market. This keeps
// the public market flowing without manual cleanup.
function processExpired(sock) {
  const all = db.all(MARKET_TABLE);
  for (const l of all) {
    if (l.sold || !isExpired(l)) continue;
    if (l.sellerId === transfer.HOUSE) {
      db.update(MARKET_TABLE, l.id, { sold: true });
      continue;
    }
    const player = Player.getById(l.playerId);
    const seller = User.getByWhatsappId(l.sellerId);
    if (player && seller) {
      const payout = Player.marketValue(player);
      User.update(l.sellerId, { currency: (seller.currency || 0) + payout });
      transfer.transferPlayer(player.id, l.sellerId, transfer.HOUSE);
      if (sock) {
        sendText(sock, l.sellerId,
          `⏰ *LISTING EXPIRED* 🏦\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `*${Player.displayName(player)}* didn't sell in 10 min.\n` +
          `The house bought it for *${money(payout)}* (market value) and it's now on the AI Market.`, undefined)
          .catch(() => {});
      }
    }
    db.update(MARKET_TABLE, l.id, { sold: true });
  }
}

// Keep a handle on the live socket so the periodic ticker can notify sellers.
let botSock = null;

async function cmdMarket({ sock, msg, jid, args }) {
  processExpired(sock);
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
  processExpired(sock);
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

  // Transfer the player from the seller into the buyer's reserves (also strips
  // it from the seller's squad lists and clears listing flags).
  transfer.transferPlayer(player.id, listing.sellerId, sender);

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
  // ── Squad listing: put every player you own on the market at once ──
  if ((args[0] || '').toLowerCase() === 'squad') {
    const price = parseInt(args[1], 10);
    const players = Player.getSquadPlayers(sender);
    if (!players.length) {
      await sendText(sock, jid, `❌ You have no players to list. Build a squad with *!start* first!`, msg);
      return;
    }
    let listed = 0;
    for (const p of players) {
      if (p.isListed) continue;
      const mv = Player.marketValue(p);
      const listPrice = price > 0 ? price : mv;
      const minPrice = Math.round(mv * MARKET.MIN_PRICE_RATIO);
      if (listPrice < minPrice) continue; // skip any below the min at this flat price
      const listingId = uuid();
      db.insert(MARKET_TABLE, listingId, {
        id: listingId,
        playerId: p.id,
        sellerId: sender,
        sellerName: user.name,
        price: listPrice,
        listedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + USER_LISTING_TTL_MS).toISOString(),
        sold: false,
      });
      Player.update(p.id, { isListed: true, marketPrice: listPrice });
      listed++;
    }
    if (!listed) {
      await sendText(sock, jid, `ℹ️ Nothing new listed — your players are already on the market or fall below the minimum price.`, msg);
      return;
    }
    await sendText(sock, jid, `📋 *SQUAD LISTED ON MARKET!*
━━━━━━━━━━━━━━━━━━━━━━━
${listed} player(s) put up for sale.
⏳ Each expires in *${USER_LISTING_TTL_MS / 60000} min* — if unsold, the house buys them at market value.
💡 Buyers use *!market* + *!buy [id]*`, msg);
    return;
  }

  // ── Single player listing ──
  const playerId = args[0];
  const price = parseInt(args[1]);

  if (!playerId || !price || price <= 0) {
    await sendText(sock, jid, `⚠️ Usage:\n*!list [playerID] [price]* — sell one player\n*!list squad [price?]* — sell your whole squad\n\nGet player IDs from *!squad*`, msg);
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

  // Create listing (user listings expire in 10 minutes)
  const listingId = uuid();
  db.insert(MARKET_TABLE, listingId, {
    id: listingId,
    playerId: player.id,
    sellerId: sender,
    sellerName: user.name,
    price,
    listedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + USER_LISTING_TTL_MS).toISOString(),
    sold: false,
  });

  Player.update(player.id, { isListed: true, marketPrice: price });

  await sendText(sock, jid, `📋 *PLAYER LISTED ON MARKET!*
━━━━━━━━━━━━━━━━━━━━━━━
${emoji} *${Player.displayName(player)}*
📊 Market Value: ${money(marketVal)}
🏷️ Listed at: ${money(price)}
⏳ Expires in *${USER_LISTING_TTL_MS / 60000} min* (house buys at market value if unsold)

Other managers can now buy them via *!market*!
━━━━━━━━━━━━━━━━━━━━━━━`, msg);
}

module.exports = { handle };