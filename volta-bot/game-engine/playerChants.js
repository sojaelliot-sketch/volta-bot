'use strict';
// game-engine/playerChants.js
//
// A chant belongs to a PLAYER, not just a club.
//
// The existing system has one chant per manager, sung the same way for every
// goal. So a 12th-minute tap-in in a 4-0 win reads exactly like a 90th-minute
// winner in a cup final — which is the fastest way to make a crowd feel fake.
//
// Two things here:
//
//   1. Every player has their own chant, derived from their name so it is
//      STABLE. The same striker gets the same song every time he scores, for
//      everyone in the group, forever, with no storage. Players become
//      recognisable, which is the whole point of collecting them.
//
//   2. Chants only fire on moments that have earned one. A goal is not special
//      because it happened; it is special because of when it happened and what
//      it did to the scoreline. Sing for everything and it means nothing.

const Player = require('../models/Player');

// ── Deterministic hashing ───────────────────────────────────────────────────
// Same player, same chant, on every machine and every restart.
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
const at = (arr, seed) => arr[seed % arr.length];

// ── Chant shapes ────────────────────────────────────────────────────────────
// {n} is the player's name. Kept short — a terrace chant is not a paragraph.
const CHANT_FORMS = [
  '🎵 _Oh, {n}! Oh, {n}!_ 🎵',
  '🎵 _{n}, {n}, {n}!_ 🎵',
  '🎵 _There\'s only one {n}!_ 🎵',
  '🎵 _He\'s magic, you know — {n}!_ 🎵',
  '🎵 _{n}\'s gonna get ya!_ 🎵',
  '🎵 _Feed the {n} and he will score!_ 🎵',
  '🎵 _We\'ve got {n}, super {n}!_ 🎵',
  '🎵 _{n}! {n}! Sign him up for life!_ 🎵',
  '🎵 _Everywhere we go — {n} steals the show!_ 🎵',
  '🎵 _Hey {n}, do it again!_ 🎵',
];

// A rarer player gets a grander introduction to his chant.
const INTRO = {
  Common: [
    'A few voices behind the goal pick it up…',
    'One corner of the ground starts singing…',
    'Someone starts it, and enough people join in…',
  ],
  Rare: [
    'The stand behind the goal finds its voice…',
    'It spreads along one side of the ground…',
    'Half the crowd is on its feet for this one…',
  ],
  Elite: [
    'The whole ground is on its feet…',
    'It goes up around the entire stadium…',
    'Every voice in the place, all at once…',
  ],
  Legendary: [
    'The noise is something else. Listen to this…',
    'You can feel the stand shaking…',
    'This is the song they will still sing in twenty years…',
  ],
};

/** The chant for a player. Stable for the life of that player. */
function chantFor(player) {
  if (!player) return null;
  const name = Player.displayName ? (Player.displayName(player) || player.name) : player.name;
  if (!name) return null;
  const seed = hash(String(player.id || name));
  return at(CHANT_FORMS, seed).replace(/\{n\}/g, name);
}

/**
 * Was this goal worth a song?
 *
 * Returns a reason string, or null. Deliberately strict: at most a couple of
 * chants a match, so the ones that land actually feel like something.
 *
 * @param {object} o
 * @param {number} o.minute        football minute of the goal
 * @param {number} o.scorerTeam    goals for the scoring side AFTER this goal
 * @param {number} o.otherTeam     goals for the other side
 * @param {number} o.playerGoals   goals this player has scored in this match
 * @param {string} o.rarity        the scorer's rarity
 * @param {boolean} o.isFinal      cup final or equivalent
 */
function momentFor({ minute = 0, scorerTeam = 0, otherTeam = 0, playerGoals = 1, rarity = 'Common', isFinal = false }) {
  const late = minute >= 80;
  const veryLate = minute >= 88;
  const lead = scorerTeam - otherTeam;

  // A hat-trick is always worth it.
  if (playerGoals >= 3) return 'hattrick';

  // A goal that wins it at the death.
  if (veryLate && lead === 1) return 'winner';

  // A goal that saves it at the death.
  if (late && lead === 0) return 'equaliser';

  // Coming from two behind to level, at any point.
  if (lead === 0 && scorerTeam >= 2) return 'comeback';

  // A brace from a genuinely good player.
  if (playerGoals === 2 && (rarity === 'Elite' || rarity === 'Legendary')) return 'brace';

  // The opening goal of a final.
  if (isFinal && scorerTeam === 1 && otherTeam === 0) return 'final_opener';

  return null;
}

const MOMENT_LINE = {
  hattrick:     '🎩 *HAT-TRICK.* Take the ball home, son.',
  winner:       '💥 *THAT IS THE WINNER.* At the death!',
  equaliser:    '😱 *LEVEL! AT THE DEATH!*',
  comeback:     '🔥 *ALL SQUARE!* What a way back.',
  brace:        '⚡ *Two for him now.*',
  final_opener: '🏆 *First blood in the final.*',
};

/**
 * Build the chant block for a goal, or return '' if this goal did not earn one.
 * Safe to call on every goal.
 */
function chantOnGoal(player, context = {}) {
  const moment = momentFor({ ...context, rarity: player?.rarity || 'Common' });
  if (!moment) return '';

  const chant = chantFor(player);
  if (!chant) return '';

  const rarity = player.rarity && INTRO[player.rarity] ? player.rarity : 'Common';
  const seed = hash(String(player.id || '') + moment + String(context.minute || 0));
  const intro = at(INTRO[rarity], seed);

  return [
    '',
    MOMENT_LINE[moment],
    `_${intro}_`,
    chant,
  ].join('\n');
}

module.exports = { chantFor, chantOnGoal, momentFor, CHANT_FORMS };
