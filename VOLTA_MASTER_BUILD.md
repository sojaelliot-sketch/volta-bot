# ⚽ VOLTA SOCCER BOT — UNIFIED MASTER BUILD DOCUMENT
### 𝙈𝙀𝙏𝘼𝙒𝙊𝙍𝙆𝙎™ | Version 5.0 FINAL
### WhatsApp · Node.js · Baileys · MongoDB · Socket-based real-time

---

> **How to use this document:**
> This is the single source of truth for the entire Volta Soccer Bot system.
> It merges v3 prompt + v4 Master System + Logic Core into one buildable spec.
> It is divided into numbered PHASES. Each phase has a DEBUG CHECKLIST.
> Complete each phase and check every box before proceeding to the next.

---

## 🧠 THE CORE EXPERIENCE LOOP (READ THIS FIRST)

The match must *feel* like watching a real game on your phone. The key mechanic that creates tension is **sequential message bursting** — the bot does NOT send one long match dump. It sends individual WhatsApp messages in sequence with short delays between them, like a live match thread:

```
[msg 1]  ⏱️ 23' — Flash has the ball on the right wing...
[msg 2]  He cuts inside past the defender! 💨
[msg 3]  Opens up his body... and SHOOTS! 🎯
[msg 4]  ⚽ GOOOAL! Iron Wall had no chance!
```

Each message is its own `sock.sendMessage()` call with a 600–1200ms delay between them. This is non-negotiable. It is what makes this feel like a live match, not a text wall.

---

## 📐 SYSTEM OVERVIEW

```
volta-bot/
├── index.js                    ← Bot entry point + Baileys connection
├── .env
├── package.json
├── config/
│   ├── constants.js            ← All game constants (single source of truth)
│   └── database.js             ← MongoDB connection
├── models/
│   ├── User.js                 ← Manager/player profile
│   ├── Player.js               ← Football player card
│   ├── Match.js                ← Match state
│   ├── Market.js               ← Transfer listings
│   └── Tournament.js           ← Competition brackets
├── game-engine/
│   ├── matchEngine.js          ← Stat math: ActionPower, DefensePower, outcomes
│   ├── matchSession.js         ← Full match orchestrator + message burst loop
│   └── commentary.js           ← All commentary line pools + message builders
├── commands/
│   ├── router.js               ← Master command dispatcher
│   ├── start.js                ← !start, !register
│   ├── squad.js                ← !squad, !lineup, !bench, !rename, !condition
│   ├── match.js                ← !play, !challenge, !decision
│   ├── market.js               ← !market, !buy, !sell, !list
│   ├── shop.js                 ← !shop, !pack, !boost, !train
│   ├── academy.js              ← !academy, !scout, !promote
│   ├── daily.js                ← !daily, !streak
│   ├── tournament.js           ← !tournament, !enter, !bracket
│   ├── leaderboard.js          ← !leaderboard, !rank, !stats
│   └── help.js                 ← !help, !menu
├── market/
│   └── marketService.js
├── shop/
│   └── shopService.js
├── academy/
│   └── academyService.js
├── ai/
│   └── aiOpponent.js
└── utils/
    ├── logger.js
    ├── random.js
    ├── formatter.js
    └── playerGenerator.js
```

---

## ⚙️ TECH STACK

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| WhatsApp | `@whiskeysockets/baileys` ^6.7.9 |
| Database | MongoDB via `mongoose` |
| Logger | `pino` + `pino-pretty` |
| IDs | `uuid` |
| Env | `dotenv` |
| Dev | `nodemon` |

**package.json dependencies:**
```json
{
  "dependencies": {
    "@whiskeysockets/baileys": "^6.7.9",
    "mongoose": "^8.3.4",
    "pino": "^9.1.0",
    "pino-pretty": "^11.0.0",
    "dotenv": "^16.4.5",
    "qrcode-terminal": "^0.12.0",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "nodemon": "^3.1.0"
  }
}
```

---

## 🌍 ENVIRONMENT

```env
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/volta_bot
BOT_NAME=VoltaBot
SESSION_DIR=./sessions
LOG_LEVEL=info
NODE_ENV=development
```

---

---

# 📦 PHASE 1 — FOUNDATION
## Bot entry point · Database · Constants · Logger · Formatter

---

### 1.1 — `config/constants.js`

This is the single source of truth for all numbers. **Never hardcode a game value anywhere else.**

```javascript
// config/constants.js
module.exports = {

  // ─── MATCH ─────────────────────────────────────────────────────────────
  MATCH: {
    TOTAL_SECONDS: 240,           // Real seconds the match loop runs
    HALF_TIME_SECONDS: 120,
    FOOTBALL_MINUTES: 90,         // Maps to above for display
    EVENT_DURATIONS: {
      SHORT:   [10, 15],          // pass
      MEDIUM:  [15, 20],          // shoot, dribble
      COMPLEX: [20, 25],          // skillmove, corner, throwin
    },
    SET_PIECES_PER_TEAM: 3,
    MOMENTUM_BASE: 50,
    MOMENTUM_CHANGES: {
      GOAL:      12,
      MISS:      -7,
      BIG_SAVE:   8,
      TURNOVER:  -3,
    },
    // Late-game phase boundary (in football minutes)
    LATE_GAME_MINUTE: 70,
    LATE_GAME_BOOST_MAX: 10,
    // Message delay between burst messages (ms)
    BURST_DELAY: 800,
    DECISION_TIMEOUT_MS: 30000,
  },

  // ─── ECONOMY ───────────────────────────────────────────────────────────
  ECONOMY: {
    STARTING_CURRENCY: 500,
    WIN_REWARD:  150,
    DRAW_REWARD:  90,
    LOSS_REWARD:  60,
    MVP_BONUS:   100,
    DAILY_BASE:   50,
    STREAK_MULTIPLIER: 1.2,
    MAX_DAILY:   300,
  },

  // ─── PACKS ─────────────────────────────────────────────────────────────
  PACKS: {
    STARTER: { cost: 200, count: 3, weights: { Common: 70, Rare: 25, Elite: 5,  Legendary: 0  } },
    PRO:     { cost: 500, count: 4, weights: { Common: 40, Rare: 40, Elite: 18, Legendary: 2  } },
    ELITE:   { cost: 1200,count: 5, weights: { Common: 10, Rare: 40, Elite: 38, Legendary: 12 } },
  },

  // ─── RARITY ────────────────────────────────────────────────────────────
  RARITY: {
    Common:    { emoji: '⚪', bonus: 0,    statMin: 40, statMax: 70 },
    Rare:      { emoji: '🔵', bonus: 200,  statMin: 60, statMax: 80 },
    Elite:     { emoji: '🟣', bonus: 600,  statMin: 72, statMax: 90 },
    Legendary: { emoji: '🟡', bonus: 2000, statMin: 85, statMax: 99 },
  },

  // ─── PLAYER ────────────────────────────────────────────────────────────
  PLAYER: {
    CONDITION_DECAY_MATCH:    5,
    CONDITION_DECAY_TRAINING: 3,
    FORM_BOOST_PCT:    5,
    CHEMISTRY_CAP:     1.15,
    POTENTIAL_WEIGHTS: {
      Common:    { Low: 50, Medium: 40, High: 10, Star: 0  },
      Rare:      { Low: 20, Medium: 45, High: 30, Star: 5  },
      Elite:     { Low: 5,  Medium: 25, High: 50, Star: 20 },
      Legendary: { Low: 0,  Medium: 10, High: 40, Star: 50 },
    },
  },

  // ─── TRAINING ──────────────────────────────────────────────────────────
  TRAINING: {
    BASE_COST:  80,
    ELITE_COST: 250,
    GREAT_ROLL: 70,
    POOR_ROLL:  30,
    STAT_CAP:   99,
  },

  // ─── MMR ───────────────────────────────────────────────────────────────
  MMR: {
    WIN:  25,
    DRAW:  0,
    LOSS: -15,
    RANKS: [
      { label: 'Bronze',   min: 0    },
      { label: 'Silver',   min: 1100 },
      { label: 'Gold',     min: 1300 },
      { label: 'Platinum', min: 1500 },
      { label: 'Diamond',  min: 1800 },
      { label: 'Legend',   min: 2100 },
    ],
  },

  // ─── TOURNAMENT ────────────────────────────────────────────────────────
  TOURNAMENT: {
    ENTRY_FEE: 300,
    REWARDS:   { winner: 1500, runner_up: 600, semi: 250 },
    MAX_PLAYERS: 8,
  },

  // ─── AI ────────────────────────────────────────────────────────────────
  AI: {
    EASY:   { statBase: 55, randomness: 0.4 },
    MEDIUM: { statBase: 70, randomness: 0.2 },
    HARD:   { statBase: 85, randomness: 0.05 },
  },

  // ─── SHOP ──────────────────────────────────────────────────────────────
  SHOP: {
    ENERGY_RESTORE: 150,
    FORM_BOOST:     200,
    FOCUS_BOOST:    100,
    RENAME_TOKEN:    50,
  },

  // ─── ACADEMY ───────────────────────────────────────────────────────────
  ACADEMY: {
    SCOUT_COST:   100,
    SCOUT_SLOTS:    2,
    YOUTH_STAT_MIN: 35,
    YOUTH_STAT_MAX: 60,
  },

  // ─── MARKET ────────────────────────────────────────────────────────────
  MARKET: {
    MIN_PRICE_RATIO: 0.5,     // min listing = 50% of market value
    LISTING_HOURS:   48,
    AI_SEED_COUNT:   10,
    PAGE_SIZE:        6,
  },
};
```

---

### 1.2 — `index.js` — Bot Entry Point

```javascript
// index.js
require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode  = require('qrcode-terminal');
const logger  = require('./utils/logger');
const { connectDB } = require('./config/database');
const router  = require('./commands/router');

async function startBot() {
  await connectDB();

  const { state, saveCreds } = await useMultiFileAuthState(process.env.SESSION_DIR || './sessions');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: require('pino')({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      logger.info('📱 Scan QR code to connect:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut
        : true;
      logger.warn(`🔌 Connection closed. Reconnecting: ${shouldReconnect}`);
      if (shouldReconnect) setTimeout(startBot, 3000);
    }
    if (connection === 'open') {
      logger.info('✅ VoltaBot connected to WhatsApp!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      await router.handle(sock, msg);
    }
  });
}

startBot().catch(err => {
  logger.error({ err }, '❌ Fatal startup error');
  process.exit(1);
});
```

---

### Phase 1 Debug Checklist

```
PHASE 1 — FOUNDATION
□ npm install completes with no errors
□ .env file created and MONGODB_URI filled in
□ node index.js starts without crashing
□ QR code appears in terminal
□ Scanning QR connects bot successfully
□ "VoltaBot connected" log appears
□ MongoDB connection log shows "✅ MongoDB connected"
□ Sending any message to bot does NOT crash the process
□ CTRL+C kills the process cleanly
□ nodemon restarts on file save (dev mode)
```

---

---

# 📦 PHASE 2 — PLAYER & USER DATA LAYER
## Models · Player Generator · Player Cards

---

### 2.1 — `models/User.js`

```javascript
// models/User.js
const mongoose = require('mongoose');
const { ECONOMY, MMR } = require('../config/constants');

const userSchema = new mongoose.Schema({
  whatsappId:  { type: String, required: true, unique: true, index: true },
  name:        { type: String, default: 'Manager' },
  currency:    { type: Number, default: ECONOMY.STARTING_CURRENCY },

  // Squad
  startingXI:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }], // max 3
  bench:       [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }], // max 4
  reserves:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }],

  // Competitive
  mmr:         { type: Number, default: 1000 },
  rank:        { type: String, default: 'Bronze' },
  wins:        { type: Number, default: 0 },
  losses:      { type: Number, default: 0 },
  draws:       { type: Number, default: 0 },
  totalGoals:  { type: Number, default: 0 },

  // Daily
  lastDaily:   { type: Date, default: null },
  dailyStreak: { type: Number, default: 0 },

  // State
  inMatch:        { type: Boolean, default: false },
  currentMatchId: { type: String,  default: null },
  registered:     { type: Boolean, default: false },

}, { timestamps: true });

userSchema.virtual('winRate').get(function () {
  const t = this.wins + this.losses + this.draws;
  return t === 0 ? 0 : Math.round((this.wins / t) * 100);
});

userSchema.set('toJSON', { virtuals: true });
module.exports = mongoose.model('User', userSchema);
```

---

### 2.2 — `models/Player.js`

```javascript
// models/Player.js
const mongoose = require('mongoose');

const statsSchema = new mongoose.Schema({
  // Outfield stats
  pace:         { type: Number, default: 60 },
  skill:        { type: Number, default: 60 },
  shooting:     { type: Number, default: 60 },
  stamina:      { type: Number, default: 60 },
  composure:    { type: Number, default: 60 },
  // GK stats (only used if role === 'goalkeeper')
  reflex:       { type: Number, default: 60 },
  positioning:  { type: Number, default: 60 },
  anticipation: { type: Number, default: 60 },
  strength:     { type: Number, default: 60 },
}, { _id: false });

const playerSchema = new mongoose.Schema({
  ownerId:       { type: String, required: true, index: true },
  name:          { type: String, required: true },
  nickname:      { type: String, default: null },   // custom name via !rename
  role:          { type: String, enum: ['outfield', 'goalkeeper'], default: 'outfield' },
  rarity:        { type: String, enum: ['Common', 'Rare', 'Elite', 'Legendary'], default: 'Common' },
  potential:     { type: String, enum: ['Low', 'Medium', 'High', 'Star'], default: 'Medium' },
  level:         { type: Number, default: 1 },
  stats:         { type: statsSchema, default: () => ({}) },

  // Dynamic
  condition:     { type: Number, default: 100, min: 0, max: 100 },
  form:          { type: String, enum: ['Hot', 'Normal', 'Cold'], default: 'Normal' },
  chemistry:     { type: Number, default: 0, min: 0, max: 100 },

  // Market
  isListed:      { type: Boolean, default: false },
  marketPrice:   { type: Number, default: 0 },
  isAI:          { type: Boolean, default: false },

  // Career stats
  matchesPlayed: { type: Number, default: 0 },
  goals:         { type: Number, default: 0 },
  assists:       { type: Number, default: 0 },
  saves:         { type: Number, default: 0 },
  manOfTheMatch: { type: Number, default: 0 },

  nationality:   { type: String, default: 'Nigerian' },
  age:           { type: Number, default: 21 },

}, { timestamps: true });

// Display name (nickname takes priority)
playerSchema.virtual('displayName').get(function () {
  return this.nickname || this.name;
});

// Total stats for value calc
playerSchema.virtual('totalStats').get(function () {
  const s = this.stats;
  return this.role === 'goalkeeper'
    ? (s.reflex + s.positioning + s.anticipation + s.strength + s.composure)
    : (s.pace + s.skill + s.shooting + s.stamina + s.composure);
});

// Market value formula
// Value = (TotalStats × LevelFactor × FormFactor) + RarityBonus
playerSchema.virtual('marketValue').get(function () {
  const { RARITY } = require('../config/constants');
  const rarityBonus  = RARITY[this.rarity]?.bonus || 0;
  const levelFactor  = 1 + (this.level - 1) * 0.1;
  const formFactor   = this.form === 'Hot' ? 1.1 : this.form === 'Cold' ? 0.9 : 1.0;
  return Math.round(this.totalStats * levelFactor * formFactor + rarityBonus);
});

playerSchema.set('toJSON', { virtuals: true });
module.exports = mongoose.model('Player', playerSchema);
```

---

### 2.3 — `utils/playerGenerator.js`

**Name pool is carefully considered — real Nigerian names mixed with football-style street names for VOLTA flavor.**

```javascript
// utils/playerGenerator.js
const Player  = require('../models/Player');
const { RARITY, PLAYER, ACADEMY } = require('../config/constants');
const { randInt, weightedRandom, pick } = require('./random');

// ─── NAME POOLS ──────────────────────────────────────────────────────────────

const NIGERIAN_FIRST = [
  'Kelechi', 'Chukwuemeka', 'Obinna', 'Tunde', 'Amara', 'Seun', 'Dami',
  'Femi', 'Leke', 'Uche', 'Nnamdi', 'Bayo', 'Dotun', 'Gbenga', 'Kunle',
  'Emeka', 'Chidi', 'Onyeka', 'Biodun', 'Rotimi', 'Adewale', 'Ikenna',
];

const NIGERIAN_LAST = [
  'Okafor', 'Adeyemi', 'Nwosu', 'Eze', 'Bello', 'Lawal', 'Okonkwo', 'Musa',
  'Babatunde', 'Okeke', 'Abiodun', 'Obi', 'Amadi', 'Chukwu', 'Afolabi',
];

// Street/VOLTA-style nicknames — auto-assigned as name on Elite/Legendary players
const VOLTA_NICKNAMES = [
  'Flash', 'Shadow Striker', 'Night King', 'The Blur', 'El Diablo',
  'Iron Boot', 'Smoke', 'Razor', 'Ghost Foot', 'Thunderbolt',
  'The Sniper', 'El Fantasma', 'Bolt', 'The Wall', 'Predator',
  'Viper', 'Storm', 'Nova', 'Apex', 'The Machine',
];

// GK names always have an intimidating handle
const GK_NAMES = [
  'Iron Wall', 'Stone Hands', 'The Vault', 'Block Mode', 'The Fortress',
  'No Entry', 'Safe Hands', 'The Shield', 'Concrete', 'The Barrier',
];

function randomName(role, rarity) {
  if (role === 'goalkeeper') return pick(GK_NAMES);
  if (rarity === 'Elite' || rarity === 'Legendary') return pick(VOLTA_NICKNAMES);
  return `${pick(NIGERIAN_FIRST)} ${pick(NIGERIAN_LAST)}`;
}

// ─── STAT GENERATION ─────────────────────────────────────────────────────────

function randomStat(rarity) {
  const { statMin, statMax } = RARITY[rarity] || RARITY.Common;
  return randInt(statMin, statMax);
}

function buildStats(role, rarity) {
  const s = () => randomStat(rarity);
  if (role === 'goalkeeper') {
    return { reflex: s(), positioning: s(), anticipation: s(), strength: s(), composure: s() };
  }
  return { pace: s(), skill: s(), shooting: s(), stamina: s(), composure: s() };
}

// ─── BUILD PLAYER ─────────────────────────────────────────────────────────────

function buildPlayer(ownerId, rarity = 'Common', role = null) {
  const resolvedRole = role || (Math.random() < 0.85 ? 'outfield' : 'goalkeeper');
  const potWeights   = PLAYER.POTENTIAL_WEIGHTS[rarity] || PLAYER.POTENTIAL_WEIGHTS.Common;
  const age          = randInt(17, 32);

  return new Player({
    ownerId,
    name:      randomName(resolvedRole, rarity),
    role:      resolvedRole,
    rarity,
    potential: weightedRandom(potWeights),
    stats:     buildStats(resolvedRole, rarity),
    age,
    condition: 100,
    form:      'Normal',
  });
}

// ─── PACK OPEN ────────────────────────────────────────────────────────────────

async function openPack(ownerId, packConfig) {
  const players = [];
  for (let i = 0; i < packConfig.count; i++) {
    const rarity = weightedRandom(packConfig.weights);
    const p = buildPlayer(ownerId, rarity);
    await p.save();
    players.push(p);
  }
  return players;
}

// ─── ACADEMY YOUTH ───────────────────────────────────────────────────────────

async function buildYouthPlayer(ownerId) {
  const role = Math.random() < 0.85 ? 'outfield' : 'goalkeeper';
  const p = buildPlayer(ownerId, 'Common', role);
  // Overwrite stats with youth ranges
  const statKeys = role === 'goalkeeper'
    ? ['reflex', 'positioning', 'anticipation', 'strength', 'composure']
    : ['pace', 'skill', 'shooting', 'stamina', 'composure'];
  for (const k of statKeys) {
    p.stats[k] = randInt(ACADEMY.YOUTH_STAT_MIN, ACADEMY.YOUTH_STAT_MAX);
  }
  p.potential = weightedRandom({ Medium: 30, High: 50, Star: 20 });
  p.age       = randInt(15, 18);
  return p;
}

// ─── SEED AI MARKET PLAYERS ──────────────────────────────────────────────────

async function seedMarketPlayer(rarity = null) {
  const rarities  = ['Common', 'Common', 'Rare', 'Rare', 'Elite', 'Legendary'];
  const r         = rarity || pick(rarities);
  const p         = buildPlayer('AI_MARKET', r);
  p.isAI          = true;
  await p.save();
  return p;
}

module.exports = { buildPlayer, openPack, buildYouthPlayer, seedMarketPlayer };
```

---

### Phase 2 Debug Checklist

```
PHASE 2 — DATA LAYER
□ User.create() works — document saved to MongoDB
□ Player.create() works — document saved with all stats
□ playerGenerator.buildPlayer() returns valid player object
□ openPack() generates correct number of players per pack type
□ Rarity distribution roughly correct after 20 pack opens
□ GK players get GK stats (reflex/positioning etc), not outfield stats
□ Elite/Legendary players get VOLTA nicknames
□ marketValue virtual returns a number > 0
□ displayName virtual uses nickname when set
□ totalStats virtual sums the correct 5 stats for role
□ Youth players have lower stats than pack players of same rarity
□ seedMarketPlayer() saves to MongoDB with isAI: true
```

---

---

# 📦 PHASE 3 — COMMAND ROUTER & REGISTRATION
## !start · !register · !help · !menu · router

---

### 3.1 — `commands/router.js`

```javascript
// commands/router.js
const User    = require('../models/User');
const logger  = require('../utils/logger');
const { getSessionForUser, submitDecision } = require('../game-engine/matchSession');

// Lazy-load command handlers
const handlers = {
  start:       () => require('./start'),
  register:    () => require('./start'),
  help:        () => require('./help'),
  menu:        () => require('./help'),
  squad:       () => require('./squad'),
  lineup:      () => require('./squad'),
  bench:       () => require('./squad'),
  rename:      () => require('./squad'),
  condition:   () => require('./squad'),
  card:        () => require('./squad'),
  play:        () => require('./match'),
  challenge:   () => require('./match'),
  accept:      () => require('./match'),
  market:      () => require('./market'),
  buy:         () => require('./market'),
  sell:        () => require('./market'),
  list:        () => require('./market'),
  shop:        () => require('./shop'),
  pack:        () => require('./shop'),
  boost:       () => require('./shop'),
  train:       () => require('./shop'),
  academy:     () => require('./academy'),
  scout:       () => require('./academy'),
  promote:     () => require('./academy'),
  daily:       () => require('./daily'),
  tournament:  () => require('./tournament'),
  enter:       () => require('./tournament'),
  bracket:     () => require('./tournament'),
  leaderboard: () => require('./leaderboard'),
  rank:        () => require('./leaderboard'),
  stats:       () => require('./leaderboard'),
};

// Commands that work without registration
const PUBLIC_COMMANDS = new Set(['start', 'register', 'help', 'menu']);

async function handle(sock, msg) {
  const jid  = msg.key.remoteJid;
  const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();

  if (!text.startsWith('!')) return;

  const [rawCmd, ...args] = text.slice(1).split(/\s+/);
  const cmd = rawCmd.toLowerCase();

  logger.info({ jid, cmd, args }, '📨 Command received');

  try {
    // Check if user is mid-match and awaiting decision
    const session = getSessionForUser(jid);
    if (session?.awaitingDecision && ['1', '2', '3', '4'].includes(cmd)) {
      submitDecision(session.matchId, cmd);
      return;
    }

    const getHandler = handlers[cmd];
    if (!getHandler) {
      await sock.sendMessage(jid, { text: `❓ Unknown command: *!${cmd}*\nType *!help* to see all commands.` });
      return;
    }

    // Auth gate
    if (!PUBLIC_COMMANDS.has(cmd)) {
      const user = await User.findOne({ whatsappId: jid });
      if (!user || !user.registered) {
        await sock.sendMessage(jid, { text: `👋 Welcome! You need to register first.\nType *!start* to begin your VOLTA journey!` });
        return;
      }
    }

    const handler = getHandler();
    await handler.handle(sock, msg, jid, args);

  } catch (err) {
    logger.error({ err, cmd, jid }, '❌ Command error');
    await sock.sendMessage(jid, { text: `⚠️ Something went wrong. Try again or type *!help*.` });
  }
}

module.exports = { handle };
```

---

### 3.2 — `commands/start.js`

```javascript
// commands/start.js
const User   = require('../models/User');
const { openPack } = require('../utils/playerGenerator');
const { PACKS }    = require('../config/constants');
const { formatCard } = require('./squad');

async function handle(sock, msg, jid, args) {
  const cmd = msg.message?.conversation?.split(' ')[0]?.slice(1)?.toLowerCase();

  if (cmd === 'start') {
    let user = await User.findOne({ whatsappId: jid });
    if (user?.registered) {
      await sock.sendMessage(jid, { text: `✅ You're already registered, Manager!\nType *!menu* to see all commands.` });
      return;
    }

    await sock.sendMessage(jid, { text: `
⚽ *WELCOME TO VOLTA SOCCER BOT*
━━━━━━━━━━━━━━━━━━━━━━━━
𝙈𝙀𝙏𝘼𝙒𝙊𝙍𝙆𝙎™ Production

Build your squad. Dominate the streets.

To register, type: *!register [your name]*
Example: *!register Tunde*
━━━━━━━━━━━━━━━━━━━━━━━━`
    });
    return;
  }

  if (cmd === 'register') {
    let user = await User.findOne({ whatsappId: jid });
    if (user?.registered) {
      await sock.sendMessage(jid, { text: `✅ Already registered! Type *!menu*.` });
      return;
    }

    const name = args.join(' ').trim() || 'Manager';

    user = user || new User({ whatsappId: jid });
    user.name       = name;
    user.registered = true;
    await user.save();

    // Give starter pack
    const starterPlayers = await openPack(jid, PACKS.STARTER);
    await User.updateOne({ whatsappId: jid }, {
      $push: {
        startingXI: { $each: starterPlayers.slice(0, 3).map(p => p._id) },
        reserves:   { $each: starterPlayers.slice(3).map(p => p._id) },
      }
    });

    await sock.sendMessage(jid, { text: `
🎉 *REGISTRATION COMPLETE!*
━━━━━━━━━━━━━━━━━━━━━━━━
Welcome, *${name}*! 🙌

You received a FREE Starter Pack!
Here are your first players:
` });

    for (const p of starterPlayers) {
      await sock.sendMessage(jid, { text: formatCard(p) });
      await sleep(500);
    }

    await sock.sendMessage(jid, { text: `
━━━━━━━━━━━━━━━━━━━━━━━━
💲 Starting currency: *500 Metaworks*
🏟️ Type *!play* to start your first match!
Type *!menu* to see all commands.
━━━━━━━━━━━━━━━━━━━━━━━━` });
    return;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
module.exports = { handle };
```

---

### 3.3 — `commands/help.js`

```javascript
// commands/help.js
async function handle(sock, msg, jid, args) {
  await sock.sendMessage(jid, { text: `
⚽ *VOLTA BOT — COMMAND MENU*
𝙈𝙀𝙏𝘼𝙒𝙊𝙍𝙆𝙎™
━━━━━━━━━━━━━━━━━━━━━━━━

🚀 *GETTING STARTED*
  !start          — Begin your journey
  !register [name]— Create your account

⚽ *MATCHES*
  !play           — Quick match vs AI
  !play hard      — Hard AI opponent
  !challenge @tag — Challenge another player

👥 *SQUAD*
  !squad          — View your full squad
  !lineup         — View Starting XI
  !bench [id]     — Move player to bench
  !card [id]      — View player card
  !condition      — Check all player conditions
  !rename [id] [name] — Rename a player

🛒 *MARKET*
  !market         — Browse transfer market
  !market 2       — Page 2
  !buy [listingID]— Buy a player
  !list [id] [price] — List your player for sale

🛍️ *SHOP*
  !shop           — Browse shop
  !pack starter   — Buy Starter Pack (💲200)
  !pack pro       — Buy Pro Pack (💲500)
  !pack elite     — Buy Elite Pack (💲1200)
  !boost energy [id]  — Restore condition (💲150)
  !boost form [id]    — Hot form boost (💲200)
  !train [id]     — Training session (💲80)
  !train elite [id]   — Elite coaching (💲250)
  !rename [id] [name] — Rename token (💲50)

🏫 *ACADEMY*
  !academy        — View your academy
  !scout          — Scout a youth player (💲100)
  !promote [id]   — Promote youth to first team

🎁 *REWARDS*
  !daily          — Claim daily reward
  !streak         — View streak info

🏆 *COMPETITION*
  !tournament     — View active tournaments
  !enter [id]     — Enter a tournament (💲300)
  !bracket [id]   — View tournament bracket

📊 *STATS & RANK*
  !rank           — Your rank and MMR
  !stats          — Your career stats
  !leaderboard    — Top managers

━━━━━━━━━━━━━━━━━━━━━━━━
💲 Currency: Metaworks | Type any command!` });
}

module.exports = { handle };
```

---

### Phase 3 Debug Checklist

```
PHASE 3 — COMMANDS & REGISTRATION
□ !start sends welcome message
□ !register Tunde creates user in MongoDB
□ Registered user gets 3 starter players added to startingXI
□ !register when already registered shows correct message
□ Unknown command returns helpful error message
□ Commands without !prefix are ignored silently
□ !help shows full command menu
□ !menu alias works same as !help
□ Unregistered user trying !squad gets registration prompt
□ Router does not crash on any malformed input
□ Player cards display correctly in registration flow
```

---

---

# 📦 PHASE 4 — SQUAD MANAGEMENT
## !squad · !lineup · !bench · !card · !condition · !rename

---

### 4.1 — `commands/squad.js`

```javascript
// commands/squad.js
const User   = require('../models/User');
const Player = require('../models/Player');
const { RARITY, SHOP } = require('../config/constants');
const { conditionEmoji, formEmoji, rarityEmoji, statBar, currency } = require('../utils/formatter');

// ─── PLAYER CARD ──────────────────────────────────────────────────────────────
// This format is used everywhere a player card is displayed (FC25-style)
function formatCard(player) {
  const r  = RARITY[player.rarity] || RARITY.Common;
  const dn = player.nickname || player.name;
  const isGK = player.role === 'goalkeeper';

  const statLines = isGK
    ? [
        `  RFX ${statBar(player.stats.reflex)} ${player.stats.reflex}`,
        `  POS ${statBar(player.stats.positioning)} ${player.stats.positioning}`,
        `  ANT ${statBar(player.stats.anticipation)} ${player.stats.anticipation}`,
        `  STR ${statBar(player.stats.strength)} ${player.stats.strength}`,
        `  CMP ${statBar(player.stats.composure)} ${player.stats.composure}`,
      ]
    : [
        `  PAC ${statBar(player.stats.pace)} ${player.stats.pace}`,
        `  SKL ${statBar(player.stats.skill)} ${player.stats.skill}`,
        `  SHT ${statBar(player.stats.shooting)} ${player.stats.shooting}`,
        `  STA ${statBar(player.stats.stamina)} ${player.stats.stamina}`,
        `  CMP ${statBar(player.stats.composure)} ${player.stats.composure}`,
      ];

  return [
    ``,
    `${r.emoji} *${dn}* ${formEmoji(player.form)}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `  ${player.rarity} | ${isGK ? '🧤 Goalkeeper' : '⚽ Outfield'} | Age ${player.age}`,
    `  Potential: ${player.potential} | Level ${player.level}`,
    `  Condition: ${conditionEmoji(player.condition)} ${player.condition}%`,
    ``,
    ...statLines,
    ``,
    `  🏷️ Market Value: ${currency(player.marketValue || 0)}`,
    `  🆔 ID: \`${player._id}\``,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
  ].join('\n');
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
async function handle(sock, msg, jid, args) {
  const cmd = msg.message?.conversation?.split(' ')[0]?.slice(1)?.toLowerCase()
    || msg.message?.extendedTextMessage?.text?.split(' ')[0]?.slice(1)?.toLowerCase();

  const user = await User.findOne({ whatsappId: jid })
    .populate('startingXI')
    .populate('bench')
    .populate('reserves');

  if (!user) return sock.sendMessage(jid, { text: '❌ User not found. Type *!register*.' });

  // ─── !squad ──────────────────────────────────────────────────────────────
  if (cmd === 'squad' || cmd === 'lineup') {
    const xi     = user.startingXI || [];
    const bench  = user.bench      || [];
    const res    = user.reserves   || [];

    let msg_txt = `\n👥 *YOUR SQUAD*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    msg_txt += `*⚡ STARTING XI (${xi.length}/3)*\n`;
    if (!xi.length) msg_txt += `  (empty — use *!promote [id]* to add players)\n`;
    xi.forEach((p, i) => {
      const dn = p.nickname || p.name;
      msg_txt += `  ${i + 1}. ${rarityEmoji(p.rarity)} *${dn}* | ${p.role === 'goalkeeper' ? '🧤' : '⚽'} | ${conditionEmoji(p.condition)} ${p.condition}%\n`;
    });

    msg_txt += `\n*🪑 BENCH (${bench.length}/4)*\n`;
    if (!bench.length) msg_txt += `  (empty)\n`;
    bench.forEach((p, i) => {
      const dn = p.nickname || p.name;
      msg_txt += `  ${i + 1}. ${rarityEmoji(p.rarity)} *${dn}* | ${conditionEmoji(p.condition)} ${p.condition}%\n`;
    });

    msg_txt += `\n*📦 RESERVES (${res.length})*\n`;
    if (!res.length) msg_txt += `  (empty)\n`;
    res.slice(0, 5).forEach((p, i) => {
      const dn = p.nickname || p.name;
      msg_txt += `  ${i + 1}. ${rarityEmoji(p.rarity)} *${dn}*\n`;
    });
    if (res.length > 5) msg_txt += `  ...and ${res.length - 5} more\n`;

    msg_txt += `\n━━━━━━━━━━━━━━━━━━━━━━━━\n💲 ${currency(user.currency)} | MMR: ${user.mmr} | Rank: ${user.rank}`;

    await sock.sendMessage(jid, { text: msg_txt });
    return;
  }

  // ─── !card [id] ──────────────────────────────────────────────────────────
  if (cmd === 'card') {
    const playerId = args[0];
    if (!playerId) {
      await sock.sendMessage(jid, { text: '❌ Usage: *!card [playerID]*' });
      return;
    }
    const player = await Player.findOne({ _id: playerId, ownerId: jid });
    if (!player) {
      await sock.sendMessage(jid, { text: '❌ Player not found in your squad!' });
      return;
    }
    await sock.sendMessage(jid, { text: formatCard(player) });
    return;
  }

  // ─── !condition ──────────────────────────────────────────────────────────
  if (cmd === 'condition') {
    const all = [...(user.startingXI || []), ...(user.bench || [])];
    let txt = `\n🏥 *SQUAD CONDITIONS*\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    all.forEach(p => {
      const dn = p.nickname || p.name;
      txt += `${conditionEmoji(p.condition)} *${dn}* — ${p.condition}%\n`;
    });
    txt += `\n⚡ Use *!boost energy [id]* to restore a player (💲150)`;
    await sock.sendMessage(jid, { text: txt });
    return;
  }

  // ─── !rename [id] [name] ─────────────────────────────────────────────────
  if (cmd === 'rename') {
    const [playerId, ...nameParts] = args;
    const newName = nameParts.join(' ').trim();
    if (!playerId || !newName) {
      await sock.sendMessage(jid, { text: '❌ Usage: *!rename [playerID] [new name]*\nCosts 💲50 per rename.' });
      return;
    }
    if (user.currency < SHOP.RENAME_TOKEN) {
      await sock.sendMessage(jid, { text: `❌ Not enough Metaworks! Rename costs 💲${SHOP.RENAME_TOKEN}.` });
      return;
    }
    const player = await Player.findOne({ _id: playerId, ownerId: jid });
    if (!player) {
      await sock.sendMessage(jid, { text: '❌ Player not found!' });
      return;
    }
    const oldName = player.nickname || player.name;
    player.nickname = newName;
    await player.save();
    await User.updateOne({ whatsappId: jid }, { $inc: { currency: -SHOP.RENAME_TOKEN } });
    await sock.sendMessage(jid, { text: `✏️ *${oldName}* has been renamed to *${newName}*!\n💲 -${SHOP.RENAME_TOKEN} Metaworks` });
    return;
  }

  // ─── !bench [playerID] ───────────────────────────────────────────────────
  if (cmd === 'bench') {
    const playerId = args[0];
    if (!playerId) {
      await sock.sendMessage(jid, { text: '❌ Usage: *!bench [playerID]* — Move player to bench, or *!bench start [playerID]* to move to Starting XI' });
      return;
    }

    // Check if player is in XI → move to bench
    const inXI = user.startingXI.some(p => p._id.toString() === playerId);
    if (inXI) {
      await User.updateOne({ whatsappId: jid }, {
        $pull: { startingXI: mongoose.Types.ObjectId(playerId) },
        $push: { bench: mongoose.Types.ObjectId(playerId) },
      });
      await sock.sendMessage(jid, { text: '✅ Player moved to bench.' });
    } else {
      await sock.sendMessage(jid, { text: '❌ Player is not in your Starting XI.' });
    }
    return;
  }
}

module.exports = { handle, formatCard };
```

---

### Phase 4 Debug Checklist

```
PHASE 4 — SQUAD MANAGEMENT
□ !squad shows Starting XI, Bench, Reserves correctly
□ !squad shows player condition emoji and percentage
□ !card [id] returns FC25-style formatted card
□ GK cards show GK stats (RFX/POS/ANT) not outfield stats
□ !condition shows all player conditions in one message
□ !rename [id] Name deducts 💲50 and updates player.nickname
□ !rename shows error if insufficient currency
□ Renamed player shows new name (not old) in !squad view
□ !bench [id] moves player from XI to bench
□ Squad view correctly handles empty Starting XI gracefully
□ Player IDs are shown in card view for reference
□ marketValue virtual outputs correct number in card
```

---

---

# 📦 PHASE 5 — MATCH ENGINE (CORE)
## The sequential message burst system · stat resolution · commentary

---

## ⚡ THE SEQUENTIAL MESSAGE BURST PROTOCOL

This is the most important implementation detail in the entire project.

**Every match event sends multiple individual WhatsApp messages with delays between them.** This creates the feeling of watching a live match unfold in real time.

```
Event: Shot at goal

Message 1 (immediate):
  "⏱️ 67' — Flash receives the ball on the edge of the box..."

[800ms delay]

Message 2:
  "He shifts it onto his right foot... takes aim... 🎯"

[800ms delay]  

Message 3:
  "⚽ GOOOAL! Curled it into the top corner! Iron Wall had NO CHANCE!"
```

The match is not pre-computed and dumped. It runs as a real-time async loop.

---

### 5.1 — `game-engine/matchEngine.js`

```javascript
// game-engine/matchEngine.js
// Pure stat math — no I/O, no DB, no side effects
const { MATCH, PLAYER } = require('../config/constants');
const { randInt, clamp, withVariance } = require('../utils/random');

// ─── CONDITION SCALING ───────────────────────────────────────────────────────
// EffectiveStats = BaseStats × (condition / 100)
function effectiveStat(value, condition) {
  return Math.round(value * (condition / 100));
}

// ─── FORM MODIFIER ───────────────────────────────────────────────────────────
function formMod(form) {
  return form === 'Hot' ? 1.05 : form === 'Cold' ? 0.95 : 1.0;
}

// ─── CHEMISTRY MULTIPLIER ────────────────────────────────────────────────────
function chemMult(chemistry) {
  return Math.min(1 + (chemistry / 100) * (PLAYER.CHEMISTRY_CAP - 1), PLAYER.CHEMISTRY_CAP);
}

// ─── MOMENTUM EFFECT ─────────────────────────────────────────────────────────
// MomentumEffect = (teamMomentum - 50) × 0.2
function momentumEffect(momentum) {
  return (momentum - 50) * 0.2;
}

// ─── LATE GAME FATIGUE ───────────────────────────────────────────────────────
// After 70' football time, chaos increases, mistakes happen more
function lateGamePenalty(footballMinute, condition) {
  if (footballMinute < MATCH.LATE_GAME_MINUTE) return 0;
  const fatigue = (footballMinute - MATCH.LATE_GAME_MINUTE) * 0.15;
  return -(fatigue * (1 - condition / 100)) * 5;
}

// ─── ACTION POWER ────────────────────────────────────────────────────────────
// ActionPower = (PrimaryStat × Weight) + (SecondaryStat × Weight)
//             + FormBonus + ChemBonus + MomentumEffect + LateGameEffect
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

// ─── DEFENSE POWER ───────────────────────────────────────────────────────────
// DefensePower = (DefStats + GKStats + Positioning) + Pressure + FatigueEffect
function calcDefensePower(defenders, gk, oppMomentum, footballMinute) {
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
    : 55; // fallback if no outfield defenders provided

  let gkPower = 55;
  if (gk) {
    const cond = gk.condition || 100;
    const s    = gk.stats || {};
    // Late game GK gets shaky
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

// ─── SHOT RESOLUTION ─────────────────────────────────────────────────────────
// Returns: 'goal' | 'save' | 'near_miss' | 'blocked'
function resolveShotOutcome(actionPower, gkPower, footballMinute) {
  const lateBoost = footballMinute >= MATCH.LATE_GAME_MINUTE
    ? randInt(0, MATCH.LATE_GAME_BOOST_MAX)
    : 0;
  const diff = (actionPower + lateBoost) - gkPower;
  if (diff > 15)  return 'goal';
  if (diff > 2)   return 'save';
  if (diff > -5)  return 'near_miss';
  return 'blocked';
}

// ─── OUTCOME RESOLUTION ──────────────────────────────────────────────────────
function resolveOutcome(ap, dp) {
  const diff = ap - dp;
  if (diff > 5)  return 'success';
  if (diff > -5) return 'contested';
  return 'failure';
}

// ─── DRIBBLE RESOLUTION ──────────────────────────────────────────────────────
function resolveDribbleOutcome(ap, dp) {
  const o = resolveOutcome(ap, dp);
  if (o === 'success')   return 'dribble_success';
  if (o === 'contested') return 'foul';
  return 'tackled';
}

// ─── SET PIECES ──────────────────────────────────────────────────────────────
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

// ─── MOMENTUM UPDATER ────────────────────────────────────────────────────────
function updateMomentum(current, event) {
  const delta = MATCH.MOMENTUM_CHANGES[event] || 0;
  return clamp(current + delta, 0, 100);
}

// ─── EVENT DURATION ──────────────────────────────────────────────────────────
function eventDuration(action) {
  const { SHORT, MEDIUM, COMPLEX } = MATCH.EVENT_DURATIONS;
  if (['pass'].includes(action))                          return randInt(...SHORT);
  if (['shoot', 'dribble'].includes(action))              return randInt(...MEDIUM);
  if (['skillmove', 'corner', 'throwin'].includes(action)) return randInt(...COMPLEX);
  return randInt(...MEDIUM);
}

// ─── FOOTBALL MINUTE CONVERSION ──────────────────────────────────────────────
// Maps 0–240 elapsed seconds → 0–90 football minutes
function toFootballMinute(elapsedSeconds) {
  return Math.min(90, Math.floor((elapsedSeconds / MATCH.TOTAL_SECONDS) * MATCH.FOOTBALL_MINUTES));
}

module.exports = {
  calcActionPower, calcDefensePower,
  resolveOutcome, resolveShotOutcome, resolveDribbleOutcome,
  resolveCorner, resolveThrowIn,
  updateMomentum, eventDuration, toFootballMinute,
};
```

---

### 5.2 — `game-engine/commentary.js`

**Commentary is designed for BURST delivery — each array entry is one message in the sequence.**

```javascript
// game-engine/commentary.js
const { pick, randInt } = require('../utils/random');
const { toFootballMinute } = require('./matchEngine');

// ─── BURST SEQUENCES ─────────────────────────────────────────────────────────
// Each key maps to an array of arrays. Each inner array = one burst sequence.
// The burst system picks a random sequence and sends each string as its own message.

const SEQUENCES = {

  goal: [
    [
      '{player} has the ball in the box... 👀',
      'He opens up his body... SHOOTS! 🎯',
      '⚽ *GOOOAL!* Top corner! Absolutely FILTHY! 🔥',
    ],
    [
      '*{player}* receives it in stride...',
      'One touch... two touch... BANG! 💥',
      '⚽ *GOAL!!* The net is RIPPLING! 🌊',
    ],
    [
      '*{player}* with the ball at the edge of the box...',
      'He takes a touch and LETS FLY! 💨',
      '⚽ *GOLAZO!* Low and hard — keeper had no chance! 😤',
    ],
    [
      '🎯 *{player}* picks his spot...',
      'The GK dives... but it\'s already in! 🫣',
      '⚽ *GOAL!* Clinical. Absolutely clinical. 💎',
    ],
  ],

  save: [
    [
      '*{player}* receives it... takes aim... 🎯',
      'SHOOTS — and the keeper DIVES! 🧤',
      '🛑 *SAVED!* What a stop! The keeper denies him! 😤',
    ],
    [
      '*{player}* pulls the trigger! 💥',
      'Low to the corner...',
      '🧤 *INCREDIBLE SAVE!* Fingertips! Off the post and out! 😱',
    ],
    [
      '*{player}* shoots first-time! ⚡',
      'The keeper reads it...',
      '🛑 Comfortable *SAVE.* No danger. 💤',
    ],
  ],

  near_miss: [
    [
      '*{player}* opens up his body... 🎯',
      'WHIPS IT! Curling effort...',
      '😩 *JUST WIDE!* The post shook! So close! 😮',
    ],
    [
      '*{player}* with room to shoot...',
      'He takes it on... FIRES! 💨',
      '😱 *OVER THE BAR!* Skies it! What a waste! 🤦',
    ],
  ],

  blocked: [
    [
      '*{player}* shapes to shoot... 🎯',
      'The defender THROWS himself in the way...',
      '🛡️ *BLOCKED!* Great defending! Possession lost. 💪',
    ],
  ],

  dribble_success: [
    [
      '*{player}* takes on his man... 👀',
      'One way... then the other... 💃',
      '🔥 *NUTMEG!* He\'s through! Defence beaten! 😤',
    ],
    [
      '*{player}* drives forward with pace! 💨',
      'Past one! Past two!',
      '🚀 *Sensational run!* He\'s in space now! 🔥',
    ],
    [
      '*{player}* drops a shoulder... 🤔',
      'The defender bites...',
      '⚡ *Gone!* Like he wasn\'t even there! 😂',
    ],
  ],

  tackled: [
    [
      '*{player}* tries to go past the defender...',
      'The challenge comes in... 🦵',
      '🔄 *TACKLED!* Clean as a whistle. Possession changes. ⚽',
    ],
    [
      '*{player}* pushes forward...',
      'He\'s caught in possession! 😤',
      '🔄 Turnover! Defence wins it back. 💪',
    ],
  ],

  foul: [
    [
      '*{player}* drives into the box...',
      'He goes down! 🫣',
      '📋 *FOUL!* Referee points to the spot! 🟡',
    ],
    [
      '*{player}* tries to wriggle free...',
      'Reckless challenge! 😤',
      '🟡 *FREE KICK!* Dangerous position for the defending team! ⚡',
    ],
  ],

  pass: [
    [
      '*{player}* holds the ball... looks up... 👀',
      '⚽ *Slick pass!* Found a man in space!',
    ],
    [
      '*{player}* on the ball...',
      'One-two and away! 💫 *Good combination play.*',
    ],
    [
      '*{player}* drives forward...',
      'Lays it off — 🎯 *clever ball!* Team keeps possession.',
    ],
  ],

  corner_goal: [
    [
      '🚩 Corner taken...',
      'It swings to the back post... *{player}* rises! 🦅',
      '⚽ *HEADER! GOAL!!* From the corner! Pure power! 💥',
    ],
  ],
  corner_save: [
    [
      '🚩 Corner comes in...',
      'Scramble in the box!',
      '🧤 *KEEPER CLAIMS IT!* Good hands! Danger cleared. 😮‍💨',
    ],
  ],
  corner_cleared: [
    [
      '🚩 Corner...',
      'Swings into the area...',
      '🧱 *HEADED CLEAR!* Defended well. Nothing from it. 💤',
    ],
  ],

  quick_attack: [
    [
      '⚡ *QUICK THROW-IN!*',
      '*{player}* catches the defence off guard! 😱',
      '🏃 He\'s got space now... this could be dangerous! 🔥',
    ],
  ],
  possession_reset: [
    [
      '🔄 Throw-in taken slowly...',
      '*{player}* recycles possession.',
    ],
  ],
  long_throw: [
    [
      '📏 *LONG THROW-IN!*',
      'Launched into the box... 😱',
      '⚡ Scramble! Everyone going for it! 🔥',
    ],
  ],
};

// ─── BURST BUILDER ───────────────────────────────────────────────────────────

/**
 * Returns array of strings (messages to be sent one by one with delay)
 * @param {string} eventType
 * @param {object} ctx         { player, team }
 * @param {number} elapsed     seconds elapsed in match
 */
function buildBurst(eventType, ctx = {}, elapsed = 0) {
  const pool = SEQUENCES[eventType];
  if (!pool) return [`⚽ ${eventType}`];

  const sequence = pick(pool);
  const minute   = toFootballMinute(elapsed);
  const prefix   = `⏱️ ${minute}'`;

  return sequence.map((line, i) => {
    const filled = line
      .replace(/{player}/g, ctx.player || 'The player')
      .replace(/{team}/g,   ctx.team   || 'The team');
    // First line gets the time prefix
    return i === 0 ? `${prefix} — ${filled}` : filled;
  });
}

// ─── HALF TIME MESSAGE ───────────────────────────────────────────────────────

function halfTimeMessage(homeName, awayName, homeScore, awayScore) {
  return `
⏸️ *HALF TIME WHISTLE!*
━━━━━━━━━━━━━━━━━━━━━━━━
🏠 *${homeName}*  ${homeScore} – ${awayScore}  *${awayName}* 🚗
━━━━━━━━━━━━━━━━━━━━━━━━
Both sides head to the dressing room.
The manager has 60 seconds to make changes.
━━━━━━━━━━━━━━━━━━━━━━━━`;
}

// ─── FULL TIME MESSAGE ───────────────────────────────────────────────────────

function fullTimeMessage(homeName, awayName, homeScore, awayScore, scorers = []) {
  const result =
    homeScore > awayScore ? `🏆 *${homeName}* WIN!` :
    awayScore > homeScore ? `🏆 *${awayName}* WIN!` :
    `🤝 *IT'S A DRAW!*`;

  const goalLines = scorers.length
    ? scorers.map(g => `  ⚽ ${g.player} ${g.minute}'`).join('\n')
    : '  No goals scored';

  return `
🏁 *FULL TIME!*
━━━━━━━━━━━━━━━━━━━━━━━━
🏠 *${homeName}*  ${homeScore} – ${awayScore}  *${awayName}* 🚗
━━━━━━━━━━━━━━━━━━━━━━━━
${result}

*⚽ Goals:*
${goalLines}
━━━━━━━━━━━━━━━━━━━━━━━━`;
}

// ─── DECISION PROMPT ─────────────────────────────────────────────────────────

function decisionPrompt(playerName, minute, scenario = '') {
  return `
🎮 *YOUR BALL — MAKE A DECISION!*
━━━━━━━━━━━━━━━━━━━━━━━━
⏱️ ${minute}' — *${playerName}* has the ball!

${scenario}

What do you do?
1️⃣ *Pass* — Keep possession safely
2️⃣ *Shoot* — Go for goal!
3️⃣ *Dribble* — Take them on
4️⃣ *Skill Move* — Try something special 🎩

Reply *1, 2, 3* or *4*
━━━━━━━━━━━━━━━━━━━━━━━━`;
}

module.exports = {
  buildBurst,
  halfTimeMessage,
  fullTimeMessage,
  decisionPrompt,
};
```

---

### 5.3 — `game-engine/matchSession.js`

```javascript
// game-engine/matchSession.js
// Full match orchestrator — async event loop with message bursting
const { v4: uuid }  = require('uuid');
const Match   = require('../models/Match');
const User    = require('../models/User');
const Player  = require('../models/Player');
const engine  = require('./matchEngine');
const comm    = require('./commentary');
const ai      = require('../ai/aiOpponent');
const { MATCH, ECONOMY, MMR } = require('../config/constants');
const { pick, randInt }       = require('../utils/random');
const { currency }            = require('../utils/formatter');
const logger  = require('../utils/logger');

// In-memory session map: matchId → session
const activeSessions = new Map();

// ─── BURST SEND ──────────────────────────────────────────────────────────────

async function burst(sock, jid, messages, delay = MATCH.BURST_DELAY) {
  for (const m of messages) {
    await sock.sendMessage(jid, { text: m });
    await sleep(delay);
  }
}

// ─── START MATCH ─────────────────────────────────────────────────────────────

async function startMatch(sock, homeId, awayId = 'AI', options = {}) {
  const { aiDifficulty = 'Medium' } = options;
  const isAI = awayId === 'AI';

  // Load home user + squad
  const homeUser = await User.findOne({ whatsappId: homeId }).populate('startingXI');
  if (!homeUser || homeUser.startingXI.length < 3) {
    await sock.sendMessage(homeId, { text: '❌ You need 3 players in your Starting XI to play!\nUse *!squad* to set up your lineup.' });
    return;
  }
  if (homeUser.inMatch) {
    await sock.sendMessage(homeId, { text: '❌ You\'re already in a match!' });
    return;
  }

  let awaySquad, awayName;
  if (isAI) {
    awaySquad = ai.generateAISquad(aiDifficulty);
    awayName  = `AI (${aiDifficulty})`;
  } else {
    const awayUser = await User.findOne({ whatsappId: awayId }).populate('startingXI');
    if (!awayUser || awayUser.startingXI.length < 3) {
      await sock.sendMessage(homeId, { text: '❌ Your opponent doesn\'t have a valid squad!' });
      return;
    }
    awaySquad = awayUser.startingXI;
    awayName  = awayUser.name;
    await User.updateOne({ whatsappId: awayId }, { inMatch: true, currentMatchId: matchId });
  }

  const matchId   = uuid();
  const homeName  = homeUser.name;

  // Session state
  const session = {
    matchId,
    sock,
    homeId,
    awayId,
    isAI,
    aiDifficulty,
    homeName,
    awayName,
    homeSquad:    JSON.parse(JSON.stringify(homeUser.startingXI)),  // snapshot
    awaySquad:    JSON.parse(JSON.stringify(awaySquad)),
    homeScore:    0,
    awayScore:    0,
    timeElapsed:  0,   // real seconds (0–240)
    homeMomentum: 50,
    awayMomentum: 50,
    homeSetPieces:  { corners: MATCH.SET_PIECES_PER_TEAM, throwins: MATCH.SET_PIECES_PER_TEAM },
    awaySetPieces:  { corners: MATCH.SET_PIECES_PER_TEAM, throwins: MATCH.SET_PIECES_PER_TEAM },
    halfTimeDone:   false,
    awaitingDecision: false,
    pendingResolver:  null,
    events:         [],
    goalScorers:    [],
  };

  activeSessions.set(matchId, session);
  await User.updateOne({ whatsappId: homeId }, { inMatch: true, currentMatchId: matchId });

  // Kick-off
  await burst(sock, homeId, [
    `🏟️ *VOLTA MATCH STARTING!*\n━━━━━━━━━━━━━━━━━━━━━━━━\n🏠 *${homeName}* vs 🚗 *${awayName}*\n⏱️ 4-minute VOLTA format | 2v2 + GK\n━━━━━━━━━━━━━━━━━━━━━━━━`,
    `⚽ *Kick-off!* The match is underway! Both sides looking sharp from the first whistle! 🏁`,
  ]);

  await runMatchLoop(session);
}

// ─── MAIN MATCH LOOP ─────────────────────────────────────────────────────────

async function runMatchLoop(session) {
  const { sock, homeId } = session;

  while (session.timeElapsed < MATCH.TOTAL_SECONDS) {

    // Half-time trigger
    if (!session.halfTimeDone && session.timeElapsed >= MATCH.HALF_TIME_SECONDS) {
      session.halfTimeDone = true;
      await sock.sendMessage(homeId, { text: comm.halfTimeMessage(session.homeName, session.awayName, session.homeScore, session.awayScore) });
      await sleep(3500);
      await sock.sendMessage(homeId, { text: `▶️ *Second half kicks off!* Can anyone change it? 🔥` });
      await sleep(1000);
    }

    // Decide who has possession
    const team = decidePossession(session);

    // Find attacker
    const attackerPool = (team === 'home' ? session.homeSquad : session.awaySquad)
      .filter(p => p.role === 'outfield');
    const attacker = pick(attackerPool.length ? attackerPool : (team === 'home' ? session.homeSquad : session.awaySquad));

    const fm = engine.toFootballMinute(session.timeElapsed);

    // Human decision gate — only for home team
    if (team === 'home' && !session.isAI) {
      // Pre-decision build-up message
      await sock.sendMessage(homeId, { text: `⏱️ ${fm}' — *${attacker.displayName || attacker.name}* receives the ball in a promising area... 👀` });
      await sleep(MATCH.BURST_DELAY);

      const scenario = buildScenario(session, fm);
      await sock.sendMessage(homeId, { text: comm.decisionPrompt(attacker.displayName || attacker.name, fm, scenario) });

      const action = await waitForDecision(session);
      await processEvent(session, team, attacker, action);
    } else {
      // AI / away auto-action
      const action = ai.chooseAction(session, team, attacker);
      await processEvent(session, team, attacker, action);
    }

    await sleep(400);
  }

  await endMatch(session);
}

// ─── EVENT PROCESSOR ─────────────────────────────────────────────────────────

const ACTION_MAP = { '1': 'pass', '2': 'shoot', '3': 'dribble', '4': 'skillmove' };

async function processEvent(session, team, attacker, rawAction) {
  const { sock, homeId } = session;
  const action   = ACTION_MAP[rawAction] || rawAction;
  const duration = engine.eventDuration(action);
  const isHome   = team === 'home';

  session.timeElapsed = Math.min(session.timeElapsed + duration, MATCH.TOTAL_SECONDS);
  const fm = engine.toFootballMinute(session.timeElapsed);

  const defenders = (isHome ? session.awaySquad : session.homeSquad).filter(p => p.role === 'outfield');
  const gk        = (isHome ? session.awaySquad : session.homeSquad).find(p => p.role === 'goalkeeper');
  const momentum  = isHome ? session.homeMomentum : session.awayMomentum;
  const oppMom    = isHome ? session.awayMomentum : session.homeMomentum;

  const ap = engine.calcActionPower(attacker, action, momentum, fm);
  const dp = engine.calcDefensePower(defenders, gk, oppMom, fm);

  let eventType;
  let isGoal = false;

  if (action === 'shoot') {
    const gkOnly = engine.calcDefensePower([], gk, oppMom, fm);
    eventType    = engine.resolveShotOutcome(ap, gkOnly, fm);
    isGoal       = eventType === 'goal';
  } else if (action === 'dribble' || action === 'skillmove') {
    eventType = engine.resolveDribbleOutcome(ap, dp);
  } else {
    // pass
    const o   = engine.resolveOutcome(ap, dp);
    eventType = o === 'failure' ? 'tackled' : 'pass';
  }

  // Update score
  if (isGoal) {
    if (isHome) session.homeScore++;
    else        session.awayScore++;
    session.goalScorers.push({ player: attacker.displayName || attacker.name, minute: fm, team });
    // Update player goals stat
    await Player.updateOne({ _id: attacker._id }, { $inc: { goals: 1 } });
  }

  // Update momentum
  const momEvent = isGoal ? 'GOAL' : eventType === 'save' ? 'BIG_SAVE' : eventType === 'tackled' ? 'TURNOVER' : null;
  if (momEvent) {
    if (isHome) {
      session.homeMomentum = engine.updateMomentum(session.homeMomentum, momEvent);
      session.awayMomentum = engine.updateMomentum(session.awayMomentum, isGoal ? 'MISS' : 'GOAL');
    } else {
      session.awayMomentum = engine.updateMomentum(session.awayMomentum, momEvent);
      session.homeMomentum = engine.updateMomentum(session.homeMomentum, isGoal ? 'MISS' : 'GOAL');
    }
  }

  // Log event
  session.events.push({ minute: fm, type: eventType, team, player: attacker.displayName || attacker.name, action });

  // BURST the commentary
  const messages = comm.buildBurst(eventType, { player: attacker.displayName || attacker.name, team }, session.timeElapsed);
  await burst(sock, homeId, messages, MATCH.BURST_DELAY);

  // Show scoreboard after goals
  if (isGoal) {
    await sleep(300);
    await sock.sendMessage(homeId, { text: `📊 *${session.homeName}* ${session.homeScore} – ${session.awayScore} *${session.awayName}*` });
  }
}

// ─── END MATCH ────────────────────────────────────────────────────────────────

async function endMatch(session) {
  const { sock, homeId, awayId, isAI, homeName, awayName, homeScore, awayScore, goalScorers } = session;

  const winnerId = homeScore > awayScore ? homeId : awayScore > homeScore ? awayId : null;
  const isDraw   = homeScore === awayScore;
  const homeWon  = winnerId === homeId;

  // Full time message
  await sock.sendMessage(homeId, { text: comm.fullTimeMessage(homeName, awayName, homeScore, awayScore, goalScorers) });
  await sleep(1000);

  // Rewards
  const homeReward = homeWon ? ECONOMY.WIN_REWARD : isDraw ? ECONOMY.DRAW_REWARD : ECONOMY.LOSS_REWARD;
  const mmrDelta   = homeWon ? MMR.WIN : isDraw ? MMR.DRAW : MMR.LOSS;

  await User.updateOne({ whatsappId: homeId }, {
    inMatch:        false,
    currentMatchId: null,
    $inc: {
      currency:   homeReward,
      wins:       homeWon   ? 1 : 0,
      losses:     (!homeWon && !isDraw) ? 1 : 0,
      draws:      isDraw    ? 1 : 0,
      mmr:        mmrDelta,
      totalGoals: homeScore,
    }
  });

  // Update rank
  const updatedUser = await User.findOne({ whatsappId: homeId });
  const newRank = calcRank(updatedUser.mmr);
  if (newRank !== updatedUser.rank) {
    await User.updateOne({ whatsappId: homeId }, { rank: newRank });
    await sock.sendMessage(homeId, { text: `🏅 *RANK UP!* You are now *${newRank}*! Keep climbing! 🚀` });
  }

  // Decay squad conditions
  await decayConditions(session.homeSquad);

  // Reward message
  await sock.sendMessage(homeId, { text: `
💰 *MATCH REWARDS*
━━━━━━━━━━━━━━━━━━━━━━━━
  💲 Currency: +${homeReward} Metaworks
  📈 MMR: ${mmrDelta >= 0 ? '+' : ''}${mmrDelta}
  🏆 Rank: ${newRank}
━━━━━━━━━━━━━━━━━━━━━━━━
Type *!play* to run it back!
Type *!squad* to manage your team.` });

  activeSessions.delete(session.matchId);
}

// ─── DECISION GATE ───────────────────────────────────────────────────────────

function waitForDecision(session) {
  return new Promise((resolve) => {
    session.awaitingDecision = true;
    const timeout = setTimeout(() => {
      session.awaitingDecision = false;
      resolve('shoot');  // auto-fallback after timeout
    }, MATCH.DECISION_TIMEOUT_MS);

    session.pendingResolver = (action) => {
      clearTimeout(timeout);
      session.awaitingDecision = false;
      resolve(action);
    };
  });
}

function submitDecision(matchId, action) {
  const s = activeSessions.get(matchId);
  if (s?.awaitingDecision && s.pendingResolver) s.pendingResolver(action);
}

function getSessionForUser(whatsappId) {
  for (const [, s] of activeSessions) {
    if (s.homeId === whatsappId) return s;
  }
  return null;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function decidePossession(session) {
  const homeProbBase = 0.5 + (session.homeMomentum - 50) * 0.005;
  return Math.random() < homeProbBase ? 'home' : 'away';
}

function buildScenario(session, minute) {
  const diff = session.homeScore - session.awayScore;
  if (minute >= 75 && diff < 0)  return `⚠️ *${session.homeName} are LOSING with ${90 - minute}\' left!* This could be the equaliser!`;
  if (minute >= 75 && diff > 0)  return `🔒 *${session.homeName} are WINNING!* Hold the ball or kill the match?`;
  if (minute >= 75)              return `⚡ *Tense late game! Every touch matters!*`;
  if (minute >= 45)              return `💪 *Second half intensity building...*`;
  return `⚽ *Good position in the buildup.*`;
}

function calcRank(mmr) {
  const { RANKS } = require('../config/constants').MMR;
  let rank = 'Bronze';
  for (const r of RANKS) {
    if (mmr >= r.min) rank = r.label;
  }
  return rank;
}

async function decayConditions(squad) {
  for (const p of squad) {
    if (p._id) {
      const newCondition = Math.max(0, (p.condition || 100) - MATCH.EVENT_DURATIONS ? 5 : 5);
      await Player.updateOne({ _id: p._id }, { $inc: { matchesPlayed: 1 }, $set: { condition: newCondition } });
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { startMatch, submitDecision, getSessionForUser };
```

---

### Phase 5 Debug Checklist

```
PHASE 5 — MATCH ENGINE
□ !play starts a match successfully
□ Kick-off messages appear (2 messages, not one block)
□ Commentary sends as BURST (multiple separate messages, NOT one dump)
□ Delay between burst messages is visible (~800ms)
□ Decision prompt appears when home team has ball
□ Typing 1/2/3/4 in WhatsApp resolves the decision correctly
□ Decision timeout (30s) auto-picks 'shoot' and continues
□ Goals increment homeScore/awayScore correctly
□ Score shown after every goal as its own message
□ Half-time message fires at correct time with correct score
□ Second half starts message appears after half-time
□ Full-time message fires when timeElapsed >= TOTAL_SECONDS
□ Full-time shows correct final score and scorers
□ Win/loss/draw reward deducted/added to currency correctly
□ MMR updates correctly after match
□ inMatch flag cleared after match ends
□ Player conditions decay after match
□ AI matches run without any human input required
□ activeSessions map cleaned up after match ends
□ Concurrent matches for two different users don't interfere
```

---

---

# 📦 PHASE 6 — AI OPPONENT
## Easy / Medium / Hard difficulty · contextual decision-making

---

### `ai/aiOpponent.js`

```javascript
// ai/aiOpponent.js
const { AI }    = require('../config/constants');
const { randInt, weightedRandom, pick } = require('../utils/random');

// Nigerian street football AI names for immersion
const AI_FIRST = ['Shadow', 'Blaze', 'Storm', 'Ghost', 'Viper', 'Titan', 'Fury', 'Phantom', 'Razor', 'Bolt', 'Steel', 'Nova'];
const AI_GK    = ['Iron Wall', 'Stone Hands', 'The Vault', 'Block Mode', 'The Fortress'];

function generateAISquad(difficulty = 'Medium') {
  const cfg  = AI[difficulty.toUpperCase()] || AI.MEDIUM;
  const base = cfg.statBase;
  return [
    makeAIPlayer('outfield', base, pick(AI_FIRST), difficulty),
    makeAIPlayer('outfield', base, pick(AI_FIRST), difficulty),
    makeAIPlayer('goalkeeper', base, pick(AI_GK), difficulty),
  ];
}

function makeAIPlayer(role, statBase, name, difficulty) {
  const v  = randInt(-8, 8);
  const s  = statBase + v;
  const rarity = statBase >= 80 ? 'Elite' : statBase >= 68 ? 'Rare' : 'Common';
  const stats  = role === 'goalkeeper'
    ? { reflex: s, positioning: s + randInt(-4, 4), anticipation: s + randInt(-4, 4), strength: s, composure: s }
    : { pace: s + randInt(-5, 5), skill: s, shooting: s + randInt(-5, 5), stamina: s, composure: s };

  return {
    _id:       `ai_${name.replace(/\s/g, '_').toLowerCase()}_${Date.now()}`,
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
  const fm        = require('./matchEngine').toFootballMinute(session.timeElapsed);
  const desperate = scoreDiff < 0 && fm > 70;

  if (desperate)    return weightedRandom({ shoot: 60, skillmove: 25, dribble: 15, pass: 5 });
  if (momentum > 65) return weightedRandom({ shoot: 40, dribble: 30, skillmove: 20, pass: 10 });
  if (scoreDiff > 0) return weightedRandom({ pass: 50, dribble: 25, shoot: 15, skillmove: 10 });
  return statAction(session, team);
}

module.exports = { generateAISquad, chooseAction };
```

---

### Phase 6 Debug Checklist

```
PHASE 6 — AI OPPONENT
□ generateAISquad('Easy') returns 2 outfield + 1 GK
□ generateAISquad('Hard') returns players with stats ~85
□ AI player stats scale correctly by difficulty
□ Easy AI makes random choices (noticeable variety)
□ Hard AI shoots more when losing late in game
□ Hard AI holds ball more when winning
□ AI matches complete without user input
□ AI squad names display in commentary correctly
□ AI GK blocks shots appropriately (not always goalscored)
□ Hard AI is noticeably harder to beat than Easy AI
```

---

---

# 📦 PHASE 7 — ECONOMY, SHOP & MARKET
## Packs · Boosts · Training · Transfer Market

---

### Phase 7 Debug Checklist

```
PHASE 7 — ECONOMY
□ !daily gives correct base reward
□ Daily streak increments correctly
□ Daily cooldown prevents double-claiming (24h)
□ !pack starter opens 3 players, deducts 💲200
□ !pack elite has correct rarity distribution (test 10 opens)
□ !shop shows all items with prices
□ !boost energy [id] restores condition to 100%
□ !boost form [id] sets form to 'Hot'
□ !train [id] deducts 💲80 and may improve a stat
□ !market shows AI listings
□ !market auto-seeds AI listings when below minimum
□ !buy [id] transfers player and deducts currency
□ !buy fails gracefully if insufficient currency
□ !list [id] [price] creates market listing
□ Listed player cannot be listed again
□ Minimum price validation works (50% of market value)
□ Sold listing no longer appears in !market
□ Market listing expires after 48 hours (via MongoDB TTL index)
```

---

---

# 📦 PHASE 8 — ACADEMY & DAILY
## Youth players · scout · promote · daily rewards

---

### Phase 8 Debug Checklist

```
PHASE 8 — ACADEMY & DAILY
□ !scout costs 💲100 and creates a youth player
□ Youth player has lower stats than pack players
□ Youth player has High or Star potential (weighted)
□ !academy shows all youth players in academy
□ !promote [id] moves player to reserves
□ !daily works first time successfully
□ !daily fails on second call same day
□ Streak increments on consecutive daily claims
□ Streak resets if missed a day
□ Streak bonus scales reward correctly (but capped at MAX_DAILY)
```

---

---

# 📦 PHASE 9 — TOURNAMENT SYSTEM

---

### Phase 9 Debug Checklist

```
PHASE 9 — TOURNAMENT
□ !tournament shows available tournaments
□ !enter [id] deducts entry fee and adds user to participants
□ Tournament starts when max players reached
□ Bracket auto-generates correct round 1 matchups
□ Each bracket match runs through full match engine
□ Winners advance to next round
□ Final match determined correctly
□ Winner receives 💲1500 reward
□ Runner up receives 💲600 reward
□ !bracket [id] shows current state of bracket
```

---

---

# 📦 PHASE 10 — LEADERBOARD & STATS

---

### Phase 10 Debug Checklist

```
PHASE 10 — LEADERBOARD
□ !leaderboard shows top 10 by MMR
□ !rank shows your personal rank, MMR, wins/losses
□ !stats shows career goals, assists, win rate
□ Rank updates correctly after rank threshold crossed
□ Rank-up notification sends as separate message
□ Wealth leaderboard sorts by currency correctly
□ Leaderboard handles ties gracefully
```

---

---

# 📦 PHASE 11 — INTEGRATION & HARDENING

---

### Final Integration Checklist

```
PHASE 11 — FINAL INTEGRATION
□ Full new user flow: !start → !register → first match works end-to-end
□ User cannot play with empty Starting XI
□ User cannot buy pack with insufficient funds
□ User cannot claim daily twice in 24h
□ inMatch flag prevents starting a second match while in one
□ Bot does not crash on any !unknown command
□ Bot does not crash if MongoDB query returns null
□ All commands respond within 3 seconds (no hanging)
□ Match session always cleans up from activeSessions map
□ Burst messages send in correct order (no race condition)
□ Bot reconnects automatically after disconnect
□ QR re-scan works after session expires
□ All currency operations are atomic ($inc not direct set)
□ Negative currency impossible (checked before deducting)
□ Player condition cannot go below 0 or above 100
□ Stats cannot exceed 99 after training
□ Logger captures all errors with enough context to debug
□ No unhandled promise rejections in any command
□ Test 2 concurrent users in separate matches — no interference
□ Test sending random text (not commands) — ignored cleanly
```

---

---

# 🧠 SYSTEM DESIGN DECISIONS (DO NOT SKIP)

This section explains WHY the system works the way it does. Read before coding.

---

## The Burst Messaging Pattern

Do NOT compute the entire match and dump it as one message. That killed tension.
The correct flow is:

```
while (match not over) {
  decide possession
  if human team:
    send setup message
    await decision (promise gate)
    process action
    send burst (3 messages)
  else:
    AI picks action
    process action
    send burst (3 messages)
  sleep(400ms)  // tiny pause between events
}
```

The `waitForDecision` function uses a `Promise` that is resolved by `submitDecision` when the user's message arrives in the router. The router checks `getSessionForUser()` first — before processing any command — to capture `1/2/3/4` inputs and route them to the match.

---

## Stat Resolution Flow

Every attack goes through this chain:

```
1. ActionPower    = f(attacker stats, condition, form, chemistry, momentum, lateGame)
2. DefensePower   = f(defenders, GK, opponent momentum, lateGame fatigue)
3. Outcome        = ActionPower vs DefensePower → success / contested / failure
4. Event Type     = Outcome + Action type → goal / save / near_miss / blocked / dribble_success / tackled / foul
5. Momentum Update based on event type
6. Commentary Burst built for event type
7. Messages sent one by one with delay
```

---

## Economy Design Principles

- **Never inflate.** Win reward (💲150) < cheapest meaningful pack (💲200). Players must play several matches to afford packs.
- **Decay drives spending.** Players lose condition after matches. Restores cost money. This is the economy loop.
- **Market is the long game.** Rare/Legendary players appreciate in value. Selling at the right time matters.
- **No pay-to-win floor.** Starter pack gives enough to compete. Skill matters more than spending.

---

## Player Name Design Logic

- **Common outfield**: Real Nigerian names. Grounds the game in cultural context.
- **Elite/Legendary outfield**: VOLTA street nicknames (Flash, Razor, etc). These feel earned.
- **All goalkeepers**: Intimidating labels (Iron Wall, The Vault). Adds personality.
- **Renamed players**: User's own name overrides everything. Adds identity.

---

## Momentum System

Momentum is a hidden score (0–100) per team. It shifts based on events:
- Goal → +12 for scoring team, -7 for conceding team
- Big Save → +8 for defending team
- Miss → -7 for attacking team
- Turnover → -3

Momentum affects `ActionPower` and `DefensePower` slightly, making teams on a run harder to stop. It prevents fully random outcomes while keeping matches dynamic.

---

## Late Game Mechanics

After football minute 70:
- **GK starts making more errors** (condition decay amplified for shot resolution)
- **LateBoost** adds 0–10 random bonus to attacking teams' shot power
- **Scenario messages** change to reflect tension
- AI (Hard) becomes more desperate if losing

This creates natural drama — comebacks are possible but not guaranteed.

---

---

# 📋 COMPLETE COMMAND REFERENCE

| Command | Description | Cost |
|---|---|---|
| `!start` | Begin registration flow | Free |
| `!register [name]` | Create account + free starter pack | Free |
| `!help` / `!menu` | Full command list | Free |
| `!squad` | View full squad | Free |
| `!lineup` | Same as !squad | Free |
| `!card [id]` | View FC25-style player card | Free |
| `!condition` | All squad condition levels | Free |
| `!bench [id]` | Move player from XI to bench | Free |
| `!rename [id] [name]` | Give player a custom name | 💲50 |
| `!play` | Quick match vs Medium AI | Free |
| `!play easy` | Easy AI match | Free |
| `!play hard` | Hard AI match | Free |
| `!challenge @tag` | Challenge another user | Free |
| `!accept` | Accept a challenge | Free |
| `!market` | Browse transfer market (page 1) | Free |
| `!market [page]` | Browse page N of market | Free |
| `!buy [listingID]` | Purchase a listed player | Market price |
| `!list [playerID] [price]` | List your player for sale | Free |
| `!shop` | View shop menu | Free |
| `!pack starter` | Open Starter Pack (3 players) | 💲200 |
| `!pack pro` | Open Pro Pack (4 players) | 💲500 |
| `!pack elite` | Open Elite Pack (5 players) | 💲1200 |
| `!boost energy [id]` | Restore player to 100% condition | 💲150 |
| `!boost form [id]` | Set player to Hot form 🔥 | 💲200 |
| `!boost focus [id]` | +5 Composure next match | 💲100 |
| `!train [id]` | Training session (risk-based) | 💲80 |
| `!train elite [id]` | Elite coach session | 💲250 |
| `!academy` | View academy youth players | Free |
| `!scout` | Scout a new youth player | 💲100 |
| `!promote [id]` | Promote youth to first team | Free |
| `!daily` | Claim daily Metaworks reward | Free |
| `!streak` | View daily streak info | Free |
| `!tournament` | View active tournaments | Free |
| `!enter [id]` | Enter a tournament | 💲300 |
| `!bracket [id]` | View tournament bracket | Free |
| `!leaderboard` | Top 10 managers by MMR | Free |
| `!rank` | Your rank, MMR, and record | Free |
| `!stats` | Your career statistics | Free |

---

---

# 🚀 BUILD ORDER SUMMARY

```
Phase 1  → Foundation (index.js, constants, DB, logger)
Phase 2  → Data Layer (User, Player models, playerGenerator)
Phase 3  → Router + Registration (!start, !register, !help)
Phase 4  → Squad Management (!squad, !card, !rename, !condition)
Phase 5  → Match Engine (matchEngine + commentary + matchSession)
Phase 6  → AI Opponent (Easy/Medium/Hard)
Phase 7  → Economy, Shop, Market
Phase 8  → Academy + Daily Rewards
Phase 9  → Tournament System
Phase 10 → Leaderboard + Stats
Phase 11 → Integration hardening + all edge cases
```

Complete the debug checklist for each phase before starting the next.
Phases 1–6 are the core game. Phases 7–11 are the meta-game that keeps players coming back.

---

*𝙈𝙀𝙏𝘼𝙒𝙊𝙍𝙆𝙎™ — Built Different.*
