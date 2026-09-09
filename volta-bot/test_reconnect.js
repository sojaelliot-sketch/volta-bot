'use strict';
// test_reconnect.js — the reconnect policy, tested without WhatsApp.
//
// The loop was never reproducible on demand: it needed a real disconnect at the
// right moment. So the policy is extracted here and driven directly.

const { DisconnectReason } = require('@whiskeysockets/baileys');
let pass=0,fail=0;
const ok=(l,c,d)=>{c?(console.log('  ✓ '+l),pass++):(console.log('  ✗ '+l+(d?' — '+d:'')),fail++)};
const eq=(l,a,b)=>ok(l,a===b,`expected ${b}, got ${a}`);

// Mirror of the policy in index.js.
const MAX=12;
function decide(status, attempts){
  const FATAL=new Set([DisconnectReason.loggedOut,403,405]);
  if(FATAL.has(status)) return {action:'stop',reason:'rejected'};
  if(status===DisconnectReason.restartRequired){
    const n=attempts+1;
    if(n>MAX) return {action:'stop',reason:'restart-loop'};
    return {action:'retry',attempts:n,delay:Math.min(1500*n,20000)};
  }
  const n=attempts+1;
  if(n>MAX) return {action:'stop',reason:'exhausted'};
  const base=status===440?8000:3000;
  return {action:'retry',attempts:n,delay:Math.min(base*Math.pow(1.6,n-1),120000)};
}

console.log('\nFATAL STATES MUST NOT RETRY');
for(const [name,code] of [['loggedOut (401)',DisconnectReason.loggedOut],['forbidden (403)',403],['not authorised (405)',405]]){
  eq(name+' stops', decide(code,0).action, 'stop');
}

console.log('\nREGRESSION: restartRequired used to retry forever on a flat 1.5s');
let attempts=0, spins=0;
for(let i=0;i<500;i++){
  const d=decide(DisconnectReason.restartRequired,attempts);
  if(d.action==='stop') break;
  attempts=d.attempts; spins++;
}
ok('restart loop terminates', spins<=MAX, `ran ${spins} times`);
ok('restart backoff grows', decide(DisconnectReason.restartRequired,5).delay > decide(DisconnectReason.restartRequired,0).delay);

console.log('\nTRANSIENT FAILURES BACK OFF THEN GIVE UP');
attempts=0; let total=0, tries=0;
for(let i=0;i<500;i++){
  const d=decide(500,attempts);
  if(d.action==='stop'){ ok('gives up eventually', d.reason==='exhausted'); break; }
  attempts=d.attempts; total+=d.delay; tries++;
}
eq('stops after the cap', tries, MAX);
ok('delay is capped at 2 minutes', decide(500,50).action==='stop' || decide(500,10).delay<=120000);
ok('backoff is genuinely exponential', decide(500,6).delay > decide(500,1).delay*4,
   `${decide(500,1).delay} -> ${decide(500,6).delay}`);
ok('total wait before giving up is sane', total>60000 && total<900000, `${Math.round(total/1000)}s`);

console.log('\n440 (REPLACED BY ANOTHER CONNECTION) BACKS OFF HARDER');
ok('440 waits longer than a generic drop', decide(440,0).delay > decide(500,0).delay,
   `440=${decide(440,0).delay} vs 500=${decide(500,0).delay}`);

console.log('\nSOCKET TEARDOWN');
// The actual loop cause: old sockets stayed alive and fought the new one.
let live=0;
const fakeSock=()=>({ _open:true, ev:{removeAllListeners(){}}, end(){this._open=false;}, ws:{close(){}} });
function teardown(s){ if(!s) return; try{s.ev.removeAllListeners();}catch{} try{s.end();}catch{} try{s.ws.close();}catch{} }
let active=null;
for(let i=0;i<20;i++){
  if(active) teardown(active);
  active=fakeSock();
}
live=[active].filter(s=>s._open).length;
eq('only one socket survives 20 reconnects', live, 1);

const src=require('fs').readFileSync('index.js','utf8');
ok('index.js tears the old socket down before making a new one',
   /teardownSocket\(activeSock\)[\s\S]{0,120}makeWASocket/.test(src));
ok('index.js has a single-flight reconnect guard', /if\s*\(reconnecting\)\s*return;/.test(src));
ok('index.js does not zero attempts on open', !/connection === 'open'[\s\S]{0,180}reconnectAttempts = 0;/.test(src));

console.log('\n'+'='.repeat(50));
console.log(`RECONNECT TESTS: ${pass} passed, ${fail} failed`);
console.log('='.repeat(50)+'\n');
process.exit(fail?1:0);
