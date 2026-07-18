// utils/matchImageRenderer.js
// Renders match "kickoff" and "full time" scoreboard images as PNG buffers.
// Self-contained (only depends on nothing external) so it can be dropped into
// any project on its own, same as cardRenderer.js.
const { createCanvas } = require('canvas');

const W = 1000;
const H = 650;

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

/** Deterministic color per team name so the same team always gets the same badge color. */
function teamColor(name = '') {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${hash}, 70%, 50%)`;
}

function initials(name = '') {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ─── SKY / WEATHER / TIME-OF-DAY BACKGROUND ─────────────────────────────────

function drawSky(ctx, timeOfDay, weather) {
  const isNight = timeOfDay === 'night';

  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.72);
  if (isNight) {
    sky.addColorStop(0, '#060814');
    sky.addColorStop(0.6, '#101a33');
    sky.addColorStop(1, '#1c2a4a');
  } else {
    sky.addColorStop(0, weather === 'raining' ? '#7c8896' : '#5aa8e8');
    sky.addColorStop(0.6, weather === 'raining' ? '#9aa5b0' : '#bfe0ff');
    sky.addColorStop(1, weather === 'raining' ? '#c3cad2' : '#dff1ff');
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H * 0.72);

  if (isNight) {
    const rnd = makeRng(7);
    for (let i = 0; i < 90; i++) {
      const x = rnd() * W;
      const y = rnd() * H * 0.55;
      ctx.globalAlpha = rnd() * 0.7 + 0.2;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, rnd() * 1.4 + 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (weather !== 'raining') {
      ctx.save();
      ctx.shadowColor = 'rgba(255,255,240,0.8)';
      ctx.shadowBlur = 40;
      ctx.fillStyle = '#fdf6e3';
      ctx.beginPath();
      ctx.arc(W - 130, 90, 42, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = 0.10;
    [[60, 20], [W - 60, 20]].forEach(([bx, by]) => {
      const beam = ctx.createRadialGradient(bx, by, 0, bx, by, 420);
      beam.addColorStop(0, '#fffbe0');
      beam.addColorStop(1, 'rgba(255,251,224,0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.arc(bx, by, 420, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  } else {
    if (weather !== 'raining') {
      ctx.save();
      ctx.shadowColor = 'rgba(255,240,150,0.9)';
      ctx.shadowBlur = 60;
      const sunGrad = ctx.createRadialGradient(120, 90, 5, 120, 90, 55);
      sunGrad.addColorStop(0, '#fff9d6');
      sunGrad.addColorStop(1, '#ffd84d');
      ctx.fillStyle = sunGrad;
      ctx.beginPath();
      ctx.arc(120, 90, 50, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const rnd = makeRng(weather === 'raining' ? 99 : 21);
    const cloudCount = weather === 'raining' ? 9 : 4;
    for (let i = 0; i < cloudCount; i++) {
      const cx = rnd() * W;
      const cy = 60 + rnd() * 140;
      ctx.globalAlpha = weather === 'raining' ? 0.5 : 0.35;
      ctx.fillStyle = weather === 'raining' ? '#7d8894' : '#ffffff';
      for (let j = 0; j < 4; j++) {
        ctx.beginPath();
        ctx.ellipse(cx + j * 26, cy + (j % 2) * 8, 34, 22, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  if (weather === 'raining') {
    ctx.save();
    ctx.strokeStyle = isNight ? 'rgba(200,215,255,0.35)' : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    const rnd = makeRng(555);
    for (let i = 0; i < 140; i++) {
      const x = rnd() * (W + 200) - 100;
      const y = rnd() * H;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 14, y + 26);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawPitch(ctx, timeOfDay, weather) {
  const pitchY = H * 0.72;
  const pitchH = H - pitchY;
  const isNight = timeOfDay === 'night';

  const base = ctx.createLinearGradient(0, pitchY, 0, H);
  if (isNight) {
    base.addColorStop(0, '#0e3d1e');
    base.addColorStop(1, '#061f0f');
  } else {
    base.addColorStop(0, '#2f9e46');
    base.addColorStop(1, '#1c6b2c');
  }
  ctx.fillStyle = base;
  ctx.fillRect(0, pitchY, W, pitchH);

  const stripeCount = 10;
  const stripeW = W / stripeCount;
  for (let i = 0; i < stripeCount; i++) {
    if (i % 2 === 0) {
      ctx.fillStyle = isNight ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)';
      ctx.fillRect(i * stripeW, pitchY, stripeW, pitchH);
    }
  }

  if (weather === 'raining') {
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(i * (W / 6) + 10, pitchY + 10, W / 6 - 40, 3);
    }
    ctx.restore();
  }

  ctx.strokeStyle = isNight ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, pitchY + 6);
  ctx.lineTo(W, pitchY + 6);
  ctx.stroke();
}

function weatherBadgeIcon(timeOfDay, weather) {
  if (weather === 'raining') return timeOfDay === 'night' ? '🌧️' : '🌦️';
  return timeOfDay === 'night' ? '🌙' : '☀️';
}

function weatherLabel(timeOfDay, weather) {
  const t = timeOfDay === 'night' ? 'Night' : 'Day';
  const w = weather === 'raining' ? 'Rain' : 'Clear';
  return `${t} · ${w}`;
}

function drawTopBanner(ctx, text, timeOfDay, weather) {
  ctx.textAlign = 'center';
  ctx.font = '600 15px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText('𝙈𝙀𝙏𝘼𝙒𝙊𝙍𝙆𝙎™ · VOLTA', W / 2, 34);

  const chipW = 118, chipH = 34;
  const cx = W - 40 - chipW, cy = 16;
  roundRect(ctx, cx, cy, chipW, chipH, 17);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText(weatherBadgeIcon(timeOfDay, weather), cx + 12, cy + 23);
  ctx.font = '600 13px sans-serif';
  ctx.fillText(weatherLabel(timeOfDay, weather), cx + 38, cy + 22);
}

function drawTeamBadge(ctx, cx, cy, r, name) {
  const color = teamColor(name);
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 26;
  const grad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  grad.addColorStop(0, color);
  grad.addColorStop(1, '#0c0c14');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.font = `800 ${Math.round(r * 0.7)}px sans-serif`;
  ctx.fillStyle = '#fff';
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 6;
  ctx.fillText(initials(name), cx, cy + r * 0.24);
  ctx.restore();
}

function drawFooter(ctx) {
  ctx.textAlign = 'center';
  ctx.font = '500 13px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('⚽ VOLTA — 5-a-side simulation on WhatsApp', W / 2, H - 18);
}

function drawFrame(ctx) {
  roundRect(ctx, 10, 10, W - 20, H - 20, 26);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function renderKickoffCard({ homeTeam, awayTeam, timeOfDay = 'day', weather = 'sunny', venue = 'VOLTA Arena' }) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const rainy = weather === 'raining';

  ctx.save();
  roundRect(ctx, 10, 10, W - 20, H - 20, 26);
  ctx.clip();

  drawSky(ctx, timeOfDay, rainy ? 'raining' : 'sunny');
  drawPitch(ctx, timeOfDay, rainy ? 'raining' : 'sunny');
  drawTopBanner(ctx, 'KICK-OFF', timeOfDay, rainy ? 'raining' : 'sunny');

  const midY = H * 0.42;

  drawTeamBadge(ctx, W * 0.26, midY, 78, homeTeam);
  drawTeamBadge(ctx, W * 0.74, midY, 78, awayTeam);

  ctx.textAlign = 'center';
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 24;
  ctx.font = '800 46px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('VS', W / 2, midY + 16);
  ctx.restore();

  ctx.font = '800 26px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 8;
  ctx.fillText(homeTeam, W * 0.26, midY + 120);
  ctx.fillText(awayTeam, W * 0.74, midY + 120);
  ctx.restore();

  const ribbonY = midY + 160;
  const ribbonW = 260, ribbonH = 46;
  roundRect(ctx, W / 2 - ribbonW / 2, ribbonY, ribbonW, ribbonH, 23);
  const rGrad = ctx.createLinearGradient(W / 2 - ribbonW / 2, 0, W / 2 + ribbonW / 2, 0);
  rGrad.addColorStop(0, 'rgba(255,255,255,0.05)');
  rGrad.addColorStop(0.5, 'rgba(62,207,106,0.55)');
  rGrad.addColorStop(1, 'rgba(255,255,255,0.05)');
  ctx.fillStyle = rGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.font = '800 20px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText('⚽ KICK-OFF', W / 2, ribbonY + 30);

  ctx.font = '500 15px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(venue, W / 2, ribbonY + 68);

  drawFooter(ctx);
  ctx.restore();

  drawFrame(ctx);

  return canvas.toBuffer('image/png');
}

function renderFullTimeCard({
  homeTeam, awayTeam, homeScore, awayScore,
  homeScorers = [], awayScorers = [], motm = null,
  timeOfDay = 'day', weather = 'sunny',
}) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const rainy = weather === 'raining';

  ctx.save();
  roundRect(ctx, 10, 10, W - 20, H - 20, 26);
  ctx.clip();

  drawSky(ctx, timeOfDay, rainy ? 'raining' : 'sunny');
  drawPitch(ctx, timeOfDay, rainy ? 'raining' : 'sunny');

  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, 0, W, H);

  drawTopBanner(ctx, 'FULL TIME', timeOfDay, rainy ? 'raining' : 'sunny');

  const fy = 76;
  ctx.textAlign = 'center';
  ctx.save();
  ctx.shadowColor = 'rgba(255,80,80,0.8)';
  ctx.shadowBlur = 18;
  ctx.font = '800 24px sans-serif';
  ctx.fillStyle = '#ff5a5a';
  ctx.fillText('🔴 FULL TIME', W / 2, fy);
  ctx.restore();

  const boardY = 170;
  drawTeamBadge(ctx, W * 0.20, boardY, 62, homeTeam);
  drawTeamBadge(ctx, W * 0.80, boardY, 62, awayTeam);

  ctx.font = '700 24px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText(homeTeam, W * 0.20, boardY + 92);
  ctx.fillText(awayTeam, W * 0.80, boardY + 92);

  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.7)';
  ctx.shadowBlur = 20;
  ctx.font = '800 96px sans-serif';
  ctx.fillStyle = '#fff';
  const scoreText = `${homeScore}  -  ${awayScore}`;
  ctx.fillText(scoreText, W / 2, boardY + 34);
  ctx.restore();

  if (homeScore !== awayScore) {
    const winnerX = homeScore > awayScore ? W * 0.20 : W * 0.80;
    ctx.strokeStyle = '#3ecf6a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(winnerX - 70, boardY + 106);
    ctx.lineTo(winnerX + 70, boardY + 106);
    ctx.stroke();
  }

  const scY = boardY + 150;
  ctx.font = '700 14px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textAlign = 'left';
  ctx.fillText('⚽ GOALS', 60, scY);
  ctx.textAlign = 'right';
  ctx.fillText('GOALS ⚽', W - 60, scY);

  ctx.font = '500 15px sans-serif';
  const lineH = 24;
  ctx.textAlign = 'left';
  if (homeScorers.length) {
    homeScorers.slice(0, 6).forEach((s, i) => {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(`${s.name} ${s.minute}'`, 60, scY + 28 + i * lineH);
    });
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('No goals', 60, scY + 28);
  }

  ctx.textAlign = 'right';
  if (awayScorers.length) {
    awayScorers.slice(0, 6).forEach((s, i) => {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(`${s.name} ${s.minute}'`, W - 60, scY + 28 + i * lineH);
    });
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('No goals', W - 60, scY + 28);
  }

  if (motm) {
    const my = H - 92;
    const mw = 340, mh = 46;
    ctx.textAlign = 'center';
    roundRect(ctx, W / 2 - mw / 2, my, mw, mh, 23);
    const mGrad = ctx.createLinearGradient(W / 2 - mw / 2, 0, W / 2 + mw / 2, 0);
    mGrad.addColorStop(0, 'rgba(255,255,255,0.05)');
    mGrad.addColorStop(0.5, 'rgba(255,207,77,0.5)');
    mGrad.addColorStop(1, 'rgba(255,255,255,0.05)');
    ctx.fillStyle = mGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,207,77,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = '700 17px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(`🌟 MOTM: ${motm.name} (${motm.team})`, W / 2, my + 30);
  }

  drawFooter(ctx);
  ctx.restore();

  drawFrame(ctx);

  return canvas.toBuffer('image/png');
}

module.exports = { renderKickoffCard, renderFullTimeCard };
