'use strict';
// test_league_ai.js — AI clubs must actually play, and form must be real.
const fs=require('fs'),os=require('os'),path=require('path');
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'vt-lai-'));
const db=require('./config/database');
const L=require('./models/League');
const ui=require('./utils/ui');
let pass=0,fail=0;
const ok=(l,c,d)=>{c?(console.log('  ✓ '+l),pass++):(console.log('  ✗ '+l+(d?' — '+d:'')),fail++)};

(async()=>{
await db.connectDB();
L.clearAll(); L.addAiPlayers(48);

console.log('\nAI CLUBS HAVE ABILITY');
const st=L.getState();
const all=[]; for(let d=1;d<=4;d++) for(const [,x] of Object.entries(st.standings[d]||{})) all.push({d,...x});
ok('every AI club has a strength', all.every(a=>typeof a.strength==='number'), 'some missing');
const d1=all.filter(a=>a.d===1).map(a=>a.strength);
const d4=all.filter(a=>a.d===4).map(a=>a.strength);
const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
ok('Division 1 clubs are stronger than Division 4',
   !d1.length||!d4.length||avg(d1)>avg(d4), `D1 ${avg(d1).toFixed(0)} vs D4 ${avg(d4).toFixed(0)}`);

console.log('\nREGRESSION: the table used to be frozen forever');
const before=JSON.stringify(L.getDivisionStandings(1).map(r=>[r.points,r.played]));
const played=L.playAiRound();
const after=JSON.stringify(L.getDivisionStandings(1).map(r=>[r.points,r.played]));
ok('a round of fixtures is played', Object.values(played).some(n=>n>0), JSON.stringify(played));
ok('the table actually moves', before!==after);

console.log('\nRESULTS ARE INTERNALLY CONSISTENT');
for(let i=0;i<8;i++) L.playAiRound();
const rows=[]; const s2=L.getState();
for(let d=1;d<=4;d++) for(const [,x] of Object.entries(s2.standings[d]||{})) rows.push(x);
ok('played equals W+D+L everywhere', rows.every(r=>r.played===r.wins+r.draws+r.losses));
ok('points equal 3W+D everywhere', rows.every(r=>r.points===r.wins*3+r.draws));
ok('no negative goals', rows.every(r=>r.goalsFor>=0&&r.goalsAgainst>=0));
ok('form never exceeds five entries', rows.every(r=>(r.form||[]).length<=5));

console.log('\nSTRONGER CLUBS DO BETTER OVER TIME');
let strongWins=0,weakWins=0;
for(let i=0;i<4000;i++){
  const [a,b]=L.simulateFixture(84,62);
  if(a>b) strongWins++; else if(b>a) weakWins++;
}
ok('the stronger side wins more', strongWins>weakWins*2, `${strongWins} vs ${weakWins}`);
ok('but the weaker side still wins sometimes', weakWins>200, `${weakWins}/4000`);
let evenA=0,evenB=0;
for(let i=0;i<4000;i++){const [a,b]=L.simulateFixture(70,70); if(a>b)evenA++; else if(b>a)evenB++;}
ok('equal sides are close to even', Math.abs(evenA-evenB)<600, `${evenA} vs ${evenB}`);

console.log('\nFORM TABLE');
const form=L.getFormTable(1);
ok('a form table is produced', form.length>0);
ok('it is sorted by recent points', form.every((r,i)=>i===0||form[i-1].formPoints>=r.formPoints));
ok('form points never exceed 15', form.every(r=>r.formPoints<=15));
ok('form strings render', typeof form[0].form==='string'&&form[0].form.length>0, form[0].form);
ok('an empty division is handled', Array.isArray(L.getFormTable(99)));

console.log('\nPROMOTION STILL WORKS WITH LIVE AI');
const res=L.processPromotionRelegation();
const seen=new Set(); let dupes=0;
const s3=L.getState();
for(let d=1;d<=4;d++) for(const jid of Object.keys(s3.standings[d]||{})){ if(seen.has(jid))dupes++; seen.add(jid); }
ok('nobody is duplicated after promotion', dupes===0, `${dupes} duplicates`);
ok('movement happened', res.promoted.length+res.relegated.length>0);

console.log('\nHOUSE STYLE');
const c=ui.card({icon:'🎁',title:'T',lead:'L',rows:[['A','1'],['Longer','2']],next:'N'});
ok('rows align', c.includes('A       1')||c.includes('A      1'), JSON.stringify(c.split('\n')[3]));
ok('there is exactly one heading', (c.match(/^\*/gm)||[]).length<=1);
ok('the next step is present', c.includes('_N_'));
ok('a problem states the fix', ui.problem('X','do Y').includes('do Y'));
ok('bars render at the right width', ui.bar(50,100,10).length===10);
ok('form icons render', ui.form(['W','L']).length>0);
ok('money is grouped', ui.money(1234567)==='1,234,567');

console.log('\n'+'='.repeat(50));
console.log(`LEAGUE AI + UI TESTS: ${pass} passed, ${fail} failed`);
console.log('='.repeat(50)+'\n');
process.exit(fail?1:0);
})();
