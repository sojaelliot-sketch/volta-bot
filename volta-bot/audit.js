'use strict';
// Run every routed command serially, in isolation, and report REAL failures.
const fs=require('fs'),os=require('os'),path=require('path');
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'vt-audit-'));
const {MODERATION}=require('./config/constants');
MODERATION.COOLDOWN_MS=0; MODERATION.WARNINGS_BEFORE_BAN=999999; MODERATION.OPEN_REGISTRATION=true;
// The anti-ban layer sleeps before every send (rate limiter, burst protection,
// health pause). Real behaviour, but it makes a 158-command sweep take an hour.
const ab=require('./utils/antiban');
ab.getRateLimitDelay=()=>0;
ab.checkBurstProtection=()=>({burst:false,restMs:0});
ab.shouldPauseSending=()=>false;
const m=require('./utils/messaging'); m.smartTypingPause=async()=>{}; m.startTyping=async()=>{}; m.stopTyping=async()=>{}; m.typing=async()=>{};
const db=require('./config/database'); const User=require('./models/User'); const Player=require('./models/Player');
const League=require('./models/League');
const {grantStarterSquad}=require('./utils/playerGenerator');

const OWNER=`${MODERATION.OWNER_ID}@s.whatsapp.net`;
const A='2348000000001@s.whatsapp.net', B='2348000000002@s.whatsapp.net';
const G='120363000000000000@g.us';
const clean=t=>String(t).replace(/[\u200B-\u200F\u2060-\u2064\uFEFF\u034F\u17B5\u180E]/g,'');

(async()=>{
await db.connectDB();
for(const [j,n] of [[A,'Alpha FC'],[B,'Beta FC'],[OWNER,'Owner FC']]){
  User.create(j,n); grantStarterSquad(j);
  User.update(j,{registered:true,currency:5000000,mmr:1400,rank:'Silver',wins:5,losses:2,draws:1});
}
League.addAiPlayers(20);
const router=require('./commands/router');
const squad=Player.getByOwner(A);
const PID=squad[0] ? squad[0].id.slice(0,6) : '1';
const BNUM=B.split('@')[0];

const src=fs.readFileSync('commands/router.js','utf8');
const routed=[...new Set([...src.matchAll(/^\s{2}([a-z0-9_]+):\s*\(\)\s*=>\s*require/gm)].map(x=>x[1]))];

// Plausible arguments so a command is exercised, not just its usage text.
const ARGS={
  register:'Tester FC', card:PID, explain:'chemistry', help:'money', profile:'',
  give:`1000 ${BNUM}`, borrow:'5000', lend:`${BNUM} 5000`, loan:'help',
  sell:`${PID} 5000`, buy:'ABC', search:'Storm', train:`${PID} pace`, boost:PID,
  captain:PID, rename:`${PID} Zico`, swap:'1 2', reserve:PID, retire:PID,
  slot:'100', coinflip:'100 heads', highlow:'100', tbet:'1 100',
  challenge:BNUM, pk:BNUM, rivalry:BNUM, trade:BNUM, derby:BNUM,
  league:'form', password:'Pitch-Volley77', setpass:'Corner-Kick88',
  warn:BNUM, ban:BNUM, unban:BNUM, promote:BNUM, demote:BNUM, cooldown:BNUM,
  uncooldown:BNUM, subtract:`${BNUM} 100`, disable:'ping', announce:'hello',
  broadcast:'hi', redeem:'CODE', setbounty:`${BNUM} 500`, pack:'starter',
  competitions:'', bracket:'', sub:PID, chant:'we are volta', shield:PID,
  switchsquad:'1', insurance:PID, contract:PID, surgery:PID, scout:'',
};
const GROUP_ONLY=new Set(['derby','kick','kickgc','tagall','compgcs','everyone']);
const SKIP=new Set(['on','off','reload','broadcast','kick','kickgc','clearpvp','play','match','forfeit','formcheck','press','curse','compplay','tournament','competitions']);

const sent=[];
const sock={
  sendMessage:async(j,c)=>{sent.push({j,c});return{key:{id:'x'}};},
  sendPresenceUpdate:async()=>{},
  groupMetadata:async()=>({id:G,subject:'Test',desc:'',participants:[{id:A},{id:B},{id:OWNER}]}),
  groupParticipantsUpdate:async()=>{},
};
const mk=(t,s,chat)=>({key:{remoteJid:chat||s,participant:s,fromMe:false},message:{conversation:t}});

const broken=[], soft=[];
let n=0;
for(const cmd of routed){
  process.stderr.write(`[${++n}/${routed.length}] ${cmd}\n`);
  if(SKIP.has(cmd)) continue;
  const arg=ARGS[cmd]!==undefined?ARGS[cmd]:'';
  const text=`!${cmd}${arg?' '+arg:''}`;
  const chat=GROUP_ONLY.has(cmd)?G:null;
  const who=OWNER;   // owner passes every permission gate
  sent.length=0;
  let threw=null, timedOut=false;
  try{
    await Promise.race([
      router.handle(sock,mk(text,who,chat)),
      new Promise((_,rej)=>setTimeout(()=>{timedOut=true;rej(new Error('TIMEOUT'));},4000)),
    ]);
  }catch(e){ threw=e; }
  const out=clean(sent.map(s=>s.c?.text||'').join(' | '));
  if(threw){ const b={cmd,text,why:'THREW: '+threw.message,stack:(threw.stack||'').split('\n')[1]};
    broken.push(b); console.log('BROKEN '+text.padEnd(22)+' '+b.why+(b.stack?' @'+b.stack.trim().slice(0,80):'')); }
  else if(/Something went wrong/i.test(out)){ broken.push({cmd,text,why:'generic error'}); console.log('BROKEN '+text.padEnd(22)+' generic error reply'); }
  else if(!out.trim() && !sent.length){ soft.push({cmd,text}); console.log('SILENT '+text); }
}

console.log('\n'+'='.repeat(60));
console.log(`AUDIT: ${routed.length - SKIP.size} commands run`);
console.log('='.repeat(60));
if(broken.length){
  console.log(`\n❌ BROKEN (${broken.length}):`);
  for(const b of broken) console.log(`  ${b.text.padEnd(24)} ${b.why}${b.stack?'\n      '+b.stack.trim():''}`);
} else console.log('\n✅ none throw and none return the generic error');
if(soft.length){
  console.log(`\n🔇 SILENT (${soft.length}):`);
  for(const s of soft) console.log(`  ${s.text.padEnd(24)} ${s.why}`);
}
console.log();
})();
