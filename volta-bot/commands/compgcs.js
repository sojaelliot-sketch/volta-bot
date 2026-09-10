'use strict';
// commands/compgcs.js — !compgcs
// Lists the competition group chats and their invite links.
//
// This command crashed on every use. It imported `COMPETITION_GCS` from
// config/competitionGCs.js — a name that file has never exported. The import
// silently resolved to `undefined`, and `Object.entries(undefined)` throws, so
// the router caught it and replied "Something went wrong" every single time.
//
// The config exports getAllCompIds / getCompName / getCompLink, which is what
// this now uses.

const { sendText } = require('../utils/messaging');
const ui = require('../utils/ui');
const { getAllCompIds, getCompName, getCompLink } = require('../config/competitionGCs');

async function compgcsCommand({ sock, msg, jid }) {
  let ids = [];
  try { ids = getAllCompIds() || []; } catch { ids = []; }

  const rows = ids
    .map((id) => ({ id, name: getCompName(id), link: getCompLink(id) }))
    .filter((c) => c.name);

  if (!rows.length) {
    await sendText(sock, jid, ui.problem(
      'No competition group chats are configured yet.',
      'Add them in *config/competitionGCs.js* and they will appear here.'), msg);
    return;
  }

  const withLinks = rows.filter((c) => c.link);
  const body = [];
  for (const c of rows) {
    body.push(`▸ *${c.name}*`);
    body.push(c.link ? `   ${c.link}` : '   _link not set yet_');
  }

  await sendText(sock, jid, ui.card({
    icon: '📲', title: 'Competition group chats',
    lead: `${rows.length} competition${rows.length === 1 ? '' : 's'}` +
          (withLinks.length < rows.length ? ` · ${withLinks.length} with an invite link` : ''),
    body,
    next: 'Join the chat for a competition to play its fixtures.',
  }), msg);
}

module.exports = { handle: compgcsCommand };
