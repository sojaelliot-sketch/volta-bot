// commands/redeem.js
// Redeem code system — owner/officer only
//
// !redeem set [CODE] [AMOUNT] [LIMIT]  — create code (owner/officer)
// !redeem [CODE]                       — claim code
// !redeem active                       — check active code
// !redeem clear                        — clear active code (owner/officer)
// !redeem history                      — past codes (owner/officer)

const User = require('../models/User');
const { sendText } = require('../utils/messaging');
const { BRAND } = require('../config/constants');
const db = require('../config/database');

function getActiveCode() {
  const codes = db.all('redeemcodes') || [];
  return codes.find(c => c.active && Date.now() < c.expiresAt) || null;
}

function isCodeExpired(code) {
  if (!code) return true;
  if (Date.now() >= code.expiresAt) return true;
  if (code.maxUsers > 0 && (code.redeemedBy?.length || 0) >= code.maxUsers) return true;
  return false;
}

function isOfficer(user) {
  return user?.role === 'officer' || user?.role === 'moderator';
}

async function redeemCommand({ sock, msg, jid, sender, args, user }) {
  if (!user || !user.registered) {
    await sendText(sock, jid, `⚠️ Register first with *!register [name]*`, msg);
    return;
  }

  const subcmd = (args[0] || '').toLowerCase();

  // ─── !redeem set [CODE] [AMOUNT] [LIMIT] ───
  if (subcmd === 'set') {
    if (!User.isOwner(sender) && !isOfficer(user)) {
      await sendText(sock, jid, `⛔ Only the Owner or an Officer can set redeem codes.`, msg);
      return;
    }
    const code = (args[1] || '').toUpperCase().trim();
    const amount = parseInt(args[2]);
    const maxUsers = parseInt(args[3]) || 0;

    if (!code || !amount || amount <= 0) {
      await sendText(sock, jid,
        `Usage: *!redeem set [CODE] [AMOUNT_MW] [LIMIT]*\n\n` +
        `Examples:\n` +
        `*!redeem set VOLTA 50000* → 50K MW, unlimited claims\n` +
        `*!redeem set FREE100 10000 5* → 10K MW, max 5 users\n\n` +
        `Limit defaults to unlimited. Code expires in 1 hour.`, msg);
      return;
    }

    // Deactivate any existing active codes
    const existing = db.all('redeemcodes') || [];
    for (const c of existing) {
      if (c.active) {
        db.update('redeemcodes', c.id, { active: false });
      }
    }

    const codeData = {
      id: `redeem_${Date.now()}`,
      code,
      amount,
      expiresAt: Date.now() + (60 * 60 * 1000), // 1 hour
      maxUsers: maxUsers > 0 ? maxUsers : 0,
      createdBy: sender,
      createdByName: user.name,
      redeemedBy: [],
      active: true,
      createdAt: Date.now(),
    };

    db.insert('redeemcodes', codeData.id, codeData);

    const limitText = maxUsers > 0 ? `Max ${maxUsers} users` : 'Unlimited';
    await sendText(sock, jid,
      `🎟️ *REDEEM CODE CREATED!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Code: *${code}*\n` +
      `Reward: ${(amount/1000).toFixed(0)}K MW each\n` +
      `Duration: 1 hour\n` +
      `Limit: ${limitText}\n` +
      `Created by: ${user.name}\n\n` +
      `Users claim with: *!redeem ${code}*\n${BRAND}`, msg);
    return;
  }

  // ─── !redeem active ───
  if (subcmd === 'active') {
    const active = getActiveCode();
    if (!active) {
      await sendText(sock, jid, `❌ No active redeem code right now.`, msg);
      return;
    }
    const remaining = Math.max(0, Math.ceil((active.expiresAt - Date.now()) / 60000));
    const redeemed = active.redeemedBy?.length || 0;
    const limitText = active.maxUsers > 0 ? `${redeemed}/${active.maxUsers}` : `${redeemed} (unlimited)`;
    const spotsLeft = active.maxUsers > 0 ? active.maxUsers - redeemed : '∞';
    await sendText(sock, jid,
      `🎟️ *ACTIVE REDEEM CODE*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Code: *${active.code}*\n` +
      `Reward: ${(active.amount/1000).toFixed(0)}K MW each\n` +
      `Time left: ${remaining} min\n` +
      `Claims: ${limitText}\n` +
      `Spots left: ${spotsLeft}\n${BRAND}`, msg);
    return;
  }

  // ─── !redeem clear ───
  if (subcmd === 'clear') {
    if (!User.isOwner(sender) && !isOfficer(user)) {
      await sendText(sock, jid, `⛔ Only the Owner or an Officer can clear redeem codes.`, msg);
      return;
    }
    const existing = db.all('redeemcodes') || [];
    for (const c of existing) {
      if (c.active) {
        db.update('redeemcodes', c.id, { active: false });
      }
    }
    await sendText(sock, jid, `✅ Active redeem code cleared.`, msg);
    return;
  }

  // ─── !redeem history ───
  if (subcmd === 'history') {
    if (!User.isOwner(sender) && !isOfficer(user)) {
      await sendText(sock, jid, `⛔ Only the Owner or an Officer can view redeem history.`, msg);
      return;
    }
    const codes = db.all('redeemcodes') || [];
    if (codes.length === 0) {
      await sendText(sock, jid, `📋 No redeem codes have been created yet.`, msg);
      return;
    }
    let output = `📋 *REDEEM CODE HISTORY*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    for (const c of codes.slice(-10).reverse()) {
      const expired = isCodeExpired(c);
      const status = c.active && !expired ? '🟢 Active' : '🔴 Expired';
      const redeemed = c.redeemedBy?.length || 0;
      const limit = c.maxUsers > 0 ? `/${c.maxUsers}` : '';
      output += `*${c.code}* — ${(c.amount/1000).toFixed(0)}K MW\n`;
      output += `  ${status} | ${redeemed}${limit} claimed | by ${c.createdByName}\n\n`;
    }
    output += `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`;
    await sendText(sock, jid, output, msg);
    return;
  }

  // ─── !redeem [CODE] — claim ───
  if (subcmd && subcmd !== 'set' && subcmd !== 'active' && subcmd !== 'clear' && subcmd !== 'history') {
    const active = getActiveCode();
    if (!active) {
      await sendText(sock, jid, `❌ No active redeem code right now.`, msg);
      return;
    }

    const inputCode = subcmd.toUpperCase().trim();
    if (inputCode !== active.code) {
      await sendText(sock, jid, `❌ Invalid code. Use *!redeem active* to check.`, msg);
      return;
    }

    if (active.redeemedBy?.includes(sender)) {
      await sendText(sock, jid, `❌ You already redeemed this code.`, msg);
      return;
    }

    if (Date.now() >= active.expiresAt) {
      await sendText(sock, jid, `❌ This code has expired.`, msg);
      return;
    }

    if (active.maxUsers > 0 && (active.redeemedBy?.length || 0) >= active.maxUsers) {
      await sendText(sock, jid, `❌ This code has reached its user limit.`, msg);
      return;
    }

    active.redeemedBy = active.redeemedBy || [];
    active.redeemedBy.push(sender);

    const limitReached = active.maxUsers > 0 && active.redeemedBy.length >= active.maxUsers;
    if (limitReached) {
      db.update('redeemcodes', active.id, { redeemedBy: active.redeemedBy, active: false });
    } else {
      db.update('redeemcodes', active.id, { redeemedBy: active.redeemedBy });
    }

    User.addCurrency(sender, active.amount);

    const remaining = Math.max(0, Math.ceil((active.expiresAt - Date.now()) / 60000));
    const spotsLeft = active.maxUsers > 0 ? active.maxUsers - active.redeemedBy.length : '∞';
    await sendText(sock, jid,
      `✅ *CODE REDEEMED!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Code: *${active.code}*\n` +
      `Reward: ${(active.amount/1000).toFixed(0)}K MW added to your balance!\n` +
      `New balance: ${((user.currency || 0) + active.amount).toLocaleString()} MW\n` +
      `Time left: ${remaining} min\n` +
      `Spots left: ${spotsLeft}\n` +
      (limitReached ? `\n🔒 *Code deactivated — user limit reached!*` : '') +
      `\n${BRAND}`, msg);
    return;
  }

  // ─── Default help ───
  const active = getActiveCode();
  let output = `🎟️ *REDEEM CODE*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  if (active) {
    const remaining = Math.max(0, Math.ceil((active.expiresAt - Date.now()) / 60000));
    const redeemed = active.redeemedBy?.length || 0;
    const limitText = active.maxUsers > 0 ? `${redeemed}/${active.maxUsers}` : `${redeemed} (unlimited)`;
    output += `🟢 *Active Code:* ${active.code}\n`;
    output += `💰 Reward: ${(active.amount/1000).toFixed(0)}K MW\n`;
    output += `⏱️ Time left: ${remaining} min\n`;
    output += `👥 Claims: ${limitText}\n\n`;
  } else {
    output += `❌ No active code right now.\n\n`;
  }
  output += `*Commands:*\n`;
  output += `*!redeem [CODE]* — Claim a code\n`;
  output += `*!redeem active* — Check active code\n`;
  output += `*!redeem set [CODE] [MW] [LIMIT]* — Create code (owner/officer)\n`;
  output += `*!redeem clear* — Clear active code (owner/officer)\n`;
  output += `*!redeem history* — View past codes (owner/officer)\n\n`;
  output += `📋 Code expires in 1 hour OR when user limit reached\n`;
  output += `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`;
  await sendText(sock, jid, output, msg);
}

module.exports = { handle: redeemCommand };
