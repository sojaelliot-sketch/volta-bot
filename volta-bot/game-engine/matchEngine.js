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

function calcActionPower(player, action, teamMomentum, footballMinute) {
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

  return Math.round(base + formBonus + chemBonus + momBonus + lateBonus + variance);
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

  return Math.round(defAvg + gkPower + momPenalty + variance);
}

// Shot conversion uses a logistic formula so finishing scales with the
// attacker's edge over the keeper, not hard thresholds.
//   goalP = 1 / (1 + e^(-(ap + lateBoost - gkPower) / K))
// K controls sharpness; bigger edge => much higher chance to score.
function shotGoalProbability(actionPower, gkPower, footballMinute) {
  const K = 16;
  const lateBoost = footballMinute >= MATCH.LATE_GAME_MINUTE
    ? randInt(0, MATCH.LATE_GAME_BOOST_MAX)
    : 0;
  const diff = (actionPower + lateBoost) - gkPower;
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
  const attacker  = attackers[0] || { stats: {}, condition: 80, form: 'Normal', chemistry: 50 };
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

module.exports = {
  calcActionPower, calcDefensePower,
  resolveOutcome, resolveShotOutcome, resolveDribbleOutcome,
  resolveCorner, resolveThrowIn,
  updateMomentum, eventDuration, toFootballMinute,
};