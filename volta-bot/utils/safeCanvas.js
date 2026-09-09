'use strict';
// utils/safeCanvas.js
//
// `canvas` is a NATIVE module. It is compiled against a specific OS and Node
// ABI, so a node_modules folder built on Windows will not load on Linux, and
// most cloud hosts (Railway, Render, Fly, plain Docker) lack the build deps
// unless you install them explicitly. When it fails it throws at REQUIRE time,
// which used to take the whole command down with a generic "something went
// wrong" — every visual command (!card, !squad, !profile, !stadium, full-time
// cards) dead, with no clue why.
//
// This module loads canvas once, defensively, and lets callers degrade to text
// instead of failing. Renderers return null when it is unavailable; the send
// helpers fall back to the caption.

let _canvas = null;
let _loaded = false;
let _error = null;

function load() {
  if (_loaded) return _canvas;
  _loaded = true;
  try {
    _canvas = require('canvas');
  } catch (err) {
    _canvas = null;
    _error = err && (err.message || String(err));
    console.warn(
      '[VOLTA] Image rendering is OFF — the "canvas" module could not load.\n' +
      `        Reason: ${_error}\n` +
      '        Cards and match graphics will be sent as text instead.\n' +
      '        To restore images:  npm rebuild canvas   (or reinstall node_modules on this machine)'
    );
  }
  return _canvas;
}

/** True when native canvas is usable in this process. */
function available() {
  load();
  return !!_canvas;
}

/** Why canvas is unavailable, or null when it loaded fine. */
function reason() {
  load();
  return _canvas ? null : _error;
}

/* ------------------------------------------------------------------ *
 * FONTS
 *
 * Every renderer asks for `sans-serif`. On Windows and macOS that resolves
 * to a real face. On a bare Linux container — which is what most cloud
 * hosts give you — there is often NO font installed at all, and canvas
 * silently draws empty boxes or nothing. Cards come out blank and the logs
 * say nothing, because no error is thrown.
 *
 * Fix: register any .ttf/.otf dropped into assets/fonts/ under the family
 * name "Volta", and expose a font stack that prefers it. If nothing is
 * found we warn once at startup so a blank card is explainable instead of
 * mysterious.
 * ------------------------------------------------------------------ */

const path = require('path');
const fs = require('fs');

let _fontsReady = false;
let _fontFamily = 'sans-serif';
let _fontCount = 0;

function ensureFonts() {
  if (_fontsReady) return _fontFamily;
  _fontsReady = true;

  const c = load();
  if (!c) return _fontFamily;

  const dir = path.join(__dirname, '..', 'assets', 'fonts');
  let files = [];
  try {
    if (fs.existsSync(dir)) {
      files = fs.readdirSync(dir).filter((f) => /\.(ttf|otf)$/i.test(f));
    }
  } catch {}

  for (const file of files) {
    // Weight is inferred from the filename so a single family can carry
    // Regular/Bold/Black without extra config:
    //   Inter-Bold.ttf -> weight 700, Inter-Black.ttf -> weight 900
    const lower = file.toLowerCase();
    const weight =
      /black|heavy/.test(lower) ? '900' :
      /extrabold|800/.test(lower) ? '800' :
      /bold/.test(lower) ? '700' :
      /semibold|600/.test(lower) ? '600' :
      /medium/.test(lower) ? '500' :
      /light/.test(lower) ? '300' : '400';
    const style = /italic|oblique/.test(lower) ? 'italic' : 'normal';
    try {
      c.registerFont(path.join(dir, file), { family: 'Volta', weight, style });
      _fontCount++;
    } catch (err) {
      console.warn(`[VOLTA] Could not register font ${file}: ${err && err.message}`);
    }
  }

  if (_fontCount > 0) {
    _fontFamily = 'Volta, sans-serif';
    console.log(`[VOLTA] Registered ${_fontCount} card font${_fontCount === 1 ? '' : 's'} from assets/fonts/`);
  } else {
    // No bundled fonts. On desktop OSes the system sans-serif is fine; on a
    // bare container it is usually missing entirely.
    const hasSystemFonts =
      process.platform !== 'linux' ||
      ['/usr/share/fonts', '/usr/local/share/fonts'].some((p) => {
        try { return fs.existsSync(p) && fs.readdirSync(p).length > 0; } catch { return false; }
      });
    if (!hasSystemFonts) {
      console.warn(
        '[VOLTA] No fonts available for card rendering — text will be blank.\n' +
        '        Either install system fonts (apt-get install fonts-dejavu-core)\n' +
        '        or drop a .ttf into assets/fonts/ and restart.'
      );
    }
  }
  return _fontFamily;
}

/** The font family string renderers should use, e.g. "Volta, sans-serif". */
function fontFamily() {
  return ensureFonts();
}

/** Build a full CSS font shorthand: font(800, 32) -> "800 32px Volta, sans-serif" */
function font(weight, sizePx) {
  return `${weight} ${sizePx}px ${ensureFonts()}`;
}

/**
 * createCanvas(w, h) — returns null instead of throwing when canvas is missing.
 * Renderers should bail out and return null so the caller can fall back.
 */
function createCanvas(...args) {
  const c = load();
  if (!c) return null;
  ensureFonts();
  return c.createCanvas(...args);
}

function registerFont(...args) {
  const c = load();
  if (!c) return false;
  try { c.registerFont(...args); return true; } catch { return false; }
}

function loadImage(...args) {
  const c = load();
  if (!c) return Promise.resolve(null);
  return c.loadImage(...args).catch(() => null);
}

/**
 * Wrap a render function so any failure inside it (missing canvas, a bad font,
 * an undefined field in a half-migrated user record) yields null rather than
 * throwing. Logs once per distinct failure so the console does not flood.
 */
const _seen = new Set();
function guard(label, fn) {
  return function guarded(...args) {
    if (!available()) return null;
    try {
      return fn.apply(this, args);
    } catch (err) {
      const key = `${label}:${err && err.message}`;
      if (!_seen.has(key)) {
        _seen.add(key);
        console.warn(`[VOLTA] Renderer "${label}" failed, falling back to text: ${err && err.message}`);
      }
      return null;
    }
  };
}

module.exports = { available, reason, createCanvas, registerFont, loadImage, guard, ensureFonts, fontFamily, font };
