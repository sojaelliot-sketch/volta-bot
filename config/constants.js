// config/constants.js
// Single source of truth for all game numbers. Never hardcode a game value anywhere else.
module.exports = {

  // ─── BRAND ─────────────────────────────────────────────────────────────
  BRAND: 'MΞTΛ • WORKS',

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
    LATE_GAME_MINUTE: 70,
    LATE_GAME_BOOST_MAX: 12,
    BURST_DELAY: 800,
    DECISION_TIMEOUT_MS: 30000,
    OUTFIELD_PER_SIDE: 3,         // 3-a-side outfield
    PVP_SEGMENTS: 3,              // PvP match is split into segments w/ sub windows
    SUB_WINDOW_MS: 15000,         // time the match pauses for subs
    PLAY_COOLDOWN_MS: 10000,      // cooldown between !play matches
    CHANCE_TIMEOUT_MS: 20000,     // time a player has to pick an option in a live chance (penalty minigame)
    CHANCE_OPTIONS: ['shoot', 'pass', 'dribble'],
    PVP_CHANCES: 8,               // number of interactive chances in a PvP match
    PVP_FORFEIT_MS: 90000,        // no reply within this window = forfeit the match
    PVP_HALF_TIME_MS: 15000,      // half-time break between the two halves
    PVP_BUILDUP_DELAY_MS: 900,    // delay between build-up commentary lines
    PVP_CHANCE_GAP_MS: 1200,      // delay after a chance resolves before the next one
    PVP_INTERCEPT_PCT: 0.18,      // chance the defender steals the ball mid-buildup (attacker loses possession)
    PVP_CATCH_PCT: 0.40,          // of non-goal shots, share where the keeper CATCHES (clean claim) vs blocks
    PVP_DEFEND_WEIGHT: 0.5,       // how much a defensive option's gw matters vs attacker strength
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
    STARTER: { cost: 200, count: 4, weights: { Common: 70, Rare: 25, Elite: 5,  Legendary: 0  } },
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
    DRAW:  5,
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

  // ─── SQUAD ─────────────────────────────────────────────────────────────
  SQUAD: {
    STARTING_XI_SIZE: 4,   // VOLTA = 3 outfield + 1 keeper on the pitch
    BENCH_SIZE:       4,
    MAX_SQUADS:       3,    // how many saved squads a manager can own
    EXTRA_SQUAD_COST: 1500, // cost to unlock an additional squad slot
  },

  // ─── GK POSITIONS (shown only for goalkeepers) ─────────────────────────
  GK_POSITIONS: ['Sweeper Keeper', 'Shot Stopper', 'Line Keeper', 'Ball Player', 'Reflex Freak'],

  // ─── MODERATION ────────────────────────────────────────────────────────
  MODERATION: {
    OWNER_ID: '2349011861051',
    OPEN_REGISTRATION: true,           // when false, only the owner account can exist; set false to lock sign-ups
    COOLDOWN_MS: 4000,                 // min gap between commands for normal users
    WARNINGS_BEFORE_BAN: 3,            // spam warnings before auto-ban
    BAN_DURATION_MS: 3 * 60 * 1000,    // 3 minute auto-ban
    ROLE_RANK: { user: 0, moderator: 1, officer: 2 },
  },

  // ─── MINI-GAMES ────────────────────────────────────────────────────────
  SLOT: {
    COST: 50,
    EMOJIS: ['🍒', '🍋', '🔔', '⭐', '💎', '7️⃣'],
    // payout multiplier on the stake
    THREE_SAME:   10,    // any three matching
    TWO_SAME:     2,     // any two matching
    JACKPOT:     50,     // three 7️⃣
  },
  COINFLIP: {
    MIN: 10,
    MAX: 1000,
  },

  // ─── AUCTION (staff+owner only bidders) ─────────────────────────────────
  AUCTION: {
    DURATION_MS: 60000,        // auto-close after this if no new bid
    MIN_BID_STEP: 50,
    HIGH_PLAYER_RARITY: 'Legendary',
  },

  // ─── HIGH/LOW (guess higher or lower, 1–9) ───────────────────────────────
  HIGHLOW: {
    MIN_STAKE: 20,
    HOUSE_EDGE: 0.1,           // payout = (1 / winProb) * (1 - HOUSE_EDGE)
    MAX_STAKE: 5000,
  },

  // ─── GIVEAWAY / TOURNAMENT (staff, limited) ─────────────────────────────
  GIVEAWAY: {
    MAX_AMOUNT: 5000,
    MAX_WINNERS: 20,
    COOLDOWN_MS: 10 * 60 * 1000,
  },
  TOURNAMENT: {
    MAX_PRIZE: 10000,
    MAX_PLAYERS: 16,
    COOLDOWN_MS: 30 * 60 * 1000,
    JOIN_WINDOW_MS: 120000,
    MATCH_WINDOW_MS: 180000,    // time a player has to play their bracket match
    CATEGORIES: {
      classic: { label: 'Classic', simulate: 'match' },
      penalty: { label: 'Penalty Shootout', simulate: 'penalty' },
    },
    REWARDS_BY_ROUND: { winner: 1500, runner_up: 600, semi: 250 },
  },

  // ─── PENALTY SHOOTOUT MINI-GAME ─────────────────────────────────────────
  PENALTY: {
    ROUNDS: 5,
    SPOTS: ['L', 'C', 'R'],      // shoot/guess directions
    MIN_STAKE: 20,
    MAX_STAKE: 2000,
    WIN_REWARD_MULT: 1.8,        // payout multiplier on the stake when you win the shootout
  },
};
