// utils/random.js

/** Random integer between min and max, inclusive. */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Pick a random element from an array. */
function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

/**
 * Weighted random pick from an object of { key: weight }.
 * e.g. weightedRandom({ Common: 70, Rare: 25, Elite: 5 }) => 'Common' | 'Rare' | 'Elite'
 */
function weightedRandom(weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1]?.[0];
}

/** Clamp a number between min and max. */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Add random variance around a center value: returns ±variance */
function withVariance(center, variance) {
  return center + randInt(-variance, variance);
}

module.exports = { randInt, pick, weightedRandom, clamp, withVariance };
