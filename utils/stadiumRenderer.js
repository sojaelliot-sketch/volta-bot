// utils/stadiumRenderer.js
// Renders a stadium ownership card as a PNG buffer.
// CATCHES (mechanical reasons to own & maintain):
//
// 1. TRAINING EFFECTIVENESS
//    Training a player at your stadium multiplies stat gains.
//    Sunday Pitch: ×1.0  |  Local Ground: ×1.15  |  City Arena: ×1.35
//    VOLTA Colosseum: ×1.65  |  Legends' Dome: ×2.0
//    Implementation: In training command, if user owns a stadium and trains there,
//    apply the multiplier to the stat gain roll.
//
// 2. MATCH HOME ADVANTAGE (Fan Energy system)
//    When you're HOME team, your stadium gives bonuses scaled by Fan Energy (0-100).
//    - Momentum boost: +3 to +15 (scales with tier + energy)
//    - Condition regen: +2-5 per match (higher tier stadiums auto-heal squad post-match)
//    - Currency bonus: +10% to +30% match rewards (at full energy + elite stadium)
//    Fan Energy rises on home wins (+12), drops on home losses (-10), decays if inactive.
//    Implementation: In match engine, before resolving home team actions, check if
//    home manager owns a stadium, pull fan energy, apply scaled bonuses.
//
// 3. WEATHER IMMUNITY
//    Elite stadiums (tier 3+) have retractable roofs. Rain/harsh weather has ZERO
//    effect on match outcomes (normally rain reduces pace, affects ball control).
//    Catches: Only works at home. Only works if upkeep is paid. Can be lost if
//    fan energy drops below 40 (roof is "broken" until energy recovered).
//    Implementation: In match engine, check stadium tier and weather; if tier >= 3
//    and weather is 'raining' and fan_energy >= 40, ignore weather stat penalties.
//
// 4. WEEKLY UPKEEP (the cost)
//    Every 7 days, currency is deducted. If unpaid for 2 grace days, bonuses pause
//    (not lost—just dormant). Forces engagement: must log in weekly to maintain.
//    Implementation: Cron job or login-check that runs User.stadiumUpkeep(userId).
//    If unpaid, set stadium.bonusesActive = false until currency restored.
//
// This file renders the card. The actual mechanic implementation happens in the
// match engine, training command, and a weekly upkeep job.

const { createCanvas } = require('canvas');

const W = 750;
const H = 1050;

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

// STADIUM TIER CONFIG — must match config/constants.js STADIUM.TIERS
const STADIUM_DATA = {
  sunday_pitch: {
    name: 'Sunday Pitch', tier: 0, cost: 0, capacity: 200,
    upkeep: 0, momentumBonus: 0, conditionRegenBonus: 0,
    currencyBonus: 0, weatherImmune: false,
    color: '#6b7280', emoji: '🏟️',
    desc: 'Local patch of grass. No bonuses.',
  },
  local_ground: {
    name: 'Local Ground', tier: 1, cost: 800, capacity: 1500,
    upkeep: 40, momentumBonus: 0.03, conditionRegenBonus: 0.05,
    currencyBonus: 0.05, weatherImmune: false,
    color: '#8a9a5b', emoji: '🥅',
    desc: 'Small community ground. Training +15%, home bonus starts here.',
  },
  city_arena: {
    name: 'City Arena', tier: 2, cost: 2500, capacity: 8000,
    upkeep: 110, momentumBonus: 0.06, conditionRegenBonus: 0.10,
    currencyBonus: 0.10, weatherImmune: false,
    color: '#3ea8ff', emoji: '🏟️',
    desc: 'Mid-tier arena. Training +35%, home bonus improved.',
  },
  volta_colosseum: {
    name: 'VOLTA Colosseum', tier: 3, cost: 6000, capacity: 30000,
    upkeep: 260, momentumBonus: 0.10, conditionRegenBonus: 0.15,
    currencyBonus: 0.20, weatherImmune: true,
    color: '#c452ff', emoji: '🏛️',
    desc: 'Elite. Training +65%, weather-immune roof, strong home bonus.',
  },
  legends_dome: {
    name: "Legends' Dome", tier: 4, cost: 15000, capacity: 60000,
    upkeep: 550, momentumBonus: 0.15, conditionRegenBonus: 0.20,
    currencyBonus: 0.30, weatherImmune: true,
    color: '#ffcf4d', emoji: '👑',
    desc: 'Legendary. Training ×2.0, best home bonuses, prestige.',
  },
};

function drawBackground(ctx, stadiumKey) {
  const stadium = STADIUM_DATA[stadiumKey];
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#20232a');
  grad.addColorStop(0.5, '#15171c');
  grad.addColorStop(1, '#0a0b0e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const radial = ctx.createRadialGradient(W / 2, H * 0.28, 10, W / 2, H * 0.28, W * 0.8);
  radial.addColorStop(0, stadium.color + '80');
  radial.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  // Particles
  const rnd = makeRng(77);
  for (let i = 0; i < 50; i++) {
    const x = rnd() * W, y = rnd() * H;
    ctx.globalAlpha = rnd() * 0.5 + 0.15;
    ctx.fillStyle = stadium.color;
    ctx.beginPath();
    ctx.arc(x, y, rnd() * 1.8 + 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawFrame(ctx, stadium) {
  const margin = 18;
  roundRect(ctx, margin, margin, W - margin * 2, H - margin * 2, 30);
  ctx.save();
  ctx.shadowColor = stadium.color + 'cc';
  ctx.shadowBlur = 40;
  ctx.strokeStyle = stadium.color;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.restore();

  roundRect(ctx, margin + 6, margin + 6, W - (margin + 6) * 2, H - (margin + 6) * 2, 24);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawHeader(ctx, stadium) {
  ctx.textAlign = 'center';
  ctx.font = '600 14px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillText('𝙈𝙀𝙏𝘼𝙒𝙊𝙍𝙆𝙎™ · VOLTA STADIUM', W / 2, 56);

  // Big stadium icon
  const iconSize = 120;
  ctx.textAlign = 'center';
  ctx.font = `${iconSize}px sans-serif`;
  ctx.fillText(stadium.emoji, W / 2, 180);

  // Glow circle behind icon
  const cx = W / 2, cy = 115, r = 68;
  const iconGrad = ctx.createRadialGradient(cx, cy, 5, cx, cy, r);
  iconGrad.addColorStop(0, stadium.color + '40');
  iconGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = iconGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Stadium name
  ctx.font = '800 42px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText(stadium.name, W / 2, 260);

  // Tier badge
  const tierNames = ['', 'I', 'II', 'III', 'IV'];
  const tierLabel = `Tier ${tierNames[stadium.tier]}`;
  ctx.font = '700 18px sans-serif';
  ctx.fillStyle = stadium.color;
  ctx.fillText(tierLabel, W / 2, 288);
}

function drawCapacity(ctx, stadium) {
  ctx.textAlign = 'left';
  ctx.font = '600 15px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('CAPACITY', 78, 320);

  ctx.font = '800 32px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText(`${stadium.capacity.toLocaleString()}`, 78, 360);

  ctx.font = '500 14px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('spectators', 78, 378);
}

function drawBonusMeter(ctx, stadium, labelX, labelY, meterY, icon, label, value) {
  ctx.textAlign = 'left';
  ctx.font = '600 14px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(`${icon} ${label}`, labelX, labelY);

  const barX = labelX, barW = 500, barH = 16;
  const pct = Math.max(0, Math.min(100, value * 100));

  roundRect(ctx, barX, meterY, barW, barH, barH / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fill();

  const fillW = Math.max(8, (pct / 100) * barW);
  ctx.save();
  roundRect(ctx, barX, meterY, fillW, barH, barH / 2);
  const fillGrad = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
  fillGrad.addColorStop(0, stadium.color);
  fillGrad.addColorStop(1, '#ffffff');
  ctx.fillStyle = fillGrad;
  ctx.shadowColor = stadium.color + '99';
  ctx.shadowBlur = 14;
  ctx.fill();
  ctx.restore();

  ctx.textAlign = 'right';
  ctx.font = '700 14px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText(`+${(value * 100).toFixed(0)}%`, barX + barW + 20, meterY + 12);
}

function drawBonuses(ctx, stadium) {
  let y = 400;

  if (stadium.momentumBonus > 0) {
    drawBonusMeter(ctx, stadium, 78, y - 4, y + 6, '🔥', 'Match Momentum', stadium.momentumBonus);
    y += 44;
  }

  if (stadium.conditionRegenBonus > 0) {
    drawBonusMeter(ctx, stadium, 78, y - 4, y + 6, '💚', 'Condition Regen', stadium.conditionRegenBonus);
    y += 44;
  }

  if (stadium.currencyBonus > 0) {
    drawBonusMeter(ctx, stadium, 78, y - 4, y + 6, '💰', 'Match Rewards', stadium.currencyBonus);
    y += 44;
  }

  // Weather immunity badge
  if (stadium.weatherImmune) {
    ctx.textAlign = 'left';
    ctx.font = '600 14px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('🛡️ Weather Shield', 78, y - 4);

    ctx.font = '500 13px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('Retractable roof. Rain has no effect on home matches.', 78, y + 16);
    y += 50;
  }

  return y;
}

function drawCosts(ctx, stadium) {
  const y = 750;

  // Purchase cost
  if (stadium.cost > 0) {
    ctx.textAlign = 'left';
    ctx.font = '600 15px sans-serif';
    ctx.fillStyle = '#ffcf4d';
    ctx.fillText('💳 PURCHASE COST', 78, y);

    ctx.font = '800 28px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(`💲${stadium.cost.toLocaleString()}`, 78, y + 38);
  } else {
    ctx.font = '600 15px sans-serif';
    ctx.fillStyle = '#3ecf6a';
    ctx.fillText('✅ DEFAULT GROUND', 78, y);
  }

  // Upkeep cost
  if (stadium.upkeep > 0) {
    ctx.textAlign = 'right';
    ctx.font = '600 15px sans-serif';
    ctx.fillStyle = '#ff5a5a';
    ctx.fillText('📅 WEEKLY UPKEEP', W - 78, y);

    ctx.font = '800 28px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(`💲${stadium.upkeep.toLocaleString()}`, W - 78, y + 38);
  }
}

function drawDescription(ctx, stadium) {
  const y = 880;
  ctx.textAlign = 'center';
  ctx.font = '500 16px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';

  const words = stadium.desc.split(' ');
  let line = '';
  const maxW = W - 140;
  const lines = [];

  for (const word of words) {
    const testLine = line + (line ? ' ' : '') + word;
    if (ctx.measureText(testLine).width > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }
  if (line) lines.push(line);

  lines.forEach((l, i) => {
    ctx.fillText(l, W / 2, y + i * 24);
  });
}

function drawFooter(ctx) {
  ctx.textAlign = 'center';
  ctx.font = '500 13px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('⚽ Stadiums unlock training bonuses, home-match advantages, and weather immunity', W / 2, H - 48);
  ctx.fillText('Weekly upkeep keeps bonuses active. Sell to recover half the cost.', W / 2, H - 28);
}

/**
 * Render a stadium card.
 * @param {string} stadiumKey - key from STADIUM_DATA (e.g. 'volta_colosseum')
 */
function renderStadiumCard(stadiumKey) {
  const stadium = STADIUM_DATA[stadiumKey];
  if (!stadium) throw new Error(`Unknown stadium: ${stadiumKey}`);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.save();
  roundRect(ctx, 18, 18, W - 36, H - 36, 30);
  ctx.clip();

  drawBackground(ctx, stadiumKey);
  drawHeader(ctx, stadium);
  drawCapacity(ctx, stadium);
  drawBonuses(ctx, stadium);
  drawCosts(ctx, stadium);
  drawDescription(ctx, stadium);
  drawFooter(ctx);

  ctx.restore();

  drawFrame(ctx, stadium);

  return canvas.toBuffer('image/png');
}

module.exports = { renderStadiumCard, STADIUM_DATA };
