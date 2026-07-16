except for me heres a problem ppl balance dont increase and if  they do pack the balance does not decrease and wins loses mmr and all other things stay the same and players are not claimed after doing pack or buying platyer. for the stats of every player make sure they update after training including the ovr. it should be updated whether trained on the website or through whatsapp. And for the tournament let me say three people joined how does it work now what will happen anytime the total is odd number is that the bot removes one person and gives them 3 metaworks as consolation and add tournament wins to stuff like flex, squad and also add a !profile command and also add a !info command plus any user name or mention them to view their stats. and back to the tournament add like a smart system that outomatically places the sudd like if four players joined its semi finals but if 8 join it  quater final and 16 is round of 16 and two is finals. now add a cmd that only works for people in an active tournament give it a name !tchallenge that anyone in an active tournament has to play with the person they are paired with using that cmd. and when its done the tournamments tracks it and moves them to the next part and if the other person in a bracket has not played their own match with a  user the bot tells them that thye have been promoted and the remaining rounds will be sown after all people have participated in tournament and add a !broadcast cmd for only officer plus that send a message accrosss all the gc the bot is in. when users send me challenge it stilll shows that i am not registered pls fix this but i actually am. and dont forget that trining increases ovr. and make the game better by adding tem chemistry do a search with players with the best chemistry and ad that the longer teams play with theirselves the higher chemistry will get                                                                                                                                             .  now on website you are to run a very very very hard debug on the website make sure it fetches all the user data needed and fix this bug PS C:\Users\Hp\Documents\volta-bot-phases-1-4. claude mad this one but fixed by vs code\volta-bot> node web/server.js
[VOLTA] Local JSON database ready (C:\Users\Hp\Documents\volta-bot-phases-1-4. claude mad this one but fixed by vs code\volta-bot\data)
node:events:487
      throw er; // Unhandled 'error' event
      ^

Error: listen EADDRINUSE: address already in use :::3000
    at Server.setupListenHandle [as _listen2] (node:net:2008:16)
    at listenInCluster (node:net:2065:12)
    at Server.listen (node:net:2170:7)
    at Object.<anonymous> (C:\Users\Hp\Documents\volta-bot-phases-1-4. claude mad this one but fixed by vs code\volta-bot\web\server.js:878:8)
    at Module._compile (node:internal/modules/cjs/loader:1830:14)
    at Object..js (node:internal/modules/cjs/loader:1961:10)
    at Module.load (node:internal/modules/cjs/loader:1553:32)
    at Module._load (node:internal/modules/cjs/loader:1355:12)
ternal/modules/run_main:154:5)
Emitted 'error' event on Server instance at:
    at emitErrorNT (node:net:2044:8)
    at process.processTicksAndRejections (node:internal/process/task_queues:90:21) {
  code: 'EADDRINUSE',
  errno: -4091,
  syscall: 'listen',
  address: '::',
  port: 3000
}

Node.js v24.15.0
PS C:\Users\Hp\Documents\volta-bot-phases-1-4. claude mad this one but fixed by vs code\volta-bot> and make sure that you add or make a css file for the web sit and make penalty better and fix the dash and other thing in the website and make it look better by far better and make the dash work cus they dont work add 10 more features to the webapp and make sure they work perfectly  make sure that signed in users stay signed in. finally make sure everything logs well by that i mean that if someone does an action like buy a squad the person has that squad and everything is updated implement all that and also add a heartbeat system to check the bot every once in a while and add an !ping cmd for only owner that shows owner the latency the uptime the commands responded too, the issues. and add a !debug cmd this cmd should be able too dbeug most things possible and comeback with the issues found and which fixed and the info. and for the !match cmds allow people to get mmr from tjat and for th easier matches you play the smaller mmr you get and mkae time out for playing !play 10 secs. and instead of showing people their reserves in !squad add a cmd for that which is !reserve do this for only reserve. and for the password cmd the reply from bot should be deleted after 5 seconds . and  add some stuff that wont allow the bot to break easily.    add a !setbounty price cmd that a player can set abounty on another player and when someone wins that player the player gets the mony. when a user sets a bounty the money set is taken from the player and if within 2hrs anyone cannot get the bounty the money goes to the person whp the bounty was set on.                                                    .                                                                                                                                                              .                    32' he has the ball.......     33' he has space thne the situation in the 34 min this is what i mean by timestamps do this for both pvp matches and !match. and fix commentatory based on time  and make them more intense based on time and i said do not llow situation be repeated in one match same with commentatory. so add 400 more commentatory words and 120 more situations and make the website not feel like a knock off make it feel like a proper luxurious website if needed add a js file and a css file make everything seem luxurious and complete do this while maintainin very very good structure and making sure all the datas are fetched properly and alos add this tournament winners feature in the website and best squads and etc. use both the gen z commentatory and the normal commentatory jjoin them in to one file plus the 400 new one. and dont forget to add the 120 situations to the situations file. i do not want to see any BYE in any tournament fixture. finally commit and push everything when done. and pls you did not implementthis 🏫 *ACADEMY*
  !academy        — View your academy
  !scout    id    — Scout a youth player (💲100)
  !promote [id]   — Promote youth to first team
  scout costs 💲100 and creates a youth player
□ Youth player has lower stats than pack players
□ Youth player has High or Star potential (weighted)
□ !academy shows all youth players in academy
□ !promote [id] moves player to reserves

  and add more stuffs to shop. and ad this !bracket [id]   — View tournament bracket

📊 *STATS & RANK*
  !rank           — Your rank and MMR
  !stats          — Your career stats




  and make sure everything updates after every action someone takes.      

  implememnt these 
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






finally but nit least ## Momentum System

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
