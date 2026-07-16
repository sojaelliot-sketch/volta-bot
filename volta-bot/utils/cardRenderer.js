// utils/cardRenderer.js
// Renders a premium, holographic FUT/FIFA-style player card as a PNG buffer.
// METAWORKS dark cyberpunk/neon aesthetic — rarity drives the entire look:
// pattern, foil shine, glow color, and aura all change per tier.
const { createCanvas } = require('canvas');
const Player = require('../models/Player');
const { RARITY } = require('../config/constants');

// Rendered at a larger native size for crisp text/lines — this is the exact
// buffer size sent to WhatsApp, no downsampling needed.
const W = 750;
const H = 1050;

// ─── RARITY IDENTITY ─────────────────────────────────────────────────────────
// Each rarity gets a full identity: colors, pattern style, aura intensity,
// and a small motif icon — this is what makes Legendary actually FEEL rare.
const PALETTES = {
  Common: {
    bgFrom: '#464c56', bgMid: '#2b2f36', bgTo: '#14161a',
    accent: '#d7dce3', accent2: '#9aa1ac',
    glow: 'rgba(215,220,227,0.35)', glowStrong: 'rgba(215,220,227,0.55)',
    ratingColor: '#f5f7fa', nameColor: '#ffffff',
    barBg: 'rgba(255,255,255,0.10)', barFill: '#c7ccd4', barFillTo: '#f0f2f5',
    pattern: 'grid', foil: 0.04, motif: '◆',
  },
  Rare: {
    bgFrom: '#123a66', bgMid: '#0a2140', bgTo: '#050e1c',
    accent: '#4db2ff', accent2: '#1e5fa8',
    glow: 'rgba(77,178,255,0.5)', glowStrong: 'rgba(77,178,255,0.8)',
    ratingColor: '#9fd8ff', nameColor: '#ffffff',
    barBg: 'rgba(77,178,255,0.12)', barFill: '#2f8fdb', barFillTo: '#7fd0ff',
    pattern: 'wave', foil: 0.08, motif: '◆',
  },
  Elite: {
    bgFrom: '#521a7a', bgMid: '#2e0a49', bgTo: '#12031f',
    accent: '#d270ff', accent2: '#8a2fc7',
    glow: 'rgba(210,112,255,0.55)', glowStrong: 'rgba(210,112,255,0.85)',
    ratingColor: '#eab8ff', nameColor: '#ffffff',
    barBg: 'rgba(210,112,255,0.14)', barFill: '#a13fe0', barFillTo: '#e2a0ff',
    pattern: 'hex', foil: 0.12, motif: '◆',
  },
  Legendary: {
    bgFrom: '#7a5410', bgMid: '#4a2f06', bgTo: '#1c1102',
    accent: '#ffcf4d', accent2: '#c98a1a',
    glow: 'rgba(255,207,77,0.6)', glowStrong: 'rgba(255,207,77,0.95)',
    ratingColor: '#fff0c2', nameColor: '#fffaf0',
    barBg: 'rgba(255,207,77,0.16)', barFill: '#e0a012', barFillTo: '#ffe58a',
    pattern: 'rays', foil: 0.22, motif: '★',
  },
};

const OUTFIELD_KEYS = [
  ['pace', 'PAC'], ['skill', 'SKL'], ['shooting', 'SHO'],
  ['stamina', 'STA'], ['composure', 'COM'],
];
const GK_KEYS = [
  ['reflex', 'REF'], ['positioning', 'POS'], ['anticipation', 'ANT'],
  ['strength', 'STR'], ['composure', 'COM'],
];

const POTENTIAL_STARS = { Low: 1, Medium: 2, High: 3, Star: 5 };

// Nigerian-focused, extendable if `nationality` ever varies
const NATION_CODES = { Nigerian: 'NG' };

// ─── GEOMETRY HELPERS ─────────────────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * The signature FUT card silhouette: rounded top, straight sides, then a
 * tapered shield-point at the bottom. This single shape is what makes the
 * card read as "a real trading card" instead of a rounded rectangle.
 */
function cardPath(ctx, margin) {
  const x0 = margin, y0 = margin;
  const x1 = W - margin, y1 = H - margin;
  const topR = 46;
  const shoulderY = y0 + (y1 - y0) * 0.72;
  const tipX = W / 2;

  ctx.beginPath();
  ctx.moveTo(x0 + topR, y0);
  ctx.lineTo(x1 - topR, y0);
  ctx.arcTo(x1, y0, x1, y0 + topR, topR);
  ctx.lineTo(x1, shoulderY);
  ctx.bezierCurveTo(x1, y1 - 150, x0 + (x1 - x0) * 0.66, y1, tipX, y1);
  ctx.bezierCurveTo(x0 + (x1 - x0) * 0.34, y1, x0, y1 - 150, x0, shoulderY);
  ctx.lineTo(x0, y0 + topR);
  ctx.arcTo(x0, y0, x0 + topR, y0, topR);
  ctx.closePath();
}

/** Deterministic pseudo-random so re-rendering the same player is stable. */
function makeRng(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

// ─── OVERALL RATING ───────────────────────────────────────────────────────────

function overallRating(player) {
  const total = Player.totalStats(player);
  const maxTotal = 99 * 5;
  const ovr = Math.round(40 + (total / maxTotal) * 59);
  return Math.max(40, Math.min(99, ovr));
}

// ─── BACKGROUND + PATTERN LAYERS ─────────────────────────────────────────────

function drawBaseGradient(ctx, palette) {
  const grad = ctx.createLinearGradient(0, 0, W * 0.3, H);
  grad.addColorStop(0, palette.bgFrom);
  grad.addColorStop(0.5, palette.bgMid);
  grad.addColorStop(1, palette.bgTo);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Radial hotspot behind where the player will sit
  const radial = ctx.createRadialGradient(W / 2, H * 0.36, 20, W / 2, H * 0.36, W * 0.75);
  radial.addColorStop(0, palette.glow);
  radial.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
}

function drawPattern(ctx, palette) {
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = palette.accent;
  ctx.fillStyle = palette.accent;

  if (palette.pattern === 'grid') {
    ctx.lineWidth = 1;
    for (let x = -H; x < W + H; x += 34) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + H, H);
      ctx.stroke();
    }
  } else if (palette.pattern === 'wave') {
    ctx.lineWidth = 1.4;
    for (let y = 0; y < H; y += 30) {
      ctx.beginPath();
      for (let x = 0; x <= W; x += 20) {
        const yy = y + Math.sin((x + y) * 0.045) * 10;
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
  } else if (palette.pattern === 'hex') {
    const hexR = 26;
    const hexW = hexR * Math.sqrt(3);
    ctx.lineWidth = 1.2;
    for (let row = 0; row * hexR * 1.5 < H + hexR; row++) {
      for (let col = 0; col * hexW < W + hexW; col++) {
        const cx = col * hexW + (row % 2 ? hexW / 2 : 0);
        const cy = row * hexR * 1.5;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i - Math.PI / 6;
          const px = cx + hexR * Math.cos(a);
          const py = cy + hexR * Math.sin(a);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
  } else if (palette.pattern === 'rays') {
    const cx = W / 2, cy = H * 0.34;
    const rayCount = 28;
    ctx.globalAlpha = 0.10;
    for (let i = 0; i < rayCount; i++) {
      const a0 = (i / rayCount) * Math.PI * 2;
      const a1 = a0 + (Math.PI * 2) / rayCount / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, W, a0, a1);
      ctx.closePath();
      ctx.fillStyle = i % 2 === 0 ? palette.accent : 'transparent';
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Scattered light particles for depth, denser + brighter on rarer cards. */
function drawParticles(ctx, palette, density) {
  const rnd = makeRng(1337);
  ctx.save();
  for (let i = 0; i < density; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = rnd() * 1.8 + 0.3;
    ctx.globalAlpha = rnd() * 0.5 + 0.15;
    ctx.fillStyle = palette.accent;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Diagonal holographic foil sweep — stronger + wider on higher rarities. */
function drawFoilSweep(ctx, palette) {
  if (palette.foil <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  const grad = ctx.createLinearGradient(0, 0, W, H * 0.7);
  grad.addColorStop(0, `rgba(255,255,255,${palette.foil})`);
  grad.addColorStop(0.25, `rgba(255,255,255,${palette.foil * 2.2})`);
  grad.addColorStop(0.32, `rgba(255,255,255,${palette.foil * 0.4})`);
  grad.addColorStop(0.55, `rgba(255,255,255,0)`);
  grad.addColorStop(0.78, `rgba(255,255,255,${palette.foil * 1.4})`);
  grad.addColorStop(1, `rgba(255,255,255,0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function drawVignette(ctx) {
  const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

// ─── FRAME / BORDER ───────────────────────────────────────────────────────────

function drawFrame(ctx, palette) {
  const margin = 16;

  // Outer glow
  ctx.save();
  cardPath(ctx, margin);
  ctx.shadowColor = palette.glowStrong;
  ctx.shadowBlur = 45;
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();

  // Bright inner rim (gives that metallic double-edge look)
  cardPath(ctx, margin + 7);
  const rimGrad = ctx.createLinearGradient(0, margin, 0, H - margin);
  rimGrad.addColorStop(0, 'rgba(255,255,255,0.55)');
  rimGrad.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  rimGrad.addColorStop(1, 'rgba(255,255,255,0.3)');
  ctx.strokeStyle = rimGrad;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// ─── TOP BLOCK: rating, position, rarity ribbon ──────────────────────────────

function drawTopBlock(ctx, player, palette, ovr) {
  const x = 68, y = 96;

  ctx.textAlign = 'left';
  ctx.save();
  ctx.shadowColor = palette.glowStrong;
  ctx.shadowBlur = 18;
  ctx.font = '800 76px sans-serif';
  ctx.fillStyle = palette.ratingColor;
  ctx.fillText(String(ovr), x, y);
  ctx.restore();

  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeText(String(ovr), x, y);

  const posLabel = player.role === 'goalkeeper' ? 'GK' : 'OUT';
  ctx.font = '800 22px sans-serif';
  ctx.fillStyle = palette.accent;
  ctx.fillText(posLabel, x + 2, y + 34);

  // Little nationality chip
  const nCode = NATION_CODES[player.nationality] || player.nationality.slice(0, 2).toUpperCase();
  const chipY = y + 56;
  roundRect(ctx, x, chipY, 46, 26, 13);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.font = '700 13px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText(nCode, x + 23, chipY + 17);

  // ── Rarity ribbon, top right ──
  const emoji = RARITY[player.rarity]?.emoji || '⚪';
  ctx.textAlign = 'right';
  const ribbonW = 210, ribbonH = 44;
  const rx = W - 60, ry = 58;
  roundRect(ctx, rx - ribbonW, ry, ribbonW, ribbonH, 22);
  const ribbonGrad = ctx.createLinearGradient(rx - ribbonW, 0, rx, 0);
  ribbonGrad.addColorStop(0, 'rgba(255,255,255,0.02)');
  ribbonGrad.addColorStop(1, palette.glow);
  ctx.fillStyle = ribbonGrad;
  ctx.fill();
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.font = '800 20px sans-serif';
  ctx.fillStyle = palette.accent;
  ctx.fillText(`${palette.motif}  ${player.rarity.toUpperCase()}  ${emoji}`, rx - 18, ry + 29);

  ctx.font = '600 12px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('𝙈𝙀𝙏𝘼𝙒𝙊𝙍𝙆𝙎™ · VOLTA', rx - 18, ry + 62);
}

// ─── PLAYER SILHOUETTE (athletic pose, not a blob) ──────────────────────────

function drawSilhouette(ctx, player, palette) {
  const cx = W / 2;
  const baseY = 470;

  // Ground shadow ellipse
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(cx, baseY + 4, 130, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Aura rings behind the player — more rings + brighter for rarer cards
  const ringCount = { Common: 1, Rare: 2, Elite: 3, Legendary: 4 }[player.rarity] || 1;
  ctx.save();
  for (let i = ringCount; i >= 1; i--) {
    ctx.beginPath();
    ctx.arc(cx, baseY - 140, 60 + i * 34, 0, Math.PI * 2);
    ctx.strokeStyle = palette.accent;
    ctx.globalAlpha = 0.10 / i;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.shadowColor = palette.glowStrong;
  ctx.shadowBlur = 50;
  const bodyGrad = ctx.createLinearGradient(0, baseY - 300, 0, baseY);
  bodyGrad.addColorStop(0, 'rgba(255,255,255,0.22)');
  bodyGrad.addColorStop(1, 'rgba(255,255,255,0.06)');
  ctx.fillStyle = bodyGrad;

  if (player.role === 'goalkeeper') {
    // GK crouch-ready stance: wider base, arms out
    ctx.beginPath();
    ctx.arc(cx, baseY - 258, 40, 0, Math.PI * 2); // head
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx - 30, baseY - 214);
    ctx.lineTo(cx - 120, baseY - 160);
    ctx.lineTo(cx - 108, baseY - 130);
    ctx.lineTo(cx - 26, baseY - 176);
    ctx.lineTo(cx - 60, baseY - 20);
    ctx.lineTo(cx - 14, baseY - 20);
    ctx.lineTo(cx, baseY - 150);
    ctx.lineTo(cx + 14, baseY - 20);
    ctx.lineTo(cx + 60, baseY - 20);
    ctx.lineTo(cx + 26, baseY - 176);
    ctx.lineTo(cx + 108, baseY - 130);
    ctx.lineTo(cx + 120, baseY - 160);
    ctx.lineTo(cx + 30, baseY - 214);
    ctx.closePath();
    ctx.fill();
  } else {
    // Striking / dynamic outfield pose: mid-stride with a raised leg
    ctx.beginPath();
    ctx.arc(cx + 4, baseY - 262, 38, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx - 26, baseY - 222);
    ctx.lineTo(cx - 70, baseY - 190);
    ctx.lineTo(cx - 60, baseY - 168);
    ctx.lineTo(cx - 18, baseY - 195);
    ctx.lineTo(cx - 34, baseY - 90);
    ctx.lineTo(cx - 44, baseY - 10);
    ctx.lineTo(cx - 14, baseY - 14);
    ctx.lineTo(cx - 6, baseY - 100);
    ctx.lineTo(cx + 16, baseY - 100);
    ctx.lineTo(cx + 60, baseY - 60);
    ctx.lineTo(cx + 96, baseY - 68);
    ctx.lineTo(cx + 70, baseY - 30);
    ctx.lineTo(cx + 22, baseY - 80);
    ctx.lineTo(cx + 30, baseY - 195);
    ctx.lineTo(cx + 66, baseY - 210);
    ctx.lineTo(cx + 78, baseY - 188);
    ctx.lineTo(cx + 34, baseY - 210);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Role icon on the chest, small glass badge
  ctx.textAlign = 'center';
  ctx.font = '700 34px sans-serif';
  ctx.fillStyle = palette.accent;
  ctx.save();
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = 14;
  ctx.fillText(player.role === 'goalkeeper' ? '🧤' : '⚽', cx, baseY - 130);
  ctx.restore();
}

// ─── NAME PLATE (ribbon shape, not a plain line) ────────────────────────────

function drawNamePlate(ctx, player, palette) {
  const name = Player.displayName(player);
  const y = 560;
  const plateW = 560, plateH = 64;
  const x = (W - plateW) / 2;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + 18, y);
  ctx.lineTo(x + plateW - 18, y);
  ctx.quadraticCurveTo(x + plateW, y, x + plateW, y + 18);
  ctx.lineTo(x + plateW, y + plateH - 18);
  ctx.quadraticCurveTo(x + plateW, y + plateH, x + plateW - 18, y + plateH);
  ctx.lineTo(x + 18, y + plateH);
  ctx.quadraticCurveTo(x, y + plateH, x, y + plateH - 18);
  ctx.lineTo(x, y + 18);
  ctx.quadraticCurveTo(x, y, x + 18, y);
  ctx.closePath();

  const plateGrad = ctx.createLinearGradient(x, y, x + plateW, y);
  plateGrad.addColorStop(0, 'rgba(255,255,255,0.02)');
  plateGrad.addColorStop(0.5, palette.glow);
  plateGrad.addColorStop(1, 'rgba(255,255,255,0.02)');
  ctx.fillStyle = plateGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, y + 6);
  ctx.lineTo(x - 20, y + plateH / 2);
  ctx.lineTo(x, y + plateH - 6);
  ctx.closePath();
  ctx.fillStyle = palette.accent2;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x + plateW, y + 6);
  ctx.lineTo(x + plateW + 20, y + plateH / 2);
  ctx.lineTo(x + plateW, y + plateH - 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.textAlign = 'center';
  let fontSize = 32;
  ctx.font = `800 ${fontSize}px sans-serif`;
  while (ctx.measureText(name).width > plateW - 50 && fontSize > 16) {
    fontSize -= 2;
    ctx.font = `800 ${fontSize}px sans-serif`;
  }
  ctx.fillStyle = palette.nameColor;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 6;
  ctx.fillText(name, W / 2, y + 32);
  ctx.restore();

  ctx.font = '600 15px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillText(`Age ${player.age} · Lv.${player.level} · ${player.potential} Potential`, W / 2, y + 54);
}

// ─── POTENTIAL STARS ──────────────────────────────────────────────────────────

function drawPotentialStars(ctx, player, palette) {
  const stars = POTENTIAL_STARS[player.potential] || 1;
  const y = 640;
  ctx.textAlign = 'center';
  ctx.font = '20px sans-serif';
  let str = '';
  for (let i = 0; i < 5; i++) str += i < stars ? '★' : '☆';
  ctx.fillStyle = palette.accent;
  ctx.save();
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = 8;
  ctx.fillText(str, W / 2, y);
  ctx.restore();
}

// ─── STATS ────────────────────────────────────────────────────────────────────

function drawStats(ctx, player, palette) {
  const keys = player.role === 'goalkeeper' ? GK_KEYS : OUTFIELD_KEYS;
  const startY = 672;
  const rowH = 48;
  const labelX = 78;
  const barX = 200;
  const barW = 400;
  const barH = 16;

  keys.forEach(([statKey, label], i) => {
    const y = startY + i * rowH;
    const value = player.stats[statKey] ?? 0;

    ctx.textAlign = 'left';
    ctx.font = '800 15px sans-serif';
    ctx.fillStyle = palette.accent;
    ctx.fillText(label, labelX, y + 12);

    roundRect(ctx, barX, y, barW, barH, barH / 2);
    ctx.fillStyle = palette.barBg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const fillW = Math.max(10, (value / 99) * barW);
    ctx.save();
    roundRect(ctx, barX, y, fillW, barH, barH / 2);
    const fillGrad = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
    fillGrad.addColorStop(0, palette.barFill);
    fillGrad.addColorStop(1, palette.barFillTo);
    ctx.fillStyle = fillGrad;
    ctx.shadowColor = palette.glowStrong;
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, barX, y, fillW, barH * 0.45, barH * 0.22);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fill();
    ctx.restore();

    ctx.textAlign = 'right';
    ctx.font = '800 17px sans-serif';
    ctx.fillStyle = palette.ratingColor;
    ctx.fillText(String(value), barX + barW + 40, y + 13);
  });
}

// ─── FOOTER: condition / form / chem + market value ─────────────────────────

function conditionColor(condition) {
  if (condition >= 80) return '#3ecf6a';
  if (condition >= 50) return '#e8c93e';
  if (condition >= 25) return '#ff9d3e';
  return '#ff4e4e';
}

function drawFooter(ctx, player, palette) {
  const y = 928;
  const badges = [
    { label: 'CONDITION', value: `${player.condition}%`, color: conditionColor(player.condition) },
    { label: 'FORM', value: player.form, color: player.form === 'Hot' ? '#ff7a3e' : player.form === 'Cold' ? '#3eb4ff' : '#c9ced6' },
    { label: 'CHEM', value: `${player.chemistry}%`, color: palette.accent },
  ];

  const slotW = 168, gap = 14;
  const totalW = slotW * 3 + gap * 2;
  const startX = (W - totalW) / 2;

  badges.forEach((b, i) => {
    const x = startX + i * (slotW + gap);
    roundRect(ctx, x, y, slotW, 70, 16);
    const grad = ctx.createLinearGradient(x, y, x, y + 70);
    grad.addColorStop(0, 'rgba(255,255,255,0.08)');
    grad.addColorStop(1, 'rgba(255,255,255,0.02)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = '700 12px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(b.label, x + slotW / 2, y + 26);

    ctx.font = '800 22px sans-serif';
    ctx.fillStyle = b.color;
    ctx.fillText(String(b.value), x + slotW / 2, y + 54);
  });

  const mvY = y + 92;
  const mvText = `${Player.marketValue(player).toLocaleString('en-US')} MARKET VALUE`;
  ctx.font = '700 16px sans-serif';
  const mvW = ctx.measureText(mvText).width + 70;
  roundRect(ctx, (W - mvW) / 2, mvY, mvW, 38, 19);
  ctx.fillStyle = palette.glow;
  ctx.fill();
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = palette.ratingColor;
  ctx.fillText(`💰 ${mvText}`, W / 2, mvY + 25);
}

// ─── MAIN RENDER ──────────────────────────────────────────────────────────────

function renderPlayerCard(player) {
  const palette = PALETTES[player.rarity] || PALETTES.Common;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const ovr = overallRating(player);

  // Everything below is clipped to the card silhouette so nothing bleeds
  // past the shield-shaped border.
  ctx.save();
  cardPath(ctx, 16);
  ctx.clip();

  drawBaseGradient(ctx, palette);
  drawPattern(ctx, palette);
  drawParticles(ctx, palette, { Common: 25, Rare: 35, Elite: 45, Legendary: 60 }[player.rarity] || 25);
  drawSilhouette(ctx, player, palette);
  drawNamePlate(ctx, player, palette);
  drawPotentialStars(ctx, player, palette);
  drawStats(ctx, player, palette);
  drawFooter(ctx, player, palette);
  drawTopBlock(ctx, player, palette, ovr);
  drawFoilSweep(ctx, palette);
  drawVignette(ctx);

  ctx.restore();

  drawFrame(ctx, palette);

  return canvas.toBuffer('image/png');
}

module.exports = { renderPlayerCard, overallRating };
