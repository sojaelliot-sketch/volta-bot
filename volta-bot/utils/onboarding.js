'use strict';
// utils/onboarding.js
//
// A new manager used to register and then be handed a menu of 96 commands.
// That is a list, not an introduction — most people read it, close the chat and
// never come back.
//
// This tracks a short first-run journey and, after every step the player
// completes, tells them the ONE thing to do next. Five steps, each a real action
// they were going to take anyway, each with a small reward attached so the
// sequence pays for itself.
//
// State lives on the user record, so it survives restarts and cannot be farmed:
// each step pays once, ever.

const User = require('../models/User');
const { money } = require('./formatter');
const { BRAND } = require('../config/constants');

// Ordered. `done` is the command that completes the step.
const STEPS = [
  {
    id: 'squad',
    done: ['squad'],
    reward: 0,
    title: 'Meet your team',
    ask: 'Send *!squad* to see the four players you just signed.',
    why: 'These are yours. Each has a rating out of 99.',
  },
  {
    id: 'card',
    done: ['card'],
    reward: 250,
    title: 'Look at a player properly',
    ask: 'Send *!card 1* to see your best player up close.',
    why: 'Every player has a card. The better the player, the rarer the card.',
  },
  {
    id: 'play',
    done: ['play', 'match', 'pk'],
    reward: 500,
    title: 'Play your first match',
    ask: 'Send *!play* to get a game.',
    why: 'Matches are how you earn and how you climb.',
  },
  {
    id: 'daily',
    done: ['daily'],
    reward: 250,
    title: 'Claim your daily',
    ask: 'Send *!daily*.',
    why: 'Free money every day. Claim it several days running and it grows.',
  },
  {
    id: 'shop',
    done: ['shop', 'pack', 'buy'],
    reward: 0,
    title: 'Spend it',
    ask: 'Send *!shop* to open a pack and improve the squad.',
    why: 'Packs are where better players come from.',
  },
];

const BY_ID = Object.fromEntries(STEPS.map((s) => [s.id, s]));

function progressOf(user) {
  const done = new Set(user && Array.isArray(user.onboarding) ? user.onboarding : []);
  return { done, next: STEPS.find((s) => !done.has(s.id)) || null };
}

/** Is this manager still being shown the ropes? */
function isOnboarding(user) {
  if (!user || !user.registered) return false;
  return !!progressOf(user).next;
}

/**
 * Called after a command runs successfully. If it completes the player's
 * current step, pay the reward and return the nudge toward the next one.
 * Returns a string to append, or null.
 *
 * Deliberately only advances the CURRENT step: doing things out of order does
 * not skip anyone ahead, and the sequence still reads as a sequence.
 */
function advance(user, cmd) {
  // Takes the ALREADY-LOADED user object. It used to re-fetch by id, which
  // meant an extra syncTable() — a full re-read of users.json from disk — on
  // every single command, for every player, forever. Under parallel load that
  // was enough lock contention to make unrelated commands fail.
  if (!user || !user.registered) return null;

  const sender = user.whatsappId;

  // Fast path: once the tour is finished this costs one array-length check.
  const list = user.onboarding;
  if (Array.isArray(list) && list.length >= STEPS.length) return null;

  const { done, next } = progressOf(user);
  if (!next) return null;
  if (!next.done.includes(cmd)) return null;

  done.add(next.id);
  User.update(sender, { onboarding: [...done] });
  if (next.reward > 0) User.addCurrency(sender, next.reward);

  const after = STEPS.find((s) => !done.has(s.id));
  const stepNo = STEPS.indexOf(next) + 1;

  const lines = [];
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━');
  if (next.reward > 0) {
    lines.push(`✅ *${next.title}* — done. +${money(next.reward)}`);
  } else {
    lines.push(`✅ *${next.title}* — done.`);
  }

  if (after) {
    lines.push('');
    lines.push(`*Next (${stepNo + 1}/${STEPS.length}):* ${after.ask}`);
    lines.push(`_${after.why}_`);
  } else {
    lines.push('');
    lines.push(`🎉 That's the tour. You know enough to play now.`);
    lines.push(`*!help* has everything else when you want it.`);
  }
  return lines.join('\n');
}

/** The opening message, sent right after registration. */
function welcome(user) {
  const first = STEPS[0];
  return [
    `⚽ *You're in, ${user.name}.*`,
    '━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    `You've got four players and ${money(user.currency || 0)} to your name.`,
    `You run the club: pick the team, play matches, buy and sell.`,
    '',
    `I'll walk you through it — five short steps, one at a time.`,
    `Skip it whenever you like with *!skiptour*.`,
    '',
    `*Step 1/${STEPS.length}:* ${first.ask}`,
    `_${first.why}_`,
    BRAND,
  ].join('\n');
}

/** Where a returning newcomer left off. */
function reminder(user) {
  const { done, next } = progressOf(user);
  if (!next) return null;
  return [
    `👋 Welcome back, *${user.name}*.`,
    '',
    `*Step ${done.size + 1}/${STEPS.length}:* ${next.ask}`,
    `_${next.why}_`,
  ].join('\n');
}

/** Mark the whole tour finished without paying out the remaining steps. */
function skip(sender) {
  User.update(sender, { onboarding: STEPS.map((s) => s.id) });
}

module.exports = { STEPS, BY_ID, isOnboarding, advance, welcome, reminder, skip, progressOf };
