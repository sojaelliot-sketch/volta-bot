// utils/cardRenderer.js
// Renders a FUT-style player card as a PNG Buffer using node-canvas.
// Uses the Player model's derived helpers so it stays in sync with game math.
const { createCanvas } = require('canvas');
const Player = require('../models/Player');
const { RARITY } = require('../config/constants');

// Card geometry
const W = 640;
const H = 896;

// Per-rarity palette (frame + accent + glow colors)
const PALETTES = {
  Common:    { bg: '#1b1d22', frame: '#9aa0a6', accent: '#cfd3d8', glow: '#5b6068' },
  Rare:      { bg: '#10243f', frame: '#3b82f6', accent: '#7db4ff', glow: '#1d4ed8' },
  Elite:     { bg: '#2a1640', frame: '#a855f7', accent: '#d8a6ff', glow: '#7c3aed' },
  Legendary: { bg: '#3a2e07', frame: '#facc15', accent: '#ffe57a', glow: '#eab308' },
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Public helper: overall rating of a player (sum of stats)
function overallRating(player) {
  return Player.totalStats(player);
}

function statRows(player) {
  const s = player.stats || {};
  return player.role === 'goalkeeper'
    ? [
        ['REF', s.reflex], ['POS', s.positioning], ['ANT', s.anticipation],
        ['STR', s.strength], ['COM', s.composure],
      ]
    : [
        ['PAC', s.pace], ['SKL', s.skill], ['SHO', s.shooting],
        ['STA', s.stamina], ['COM', s.composure],
      ];
}

function renderPlayerCard(player) {
  const palette = PALETTES[player.rarity] || PALETTES.Common;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // ── Background ────────────────────────────────────────────────
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0c0d10');
  bg.addColorStop(1, palette.bg);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // subtle glow
  const glow = ctx.createRadialGradient(W / 2, 360, 40, W / 2, 360, 360);
  glow.addColorStop(0, palette.glow + '55');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // ── Outer frame ──────────────────────────────────────────────
  ctx.lineWidth = 10;
  ctx.strokeStyle = palette.frame;
  roundRect(ctx, 14, 14, W - 28, H - 28, 28);
  ctx.stroke();

  // ── Top bar: club-style brand + rating ───────────────────────
  ctx.fillStyle = palette.frame;
  roundRect(ctx, 30, 30, W - 60, 90, 16);
  ctx.fill();

  ctx.fillStyle = '#0c0d10';
  ctx.font = 'bold 30px Arial';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('VOLTA', 52, 75);

  // OVR badge
  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.arc(W - 78, 75, 42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0c0d10';
  ctx.font = 'bold 44px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(String(overallRating(player)), W - 78, 78);

  // ── Player silhouette area ───────────────────────────────────
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, 40, 140, W - 80, 360, 20);
  ctx.fill();

  ctx.fillStyle = palette.accent;
  ctx.textAlign = 'center';
  ctx.font = '260px Arial';
  ctx.textBaseline = 'middle';
  ctx.fillText(player.role === 'goalkeeper' ? '🧤' : '⚽', W / 2, 320);

  // rarity emoji + form
  ctx.font = '52px Arial';
  ctx.fillText(RARITY[player.rarity]?.emoji || '⚪', W / 2, 470);

  // ── Name block ───────────────────────────────────────────────
  ctx.fillStyle = palette.accent;
  ctx.font = 'bold 40px Arial';
  ctx.textBaseline = 'alphabetic';
  const name = Player.displayName(player);
  const nameLines = wrapText(ctx, name, W - 120);
  let ny = 560;
  for (const line of nameLines) {
    ctx.fillText(line, W / 2, ny);
    ny += 46;
  }

  ctx.fillStyle = '#cfd3d8';
  ctx.font = '24px Arial';
  ctx.fillText(
    `${player.role === 'goalkeeper' ? 'Goalkeeper' : 'Outfield'} · ${player.rarity} · Lv.${player.level}`,
    W / 2,
    ny + 6
  );
  ctx.fillText(`${player.age} yrs · ${player.nationality} 🌍`, W / 2, ny + 38);

  // ── Stats panel ──────────────────────────────────────────────
  const rows = statRows(player);
  const panelY = ny + 70;
  const rowH = 56;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  roundRect(ctx, 40, panelY, W - 80, rows.length * rowH + 20, 16);
  ctx.fill();

  rows.forEach(([label, val], i) => {
    const ry = panelY + 14 + i * rowH;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#cfd3d8';
    ctx.font = 'bold 28px Arial';
    ctx.fillText(label, 64, ry + 34);

    // bar
    const barX = 160, barW = W - 280, barH = 18;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(ctx, barX, ry + 18, barW, barH, 9);
    ctx.fill();
    ctx.fillStyle = palette.frame;
    const fillW = Math.max(8, (Math.min(99, val) / 99) * barW);
    roundRect(ctx, barX, ry + 18, fillW, barH, 9);
    ctx.fill();

    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px Arial';
    ctx.fillText(String(val), W - 64, ry + 34);
  });

  // ── Footer ───────────────────────────────────────────────────
  const footY = panelY + rows.length * rowH + 36;
  ctx.textAlign = 'center';
  ctx.fillStyle = palette.accent;
  ctx.font = 'bold 26px Arial';
  ctx.fillText(`💰 ${Player.marketValue(player)}  ·  ⚽ ${player.goals}G  🌟 ${player.manOfTheMatch}MOTM`, W / 2, footY);
  ctx.fillStyle = '#9aa0a6';
  ctx.font = '20px Arial';
  ctx.fillText(`ID ${String(player.id).slice(0, 6)}  ·  MΞTΛ • WORKS`, W / 2, footY + 32);

  return canvas.toBuffer('image/png');
}

module.exports = { renderPlayerCard, overallRating };
