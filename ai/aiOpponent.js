const { AI, CLUBS } = require('../config/constants');
const { randInt, weightedRandom, pick } = require('../utils/random');
const { toFootballMinute } = require('../game-engine/matchEngine');

// Plausible real-ish footballer names so AI squads don't read as "Shadow"/"Blaze".
const FIRST = ['Marcus', 'David', 'Luka', 'Theo', 'Emre', 'Niko', 'Bruno', 'Kai', 'Idris', 'Rafael', 'Owen', 'Sergi', 'Mateo', 'Yann', 'Tomas', 'Andre', 'Pavel', 'Felix', 'Diego', 'Hugo', 'Leon', 'Samir', 'Conor', 'Pablo', 'Ruben', 'Jonas', 'Milo', 'Viktor', 'Caspar', 'Aiden'];
const LAST  = ['Vidic', 'Hall', 'Moreau', 'Okafor', 'Lindholm', 'Petrov', 'Castle', 'Marsh', 'Reyes', 'Bauer', 'Nakamura', 'Frost', 'Oduya', 'Vance', 'Cole', 'Sterling', 'Kovac', 'Romano', 'Bjorn', 'Dahl', 'Ferro', 'Hart', 'Lowe', 'Maddox', 'Quinn', 'Solano', 'Vasquez', 'Wren', 'Yates', 'Zoric'];
const GK_FIRST = ['Manuel', 'Tomas', 'Oscar', 'Boris', 'Kepa'];
const GK_LAST  = ['Banks', 'Schmeichel', 'Zoff', 'Cech', 'Trafford'];

function randomName(isGK) {
  const f = isGK ? pick(GK_FIRST) : pick(FIRST);
  const l = isGK ? pick(GK_LAST) : pick(LAST);
  return `${f} ${l}`;
}

function randomClub() {
  return pick(CLUBS);
}

function generateAISquad(difficulty = 'Medium') {
  const cfg  = AI[difficulty.toUpperCase()] || AI.MEDIUM;
  const base = cfg.statBase;
  // VOLTA = 3 outfield + 1 keeper, same as a human side.
  return [
    makeAIPlayer('outfield', base, randomName(false), difficulty),
    makeAIPlayer('outfield', base, randomName(false), difficulty),
    makeAIPlayer('outfield', base, randomName(false), difficulty),
    makeAIPlayer('goalkeeper', base, randomName(true), difficulty),
  ];
}

function makeAIPlayer(role, statBase, name, difficulty) {
  const v  = randInt(-8, 8);
  const s  = statBase + v;
  const rarity = statBase >= 80 ? 'Elite' : statBase >= 68 ? 'Rare' : 'Common';
  const stats  = role === 'goalkeeper'
    ? { reflex: s, positioning: s + randInt(-4, 4), anticipation: s + randInt(-4, 4), strength: s, composure: s }
    : { pace: s + randInt(-5, 5), skill: s, shooting: s + randInt(-5, 5), stamina: s, composure: s };

  const id = `ai_${name.replace(/\s/g, '_').toLowerCase()}_${Date.now()}_${randInt(100, 999)}`;
  return {
    id,
    _id:       id,
    name,
    displayName: name,
    role,
    rarity,
    potential:  'Medium',
    condition:  100,
    form:       'Normal',
    chemistry:  50,
    stats,
    isAI:       true,
  };
}

function chooseAction(session, team) {
  const difficulty = session.aiDifficulty || 'Medium';
  if (difficulty === 'Easy')   return randomAction();
  if (difficulty === 'Medium') return statAction(session, team);
  return predictiveAction(session, team);
}

function randomAction() {
  return pick(['pass', 'shoot', 'dribble', 'skillmove']);
}

function statAction(session, team) {
  const squad    = team === 'home' ? session.homeSquad : session.awaySquad;
  const attacker = squad.find(p => p.role === 'outfield') || squad[0];
  const s        = attacker?.stats || {};
  return weightedRandom({
    pass:      s.skill    || 60,
    shoot:     s.shooting || 60,
    dribble:   s.pace     || 60,
    skillmove: Math.round(((s.skill || 60) + (s.pace || 60)) / 2),
  });
}

function predictiveAction(session, team) {
  const isHome   = team === 'home';
  const momentum = isHome ? session.homeMomentum : session.awayMomentum;
  const scoreDiff = isHome
    ? session.homeScore - session.awayScore
    : session.awayScore - session.homeScore;
  const fm        = toFootballMinute(session.timeElapsed);
  const desperate = scoreDiff < 0 && fm > 70;

  if (desperate)    return weightedRandom({ shoot: 60, skillmove: 25, dribble: 15, pass: 5 });
  if (momentum > 65) return weightedRandom({ shoot: 40, dribble: 30, skillmove: 20, pass: 10 });
  if (scoreDiff > 0) return weightedRandom({ pass: 50, dribble: 25, shoot: 15, skillmove: 10 });
  return statAction(session, team);
}

module.exports = { generateAISquad, chooseAction, randomClub };