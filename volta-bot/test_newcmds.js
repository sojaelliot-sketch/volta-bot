const fs=require('fs'),os=require('os'),path=require('path');
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'vt-new-'));
const {MODERATION}=require('./config/constants'); MODERATION.COOLDOWN_MS=0; MODERATION.WARNINGS_BEFORE_BAN=9999;
const m=require('./utils/messaging'); m.smartTypingPause=async()=>{}; m.startTyping=async()=>{}; m.stopTyping=async()=>{};
const db=require('./config/database'); const User=require('./models/User');
const {grantStarterSquad}=require('./utils/playerGenerator'); const router=require('./commands/router');
const G='120363000000000000@g.us';
const A='1111111111@s.whatsapp.net', B='2222222222@s.whatsapp.net', C='3333333333@s.whatsapp.net';
const sent=[];
const sock={sendMessage:async(j,c)=>{sent.push({j,c});return{};},sendPresenceUpdate:async()=>{},groupMetadata:async()=>({desc:'',subject:'T'})};
const mk=(t,s,chat)=>({key:{remoteJid:chat||s,participant:s,fromMe:false},message:{conversation:t}});
// The messaging layer injects zero-width characters as an anti-ban measure.
// Strip them before matching or every assertion fails on invisible noise.
const clean=(t)=>String(t).replace(/[\u200B-\u200F\u2060-\u2064\uFEFF\u034F\u17B5\u180E]/g,'');
async function run(t,s,chat){sent.length=0; await router.handle(sock,mk(t,s,chat)); return clean(sent.map(x=>x.c?.text||'').join('\n'));}
let pass=0,fail=0; const ok=(l,c,d)=>{c?(console.log('  ✓ '+l),pass++):(console.log('  ✗ '+l+(d?' — '+d:'')),fail++);};
(async()=>{
  await db.connectDB();
  for(const[j,n]of[[A,'Alpha'],[B,'Beta'],[C,'Gamma']]){User.create(j,n);grantStarterSquad(j);User.update(j,{registered:true,currency:50000});}
  console.log('\n!agent');
  let o=await run('!agent',A);
  ok('report generated', /AGENT'S FIND/.test(o), o.slice(0,90));
  ok('offer has a price', /Asking:/.test(o));
  o=await run('!agent',A);
  ok('repeat shows the open offer', /already have a report/.test(o));
  const before=User.getByWhatsappId(A).currency;
  o=await run('!agent sign',A);
  ok('signing works', /SIGNED/.test(o), o.slice(0,80));
  ok('signing costs money', User.getByWhatsappId(A).currency < before);
  o=await run('!agent',A);
  ok('daily cooldown applies', /still working the phones/.test(o), o.slice(0,70));
  o=await run('!agent sign',B);
  ok('cannot sign with no offer', /No offer on the table/.test(o));
  o=await run('!agent',B); await run('!agent pass',B);
  o=await run('!agent',B);
  ok('passing still burns the day', /still working the phones/.test(o));

  console.log('\n!derby');
  o=await run('!derby',A);
  ok('DM rejects derby', /only works in a group/.test(o), o.slice(0,60));
  o=await run('!derby',A,G);
  ok('group shows help', /DERBY/.test(o));
  o=await run('!derby 2222222222',A,G);
  ok('derby opens', /CALLS OPEN/.test(o), o.slice(0,80));
  const cb=User.getByWhatsappId(C).currency;
  o=await run('!derby home',C,G);
  ok('a call is accepted', /calls/.test(o), o.slice(0,70));
  ok('call costs the stake', User.getByWhatsappId(C).currency===cb-250);
  o=await run('!derby home',C,G);
  ok('no double calling', /already called/.test(o));
  o=await run('!derby status',C,G);
  ok('status reports', /closes in/.test(o));
  o=await run('!derby 2222222222',A,G);
  ok('cannot open two at once', /already running/.test(o));

  console.log('\n!loan usability');
  o=await run('!loan help',A);
  ok('help explains both kinds', /two kinds|Lend a player/i.test(o));
  ok('help has no stray backslashes', !/\\\\`/.test(o), JSON.stringify(o.slice(0,60)));
  o=await run('!loan ok mloan_x',A);
  ok('alias ok -> accept routes money loans', !/Unknown command/.test(o));
  o=await run('!borrow 5000',A,G);
  ok('!borrow posts a request', /LOAN WANTED/.test(o), o.slice(0,60));
  o=await run('!loan',A);
  ok('bare !loan is friendly', /no loans running|Two things you can do/i.test(o));
  console.log('\n'+'='.repeat(46));
  console.log(`NEW-FEATURE TESTS: ${pass} passed, ${fail} failed`);
  console.log('='.repeat(46));
  process.exit(fail?1:0);
})();
