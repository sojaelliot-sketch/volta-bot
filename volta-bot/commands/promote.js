// commands/promote.js
//   !promote [id]            — promote a YOUTH prospect into your squad (Academy)
//   !promote [id] officer|moderator — promote a USER to staff (Moderation)
// One word, two meanings — disambiguated by the 2nd argument (a staff role
// keyword routes to moderation, otherwise it's an academy promotion).
const academy = require('./academy');
const mod = require('./mod');

async function handle(ctx) {
  const { args } = ctx;
  const roleArg = (args[1] || '').toLowerCase();
  const isStaffPromote = roleArg === 'officer' || roleArg === 'moderator';
  if (isStaffPromote) return mod.handle(ctx);
  return academy.handle(ctx);
}

module.exports = { handle };
