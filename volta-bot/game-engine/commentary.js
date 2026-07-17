const { pick, randInt } = require('../utils/random');
const { toFootballMinute } = require('./matchEngine');
const { BRAND } = require('../config/constants');
const { GEN_Z, fillLine: fillGenZ } = require('./commentaryGenZ');

// Per-process recent-line tracker: keeps the last RECENT_CAP lines so a given
// match never repeats commentary within its own flow (matches run over a few
// seconds and a 40-line window comfortably covers one match).
const recent = new Set();
const RECENT_CAP = 40;

function remember(lines) {
  for (const l of lines) if (l) recent.add(l);
  while (recent.size > RECENT_CAP) {
    const first = recent.values().next().value;
    if (first === undefined) break;
    recent.delete(first);
  }
}
function notRecent(pool, keyFn) {
  const fresh = pool.filter((item) => !recent.has(keyFn(item)));
  return fresh.length ? fresh : pool;
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

function buildBurst(eventType, ctx = {}, elapsed = 0) {
  const pool = SEQUENCES[eventType];
  if (!pool) return [`⚽ ${eventType}`];

  const keyFn = (seq) => seq.join('|');
  const sequence = pick(notRecent(pool, keyFn));
  remember([keyFn(sequence)]);
  const minute   = toFootballMinute(elapsed);
  const prefix   = `⏱️ ${minute}'`;

  return sequence.map((line, i) => {
    const filled = line
      .replace(/{player}/g, ctx.player || 'The player')
      .replace(/{team}/g,   ctx.team   || 'The team');
    return i === 0 ? `${prefix} — ${filled}` : filled;
  });
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
  atmosphereLine,
  genZFlow,
  buildMatchReport,
  decisionPrompt,
};
