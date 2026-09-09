const { MATCH, PLAYER } = require('../config/constants');
const { randInt, clamp, withVariance } = require('../utils/random');

function effectiveStat(value, condition) {
  return Math.round(value * (condition / 100));
}

function formMod(form) {
  return form === 'Hot' ? 1.05 : form === 'Cold' ? 0.95 : 1.0;
}

function chemMult(chemistry) {
  return Math.min(1 + (chemistry / 100) * (PLAYER.CHEMISTRY_CAP - 1), PLAYER.CHEMISTRY_CAP);
}

function momentumEffect(momentum) {
  return (momentum - 50) * 0.2;
}

function lateGamePenalty(footballMinute, condition) {
  if (footballMinute < MATCH.LATE_GAME_MINUTE) return 0;
  const fatigue = (footballMinute - MATCH.LATE_GAME_MINUTE) * 0.15;
  return -(fatigue * (1 - condition / 100)) * 5;
}

const ACTION_CONFIG = {
  pass:      { primary: 'skill',    pw: 0.6, secondary: 'composure', sw: 0.4 },
  shoot:     { primary: 'shooting', pw: 0.7, secondary: 'composure', sw: 0.3 },
  dribble:   { primary: 'pace',     pw: 0.5, secondary: 'skill',     sw: 0.5 },
  skillmove: { primary: 'skill',    pw: 0.8, secondary: 'pace',      sw: 0.2 },
};

function calcActionPower(player, action, teamMomentum, footballMinute, weather = null, immune = false) {
  const cfg  = ACTION_CONFIG[action] || ACTION_CONFIG.pass;
  const cond = player.condition || 100;
  const s    = player.stats || {};

  const primary   = effectiveStat(s[cfg.primary]   || 60, cond);
  const secondary = effectiveStat(s[cfg.secondary] || 60, cond);

  const base       = (primary * cfg.pw) + (secondary * cfg.sw);
  const formBonus  = base * (formMod(player.form) - 1);
  const chemBonus  = base * (chemMult(player.chemistry || 0) - 1);
  const momBonus   = momentumEffect(teamMomentum);
  const lateBonus  = lateGamePenalty(footballMinute, cond);
  const variance   = withVariance(0, 8);

  // CATCH #3 — Weather immunity: a home team with a retractable roof ignores
  // rain. Otherwise rain reduces pace and ball-control stats for everyone.
  let weatherPenalty = 0;
  if (weather === 'raining' && !immune) {
    const M = require('../config/constants').MATCH.WEATHER;
    const isPace   = cfg.primary === 'pace'   || cfg.secondary === 'pace';
    const isCtrl   = cfg.primary === 'composure' || cfg.secondary === 'composure' || cfg.primary === 'skill' || cfg.secondary === 'skill';
    if (isPace) weatherPenalty -= M.RAIN_PACE_PENALTY;
    if (isCtrl) weatherPenalty -= M.RAIN_CONTROL_PENALTY;
  }

  return Math.round(base + formBonus + chemBonus + momBonus + lateBonus + variance + weatherPenalty);
}

function calcDefensePower(defenders, gk, oppMomentum, footballMinute) {
  // No outfield defenders passed (e.g. a shot is only contested by the
  // keeper) => contribute 0, NOT a phantom 55. The keeper below is the
  // sole defense in that case.
  const defAvg = defenders.length
    ? defenders.reduce((sum, p) => {
        const cond = p.condition || 100;
        const s    = p.stats || {};
        return sum + (
          effectiveStat(s.pace       || 60, cond) * 0.25 +
          effectiveStat(s.skill      || 60, cond) * 0.30 +
          effectiveStat(s.stamina    || 60, cond) * 0.25 +
          effectiveStat(s.composure  || 60, cond) * 0.20
        );
      }, 0) / defenders.length
    : 0;

  let gkPower = 55;
  if (gk) {
    const cond = gk.condition || 100;
    const s    = gk.stats || {};
    const latePenalty = lateGamePenalty(footballMinute, cond) * 0.5;
    gkPower = (
      effectiveStat(s.reflex       || 60, cond) * 0.35 +
      effectiveStat(s.positioning  || 60, cond) * 0.30 +
      effectiveStat(s.anticipation || 60, cond) * 0.25 +
      effectiveStat(s.composure    || 60, cond) * 0.10
    ) + latePenalty;
  }

  const momPenalty = momentumEffect(oppMomentum);
  const variance   = withVariance(0, 6);

  // Normalise: average defAvg + gkPower so DP ≈ AP for equal-quality squads,
  // making non-shot events balanced. Shot conversion adds a built-in difficulty
  // offset inside shotGoalProbability.
  const combined = (defAvg + gkPower) / 2;

  return Math.round(combined + momPenalty + variance);
}

// Shot conversion uses a logistic formula so finishing scales with the
// attacker's edge over the keeper, not hard thresholds.
//   goalP = 1 / (1 + e^(-(ap + lateBoost - gkPower) / K))
// K controls sharpness; bigger edge => much higher chance to score.
function shotGoalProbability(actionPower, gkPower, footballMinute) {
  // K controls how decisive a power advantage is on a single shot.
  //
  // It used to be 16, which made the logistic so steep that the match was
  // effectively over at kickoff. Measured across 2,000 simulated matches per
  // rating gap:
  //
  //     gap    K=16      K=34
  //      +6    80.1%     62.5%
  //     +12    97.3%     81.4%
  //     +30   100.0%     99.2%
  //
  // A six-point squad advantage winning four games in five leaves no reason to
  // play the match, and it meant an underdog literally could not win. At 34 the
  // better squad is still clearly favoured — and a big gap is still decisive —
  // but an upset is possible, which is the only thing that makes a fixture
  // worth watching.
  const K = 34;

  // Raised alongside K to keep scorelines where they were. Flattening the curve
  // pushes every shot toward 50/50, so without this the average match gained
  // roughly two goals.
  const DIFFICULTY = 26;
  const lateBoost = footballMinute >= MATCH.LATE_GAME_MINUTE
    ? randInt(0, MATCH.LATE_GAME_BOOST_MAX)
    : 0;
  const diff = (actionPower + lateBoost) - gkPower - DIFFICULTY;
  return 1 / (1 + Math.exp(-diff / K));
}

function resolveShotOutcome(actionPower, gkPower, footballMinute) {
  const goalP = shotGoalProbability(actionPower, gkPower, footballMinute);
  const r = Math.random();
  if (r < goalP) return 'goal';
  const rem = 1 - goalP;
  if (r < goalP + rem * 0.5) return 'save';
  if (r < goalP + rem * 0.82) return 'near_miss';
  return 'blocked';
}

function resolveOutcome(ap, dp) {
  const diff = ap - dp;
  if (diff > 5)  return 'success';
  if (diff > -5) return 'contested';
  return 'failure';
}

function resolveDribbleOutcome(ap, dp) {
  const o = resolveOutcome(ap, dp);
  if (o === 'success')   return 'dribble_success';
  if (o === 'contested') return 'foul';
  return 'tackled';
}

function resolveCorner(attackers, gk, momentum, footballMinute) {
  const attacker  = pickAttacker(attackers, 'shoot') || { stats: {}, condition: 80, form: 'Normal', chemistry: 50 };
  const ap        = calcActionPower(attacker, 'shoot', momentum, footballMinute) * 1.15;
  const gkS       = gk?.stats || {};
  const gkCond    = gk?.condition || 80;
  const gkP       = (effectiveStat(gkS.reflex || 60, gkCond) + effectiveStat(gkS.anticipation || 60, gkCond)) * 0.6 + withVariance(0, 10);
  const shot      = resolveShotOutcome(ap, gkP, footballMinute);
  return shot === 'goal' ? 'corner_goal' : shot === 'save' ? 'corner_save' : 'corner_cleared';
}

function resolveThrowIn(attacker, momentum, footballMinute) {
  const ap = calcActionPower(attacker, 'pass', momentum, footballMinute);
  if (ap > 75) return 'quick_attack';
  if (ap > 55) return 'possession_reset';
  return 'long_throw';
}

function updateMomentum(current, event) {
  const delta = MATCH.MOMENTUM_CHANGES[event] || 0;
  return clamp(current + delta, 0, 100);
}

function eventDuration(action) {
  const { SHORT, MEDIUM, COMPLEX } = MATCH.EVENT_DURATIONS;
  if (['pass'].includes(action))                          return randInt(...SHORT);
  if (['shoot', 'dribble'].includes(action))              return randInt(...MEDIUM);
  if (['skillmove', 'corner', 'throwin'].includes(action)) return randInt(...COMPLEX);
  return randInt(...MEDIUM);
}

function toFootballMinute(elapsedSeconds) {
  return Math.min(90, Math.floor((elapsedSeconds / MATCH.TOTAL_SECONDS) * MATCH.FOOTBALL_MINUTES));
}


// ─── WHO GETS THE BALL ──────────────────────────────────────────────────────
//
// Every attacking event used to choose its player with a flat pick() — a
// uniform random draw across the squad. A 91-rated Legendary striker was
// exactly as likely to take a shot as a 48-rated Common defender, which is why
// better players never seemed to score more. The squad you built barely
// mattered; only the aggregate power did.
//
// Selection is now weighted by the stats that action actually needs, by
// condition, and by whether the player belongs in that phase of play. The
// exponent controls how decisive quality is: at 2.2, a player rated 85 is about
// four times more likely to be involved than one rated 55, which is roughly how
// a real five-a-side plays — the good player gets the ball, but not every time.
const SELECTION_EXPONENT = 2.2;

function relevanceFor(player, action) {
  const st = player.stats || {};
  const cond = player.condition || 100;
  const e = (v) => effectiveStat(v || 55, cond);

  if (player.role === 'goalkeeper') return 1;   // never picked for attacking play

  switch (action) {
    case 'shoot':
      return e(st.shooting) * 0.60 + e(st.composure) * 0.25 + e(st.skill) * 0.15;
    case 'dribble':
    case 'skillmove':
      return e(st.skill) * 0.55 + e(st.pace) * 0.30 + e(st.composure) * 0.15;
    case 'pass':
      return e(st.composure) * 0.45 + e(st.skill) * 0.35 + e(st.stamina) * 0.20;
    default:
      return (e(st.pace) + e(st.skill) + e(st.shooting) + e(st.composure)) / 4;
  }
}

/**
 * Pick the player involved in an attacking action, weighted by ability.
 * Falls back to a uniform pick if every candidate scores zero.
 */
function pickAttacker(squad, action = 'shoot') {
  const pool = (squad || []).filter((p) => p && p.role !== 'goalkeeper');
  const candidates = pool.length ? pool : (squad || []);
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  const weights = candidates.map((p) => Math.pow(Math.max(1, relevanceFor(p, action)), SELECTION_EXPONENT));
  const total = weights.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

module.exports = {
  calcActionPower, calcDefensePower,
  resolveOutcome, resolveShotOutcome, resolveDribbleOutcome,
  resolveCorner, resolveThrowIn,
  updateMomentum, eventDuration, toFootballMinute,
  pickAttacker, relevanceFor,
};