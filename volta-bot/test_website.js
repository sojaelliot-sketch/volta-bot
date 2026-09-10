'use strict';
// test_website.js — the site/backend contract, exercised over real HTTP.
const fs=require('fs'),os=require('os'),path=require('path'),http=require('http'),crypto=require('crypto');
const DIR='/tmp/vt-site'; fs.rmSync(DIR,{recursive:true,force:true}); fs.mkdirSync(DIR,{recursive:true});
process.env.DATA_DIR=DIR; process.env.PORT='4111';
process.env.PUBLIC_URL='http://localhost:4111'; process.env.SITE_URL='http://localhost:4111';
const db=require('./config/database'); const User=require('./models/User');
const pw=require('./utils/password'); const {grantStarterSquad}=require('./utils/playerGenerator');
let pass=0,fail=0;
const ok=(l,c,d)=>{c?(console.log('  ✓ '+l),pass++):(console.log('  ✗ '+l+(d?' — '+d:'')),fail++)};
const req=(method,p,body,token)=>new Promise((res)=>{
  const d=body?JSON.stringify({...body,token}):null;
  const url=token&&method==='GET'?`${p}${p.includes('?')?'&':'?'}token=${token}`:p;
  const r=http.request({host:'localhost',port:4111,path:url,method,
    headers:d?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(d)}:{}},(x)=>{
    let b='';x.on('data',c=>b+=c);x.on('end',()=>{ let j={}; try{j=JSON.parse(b);}catch{} res({status:x.statusCode,body:j}); });});
  r.on('error',()=>res({status:0,body:{}}));
  if(d) r.write(d); r.end();});

(async()=>{
await db.connectDB();
const J='2348000000009@s.whatsapp.net';
User.create(J,'Site FC'); grantStarterSquad(J);
User.update(J,{registered:true,currency:500000,mmr:1500,rank:'Gold',wins:4,losses:1,draws:0,...pw.make('Pitch-Volley77')});
require('./web/server');
await new Promise(r=>setTimeout(r,1200));

console.log('\nSERVER IS UP');
let r=await req('GET','/api/where');
ok('the site can discover the backend', r.status===200 && !!r.body.site, JSON.stringify(r.body));

console.log('\nSIGN IN');
r=await req('POST','/api/login',{name:'Site FC',password:'Pitch-Volley77'});
ok('a correct password signs in', r.status===200 && !!r.body.token, JSON.stringify(r.body).slice(0,60));
const T=r.body.token;
ok('a wrong one does not', (await req('POST','/api/login',{name:'Site FC',password:'nope'})).status!==200);

console.log('\nEVERY SCREEN HAS ITS DATA');
const me=await req('GET','/api/me',null,T);
ok('/api/me returns the club', me.status===200 && me.body.user.name==='Site FC');
ok('and the full roster the Squad tab needs', (me.body.user.roster||[]).length>0, `${(me.body.user.roster||[]).length} players`);
ok('with a rating on every player', (me.body.user.roster||[]).every(p=>typeof p.ovr==='number'));
for(const [label,path] of [['market','/api/market'],['leaderboard','/api/leaderboard'],['match history','/api/mymatches']]){
  const x=await req('GET',path,null,T);
  ok(`${label} loads`, x.status===200, `status ${x.status}`);
}

console.log('\nNEW: MANAGING A PLAYER FROM THE SITE');
const pid=me.body.user.roster[0].id;
const before=me.body.user.currency;
r=await req('POST','/api/shop/train',{playerId:pid,elite:false},T);
ok('training works', r.status===200, JSON.stringify(r.body).slice(0,70));
r=await req('GET','/api/me',null,T);
ok('and it costs money', r.body.user.currency<before, `${before} -> ${r.body.user.currency}`);

const u=r.body.user;
const xi=[...(u.startingXI||[])], bench=[...(u.bench||[])];
const moving=xi[0];
r=await req('POST','/api/squad',{startingXI:xi.filter(x=>x!==moving),bench:[...bench,moving]},T);
ok('the line-up can be changed', r.status===200, `status ${r.status}`);
r=await req('GET','/api/me',null,T);
ok('and the change stuck', !(r.body.user.startingXI||[]).includes(moving));

console.log('\nNEW: HIGH-LOW');
r=await req('POST','/api/highlow/start',{stake:100},T);
ok('a game starts', r.status===200 && r.body.first>=1 && r.body.first<=9, JSON.stringify(r.body).slice(0,60));
const dir=r.body.first===1?'higher':r.body.first===9?'lower':'higher';
r=await req('POST','/api/highlow/guess',{dir},T);
ok('a guess resolves', r.status===200 && ['win','lose'].includes(r.body.outcome), JSON.stringify(r.body).slice(0,70));
ok('and reports the new balance', typeof r.body.currency==='number');

console.log('\nNEW: PASSWORD FROM THE WEB');
r=await req('POST','/api/password',{current:'Pitch-Volley77',password:'Corner-Kick88'},T);
ok('it can be changed', r.status===200, JSON.stringify(r.body).slice(0,70));
ok('the new one works', (await req('POST','/api/login',{name:'Site FC',password:'Corner-Kick88'})).status===200);
ok('the old one does not', (await req('POST','/api/login',{name:'Site FC',password:'Pitch-Volley77'})).status!==200);
r=await req('POST','/api/password',{current:'wrong',password:'Another-One99'},T);
ok('a wrong current password is refused', r.status===403, `status ${r.status}`);
r=await req('POST','/api/password',{current:'Corner-Kick88',password:'abc'},T);
ok('a weak new password is refused with a reason', r.status===400 && /6 characters/.test(r.body.error||''), r.body.error);

console.log('\nAUTH IS ENFORCED');
for(const path of ['/api/me','/api/mymatches']){
  ok(`${path} needs a token`, (await req('GET',path)).status===401);
}
ok('/api/squad needs a token', (await req('POST','/api/squad',{startingXI:[],bench:[]})).status===401);
ok('a garbage token is refused', (await req('GET','/api/me',null,'garbage')).status===401);

console.log('\nTHE PAGE ITSELF');
r=await new Promise((res)=>http.get('http://localhost:4111/',(x)=>{let b='';x.on('data',c=>b+=c);x.on('end',()=>res({status:x.statusCode,body:b}));}));
ok('the site is served', r.status===200 && r.body.includes('VOLTA'));
for(const f of ['openPlayer','loadHistory','hlStart','savePassword','consumeConnectLink'])
  ok(`${f} shipped`, r.body.includes(f));

console.log('\n'+'='.repeat(50));
console.log(`WEBSITE TESTS: ${pass} passed, ${fail} failed`);
console.log('='.repeat(50)+'\n');
process.exit(fail?1:0);
})();
