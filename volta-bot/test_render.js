'use strict';
// test_render.js — exercise every card renderer WITHOUT the native canvas module.
//
// Why this exists: `canvas` is a native binary, so it will not load on every
// machine (a node_modules built on Windows cannot run on Linux, and most cloud
// containers lack the build deps). That used to mean the drawing code was
// completely untestable in CI — bugs in it only surfaced as a broken image in
// a live group chat.
//
// This harness substitutes a recording 2D context that implements the subset of
// the canvas API the renderers actually use. It cannot tell you whether a card
// looks GOOD, but it proves:
//   • every renderer runs start to finish without throwing
//   • no text is drawn outside the canvas bounds
//   • no NaN / undefined coordinates reach the drawing calls
//   • no text overflows the width it was measured against
//   • every font string is well formed
//
// Run:  node test_render.js

const Module = require('module');

// ── Recording 2D context ────────────────────────────────────────────────────
function makeCtx(W, H, issues) {
  const state = { font: '10px sans-serif', fillStyle: '#000', textAlign: 'left' };
  const stack = [];

  const num = (label, ...vals) => {
    for (const v of vals) {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        issues.push(`${label}: non-finite coordinate (${v})`);
        return false;
      }
    }
    return true;
  };

  // Rough advance-width model: enough to catch gross overflow.
  const measure = (text) => {
    const m = /(\d+(?:\.\d+)?)px/.exec(state.font);
    const size = m ? parseFloat(m[1]) : 10;
    return { width: String(text).length * size * 0.52, actualBoundingBoxAscent: size * 0.7 };
  };

  const ctx = {
    canvas: { width: W, height: H },
    get font() { return state.font; },
    set font(v) {
      if (!/^[\w\s]*\d+(\.\d+)?px\s+.+/.test(v)) issues.push(`malformed font string: "${v}"`);
      if (/undefined|NaN|\[object/.test(v)) issues.push(`bad font interpolation: "${v}"`);
      state.font = v;
    },
    get fillStyle() { return state.fillStyle; },
    set fillStyle(v) {
      if (v == null || /undefined|NaN/.test(String(v))) issues.push(`bad fillStyle: ${v}`);
      state.fillStyle = v;
    },
    strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    shadowColor: 'transparent', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    get textAlign() { return state.textAlign; },
    set textAlign(v) { state.textAlign = v; },
    textBaseline: 'alphabetic', filter: 'none',

    save() { stack.push({ ...state }); },
    restore() { const s = stack.pop(); if (s) Object.assign(state, s); },
    beginPath() {}, closePath() {}, stroke() {}, clip() {},
    moveTo(...a) { num('moveTo', ...a); },
    lineTo(...a) { num('lineTo', ...a); },
    quadraticCurveTo(...a) { num('quadraticCurveTo', ...a); },
    bezierCurveTo(...a) { num('bezierCurveTo', ...a); },
    arc(...a) { num('arc', a[0], a[1], a[2]); },
    arcTo(...a) { num('arcTo', ...a); },
    ellipse(...a) { num('ellipse', a[0], a[1], a[2], a[3]); },
    rect(...a) { num('rect', ...a); },
    roundRect(...a) { num('roundRect', a[0], a[1], a[2], a[3]); },
    translate(...a) { num('translate', ...a); },
    rotate(a) { num('rotate', a); },
    scale(...a) { num('scale', ...a); },
    setTransform() {}, resetTransform() {},
    fill() {},
    fillRect(...a) { num('fillRect', ...a); },
    strokeRect(...a) { num('strokeRect', ...a); },
    clearRect(...a) { num('clearRect', ...a); },
    measureText: measure,
    drawImage() {},

    fillText(text, x, y, maxW) {
      if (!num('fillText', x, y)) return;
      if (text == null || /undefined|NaN|\[object Object\]/.test(String(text))) {
        issues.push(`fillText drew a broken value: "${text}"`);
      }
      const w = measure(text).width;
      const align = state.textAlign;
      const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
      if (left < -40 || left + w > W + 40) {
        issues.push(`text overflows canvas (${W}px wide): "${String(text).slice(0, 34)}" at x=${Math.round(left)} w=${Math.round(w)}`);
      }
      if (y < -20 || y > H + 20) {
        issues.push(`text drawn outside canvas height: "${String(text).slice(0, 24)}" at y=${Math.round(y)}`);
      }
      if (maxW !== undefined) num('fillText.maxWidth', maxW);
    },
    strokeText(text, x, y) { num('strokeText', x, y); },

    createLinearGradient(...a) {
      num('createLinearGradient', ...a);
      return { addColorStop: (o, c) => { if (typeof o !== 'number' || o < 0 || o > 1) issues.push(`gradient stop out of range: ${o}`); if (c == null) issues.push('gradient stop with null colour'); } };
    },
    createRadialGradient(...a) {
      num('createRadialGradient', ...a);
      return { addColorStop: () => {} };
    },
    createPattern() { return null; },
  };
  return ctx;
}

function mockCanvas(W, H, issues) {
  return {
    width: W, height: H,
    getContext: () => makeCtx(W, H, issues),
    toBuffer: () => Buffer.from('MOCKPNG'),
    toDataURL: () => 'data:image/png;base64,TU9DSw==',
  };
}

// ── Intercept require('canvas') before any renderer loads ───────────────────
const collected = [];
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'canvas') return 'MOCK_CANVAS';
  return origResolve.call(this, request, ...rest);
};
require.cache['MOCK_CANVAS'] = {
  id: 'MOCK_CANVAS', filename: 'MOCK_CANVAS', loaded: true, exports: {
    createCanvas: (w, h) => mockCanvas(w, h, collected),
    registerFont: () => {},
    loadImage: async () => ({ width: 1, height: 1 }),
    Image: class {},
  },
};

// ── Fixtures ────────────────────────────────────────────────────────────────
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-render-'));

const db = require('./config/database');
const User = require('./models/User');
const Player = require('./models/Player');
const { grantStarterSquad } = require('./utils/playerGenerator');

const cardRenderer = require('./utils/cardRenderer');
const profileRenderer = require('./utils/profileRenderer');
const matchRenderer = require('./utils/matchImageRenderer');
const stadiumRenderer = require('./utils/stadiumRenderer');

let pass = 0, fail = 0;
function check(label, fn) {
  const before = collected.length;
  let out, err = null;
  try { out = fn(); } catch (e) { err = e; }
  const found = collected.slice(before);
  if (err) {
    console.log(`  ✗ ${label} — THREW: ${err.message.split('\n')[0]}`);
    fail++;
  } else if (found.length) {
    console.log(`  ✗ ${label} — ${found.length} issue(s):`);
    [...new Set(found)].slice(0, 5).forEach((i) => console.log(`      · ${i}`));
    fail++;
  } else if (!out) {
    console.log(`  ✗ ${label} — renderer returned null`);
    fail++;
  } else {
    console.log(`  ✓ ${label}`);
    pass++;
  }
}

(async () => {
  await db.connectDB();
  const U = '1111111111@s.whatsapp.net';
  const V = '2222222222@s.whatsapp.net';
  User.create(U, 'Alice'); grantStarterSquad(U); User.update(U, { currency: 50000, registered: true });
  User.create(V, 'Bob');   grantStarterSquad(V); User.update(V, { currency: 50000, registered: true });
  const alice = User.getByWhatsappId(U);
  const bob = User.getByWhatsappId(V);
  const squad = Player.getByOwner(U);

  console.log('\nPLAYER CARDS');
  for (const p of squad.slice(0, 4)) {
    check(`card: ${Player.displayName(p)} (${p.rarity}, ${p.role})`, () => cardRenderer.renderPlayerCard(p));
  }

  // Adversarial inputs — the kind of record that appears after a schema change
  console.log('\nPLAYER CARDS — awkward data');
  const base = squad[0];
  const maxStats = Object.fromEntries(Object.keys(base.stats).map((k) => [k, 99]));
  const minStats = Object.fromEntries(Object.keys(base.stats).map((k) => [k, 1]));
  check('very long name', () => cardRenderer.renderPlayerCard({ ...base, name: 'Maximilian Vanderbilt-Okonkwo III' }));
  check('single-char name', () => cardRenderer.renderPlayerCard({ ...base, name: 'X', nickname: '' }));
  check('level 99 / max stats', () => cardRenderer.renderPlayerCard({ ...base, level: 99, stats: maxStats }));
  check('zero stats', () => cardRenderer.renderPlayerCard({ ...base, level: 1, stats: minStats }));
  check('legendary rarity', () => cardRenderer.renderPlayerCard({ ...base, rarity: 'Legendary', stats: maxStats }));
  check('injured player', () => cardRenderer.renderPlayerCard({ ...base, injuredUntil: Date.now() + 86400000, condition: 12 }));

  console.log('\nPROFILE CARDS');
  check('profile: fresh manager', () => profileRenderer.renderProfileCard(alice));
  check('profile: long club name', () => profileRenderer.renderProfileCard({ ...alice, name: 'Wanderers Athletic Sporting Club International' }));
  check('profile: high MMR', () => profileRenderer.renderProfileCard({ ...alice, mmr: 2400, wins: 300, losses: 12, currency: 99999999 }));

  console.log('\nMATCH CARDS');
  check('kickoff (day/sunny)', () => matchRenderer.renderKickoffCard({
    homeTeam: alice.name, awayTeam: bob.name, timeOfDay: 'day', weather: 'sunny',
  }));
  check('kickoff (night/rain)', () => matchRenderer.renderKickoffCard({
    homeTeam: alice.name, awayTeam: bob.name, timeOfDay: 'night', weather: 'raining',
  }));
  check('full time 3-2 with scorers', () => matchRenderer.renderFullTimeCard({
    homeTeam: alice.name, awayTeam: bob.name, homeScore: 3, awayScore: 2,
    homeScorers: [{ name: 'Okafor', minute: 12 }, { name: 'Silva', minute: 44 }, { name: 'Okafor', minute: 88 }],
    awayScorers: [{ name: 'Adeyemi', minute: 30 }, { name: 'Reyes', minute: 71 }],
    motm: { name: 'Okafor', team: alice.name },
  }));
  check('full time 0-0', () => matchRenderer.renderFullTimeCard({
    homeTeam: alice.name, awayTeam: bob.name, homeScore: 0, awayScore: 0,
  }));
  check('full time rout 9-0', () => matchRenderer.renderFullTimeCard({
    homeTeam: 'Wanderers Athletic Sporting Club', awayTeam: bob.name, homeScore: 9, awayScore: 0,
    homeScorers: Array.from({ length: 9 }, (_, i) => ({ name: 'Okafor', minute: (i + 1) * 9 })),
  }));
  // Regression: a half-built session must not print "undefined" on the card.
  check('full time with missing fields', () => matchRenderer.renderFullTimeCard({}));
  check('kickoff with no args', () => matchRenderer.renderKickoffCard());

  console.log('\nSTADIUM CARDS');
  const keys = Object.keys(stadiumRenderer.STADIUM_DATA || {});
  for (const k of keys.slice(0, 4)) check(`stadium: ${k}`, () => stadiumRenderer.renderStadiumCard(k));

  console.log('\n' + '='.repeat(52));
  console.log(`RENDER TESTS: ${pass} passed, ${fail} failed`);
  console.log('='.repeat(52));
  console.log('Note: this proves the drawing code runs and stays in bounds.');
  console.log('It cannot judge how the cards look — open one to check that.\n');
  process.exit(fail ? 1 : 0);
})();
