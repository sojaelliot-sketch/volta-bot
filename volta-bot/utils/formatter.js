// utils/formatter.js

/** Format a number as VOLTA currency, e.g. 1234 -> "💲1,234" */
function money(amount) {
  return `💲${Number(amount || 0).toLocaleString('en-US')}`;
}

/** Render a 0-100 value as a 10-block progress bar, e.g. "▰▰▰▰▰▰▰▱▱▱ 70%" */
function bar(value, size = 10) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const filled = Math.round((pct / 100) * size);
  return `${'▰'.repeat(filled)}${'▱'.repeat(size - filled)} ${pct}%`;
}

/** Condition emoji based on percentage */
function conditionEmoji(condition) {
  if (condition >= 80) return '🟢';
  if (condition >= 50) return '🟡';
  if (condition >= 25) return '🟠';
  return '🔴';
}

/** Form emoji */
function formEmoji(form) {
  if (form === 'Hot') return '🔥';
  if (form === 'Cold') return '🥶';
  return '➖';
}

/** Normalize a raw WhatsApp jid into a clean display-friendly phone string */
function jidToPhone(jid = '') {
  return jid.split('@')[0].split(':')[0];
}

/** Pad a string to a fixed width for aligned monospace tables */
function pad(str, len) {
  str = String(str);
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

module.exports = { money, bar, conditionEmoji, formEmoji, jidToPhone, pad };
