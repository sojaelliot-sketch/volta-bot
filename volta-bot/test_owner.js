'use strict';
// test_owner.js — owner identity across LID / phone number, plus the command
// fixes that came out of the full test sweep. Run: node test_owner.js
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-owner-'));
process.env.VOLTA_TEST_FAST = '1';
const { MODERATION } = require('./config/constants');
MODERATION.COOLDOWN_MS = 0;
const db = require('./config/database');
const User = require('./models/User');
const router = require('./commands/router');
const { grantStarterSquad } = require('./utils/playerGenerator');

let pass = 0, fail = 0;
const ok = (l, c, d) => { c ? (console.log('  ✓ ' + l), pass++) : (console.log('  ✗ ' + l + (d ? ' — ' + d : '')), fail++); };

const LID = `${MODERATION.OWNER_ID}@lid`;
const PHONE = `${MODERATION.OWNER_ALIASES[0]}@s.whatsapp.net`;
const U1 = '1111111111@s.whatsapp.net', U2 = '2222222222@s.whatsapp.net';
const sent = [];
const sock = { sendMessage: async (j, c) => { sent.push(c.text || c.caption || ''); return {}; }, sendPresenceUpdate: async () => {}, groupMetadata: async () => ({ participants: [] }) };
const say = async (text, from) => { sent.length = 0; await router.handle(sock, { key: { remoteJid: from, fromMe: false }, message: { conversation: text } }); return sent.join(' | ').replace(/[​-‍⁠-⁤﻿]/g, ''); };

(async () => {
  await db.connectDB();
  console.log('\nOWNER IDENTITY');
  ok('owner LID recognised', User.isOwner(LID));
  ok('owner phone number recognised', User.isOwner(PHONE));
  ok('owner phone with device suffix recognised', User.isOwner(`${MODERATION.OWNER_ALIASES[0]}:12@s.whatsapp.net`));
  ok('random number is not owner', !User.isOwner(U1));

  for (const [j, n] of [[U1, 'Alice'], [U2, 'Bob']]) { User.create(j, n); grantStarterSquad(j); User.update(j, { registered: true }); }

  const viaPhone = await say('!broadcast hi', PHONE);
  ok('owner commands work from the phone-number DM', /Broadcast sent/.test(viaPhone), viaPhone.slice(0, 80));
  const viaLid = await say('!broadcast hi', LID);
  ok('owner commands work from the LID', /Broadcast sent/.test(viaLid), viaLid.slice(0, 80));
  const owners = User.all().filter((u) => User.isOwner(u.whatsappId));
  ok('both identities share ONE owner profile', owners.length === 1, `${owners.length} profiles`);

  console.log('\nCOMMAND FIXES');
  let r = await say('!cooldown 60 2222222222', PHONE);
  ok('!cooldown <secs> <id> works', /cooldown for/i.test(r), r.slice(0, 80));
  await say('!uncooldown 2222222222', PHONE);
  r = await say('!cooldown 2222222222 60', PHONE);
  ok('!cooldown <id> <secs> still works', /cooldown for/i.test(r), r.slice(0, 80));
  r = await say('!playtourney', U1);
  ok('!playtourney replies (was silent)', r.length > 0);
  r = await say('!pvpadmin', PHONE);
  ok('!pvpadmin is a working alias', /CLEARED/.test(r), r.slice(0, 80));
  r = await say('!ban 134643298873543', U1);
  ok('owner cannot be targeted by LID number', !/has been \*?banned/i.test(r));

  console.log('\n' + '='.repeat(50));
  console.log(`OWNER + FIXES: ${pass} passed, ${fail} failed`);
  console.log('='.repeat(50));
  setTimeout(() => process.exit(fail ? 1 : 0), 100);
})().catch((e) => { console.error(e); process.exit(1); });
