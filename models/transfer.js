// models/transfer.js
// Shared ownership-transfer logic for players moving between managers' squads.
// Used by the auction, the transfer market (buy / expiry house-buyout) and the
// !dash gift command. Centralising it guarantees a player is always removed
// from the seller's squad lists AND dropped into the buyer's reserves in one
// place, so we never end up with a player owned by two people at once.
const User = require('./User');
const Player = require('./Player');
const logger = require('../utils/logger');

const HOUSE = 'AI_MARKET';

function removeFromSquads(ownerId, playerId) {
  if (!ownerId || ownerId === HOUSE) return;
  const u = User.getByWhatsappId(ownerId);
  if (!u) return;
  const clean = (ids) => (ids || []).filter((id) => id !== playerId);
  User.update(ownerId, {
    startingXI: clean(u.startingXI),
    bench: clean(u.bench),
    reserves: clean(u.reserves),
  });
}

function addToReserves(ownerId, playerId) {
  if (!ownerId || ownerId === HOUSE) return;
  const u = User.getByWhatsappId(ownerId);
  if (!u) return;
  User.update(ownerId, { reserves: [...(u.reserves || []), playerId] });
}

// Move a player from one owner to another: pull it out of the seller's squad
// lists, push it into the buyer's reserves, and update ownership. If fromOwner
// is the house (or null) we only add to the buyer. A player landing with the
// house is flagged isAI; anyone else gets isAI:false.
function transferPlayer(playerId, fromOwnerId, toOwnerId) {
  const player = Player.getById(playerId);
  if (!player) {
    logger.error({ playerId, fromOwnerId, toOwnerId }, 'transferPlayer BLOCKED: player not found');
    return false;
  }
  // Ownership integrity: the seller/giver must actually own the player. Without
  // this guard a listing whose sellerId was spoofed (e.g. a real manager's
  // player listed under a fake club seller) would let the buyer receive a clone
  // while the true owner keeps their copy — silently creating double ownership.
  // After a legitimate transfer the player's ownerId is updated to toOwnerId, so
  // any future transfer must again be initiated by its current owner.
  if (fromOwnerId && fromOwnerId !== toOwnerId && player.ownerId !== fromOwnerId) {
    logger.error(
      { playerId, claimedFrom: fromOwnerId, actualOwner: player.ownerId, toOwnerId },
      'transferPlayer BLOCKED: claimed seller does not own the player'
    );
    return false;
  }
  if (fromOwnerId && fromOwnerId !== toOwnerId) removeFromSquads(fromOwnerId, playerId);
  if (toOwnerId && toOwnerId !== HOUSE) addToReserves(toOwnerId, playerId);
  Player.update(playerId, {
    ownerId: toOwnerId,
    isAI: toOwnerId === HOUSE,
    isListed: false,
    marketPrice: 0,
  });
  return true;
}

module.exports = { HOUSE, removeFromSquads, addToReserves, transferPlayer };
