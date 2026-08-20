'use strict';

const KNOWN_STALE = [2, 3000, 1023223821];
const KNOWN_GOOD  = [2, 3000, 1042466098];

function isValid(v) {
  return Array.isArray(v) && v.length === 3 && v.every((n) => Number.isInteger(n) && n >= 0);
}

function same(a, b) {
  return isValid(a) && isValid(b) && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function parse(input) {
  if (!input) return null;
  const parts = String(input).trim().split(/[.,\s]+/).map((n) => parseInt(n, 10));
  return isValid(parts) ? parts : null;
}

async function resolveVersion(baileys, log = () => {}) {
  const override = parse(process.env.WA_VERSION);
  if (override) {
    log(`WhatsApp Web v${override.join('.')} (from WA_VERSION)`);
    return { version: override, source: 'env' };
  }

  if (typeof baileys.fetchLatestWaWebVersion === 'function') {
    try {
      const res = await baileys.fetchLatestWaWebVersion({});
      const v = res && res.version;
      if (isValid(v)) {
        log(`WhatsApp Web v${v.join('.')} (live)`);
        return { version: v, source: 'waweb' };
      }
    } catch (err) {
      log(`Could not fetch live WA Web version (${err && err.message}) — trying fallbacks.`);
    }
  }

  if (typeof baileys.fetchLatestBaileysVersion === 'function') {
    try {
      const res = await baileys.fetchLatestBaileysVersion();
      const v = res && res.version;
      if (isValid(v) && !same(v, KNOWN_STALE)) {
        log(`WhatsApp Web v${v.join('.')} (Baileys)`);
        return { version: v, source: 'baileys' };
      }
      if (same(v, KNOWN_STALE)) {
        log(`Ignoring stale version v${v.join('.')} — WhatsApp refuses connections on it.`);
      }
    } catch (err) {
      log(`Could not fetch version from Baileys (${err && err.message}).`);
    }
  }

  log(`WhatsApp Web v${KNOWN_GOOD.join('.')} (pinned fallback)`);
  return { version: KNOWN_GOOD.slice(), source: 'pinned' };
}

module.exports = { resolveVersion, parse, isValid, KNOWN_STALE, KNOWN_GOOD };
