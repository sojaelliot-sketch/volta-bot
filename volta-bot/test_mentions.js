'use strict';
// test_mentions.js — tags must render AND notify, and survive the antiban layer.
const fs=require('fs'),os=require('os'),path=require('path');
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'vt-mn-'));
const db=require('./config/database');
const User=require('./models/User');
const M=require('./utils/mentions');
const ab=require('./utils/antiban');
const tickets=require('./utils/connectTickets');
let pass=0,fail=0;
const ok=(l,c,d)=>{c?(console.log('  ✓ '+l),pass++):(console.log('  ✗ '+l+(d?' — '+d:'')),fail++)};

(async()=>{
await db.connectDB();
const J='2348012345678@s.whatsapp.net';
User.create(J,'Kano Kings'); User.update(J,{registered:true});

console.log('\nTOKENS');
ok('a jid becomes an @number', M.token(J)==='@2348012345678', M.token(J));
ok('a device suffix is stripped', M.token('2348012345678:12@s.whatsapp.net')==='@2348012345678');
ok('an empty jid is safe', M.token(null)==='');

console.log('\nREGRESSION: the array used to name people the body never tagged');
ok('a jid not in the body is dropped', M.collect('Sent to Kano Kings',[J]).length===0);
ok('a jid in the body is kept', M.collect('Sent to @2348012345678',[J]).length===1);
ok('body tags are found without being passed',
   M.collect('@2348012345678 and @2349099887766').length===2);
ok('duplicates collapse', M.collect('@2348012345678 @2348012345678').length===1);
ok('short numbers are ignored', M.collect('meet at @12').length===0);

console.log('\nTAG RENDERING');
const t=M.tag(J,{name:'Kano Kings'});
ok('a tag carries a readable name', t.includes('Kano Kings'), t);
ok('and the token that makes it notify', t.includes('@2348012345678'), t);
ok('bare mode is just the token', M.tag(J,{bare:true})==='@2348012345678');
ok('a name is looked up when not given', M.tag(J).includes('Kano Kings'), M.tag(J));

console.log('\nREGRESSION: the antiban injector used to break tags');
let broken=0;
const body='💸 Sent 5,000 to *Kano Kings* @2348012345678 — nice one @2349099887766! 🔥⚽';
for(let i=0;i<600;i++){
  const out=ab.varyMessage(body+' '+i);
  if(!/@2348012345678\b/.test(out)||!/@2349099887766\b/.test(out)) broken++;
}
ok('mention tokens always survive', broken===0, `${broken}/600 broken`);
let emojiBroken=0;
for(let i=0;i<400;i++){
  const out=ab.varyMessage(body+' '+i);
  if(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out)) emojiBroken++;
}
ok('and emoji still survive too', emojiBroken===0, `${emojiBroken}/400`);

console.log('\nCONNECT TICKETS');
const code=tickets.issue(J);
ok('a ticket is issued', typeof code==='string'&&code.length>10);
ok('it redeems to the right account', tickets.redeem(code)===J);
ok('it is single use', tickets.redeem(code)===null);
ok('garbage is rejected', tickets.redeem('nope')===null);
ok('an empty code is rejected', tickets.redeem('')===null);
const link=tickets.buildLink(J);
ok('a link is built', link.includes('#c='), link.slice(0,40));
const payload=JSON.parse(Buffer.from(/#c=(.+)$/.exec(link)[1],'base64url').toString());
ok('the link carries the backend address', !!payload.b, payload.b);
ok('and a ticket', !!payload.t);
ok('the embedded ticket works', tickets.redeem(payload.t)===J);

console.log('\nEXPIRY IS ENFORCED');
const old=tickets.issue(J);
const raw=db.findById('counters','connect_tickets');
raw.tickets=raw.tickets.map(t=>t.code===old?{...t,expires:Date.now()-1000}:t);
db.update('counters','connect_tickets',{tickets:raw.tickets});
ok('an expired ticket is refused', tickets.redeem(old)===null);

console.log('\n'+'='.repeat(50));
console.log(`MENTIONS + CONNECT: ${pass} passed, ${fail} failed`);
console.log('='.repeat(50)+'\n');
process.exit(fail?1:0);
})();
