// commands/stadium.js
//   !stadium            — view your stadium (renders a card) + fan energy + upkeep
//   !buystadium [key]  — buy/upgrade to a stadium tier (e.g. !buystadium volta_colosseum)
//   !sellstadium       — sell your stadium, recover half the cost (back to Sunday Pitch)
//   !pk [on|off]       — toggle penalty shootouts for drawn normal PvP / !match games
const User = require('../models/User');
const { STADIUM } = require('../config/constants');
const { money } = require('../utils/formatter');
const { sendText } = require('../utils/messaging');
const stadium = require('../utils/stadium');
const logger = require('../utils/logger');

const STADIUM_KEYS = Object.keys(STADIUM.TIERS);

function sendCard(sock, jid, buf, caption, msg) {
  try {
    return sock.sendMessage(jid, { image: buf, caption }, { quoted: msg });
  } catch (err) {
    logger.error({ err }, 'stadium card render failed');
  }
}

async function cmdStadium({ sock, jid, sender, msg }) {
  const u = User.getByWhatsappId(sender);
  if (!u || !u.registered) { await sendText(sock, jid, `👋 Register first with *!start*.`, msg); return; }
  const key = stadium.resolveKey(u);
  const tier = stadium.tierOf(key);
  const energy = u.fanEnergy || 0;
  const active = stadium.isActive(u);
  try {
    const buf = require('../utils/stadiumRenderer').renderStadiumCard(key);
    await sendCard(sock, jid, buf,
      `🏟️ *${tier.name}* (Tier ${tier.tier})\n` +
      `🔋 Fan Energy: ${energy}/100 ${energy < STADIUM.LOW_ENERGY ? '⚠️ LOW' : energy >= STADIUM.FULL_ENERGY ? '✅' : ''}\n` +
      `💡 Bonuses: ${active ? 'ACTIVE' : 'DORMANT (pay upkeep!)'}\n` +
      `🛡️ Weather roof: ${tier.weatherImmune ? (stadium.blocksWeather(u) ? 'ONLINE' : 'OFFLINE (low energy)') : '—'}\n` +
      `${tier.upkeep ? `📅 Upkeep: ${money(tier.upkeep)}/wk` : ''}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n*!buystadium [key]* to upgrade · keys: ${STADIUM_KEYS.join(', ')}`, msg);
  } catch (err) {
    logger.error({ err }, 'stadium render failed');
    await sendText(sock, jid, `🏟️ *${tier.name}* — Fan Energy ${energy}/100, bonuses ${active ? 'ACTIVE' : 'DORMANT'}.`, msg);
  }
}

async function cmdBuy({ sock, jid, sender, args, msg }) {
  const u = User.getByWhatsappId(sender);
  if (!u || !u.registered) { await sendText(sock, jid, `👋 Register first with *!start*.`, msg); return; }
  const key = (args[0] || '').toLowerCase();
  if (!STADIUM.TIERS[key]) {
    await sendText(sock, jid,
      `⚠️ Usage: *!buystadium [key]*\nAvailable:\n${STADIUM_KEYS.map(k => `• ${k} — ${STADIUM.TIERS[k].name} (${money(STADIUM.TIERS[k].cost)})`).join('\n')}`, msg);
    return;
  }
  const cur = STADIUM.TIERS[key];
  const curKey = stadium.resolveKey(u);
  const curTier = STADIUM.TIERS[curKey].tier;
  if (cur.tier <= curTier && curKey !== STADIUM.DEFAULT_KEY) {
    await sendText(sock, jid, `❌ You already own *${STADIUM.TIERS[curKey].name}* (Tier ${curTier}). That's the same or higher tier.`, msg);
    return;
  }
  if ((u.currency || 0) < cur.cost) {
    await sendText(sock, jid, `❌ *${cur.name}* costs ${money(cur.cost)}. You have ${money(u.currency)}.`, msg);
    return;
  }
  // When upgrading, the player pays the difference but we keep it simple: full cost.
  // (Sunday Pitch is free, so the first purchase is the full tier cost.)
  User.update(sender, { currency: (u.currency || 0) - cur.cost, stadium: key, upkeepLastPaid: new Date().toISOString() });
  if (curKey === STADIUM.DEFAULT_KEY) {
    User.update(sender, { fanEnergy: STADIUM.ENERGY_MAX });
  }
  await sendText(sock, jid,
    `🏟️ You now own *${cur.name}* (Tier ${cur.tier})!\n` +
    `✅ Training ×${cur.trainingMult}${cur.weatherImmune ? ' · 🛡️ weather roof' : ''}\n` +
    `💡 Home bonuses scale with Fan Energy (win at home to raise it).\n` +
    `📅 Upkeep ${money(cur.upkeep)}/wk — keep it paid or bonuses go dormant.`, msg);
}

async function cmdSell({ sock, jid, sender, msg }) {
  const u = User.getByWhatsappId(sender);
  if (!u || !u.registered) { await sendText(sock, jid, `👋 Register first with *!start*.`, msg); return; }
  const curKey = stadium.resolveKey(u);
  if (curKey === STADIUM.DEFAULT_KEY) {
    await sendText(sock, jid, `❌ You don't own a stadium to sell — you're on the free Sunday Pitch.`, msg);
    return;
  }
  const refund = Math.round(STADIUM.TIERS[curKey].cost / 2);
  User.update(sender, { currency: (u.currency || 0) + refund, stadium: null, fanEnergy: STADIUM.ENERGY_MAX });
  await sendText(sock, jid, `💸 Sold *${STADIUM.TIERS[curKey].name}* — recovered ${money(refund)}. Back to Sunday Pitch.`, msg);
}

async function cmdPk({ sock, jid, sender, args, msg }) {
  const u = User.getByWhatsappId(sender);
  if (!u || !u.registered) { await sendText(sock, jid, `👋 Register first with *!start*.`, msg); return; }
  const arg = (args[0] || '').toLowerCase();
  if (arg === 'on' || arg === 'off') {
    const val = arg === 'on';
    User.update(sender, { pkEnabled: val });
    await sendText(sock, jid, val
      ? `⚽ *Penalty shootouts ON* for your normal PvP / !match games — a draw goes to PK! 🔥`
      : `🚫 *Penalty shootouts OFF* — normal matches can end in a draw.`, msg);
    return;
  }
  await sendText(sock, jid,
    `⚽ *Penalty preference:* ${u.pkEnabled ? 'ON (draws → PK)' : 'OFF (draws allowed)'}\n` +
    `Toggle with *!pk on* / *!pk off*.`, msg);
}

async function handle({ sock, jid, sender, cmd, args, msg }) {
  if (cmd === 'stadium')    return cmdStadium({ sock, jid, sender, msg });
  if (cmd === 'buystadium') return cmdBuy({ sock, jid, sender, args, msg });
  if (cmd === 'sellstadium') return cmdSell({ sock, jid, sender, msg });
  if (cmd === 'pk')         return cmdPk({ sock, jid, sender, args, msg });
}

module.exports = { handle };
