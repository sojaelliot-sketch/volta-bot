const User = require('../models/User');
const Player = require('../models/Player');
const transfer = require('../models/transfer');
const db = require('../config/database');
const { MARKET, RARITY, ECONOMY } = require('../config/constants');
const { money, bar } = require('../utils/formatter');
const { sendText, typing } = require('../utils/messaging');
const { seedMarketPlayer } = require('../utils/playerGenerator');
const { v4: uuid } = require('uuid');

const MARKET_TABLE = 'market';
const DEMAND_TABLE = 'marketmeta';
const DEMAND_KEY = 'demand';
const DEMAND_MIN = 0.5;   // floor on the demand multiplier
const DEMAND_MAX = 3.0;   // ceiling on the demand multiplier
const LISTING_HOURS_MS = MARKET.LISTING_HOURS * 60 * 60 * 1000;
const USER_LISTING_TTL_MS = MARKET.USER_LISTING_TTL_MS;

// ─── DEMAND TRACKING ────────────────────────────────────────────────────────
// A per-player-name demand multiplier drives dynamic AI pricing: when a name
// sells quickly its price climbs (scarcity/interest), and when it sits unsold
// the multiplier decays back toward 1.0. Kept in its own table so it never
// pollutes the live market listings.
function getDemandMap() {
  const rec = db.findById(DEMAND_TABLE, DEMAND_KEY);
  return (rec && rec.map) || {};
}
function saveDemandMap(map) {
  db.update(DEMAND_TABLE, DEMAND_KEY, { map });
}
function demandFor(name) {
  const map = getDemandMap();
  return map[name] || 1.0;
}
function bumpDemand(name, delta) {
  const map = getDemandMap();
  const next = Math.max(DEMAND_MIN, Math.min(DEMAND_MAX, (map[name] || 1.0) + delta));
  map[name] = Math.round(next * 100) / 100;
  saveDemandMap(map);
  return map[name];
}
// Nudge every demand value 5% back toward 1.0 so prices settle when a name
// stops selling. Called whenever the market is (re)seeded.
function decayDemand() {
  const map = getDemandMap();
  let changed = false;
  for (const k of Object.keys(map)) {
    const v = map[k];
    const nv = v + (1.0 - v) * 0.05;
    if (Math.abs(nv - 1.0) < 0.01) { delete map[k]; }
    else { map[k] = Math.round(nv * 100) / 100; }
    changed = true;
  }
  if (changed) saveDemandMap(map);
}

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
      let player = seedMarketPlayer();
      let attempts = 0;
      while (isDuplicatePlayer(player.id, activeListings) && attempts < 20) {
        player = seedMarketPlayer();
        attempts++;
      }
      // Dynamic pricing: rarer players cost more, with a premium markup.
      // A hard rarity floor is enforced so AI listings never drop below the
      // configured minimum for each tier. A per-name demand multiplier (based
      // on recent sales) scales the price up when a name is hot.
      decayDemand();
      const baseValue = Player.marketValue(player);
      const rarityMult = { Common: 1.0, Rare: 1.3, Elite: 1.6, Legendary: 2.0 };
      const demand = demandFor(player.name);
      const mult = (rarityMult[player.rarity] || 1.0) * (0.9 + Math.random() * 0.4) * demand;
      const floor = MARKET.RARITY_FLOOR[player.rarity] || 0;
      const price = Math.max(floor, Math.round(baseValue * mult));
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
      activeListings.push({ playerId: player.id });
    }
  }
}

function isDuplicatePlayer(playerId, activeListings) {
  const newPlayer = Player.getById(playerId);
  if (!newPlayer) return false;
  const newName = newPlayer.name;
  let count = 0;
  for (const l of activeListings) {
    const p = Player.getById(l.playerId);
    if (p && p.name === newName) count++;
    if (count >= 1) return true;
  }
  return false;
}

// Remove excess duplicate listings from the market so only ONE copy of any
// player name exists (the first occurrence is kept, the rest are retired).
function cleanupDuplicates() {
  const all = db.all(MARKET_TABLE).filter(l => l.sold === false);
  const nameCount = {};
  const toRemove = [];
  for (const l of all) {
    const p = Player.getById(l.playerId);
    if (!p) continue;
    nameCount[p.name] = (nameCount[p.name] || 0) + 1;
    if (nameCount[p.name] > 1) {
      toRemove.push(l);
    }
  }
  for (const l of toRemove) {
    db.update(MARKET_TABLE, l.id, { sold: true });
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
      const moved = transfer.transferPlayer(player.id, l.sellerId, transfer.HOUSE);
      if (moved) {
        User.addCurrency(l.sellerId, payout);
        if (sock) {
        sendText(sock, l.sellerId,
          `⏰ *LISTING EXPIRED* 🏦\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `*${Player.displayName(player)}* didn't sell in 10 min.\n` +
          `The house bought it for *${money(payout)}* (market value) and it's now on the AI Market.`, undefined)
           .catch(() => {});
        }
      }
    }
    db.update(MARKET_TABLE, l.id, { sold: true });
  }
}

// Keep a handle on the live socket so the periodic ticker can notify sellers.
let botSock = null;

async function cmdMarket({ sock, msg, jid, args }) {
  processExpired(sock);
  cleanupDuplicates();
  await ensureSeedMarket();

  const allListings = db.all(MARKET_TABLE);
  const activeListings = allListings
    .filter(l => l.sold === false && !isExpired(l))
    .sort((a, b) => new Date(b.listedAt) - new Date(a.listedAt));

  const shownListings = [];
  const nameCount = {};
  for (const l of activeListings) {
    const p = Player.getById(l.playerId);
    if (!p) continue;
    nameCount[p.name] = (nameCount[p.name] || 0) + 1;
    if (nameCount[p.name] <= 1) shownListings.push(l);
  }

  if (!shownListings.length) {
    await sendText(sock, jid, `📭 *Transfer Market* — No players currently listed.\n\nAI is restocking... check back soon!`, msg);
    return;
  }

  const page = Math.max(1, parseInt(args[0]) || 1);
  const pageSize = MARKET.PAGE_SIZE;
  const totalPages = Math.ceil(shownListings.length / pageSize);
  const start = (page - 1) * pageSize;
  const pageListings = shownListings.slice(start, start + pageSize);

  let text = `🏪 *TRANSFER MARKET* — Page ${page}/${totalPages}
━━━━━━━━━━━━━━━━━━━━━━━━
📦 ${shownListings.length} players available\n\n`;

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

  // Process transfer. Do this BEFORE touching coins so a spoofed/orphaned
  // listing (sellerId does not match the player's real owner) is rejected
  // cleanly — the buyer is never charged for a player they can't receive.
  const player = Player.getById(listing.playerId);
  if (!player) {
    await sendText(sock, jid, `❌ Player not found in database.`, msg);
    return;
  }

  // Prevent buyer from owning more than one copy of the same player name
  const buyerSquad = Player.getSquadPlayers(sender);
  const sameNameCount = buyerSquad.filter(p => p.name === player.name).length;
  if (sameNameCount >= 1) {
    await sendText(sock, jid, `❌ You already own *${Player.displayName(player)}* — only 1 copy per player is allowed.`, msg);
    return;
  }

  const moved = transfer.transferPlayer(player.id, listing.sellerId, sender);
  if (!moved) {
    await sendText(sock, jid,
      `❌ *Transfer blocked.* This listing's seller no longer owns the player — the listing was invalid and has been removed. No coins were charged.`,
      msg);
    db.update(MARKET_TABLE, listing.id, { sold: true });
    return;
  }

  // Deduct from buyer
  User.update(sender, { currency: (user.currency || 0) - listing.price });

  // Credit seller with transaction tax applied (if not AI)
  const taxRate = ECONOMY.TRANSACTION_TAX || 0;
  const sellerPayout = Math.round(listing.price * (1 - taxRate));
  const taxAmount = listing.price - sellerPayout;
  if (listing.sellerId !== 'AI_MARKET') {
    const seller = User.getByWhatsappId(listing.sellerId);
    if (seller) {
      User.addCurrency(listing.sellerId, sellerPayout);
    }
  }

  // Mark listing as sold
  db.update(MARKET_TABLE, listing.id, { sold: true });

  // Demand signal: a name that just sold from the AI Market is "hot" — bump
  // its multiplier so the next seed of the same name costs more.
  if (listing.sellerId === 'AI_MARKET') {
    try { bumpDemand(player.name, 0.2); } catch {}
  }

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
      const minPrice = Math.max(Math.round(mv * MARKET.MIN_PRICE_RATIO), MARKET.RARITY_FLOOR[p.rarity] || 0);
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

  const player = Player.findByQuery(sender, playerId);
  if (!player) {
    await sendText(sock, jid, `❌ No player found with ID *${playerId}*. Use *!squad* to view your players.`, msg);
    return;
  }

  if (player.isListed) {
    await sendText(sock, jid, `❌ *${Player.displayName(player)}* is already listed on the market!`, msg);
    return;
  }

  // Check if a copy of this player is already in the market (max 1 allowed)
  const allActive = db.all(MARKET_TABLE).filter(l => l.sold === false && !isExpired(l));
  let sameCount = 0;
  for (const l of allActive) {
    const p = Player.getById(l.playerId);
    if (p && p.name === player.name) sameCount++;
  }
  if (sameCount >= 1) {
    await sendText(sock, jid, `❌ *${Player.displayName(player)}* already has a copy on the market — only 1 per player is allowed.`, msg);
    return;
  }

  // Check minimum price (max of 50% of market value OR the rarity floor)
  const marketVal = Player.marketValue(player);
  const ratioMin = Math.round(marketVal * MARKET.MIN_PRICE_RATIO);
  const floorMin = MARKET.RARITY_FLOOR[player.rarity] || 0;
  const minPrice = Math.max(ratioMin, floorMin);
  if (price < minPrice) {
    await sendText(sock, jid, `❌ Minimum listing price for *${Player.displayName(player)}* is ${money(minPrice)} (rarity floor: ${money(floorMin)}).\n\nSet a price of at least ${money(minPrice)}.`, msg);
    return;
  }

  // Listing fee
  const listingFee = (require('../config/constants').SHOP || {}).LISTING_FEE || 0;
  if (listingFee > 0 && (user.currency || 0) < listingFee) {
    await sendText(sock, jid, `❌ Listing fee is ${money(listingFee)} — you only have ${money(user.currency)}.`, msg);
    return;
  }
  if (listingFee > 0) {
    User.update(sender, { currency: (user.currency || 0) - listingFee });
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

module.exports = { handle, demandFor, bumpDemand, decayDemand, ensureSeedMarket, getDemandMap };