const { pick, randInt } = require('../utils/random');
const { toFootballMinute } = require('./matchEngine');
const { BRAND } = require('../config/constants');
const { GEN_Z, fillLine: fillGenZ } = require('./commentaryGenZ');

// Recent-line tracking, scoped PER MATCH.
//
// This used to be a single module-level Set shared by every match in the
// process. Two games running in different groups at the same time ate each
// other's pool: match A would use a goal sequence, and match B — a completely
// separate game between different people — was then barred from it. With six
// goal sequences and two live matches, both ended up recycling lines almost
// immediately, which is exactly the "commentary repeats itself" complaint.
//
// Keyed by match id, with a hard cap so a long-running process cannot leak.
const RECENT_CAP = 40;
const MATCH_CAP = 60;
const recentByMatch = new Map();

function bucket(matchId) {
  const key = matchId || 'default';
  let set = recentByMatch.get(key);
  if (!set) {
    set = new Set();
    recentByMatch.set(key, set);
    // Evict the oldest match once too many have accumulated.
    if (recentByMatch.size > MATCH_CAP) {
      const oldest = recentByMatch.keys().next().value;
      if (oldest !== undefined) recentByMatch.delete(oldest);
    }
  }
  return set;
}

function remember(lines, matchId) {
  const recent = bucket(matchId);
  for (const l of lines) if (l) recent.add(l);
  while (recent.size > RECENT_CAP) {
    const first = recent.values().next().value;
    if (first === undefined) break;
    recent.delete(first);
  }
}
function notRecent(pool, keyFn, matchId) {
  const recent = bucket(matchId);
  const fresh = pool.filter((item) => !recent.has(keyFn(item)));
  return fresh.length ? fresh : pool;
}

/** Drop a match's line history when it finishes. */
function endMatch(matchId) {
  if (matchId) recentByMatch.delete(matchId);
}

const SEQUENCES = {

  goal: [
    [
      '{player} grabs it on the edge... 👀',
      'swings the left boot and *SENDS IT!* 💥',
      '⚽ *GOAL!* Top bins — absolutely CRACKED! 🔥',
    ],
    [
      '*{player}* breezes past the last man...',
      'one touch, then BANG! 💥',
      '⚽ *GOAL!!* The net is JUMPING! 🌊',
    ],
    [
      '*{player}* with the ball 20 out...',
      'leans on it and *LAUNCHES!* 💨',
      '⚽ *GOLAZO!* Keeper never stood a chance! 😤',
    ],
    [
      '🎯 *{player}* dead-eye, picks the corner...',
      'keeper commits... too late 😏',
      '⚽ *GOAL!* No cap, that was filthy. 💎',
    ],
    [
      '⚡ *{player}* splits the D with a pass to himself!',
      'rounds the keeper, rolls it in 🥅',
      '⚽ *GOAL!* Ice in the veins! 🧊',
    ],
    [
      '*{player}* cleans up the scrap...',
      'snaps it first time! 💥',
      '⚽ *GOAL!* The place goes NUTS! 🏟️',
    ],
    [
      '🧠 *{player}* stands it up, waits for the run…',
      'nods it back into his own path 😮',
      '⚽ *GOAL!* He created that out of absolutely nothing! 🎨',
    ],
    [
      '*{player}* gambles on the rebound…',
      'keeper spills it and he is FIRST to react ⚡',
      '⚽ *GOAL!* Poacher\'s instinct — right place, right time! 🦊',
    ],
    [
      '🚀 *{player}* from a LONG way out…',
      'he has actually gone for this! 😳',
      '⚽ *GOAL!!* From distance! What is he doing shooting from there?! 🤯',
    ],
    [
      '*{player}* wins it back in midfield…',
      'drives at the heart of them, nobody closes 🏃',
      '⚽ *GOAL!* Straight up the middle and it is in! 💢',
    ],
    [
      '↩️ *{player}* peels off the back post…',
      'nobody picked him up. Nobody. 🫥',
      '⚽ *GOAL!* Free header, and the defenders are already arguing! 😤',
    ],
    [
      '🦶 *{player}* on his weaker foot here…',
      'he does not care — swings anyway',
      '⚽ *GOAL!* On the wrong foot and it is in the corner! 🎯',
    ],
    [
      '*{player}* is bundled over on the edge… play on!',
      'he keeps his feet, keeps going 💪',
      '⚽ *GOAL!* Should have gone down and instead he scored! 🔥',
    ],
    [
      '⚙️ *{player}* one-two on the angle…',
      'gets it straight back and squeezes it near post 📐',
      '⚽ *GOAL!* Keeper will not enjoy watching that one back. 😬',
    ],
    [
      '*{player}* dinks it… cheeky 😏',
      'the keeper is stranded, watching it drop…',
      '⚽ *GOAL!* Audacity! Absolute audacity! 🪄',
    ],
    [
      '🌪️ *{player}* whips it in with the outside of the boot…',
      'it is bending, it is bending…',
      '⚽ *GOAL!* That ball had a MIND of its own! 🌀',
    ],
    [
      '*{player}* gets a toe on it in the scramble…',
      'it trickles… agonisingly slowly… 🐌',
      '⚽ *GOAL!* Over the line! Scruffy, and they all count! 🙌',
    ],
    [
      '💀 *{player}* robs the defender who took one touch too many…',
      'rolls it into the empty net 🥅',
      '⚽ *GOAL!* Punished! That is a horror show at the back! 😵',
    ],
  ],

  save: [
    [
      '*{player}* winds up and *CRACKS* it! 💥',
      'keeper throws the whole body! 🧤',
      '🛑 *SAVED!* Bro stretched like elastic! 🤯',
    ],
    [
      '*{player}* shoots low, looking for the corner...',
      'keeper reads it perfectly 👀',
      '🧤 *CLUTCH SAVE!* Off the post! 😱',
    ],
    [
      '*{player}* lets one fly! ⚡',
      'keeper stands tall...',
      '🛑 *SAVED.* Simple. 😮‍💨',
    ],
    [
      '🔥 *{player}* hammers it goalward!',
      'point-blank stop!! 🧤',
      '🛑 *WHAT A SAVE!* Crowd loses it! 🤯',
    ],
  ],

  near_miss: [
    [
      '*{player}* opens up... 🎯',
      'curls it sweet...',
      '😩 *JUST WIDE!* The post is shaking! 😮',
    ],
    [
      '*{player}* with room...',
      'sends it... 💨',
      '😱 *OVER!* Bruh, what a waste! 🤦',
    ],
    [
      '⚡ *{player}* from distance!',
      'keeper gets a fingertip...',
      '😬 *SO CLOSE!* Clipped the bar! 😮',
    ],
  ],

  blocked: [
    [
      '*{player}* shapes to shoot... 🎯',
      'a body throws itself in front 🦵',
      '🛡️ *BLOCKED!* Gritty defending! 💪',
    ],
    [
      '🔥 *{player}* loads up...',
      'last-ditch block deflects wide!',
      '🛡️ *BLOCKED!* Bodies on the line! 💪',
    ],
  ],

  dribble_success: [
    [
      '*{player}* takes his man... 👀',
      'one way... then the other 💃',
      '🔥 *NUTMEG!* Gone. Defence COOKED! 😤',
    ],
    [
      '*{player}* flies forward with pace! 💨',
      'beats one! beats two!',
      '🚀 *RUN!* Wide open now! 🔥',
    ],
    [
      '*{player}* shimmies... 🤔',
      'defender bites...',
      '⚡ *GONE!* Like he wasn\'t there! 😂',
    ],
    [
      '🔥 *{player}* glides through the press!',
      'mazy little run...',
      '⚡ *CHEF\'S KISS!* Stand up! 🌟',
    ],
  ],

  tackled: [
    [
      '*{player}* tries to dance past...',
      'here comes the crunch 🦵',
      '🔄 *TACKLED!* Clean. Turnover. ⚽',
    ],
    [
      '*{player}* pushes on...',
      'caught napping! 😤',
      '🔄 *TURNOVER!* Defence wins it. 💪',
    ],
  ],

  foul: [
    [
      '*{player}* drives into the box...',
      'goes down! 🫣',
      '📋 *FOUL!* Penalty given! 🟡',
    ],
    [
      '*{player}* wriggles free...',
      'reckless from behind! 😤',
      '🟡 *FREE KICK!* Dangerous spot! ⚡',
    ],
  ],

  pass: [
    [
      '*{player}* looks up... 👀',
      '⚽ *slick ball* into space!',
    ],
    [
      '*{player}* on it...',
      'one-two, release! 💫 *clean*',
    ],
    [
      '*{player}* drives...',
      'slides it through — 🎯 *smart*',
    ],
    [
      '🔄 *{player}* switches it wide...',
      '⚽ *nice* — stretching them out 💫',
    ],
  ],

  corner_goal: [
    [
      '🚩 Corner in...',
      'dropped at the back stick... *{player}* rises! 🦅',
      '⚽ *HEADER! GOAL!!* Pure power! 💥',
    ],
  ],
  corner_save: [
    [
      '🚩 Corner comes...',
      'scramble...',
      '🧤 *KEEPER CLAIMS!* Sorted. 😮‍💨',
    ],
  ],
  corner_cleared: [
    [
      '🚩 Corner...',
      'swung in...',
      '🧱 *CLEARED!* Nothing doing. 💤',
    ],
  ],

  quick_attack: [
    [
      '⚡ *QUICK THROW!*',
      '*{player}* catches them SLEEPING! 😱',
      '🏃 space opened up... 🔥',
    ],
  ],
  possession_reset: [
    [
      '🔄 Short throw...',
      '*{player}* keeps it calm.',
    ],
  ],
  long_throw: [
    [
      '📏 *LONG THROW!*',
      'hurled into the mixer... 😱',
      '⚡ Scramble! Everyone in! 🔥',
    ],
  ],
};

// Atmosphere lines sprinkled between moments to keep it tense
const ATMOSPHERE = [
  '🔥 Tempo is *insane* — nobody backing down!',
  '⏱️ Clock ticking... the pressure is *real*.',
  '🌟 The crowd is LIVE for this one!',
  '💥 End-to-end stuff — any second it blows up!',
  '🧠 Both managers chewing their nails.',
  '⚡ A big tackle sets the tone — no mercy!',
  '🎯 Chaos at both ends — pure chaos!',
  '😤 Frustration building, chances keep coming.',
];

// A goal means different things depending on when it lands and what it does to
// the scoreline. Previously every goal got the same six-sequence treatment, so
// a consolation in a 5-0 rout read exactly like a last-minute winner. This adds
// one line of context AFTER the sequence, which is cheap and does most of the
// work of making a match feel like it has a story.
function scorelineNote(ctx) {
  const { forGoals, againstGoals, minute } = ctx;
  if (typeof forGoals !== 'number' || typeof againstGoals !== 'number') return null;

  const lead = forGoals - againstGoals;
  const late = minute >= 80;
  const veryLate = minute >= 88;

  if (veryLate && lead === 1) return '🚨 *That could be the last kick of the game.*';
  if (late && lead === 0)     return '😱 *They have levelled it with almost no time left!*';
  if (lead === 0 && forGoals >= 2) return '🔥 *All the way back — this is level again.*';
  if (lead === 1 && forGoals === 1 && againstGoals === 0 && minute <= 15) return '⚡ *An early one. Game on.*';
  if (lead >= 4)  return '😬 *This is getting embarrassing now.*';
  if (lead === 3) return '💪 *Three clear. Comfortable.*';
  if (lead === -1 && late) return '⏳ *Still behind, and the clock is not helping.*';
  if (lead === -2) return '🙃 *A goal back, but there is work to do.*';
  return null;
}

function buildBurst(eventType, ctx = {}, elapsed = 0) {
  const pool = SEQUENCES[eventType];
  if (!pool) return [`⚽ ${eventType}`];

  const keyFn = (seq) => seq.join('|');
  const sequence = pick(notRecent(pool, keyFn, ctx.matchId));
  remember([keyFn(sequence)], ctx.matchId);
  const minute   = toFootballMinute(elapsed);
  const prefix   = `⏱️ ${minute}'`;

  const out = sequence.map((line, i) => {
    const filled = line
      .replace(/{player}/g, ctx.player || 'The player')
      .replace(/{team}/g,   ctx.team   || 'The team');
    return i === 0 ? `${prefix} — ${filled}` : filled;
  });

  if (eventType === 'goal') {
    const note = scorelineNote({ ...ctx, minute });
    if (note) out.push(note);
  }
  return out;
}

// Extra crowd/tension lines that only make sense deep into the match, so the
// atmosphere aligns with the clock instead of feeling minute-agnostic.
const LATE_ATMOSPHERE = [
  '⏳ The clock is ticking down — every touch matters now!',
  '😰 Nerves are FRAYED with time running out!',
  '🔥 Squeaky-bum time — the crowd can barely watch!',
  '🚨 Deep into the match — one moment could decide it all!',
  '⚡ Legs are heavy but the drama is peaking!',
  '😤 This is where matches are won and lost!',
];

// Draw a background atmosphere line. Late in the game (75'+) it may pull from a
// clock-aware pool so the vibe matches how deep we are into the match.
function atmosphereLine(minute = 0) {
  const usePool = (minute >= 75 && Math.random() < 0.6) ? LATE_ATMOSPHERE : ATMOSPHERE;
  const line = pick(notRecent(usePool, (l) => l));
  remember([line]);
  return line;
}

// A single Gen Z connective line (BUILDUP / DEFENSE / PRESSURE / TURNOVER /
// HYPE), filled with context and tracked against the no-repeat window.
function genZFlow(category, ctx = {}) {
  const pool = GEN_Z[category];
  if (!pool || !pool.length) return '';
  const line = pick(notRecent(pool, (l) => l));
  remember([line]);
  return fillGenZ(line, ctx);
}

function buildMatchReport({ homeName, awayName, homeScore, awayScore, lines, scorers, brand }) {
  const result =
    homeScore > awayScore ? `🏆 *${homeName}* WINS!` :
    awayScore > homeScore ? `🏆 *${awayName}* WINS!` :
    `🤝 *DRAW!*`;

  const goalLines = scorers.length
    ? scorers.map(g => `  ⚽ ${g.player} ${g.minute}' (${g.team === 'home' ? homeName : awayName})`).join('\n')
    : '  No goals. Yikes.';

  const body = lines.length ? lines.join('\n') : 'A cagey one — barely a sniff.';

  return `━━━━━━━━━━━━━━━━━━━━━━━━
🏟️ *FULL TIME — VOLTA*
━━━━━━━━━━━━━━━━━━━━━━
🏠 *${homeName}*  ${homeScore} – ${awayScore}  *${awayName}* 🚗
━━━━━━━━━━━━━━━━━━━━━━

${body}

━━━━━━━━━━━━━━━━━━━━━━━━
📊 *FINAL* — ${homeScore}–${awayScore}
${result}

*⚽ Goals:*
${goalLines}
━━━━━━━━━━━━━━━━━━━━━━━━
${brand || BRAND}`;
}

function decisionPrompt(playerName, minute, scenario = '') {
  return `
🎮 *YOUR CALL!*
━━━━━━━━━━━━━━━━━━━━━━━
⏱️ ${minute}' — *${playerName}* on the ball!

${scenario}

1️⃣ Pass   2️⃣ Shoot   3️⃣ Dribble   4️⃣ Skill
━━━━━━━━━━━━━━━━━━━━━━━`;
}

module.exports = {
  buildBurst,
  endMatch,
  scorelineNote,
  atmosphereLine,
  genZFlow,
  buildMatchReport,
  decisionPrompt,
};
