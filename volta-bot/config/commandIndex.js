'use strict';
// config/commandIndex.js
//
// One description per command, in one place.
//
// The old !help was a hand-typed wall of ~90 bare command names with no
// explanation of what any of them did. Because it was hand-typed it drifted:
// it still advertised `!loan maccept` and `!loan mpay` long after those stopped
// being necessary, and it never mentioned commands that had been added.
//
// This is the single source of truth. !help renders from it, and a test asserts
// that every routed command appears here — so the day someone adds a command
// without documenting it, the suite says so.

// access: 'all' | 'staff' | 'owner'
// Commands marked `hidden` still resolve but are kept out of the menus.
const COMMANDS = {
  // ── GETTING STARTED ──────────────────────────────────────────────────────
  start:     { cat: 'start', s: 'Create your club, or pick up where you left off' },
  register:  { cat: 'start', s: 'Sign up with a club name', u: '!register <name>', ex: '!register Kano Kings' },
  help:      { cat: 'start', s: 'This menu. Add a topic or command for detail', u: '!help [topic]', ex: '!help squad' },
  explain:   { cat: 'start', s: 'Plain-English explanation of any part of the game', u: '!explain <thing>', ex: '!explain chemistry' },
  invite:    { cat: 'start', s: 'Your referral code — you both get paid' },
  password:  { cat: 'start', s: 'Set your website password', u: '!password <password>' },
  skiptour:  { cat: 'start', s: 'Skip the beginner walkthrough' },

  // ── YOUR SQUAD ───────────────────────────────────────────────────────────
  squad:     { cat: 'squad', s: 'Your players and who is in the starting four' },
  card:      { cat: 'squad', s: "A player's card", u: '!card <playerID>', ex: '!card 1' },
  flex:      { cat: 'squad', s: 'Show off your best player in the group' },
  swap:      { cat: 'squad', s: 'Move a player between the XI and the bench', u: '!swap <a> <b>' },
  autosquad: { cat: 'squad', s: 'Let the bot pick your strongest four' },
  captain:   { cat: 'squad', s: 'Name a captain — small boost to the whole team', u: '!captain <playerID>' },
  rename:    { cat: 'squad', s: 'Give a player a nickname', u: '!rename <playerID> <name>' },
  condition: { cat: 'squad', s: 'Fitness of everyone in the squad' },
  injuries:  { cat: 'squad', s: 'Who is hurt and for how long' },
  teamchem:  { cat: 'squad', s: 'How well your squad plays together' },
  reserve:   { cat: 'squad', s: 'Move players to and from the reserves', u: '!reserve <playerID>' },
  preserves: { cat: 'squad', s: 'View your reserve players' },
  retire:    { cat: 'squad', s: 'Retire a player permanently', u: '!retire <playerID>' },
  chant:     { cat: 'squad', s: 'Set a chant for your club' },
  shield:    { cat: 'squad', s: 'Protect a player from being poached' },

  // ── MATCHES ──────────────────────────────────────────────────────────────
  play:      { cat: 'match', s: 'Find a match and play it' },
  challenge: { cat: 'match', s: 'Call someone out', u: '!challenge @them' },
  accept:    { cat: 'match', s: 'Take a challenge' },
  forfeit:   { cat: 'match', s: 'Give up the match you are in' },
  sub:       { cat: 'match', s: 'Bring a substitute on mid-match', u: '!sub <playerID>' },
  pk:        { cat: 'match', s: 'Penalty shootout against someone', u: '!pk @them' },
  penalty:   { cat: 'match', s: 'Take or save a penalty' },
  derby:     { cat: 'match', s: 'Group prediction game — everyone calls the winner', u: '!derby @them' },
  rivalry:   { cat: 'match', s: 'Your head-to-head record with someone', u: '!rivalry @them' },
  formcheck: { cat: 'match', s: 'How your team has been playing lately' },
  press:     { cat: 'match', s: 'Post-match press conference' },
  curse:     { cat: 'match', s: 'Put a hex on an opponent' },

  // ── MONEY ────────────────────────────────────────────────────────────────
  daily:     { cat: 'money', s: 'Free money once a day — streaks pay more' },
  streak:    { cat: 'money', s: 'How many days you have claimed in a row' },
  salary:    { cat: 'money', s: 'Weekly pay, based on your rank' },
  interest:  { cat: 'money', s: 'Daily interest on savings over 1,000' },
  hustle:    { cat: 'money', s: 'Quick earner on a cooldown' },
  dash:      { cat: 'money', s: 'Your money at a glance' },
  give:      { cat: 'money', s: 'Send money to another manager', u: '!give <amount> @them' },
  borrow:    { cat: 'money', s: 'Ask someone for a loan', u: '!borrow <amount> [@them]', ex: '!borrow 5000 @tunde' },
  lend:      { cat: 'money', s: 'Offer someone a loan', u: '!lend @them <amount>' },
  loan:      { cat: 'money', s: 'Manage loans — accept, reject, repay', u: '!loan help' },
  contract:  { cat: 'money', s: 'Player contracts and repairs' },
  insurance: { cat: 'money', s: 'Insure a player against injury' },

  // ── BUYING PLAYERS ───────────────────────────────────────────────────────
  shop:      { cat: 'shop', s: 'Packs, boosts and training' },
  pack:      { cat: 'shop', s: 'Open a pack and pull new players', u: '!pack <starter|pro|elite>' },
  agent:     { cat: 'shop', s: 'One free scout report a day — sign him or walk' },
  market:    { cat: 'shop', s: 'Transfer market listings' },
  buy:       { cat: 'shop', s: 'Buy a listed player', u: '!buy <listingID>' },
  sell:      { cat: 'shop', s: 'List a player for sale', u: '!sell <playerID> <price>' },
  list:      { cat: 'shop', s: 'Your active listings' },
  search:    { cat: 'shop', s: 'Search the market by name', u: '!search <name>' },
  trade:     { cat: 'shop', s: 'Swap players with another manager', u: '!trade @them' },
  boost:     { cat: 'shop', s: 'Boost a player permanently', u: '!boost <playerID>' },
  train:     { cat: 'shop', s: 'Train a stat', u: '!train <playerID> <stat>' },
  surgery:   { cat: 'shop', s: 'Heal an injured player instantly' },
  academy:   { cat: 'shop', s: 'Your youth academy' },
  scout:     { cat: 'shop', s: 'Scout a youth prospect' },
  stadium:   { cat: 'shop', s: 'Your stadium — bigger ground, better crowd' },

  // ── GAMBLING ─────────────────────────────────────────────────────────────
  slot:      { cat: 'games', s: 'Slot machine (the house keeps about 8%)', u: '!slot [stake]' },
  coinflip:  { cat: 'games', s: 'Double or nothing', u: '!coinflip <amount> [heads|tails]' },
  highlow:   { cat: 'games', s: 'Guess higher or lower', u: '!highlow [stake]' },

  // ── STANDINGS ────────────────────────────────────────────────────────────
  league:    { cat: 'ranks', s: 'Your division and the table', u: '!league [me|form|1-4|info|history]' },
  leaderboard:{ cat: 'ranks', s: 'Top managers by rating' },
  playerlb:  { cat: 'ranks', s: 'Best individual players in the game' },
  topchem:   { cat: 'ranks', s: 'Best team chemistry' },
  profile:   { cat: 'ranks', s: 'A manager profile', u: '!profile [@them]' },
  season:    { cat: 'ranks', s: 'This season so far' },
  trophies:  { cat: 'ranks', s: 'What you have won' },
  awards:    { cat: 'ranks', s: 'Weekly awards' },
  competitions:{ cat: 'ranks', s: 'Cups and tournaments', u: '!competitions [info|join] [id]' },
  compplay:  { cat: 'ranks', s: 'Play your competition fixture' },
  bracket:   { cat: 'ranks', s: 'Tournament bracket' },
  redeem:    { cat: 'ranks', s: 'Redeem a code', u: '!redeem <CODE>' },

  // ── STAFF ────────────────────────────────────────────────────────────────
  mods:      { cat: 'staff', s: 'Who is staff', access: 'staff' },
  warn:      { cat: 'staff', s: 'Warn a member', access: 'staff' },
  ban:       { cat: 'staff', s: 'Ban a member from the bot', access: 'staff' },
  unban:     { cat: 'staff', s: 'Lift a ban on a member', access: 'staff' },
  cooldown:  { cat: 'staff', s: 'Put someone on cooldown', access: 'staff' },
  kick:      { cat: 'staff', s: 'Remove someone from the group', access: 'staff' },
  promote:   { cat: 'staff', s: 'Give someone a staff role', access: 'staff' },
  giveaway:  { cat: 'staff', s: 'Run a giveaway', access: 'staff' },
  auction:   { cat: 'staff', s: 'Run a player auction', access: 'staff' },
  subtract:  { cat: 'staff', s: 'Take money off an account', access: 'staff' },
  clearpvp:  { cat: 'staff', s: 'Clear a stuck match', access: 'staff' },

  // ── OWNER ────────────────────────────────────────────────────────────────
  on:        { cat: 'owner', s: 'Turn the bot on or off', access: 'owner' },
  disable:   { cat: 'owner', s: 'Disable a single command', access: 'owner' },
  diag:      { cat: 'owner', s: 'Health check — uptime, memory, rendering, database', access: 'owner' },
  debug:     { cat: 'owner', s: 'Debug output', access: 'owner' },
  broadcast: { cat: 'owner', s: 'Message every manager', access: 'owner' },
  announce:  { cat: 'owner', s: 'Set the notice shown on !help', access: 'owner' },
  reload:    { cat: 'owner', s: 'Reload data from disk', access: 'owner' },
  ping:      { cat: 'owner', s: 'Latency check', access: 'owner' },

  // ── Previously undocumented. Found by test_help.js, which asserts that every
  // routed command appears here — the check that stops this file going stale.
  wallet:    { cat: 'money', s: 'Your balance and recent movement' },
  work:      { cat: 'money', s: 'Take a shift for a steady payout' },
  jobs:      { cat: 'money', s: 'Jobs you can work, and what they pay' },
  tbet:      { cat: 'games', s: 'Bet on a tournament result', u: '!tbet <id> <amount>' },
  setbounty: { cat: 'ranks', s: 'Put a bounty on a manager', u: '!setbounty @them <amount>' },
  squads:    { cat: 'squad', s: 'All the squads you own' },
  buysquad:  { cat: 'squad', s: 'Buy an extra squad slot' },
  switchsquad:{ cat: 'squad', s: 'Switch to another of your squads' },
  tutorial:  { cat: 'start', s: 'Walk through how the game works' },
  compgcs:   { cat: 'ranks', s: 'Competition group chats' },
  chance:    { cat: 'match', s: 'Take your chance during a live match', hidden: true },
  afk:       { cat: 'owner', s: 'Mute the bot for yourself', access: 'owner' },
  uncooldown:{ cat: 'staff', s: 'Take someone off cooldown', access: 'staff' },
  demote:    { cat: 'staff', s: 'Remove a staff role', access: 'staff' },
  kickgc:    { cat: 'staff', s: 'Remove the bot from a group', access: 'staff' },
};

const CATEGORIES = {
  start:  { icon: '🚀', name: 'Getting started', blurb: 'New here? Start with !start.' },
  squad:  { icon: '👥', name: 'Your squad',      blurb: 'Pick, train and manage your players.' },
  match:  { icon: '⚔️', name: 'Matches',         blurb: 'Playing, challenging and rivalries.' },
  money:  { icon: '💰', name: 'Money',           blurb: 'Earning, sending, borrowing.' },
  shop:   { icon: '🛍️', name: 'Getting players', blurb: 'Packs, the market, the academy.' },
  games:  { icon: '🎰', name: 'Side games',      blurb: 'Gambling. The house always wins.' },
  ranks:  { icon: '🏆', name: 'Standings',       blurb: 'Leagues, cups and leaderboards.' },
  staff:  { icon: '🛡️', name: 'Staff',           blurb: 'Moderation tools.' },
  owner:  { icon: '🔧', name: 'Owner',           blurb: 'Running the bot.' },
};

// Aliases that resolve to the documented command, so !help works on either.
const ALIASES = {
  menu: 'help', guide: 'explain', how: 'explain', setpass: 'password',
  lineup: 'squad', bench: 'squad', best: 'autosquad', move: 'swap',
  match: 'play', tchallenge: 'challenge', shoot: 'penalty', save: 'penalty',
  flip: 'coinflip', hl: 'highlow', lb: 'leaderboard', top10: 'leaderboard',
  plb: 'playerlb', name: 'profile', setname: 'profile', info: 'profile',
  find: 'search', bargain: 'agent', buystadium: 'stadium', sellstadium: 'stadium',
  boostall: 'boost', youthpromote: 'academy', health: 'diag', off: 'on',
  take: 'subtract', gw: 'giveaway', bid: 'auction', repair: 'contract',
  brackets: 'bracket', tourney: 'competitions', tournament: 'competitions',
  bal: 'wallet', tut: 'tutorial', pong: 'ping',
  tourneyplay: 'competitions', playtourney: 'competitions', join: 'competitions',
  tbv: 'bracket', weeklyawards: 'awards',
  a: 'chance', b: 'chance', c: 'chance', d: 'chance',

};

function resolve(name) {
  const key = String(name || '').toLowerCase().replace(/^!/, '');
  return COMMANDS[key] ? key : (ALIASES[key] && COMMANDS[ALIASES[key]] ? ALIASES[key] : null);
}

function byCategory(cat, access = 'all') {
  const rank = { all: 0, staff: 1, owner: 2 };
  return Object.entries(COMMANDS)
    .filter(([, c]) => c.cat === cat && !c.hidden)
    .filter(([, c]) => rank[c.access || 'all'] <= rank[access])
    .map(([name, c]) => ({ name, ...c }));
}

module.exports = { COMMANDS, CATEGORIES, ALIASES, resolve, byCategory };
