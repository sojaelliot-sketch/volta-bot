// models/transfer.js
// Shared ownership-transfer logic for players moving between managers' squads.
// Used by the auction, the transfer market (buy / expiry house-buyout) and the
// !dash gift command. Centralising it guarantees a player is always removed
// from the seller's squad lists AND dropped into the buyer's reserves in one
// place, so we never end up with a player owned by two people at once.
const User = require('./User');
const Player = require('./Player');

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
  if (fromOwnerId && fromOwnerId !== toOwnerId) removeFromSquads(fromOwnerId, playerId);
  if (toOwnerId && toOwnerId !== HOUSE) addToReserves(toOwnerId, playerId);
  Player.update(playerId, {
    ownerId: toOwnerId,
    isAI: toOwnerId === HOUSE,
    isListed: false,
    marketPrice: 0,
  });
}

module.exports = { HOUSE, removeFromSquads, addToReserves, transferPlayer };
