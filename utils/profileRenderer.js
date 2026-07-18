// utils/profileRenderer.js
// Renders a manager profile card as a PNG buffer. Self-contained (no imports
// beyond canvas) so it can be dropped into any project on its own.
const { createCanvas } = require('canvas');

const W = 750;
const H = 1000;

// ─── RANK TIERS ───────────────────────────────────────────────────────────────
// Mirrors config/constants.js MMR.RANKS — duplicated here so this file has zero
// project dependencies. Update thresholds/colors if your rank tiers change.
const RANK_TIERS = [
  { label: 'Bronze',   min: 0,    color: '#cd7f32', glow: 'rgba(205,127,50,0.5)' },
  { label: 'Silver',   min: 1100, color: '#c7ccd4', glow: 'rgba(199,204,212,0.5)' },
  { label: 'Gold',     min: 1300, color: '#ffd23e', glow: 'rgba(255,210,62,0.55)' },
  { label: 'Platinum', min: 1500, color: '#4de0c9', glow: 'rgba(77,224,201,0.55)' },
  { label: 'Diamond',  min: 1800, color: '#4db2ff', glow: 'rgba(77,178,255,0.6)' },
  { label: 'Legend',   min: 2100, color: '#e0a3ff', glow: 'rgba(224,163,255,0.7)' },
];

function rankForMMR(mmr) {
  let tier = RANK_TIERS[0];
  for (const t of RANK_TIERS) if (mmr >= t.min) tier = t;
  return tier;
}

function nextRankInfo(mmr) {
  const idx = RANK_TIERS.findIndex((t) => t.min > mmr);
  if (idx === -1) return null; // already at max tier
  const current = RANK_TIERS[idx - 1] || RANK_TIERS[0];
  const next = RANK_TIERS[idx];
  const progress = (mmr - current.min) / (next.min - current.min);
  return { next, progress: Math.max(0, Math.min(1, progress)) };
}

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

function makeRng(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function initials(name = '') {
  const parts = name.trim().split(/\s+/);
  if (!parts[0]) return 'MG';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ─── BACKGROUND ───────────────────────────────────────────────────────────────

function drawBackground(ctx, tier) {
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#20232a');
  grad.addColorStop(0.5, '#15171c');
  grad.addColorStop(1, '#0a0b0e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const radial = ctx.createRadialGradient(W / 2, H * 0.22, 10, W / 2, H * 0.22, W * 0.8);
  radial.addColorStop(0, tier.glow);
  radial.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  // Particles
  const rnd = makeRng(88);
  ctx.save();
  for (let i = 0; i < 45; i++) {
    const x = rnd() * W, y = rnd() * H;
    ctx.globalAlpha = rnd() * 0.4 + 0.1;
    ctx.fillStyle = tier.color;
    ctx.beginPath();
    ctx.arc(x, y, rnd() * 1.6 + 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFrame(ctx, tier) {
  const margin = 18;
  roundRect(ctx, margin, margin, W - margin * 2, H - margin * 2, 30);
  ctx.save();
  ctx.shadowColor = tier.glow;
  ctx.shadowBlur = 35;
  ctx.strokeStyle = tier.color;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  roundRect(ctx, margin + 6, margin + 6, W - (margin + 6) * 2, H - (margin + 6) * 2, 24);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ─── HEADER: avatar, name, rank ──────────────────────────────────────────────

function drawHeader(ctx, user, tier) {
  ctx.textAlign = 'center';
  ctx.font = '600 14px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('𝙈𝙀𝙏𝘼𝙒𝙊𝙍𝙆𝙎™ · VOLTA MANAGER PROFILE', W / 2, 56);

  // Avatar circle
  const cx = W / 2, cy = 172, r = 78;
  ctx.save();
  ctx.shadowColor = tier.glow;
  ctx.shadowBlur = 40;
  const avatarGrad = ctx.createRadialGradient(cx, cy, 5, cx, cy, r);
  avatarGrad.addColorStop(0, tier.color);
  avatarGrad.addColorStop(1, '#141518');
  ctx.fillStyle = avatarGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = tier.color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.font = '800 58px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 10;
  ctx.fillText(initials(user.name), cx, cy + 20);
  ctx.restore();

  // Rank badge overlapping bottom of avatar
  const badgeY = cy + r - 6;
  const badgeText = `${tier.label.toUpperCase()}`;
  ctx.font = '800 15px sans-serif';
  const badgeW = ctx.measureText(badgeText).width + 44;
  roundRect(ctx, cx - badgeW / 2, badgeY, badgeW, 30, 15);
  ctx.fillStyle = tier.color;
  ctx.fill();
  ctx.fillStyle = '#10110f';
  ctx.fillText(badgeText, cx, badgeY + 21);

  // Name
  ctx.font = '800 36px sans-serif';
  ctx.fillStyle = '#fff';
  let name = user.name || 'Manager';
  let fontSize = 36;
  ctx.font = `800 ${fontSize}px sans-serif`;
  while (ctx.measureText(name).width > W - 120 && fontSize > 20) {
    fontSize -= 2;
    ctx.font = `800 ${fontSize}px sans-serif`;
  }
  ctx.fillText(name, W / 2, 330);

  ctx.font = '500 16px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  const joined = user.createdAt ? new Date(user.createdAt) : null;
  const joinedText = joined && !isNaN(joined)
    ? `Manager since ${joined.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
    : 'VOLTA Manager';
  ctx.fillText(joinedText, W / 2, 358);
}

// ─── MMR PROGRESS BAR ────────────────────────────────────────────────────────

function drawMMRBar(ctx, user, tier) {
  const y = 396;
  const barX = 90, barW = W - 180, barH = 18;

  ctx.textAlign = 'left';
  ctx.font = '700 14px sans-serif';
  ctx.fillStyle = tier.color;
  ctx.fillText(`MMR ${user.mmr}`, barX, y - 10);

  const nextInfo = nextRankInfo(user.mmr);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '500 13px sans-serif';
  ctx.fillText(
    nextInfo ? `${nextInfo.next.label} at ${nextInfo.next.min}` : 'Max tier reached',
    barX + barW,
    y - 10
  );

  roundRect(ctx, barX, y, barW, barH, barH / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fill();

  const progress = nextInfo ? nextInfo.progress : 1;
  const fillW = Math.max(10, progress * barW);
  ctx.save();
  roundRect(ctx, barX, y, fillW, barH, barH / 2);
  const fillGrad = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
  fillGrad.addColorStop(0, tier.color);
  fillGrad.addColorStop(1, '#ffffff');
  ctx.fillStyle = fillGrad;
  ctx.shadowColor = tier.glow;
  ctx.shadowBlur = 12;
  ctx.fill();
  ctx.restore();
}

// ─── STAT GRID ────────────────────────────────────────────────────────────────

function winRate(user) {
  const total = (user.wins || 0) + (user.losses || 0) + (user.draws || 0);
  return total === 0 ? 0 : Math.round((user.wins / total) * 100);
}

function drawStatGrid(ctx, user, tier, extra) {
  const stats = [
    { label: 'WINS', value: user.wins || 0, color: '#3ecf6a' },
    { label: 'DRAWS', value: user.draws || 0, color: '#c9ced6' },
    { label: 'LOSSES', value: user.losses || 0, color: '#ff5a5a' },
    { label: 'WIN RATE', value: `${winRate(user)}%`, color: tier.color },
    { label: 'GOALS', value: user.totalGoals || 0, color: '#ffcf4d' },
    { label: 'SQUAD', value: extra.squadSize ?? (user.startingXI?.length || 0) + (user.bench?.length || 0), color: '#4db2ff' },
  ];

  const cols = 3;
  const gap = 14;
  const cellW = (W - 90 * 2 - gap * (cols - 1)) / cols;
  const cellH = 96;
  const startX = 90;
  const startY = 450;

  stats.forEach((s, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * (cellW + gap);
    const y = startY + row * (cellH + gap);

    roundRect(ctx, x, y, cellW, cellH, 16);
    const grad = ctx.createLinearGradient(x, y, x, y + cellH);
    grad.addColorStop(0, 'rgba(255,255,255,0.07)');
    grad.addColorStop(1, 'rgba(255,255,255,0.02)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = '700 13px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(s.label, x + cellW / 2, y + 30);

    ctx.font = '800 30px sans-serif';
    ctx.fillStyle = s.color;
    ctx.save();
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 10;
    ctx.fillText(String(s.value), x + cellW / 2, y + 68);
    ctx.restore();
  });
}

// ─── FOOTER: currency + streak ───────────────────────────────────────────────

function drawFooter(ctx, user, tier) {
  const y = 830;
  const pills = [
    { icon: '💰', text: `${(user.currency || 0).toLocaleString('en-US')} Balance` },
    { icon: '🔥', text: `${user.dailyStreak || 0} Day Streak` },
  ];

  const pillH = 48;
  const gap = 16;
  ctx.font = '700 17px sans-serif';
  const widths = pills.map((p) => ctx.measureText(`${p.icon} ${p.text}`).width + 46);
  const totalW = widths.reduce((a, b) => a + b, 0) + gap;
  let x = (W - totalW) / 2;

  pills.forEach((p, i) => {
    const w = widths[i];
    roundRect(ctx, x, y, w, pillH, 24);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.strokeStyle = tier.glow;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText(`${p.icon} ${p.text}`, x + w / 2, y + 31);

    x += w + gap;
  });

  ctx.textAlign = 'center';
  ctx.font = '500 13px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('⚽ Build your squad on VOLTA — WhatsApp 5-a-side simulation', W / 2, H - 40);
}

// ─── MAIN RENDER ──────────────────────────────────────────────────────────────

/**
 * Render a manager's profile card.
 * @param {object} user - a User model doc (name, mmr, wins, losses, draws, totalGoals,
 *   currency, dailyStreak, createdAt, startingXI, bench)
 * @param {object} [extra] - optional overrides, e.g. { squadSize: 7 }
 */
function renderProfileCard(user, extra = {}) {
  const tier = rankForMMR(user.mmr || 0);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.save();
  roundRect(ctx, 18, 18, W - 36, H - 36, 30);
  ctx.clip();

  drawBackground(ctx, tier);
  drawHeader(ctx, user, tier);
  drawMMRBar(ctx, user, tier);
  drawStatGrid(ctx, user, tier, extra);
  drawFooter(ctx, user, tier);

  ctx.restore();

  drawFrame(ctx, tier);

  return canvas.toBuffer('image/png');
}

module.exports = { renderProfileCard, rankForMMR };
