// utils/stats.js
// Lightweight in-memory runtime counters shared across the bot. Reset on each
// restart (uptime is tracked separately via globalThis.__botStartTime). Used by
// the !pong health command to report activity and error counts.
const runtime = {
  commandsAnswered: 0,   // commands successfully dispatched to a handler
  commandsSeen: 0,       // total command-shaped messages the router looked at
  issuesFound: 0,        // caught errors while handling commands
  lastCommandAt: null,   // ISO timestamp of the most recent handled command
  lastError: null,       // short message of the most recent caught error
};

function commandAnswered() {
  runtime.commandsAnswered += 1;
  runtime.lastCommandAt = new Date().toISOString();
}
function commandSeen() { runtime.commandsSeen += 1; }
function issueFound(err) {
  runtime.issuesFound += 1;
  runtime.lastError = err && err.message ? String(err.message).slice(0, 120) : String(err || 'unknown');
}
function snapshot() { return { ...runtime }; }

module.exports = { commandAnswered, commandSeen, issueFound, snapshot };
