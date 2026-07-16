// commands/explain.js
//   !explain [command] — how a single command works
//   aliases: !guide, !how
const { sendText } = require('../utils/messaging');

const COMMANDS = {
  start:        { usage: '!start',                          desc: 'Welcome message + profile check.' },
  register:     { usage: '!register [name]',                desc: 'Create your manager profile + free starter pack.' },
  help:         { usage: '!help / !menu',                   desc: 'Show the full command menu.' },
  explain:      { usage: '!explain [command]',              desc: 'Explain a single command (this).' },
  play:         { usage: '!play [easy|medium|hard]',        desc: 'Quick match vs the AI. Default Medium.' },
  challenge:    { usage: '!challenge @user',                desc: 'Invite a player to a PvP duel (strength-based).' },
  accept:       { usage: '!accept',                         desc: 'Accept a pending challenge.' },
  sub:          { usage: '!sub [outId] [inId]',             desc: 'Sub a player during a PvP pause window.' },
  squad:        { usage: '!squad / !lineup',               desc: 'View your full team.' },
  card:         { usage: '!card [id]',                      desc: 'Show a player card (id shown for use in other cmds).' },
  condition:    { usage: '!condition',                      desc: 'Check your squad fitness.' },
  autosquad:    { usage: '!autosquad / !best',              desc: 'Auto-pick your 3 best outfield + best GK into the XI.' },
  swap:         { usage: '!swap [id1] [id2]',              desc: 'Swap two players, or !swap [id] xi|bench|reserves.' },
  rename:       { usage: '!rename [id] [name]',            desc: 'Give a player a custom nickname.' },
  squads:       { usage: '!squads',                         desc: 'Show your unlocked team slots.' },
  buysquad:     { usage: '!buysquad',                       desc: 'Unlock a 2nd/3rd team slot (1500 MW).' },
  switchsquad:  { usage: '!switchsquad [1|2|3]',           desc: 'Switch which team is active.' },
  daily:        { usage: '!daily',                         desc: 'Claim your daily Metaworks.' },
  streak:       { usage: '!streak',                        desc: 'Check your daily streak.' },
  slot:         { usage: '!slot [stake]',                  desc: 'Emoji slot machine — win Metaworks.' },
  coinflip:     { usage: '!coinflip [amount]',             desc: '50/50 double-or-nothing.' },
  highlow:      { usage: '!highlow [higher|lower] [stake]', desc: 'Guess if the next 1–9 number is higher/lower.' },
  shop:         { usage: '!shop',                          desc: 'Browse the store.' },
  pack:         { usage: '!pack starter|pro|elite',        desc: 'Open a player pack.' },
  boost:        { usage: '!boost energy|form [id]',        desc: 'Restore condition or trigger hot form.' },
  train:        { usage: '!train [id] / !train elite [id]', desc: 'Train a player to raise stats.' },
  market:       { usage: '!market [page]',                 desc: 'Browse the player market.' },
  buy:          { usage: '!buy [listingID]',               desc: 'Buy a listed player.' },
  list:         { usage: '!list [id] [price]',             desc: 'List one of your players for sale.' },
  wallet:       { usage: '!wallet / !bal',                 desc: 'Show your Metaworks, MMR and record.' },
  give:         { usage: '!give [amount] @user',           desc: 'Send Metaworks to another player (reply or @mention).' },
  leaderboard:  { usage: '!leaderboard / !lb [category]',  desc: 'Ranks: mmr (default) | wins | goals | rich | winrate.' },
  penalty:      { usage: '!penalty [stake] [@user]',       desc: 'Penalty shootout vs AI, or simulate a head-to-head.' },
  tournament:   { usage: '!tournament start [classic|penalty] [prize]', desc: 'Moderator+ opens a tournament (auto-pairs players).' },
  tourneyplay:  { usage: '!tourneyplay / !playtourney',    desc: 'Simulate your current tournament tie.' },
  tutorial:     { usage: '!tutorial / !tut',               desc: 'Explains every feature simply (like you are 5).' },
  auction:      { usage: '!auction start [id|auto] [min]', desc: 'Officer+ lists a high player for bid.' },
  bid:          { usage: '!bid [amount]',                  desc: 'Moderator+ bids in an auction.' },
  giveaway:     { usage: '!giveaway [amt] [winners]',      desc: 'Moderator+ hosts a giveaway (limited).' },
  tournament:   { usage: '!tournament start [prize]',      desc: 'Moderator+ opens a tournament.' },
  join:         { usage: '!join',                          desc: 'Enter an open tournament.' },
  mods:         { usage: '!mods',                          desc: 'List staff + owner.' },
  promote:      { usage: '!promote [id] officer|moderator', desc: 'Officer+ promotes a user.' },
  warn:         { usage: '!warn [id]',                     desc: 'Moderator+ warns a user (3 = temp ban).' },
  kick:         { usage: '!kick [id]',                     desc: 'Moderator+ removes a user from the group.' },
  ban:          { usage: '!ban [id]',                      desc: 'Officer+ bans a user.' },
  unban:        { usage: '!unban [id]',                    desc: 'Officer+ unbans a user.' },
};

async function handle({ sock, msg, jid, cmd, args }) {
  const name = (args[0] || '').toLowerCase();
  if (name && COMMANDS[name]) {
    const c = COMMANDS[name];
    await sendText(sock, jid,
      `🔍 *!${name}*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📝 *Usage:* \`${c.usage}\`\n` +
      `💡 ${c.desc}\n━━━━━━━━━━━━━━━━━━━━━━━`, msg);
    return;
  }

  if (name) {
    await sendText(sock, jid, `❓ No command called *!${name}*. Try *!explain* with no argument to list them all.`, msg);
    return;
  }

  let out = `🔍 *COMMAND GUIDE* — type *!explain [command]* for details\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
  for (const [k, v] of Object.entries(COMMANDS)) {
    out += `• \`!${k}\` — ${v.desc}\n`;
  }
  out += `━━━━━━━━━━━━━━━━━━━━━━━`;
  await sendText(sock, jid, out, msg);
}

module.exports = { handle, COMMANDS };
