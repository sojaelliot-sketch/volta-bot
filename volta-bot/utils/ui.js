'use strict';
// utils/ui.js — the house style.
//
// Every command wrote its own layout by hand, so the bot looked like ten
// different products stitched together: some replies opened with a heavy emoji
// banner, some with none; some used ━ rules, some used ─; some shouted in caps,
// some didn't; some ended with BRAND, some forgot. The information was fine —
// it just never looked like it came from the same place.
//
// This is one small set of builders. The rules behind them:
//
//   • ONE heading per message. If everything is emphasised, nothing is.
//   • Numbers get room to breathe. A balance is the thing people came for.
//   • Say what happened before saying what it cost.
//   • Never end on a dead end — if there is an obvious next command, name it.
//   • Caps are for scorelines and headings. Not for sentences.

const { BRAND } = require('../config/constants');

const RULE = '━━━━━━━━━━━━━━━━━━━━━━━';

/** Format a currency amount consistently everywhere. */
function money(n) {
  return Number(n || 0).toLocaleString('en-US');
}

/**
 * The standard reply.
 *
 *   card({
 *     icon: '💰', title: 'Daily claimed',
 *     lead: 'Day 4 of your streak.',
 *     rows: [['Reward', '+2,400'], ['Balance', '18,900']],
 *     next: 'Come back tomorrow for more — !daily',
 *   })
 */
function card({ icon = '', title = '', lead = '', rows = [], body = [], next = '', brand = true }) {
  const out = [];
  if (title) out.push(`${icon ? icon + ' ' : ''}*${title}*`);
  out.push(RULE);
  if (lead) { out.push(lead); out.push(''); }

  if (rows.length) {
    const width = Math.max(...rows.map(([k]) => String(k).length));
    for (const [k, v] of rows) {
      if (k === null) { out.push(''); continue; }
      out.push(`${String(k).padEnd(width)}  ${v}`);
    }
  }

  if (body.length) {
    if (rows.length) out.push('');
    out.push(...body);
  }

  if (next) { out.push(''); out.push(`_${next}_`); }
  if (brand) out.push(BRAND);
  return out.join('\n');
}

/** A single headline number — balances, scores, ratings. */
function figure(label, value) {
  return `*${value}*\n_${label}_`;
}

/** Something went well. */
function good(title, lines = [], next = '') {
  return card({ icon: '✅', title, body: Array.isArray(lines) ? lines : [lines], next });
}

/**
 * Something did not work.
 *
 * A failure message should say what went wrong AND how to fix it. "Not enough
 * money" is a dead end; "Not enough money — you have 400, it costs 900. Try
 * !daily" is a next step.
 */
function problem(what, fix = '') {
  const out = [`⚠️ ${what}`];
  if (fix) { out.push(''); out.push(fix); }
  return out.join('\n');
}

/** Refused on purpose — wrong permissions, wrong place, wrong time. */
function denied(what, why = '') {
  return why ? `⛔ ${what}\n\n_${why}_` : `⛔ ${what}`;
}

/** A short list where each item has a name and a detail. */
function list(items, { numbered = true } = {}) {
  return items.map((it, i) => {
    const n = numbered ? `${String(i + 1).padStart(2)}. ` : '• ';
    const detail = it.detail ? `\n${' '.repeat(numbered ? 4 : 2)}${it.detail}` : '';
    return `${n}*${it.name}*${it.right ? `  ·  ${it.right}` : ''}${detail}`;
  }).join('\n');
}

/** A progress bar that reads clearly at small sizes. */
function bar(value, max = 100, width = 10) {
  const pct = Math.max(0, Math.min(1, (Number(value) || 0) / (max || 100)));
  const filled = Math.round(pct * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

/** Recent form, newest first. */
function form(results = []) {
  const icon = { W: '🟢', D: '🟡', L: '🔴' };
  const f = results.slice(-5).reverse();
  return f.length ? f.map((r) => icon[r] || '⚪').join('') : '—';
}

module.exports = { card, figure, good, problem, denied, list, bar, form, money, RULE };
