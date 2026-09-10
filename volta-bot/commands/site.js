'use strict';
// commands/site.js — !site
//
// Connecting the website used to require the player to find the backend's
// current ngrok URL and set a localStorage key by hand. Nobody does that, so in
// practice the site only worked for whoever ran the server.
//
// !site sends a private link that carries both the backend address and a
// single-use login ticket. One tap and they are in — no address to copy, no
// password to type.

const User = require('../models/User');
const { sendText } = require('../utils/messaging');
const ui = require('../utils/ui');

const SITE_URL = (process.env.SITE_URL || 'https://voltabot1.netlify.app').replace(/\/$/, '');

async function handle({ sock, msg, jid, sender, user }) {
  if (!user || !user.registered) {
    await sendText(sock, jid, ui.problem('You need a club first.', 'Send *!start* to create one.'), msg);
    return;
  }

  // Never require web/server.js here — it has no exports and would start a
  // second HTTP server inside the bot process.
  let link = null;
  try {
    link = require('../utils/connectTickets').buildLink(sender);
  } catch {
    link = null;
  }

  const isGroup = jid.endsWith('@g.us');

  if (!link) {
    await sendText(sock, jid, ui.card({
      icon: '🌐', title: 'VOLTA online',
      lead: SITE_URL,
      body: [
        'The one-tap link is unavailable right now — the web server',
        'is not running alongside the bot.',
        '',
        'Sign in with your club name and the password you set',
        'using *!password*.',
      ],
    }), msg);
    return;
  }

  // A ticket is a login. It never goes in a group.
  const body = ui.card({
    icon: '🌐', title: 'Your link to VOLTA online',
    lead: 'Tap this and you are straight in — no password needed.',
    body: [link, '', '_Works once, and only for the next 10 minutes._'],
    next: 'Send !site again any time for a fresh one.',
  });

  if (isGroup) {
    try {
      await sendText(sock, sender, body);
      await sendText(sock, jid, '📩 Sent you the link privately — a login link should never go in a group.', msg);
    } catch {
      await sendText(sock, jid,
        ui.problem('I could not message you privately.',
          `Send *!site* to me in a direct chat instead.\n\nThe site is at ${SITE_URL}`), msg);
    }
    return;
  }

  await sendText(sock, jid, body, msg);
}

module.exports = { handle };
