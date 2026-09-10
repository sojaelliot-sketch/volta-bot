'use strict';
// test_password.js — passwords must work identically on both surfaces.
const fs=require('fs'),os=require('os'),path=require('path');
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'vt-pw-'));
const {MODERATION}=require('./config/constants'); MODERATION.COOLDOWN_MS=0; MODERATION.WARNINGS_BEFORE_BAN=9999;
const m=require('./utils/messaging'); m.smartTypingPause=async()=>{};
const db=require('./config/database'); const User=require('./models/User');
const pw=require('./utils/password');
const {grantStarterSquad}=require('./utils/playerGenerator');
const router=require('./commands/router');
let pass=0,fail=0;
const ok=(l,c,d)=>{c?(console.log('  ✓ '+l),pass++):(console.log('  ✗ '+l+(d?' — '+d:'')),fail++)};
const A='1111111111@s.whatsapp.net', G='120363000000000000@g.us';
const sent=[]; const sock={sendMessage:async(j,c)=>{sent.push({j,c});return{};},sendPresenceUpdate:async()=>{},groupMetadata:async()=>({desc:'',subject:'T'})};
const clean=t=>String(t).replace(/[\u200B-\u200F\u2060-\u2064\uFEFF\u034F\u17B5\u180E]/g,'');
const mk=(t,s,chat)=>({key:{remoteJid:chat||s,participant:s,fromMe:false},message:{conversation:t}});
async function run(t,s,chat){sent.length=0;await router.handle(sock,mk(t,s,chat));return clean(sent.map(x=>x.c?.text||'').join('\n'));}

(async()=>{
await db.connectDB();
User.create(A,'Alpha FC'); grantStarterSquad(A); User.update(A,{registered:true,currency:5000});

console.log('\nSTRENGTH RULES');
ok('too short is refused', !pw.check('abc').ok);
ok('an obvious password is refused', !pw.check('password').ok);
ok('a repeated character is refused', !pw.check('aaaaaa').ok);
ok('a decent one passes', pw.check('football2024').ok);
ok('a strong one scores higher',
   pw.check('Pitch-Volley77').score > pw.check('football2024').score);
ok('every rejection explains itself', !!pw.check('abc').problem);
ok('a suggestion is usable', pw.check(pw.suggest()).ok, pw.suggest());

console.log('\nHASHING IS SHARED AND CORRECT');
const h=pw.make('Pitch-Volley77');
ok('the right password verifies', pw.verify('Pitch-Volley77',h.passwordHash,h.passwordSalt));
ok('a wrong one does not', !pw.verify('wrong',h.passwordHash,h.passwordSalt));
ok('an empty one does not', !pw.verify('',h.passwordHash,h.passwordSalt));
ok('missing hash is handled', !pw.verify('x',null,null));
ok('salts differ between users', pw.make('same').passwordSalt!==pw.make('same').passwordSalt);

console.log('\nREGRESSION: a password typed in a group was being saved');
let o=await run('!password Pitch-Volley77',A,G);
ok('it is refused in a group', /everyone here just read that/i.test(o), o.slice(0,70));
ok('and nothing was stored', !User.getByWhatsappId(A).passwordHash);
ok('it explains what to do instead', /direct chat|!site/i.test(o));

console.log('\nSETTING ONE PRIVATELY');
o=await run('!password Pitch-Volley77',A);
ok('it is accepted in a DM', /password saved/i.test(o), o.slice(0,60));
const u=User.getByWhatsappId(A);
ok('a hash was stored', !!u.passwordHash);
ok('a salt was stored', !!u.passwordSalt);
ok('the plaintext is nowhere on the record', !JSON.stringify(u).includes('Pitch-Volley77'));
ok('it verifies afterwards', pw.verify('Pitch-Volley77',u.passwordHash,u.passwordSalt));
ok('strength is shown back', /strong|good|okay/i.test(o), o.slice(0,120));

console.log('\nGUIDANCE AND WEAK INPUT');
o=await run('!password',A);
ok('bare !password explains', /change your password|set a password/i.test(o));
ok('and offers a suggestion', /Need one|Try/i.test(o));
o=await run('!password abc',A);
ok('a weak password is refused with a reason', /at least 6/i.test(o), o.slice(0,70));
ok('the old password still works after a refusal',
   pw.verify('Pitch-Volley77',User.getByWhatsappId(A).passwordHash,User.getByWhatsappId(A).passwordSalt));
o=await run('!setpass Corner-Kick88',A);
ok('!setpass is an alias', /password saved/i.test(o));

console.log('\nFORMATTING');
const help=require('./commands/help');
const menu=help.topLevel('all');
ok('no literal double asterisks in the menu', !menu.includes('**'));
ok('the menu lists commands, not descriptions', (menu.match(/·/g)||[]).length>20);
ok('every category has a heading', (menu.match(/^[^\s].*\*[A-Z ]+\*$/gm)||[]).length>=5);
ok('a command count is shown', /\d+ commands/.test(menu));
ok('the interactive module is gone', !fs.existsSync('./utils/interactive.js'));

console.log('\n'+'='.repeat(50));
console.log(`PASSWORD + FORMAT: ${pass} passed, ${fail} failed`);
console.log('='.repeat(50)+'\n');
process.exit(fail?1:0);
})();
