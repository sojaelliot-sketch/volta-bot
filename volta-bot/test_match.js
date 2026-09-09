'use strict';
// test_match.js — match fairness and player involvement.
//
// These were the two complaints: better players didn't score more, and the
// result felt decided before kickoff. Both are now measurable.

const E = require('./game-engine/matchEngine');
let pass=0,fail=0;
const ok=(l,c,d)=>{c?(console.log('  ✓ '+l),pass++):(console.log('  ✗ '+l+(d?' — '+d:'')),fail++)};

const mk=(n,v)=>({name:n,role:'outfield',condition:100,form:'Normal',chemistry:60,
  stats:{shooting:v,skill:v,pace:v,composure:v,stamina:v}});
const gk=(v)=>({name:'GK',role:'goalkeeper',condition:100,form:'Normal',chemistry:60,
  stats:{reflex:v,positioning:v,anticipation:v,strength:v,composure:v}});
const squad=(v)=>[mk('A',v),mk('B',v-3),mk('C',v-6),gk(v-2)];

console.log('\nBETTER PLAYERS GET THE BALL MORE');
const test=[mk('Star',90),mk('Solid',72),mk('Fringe',55),gk(70)];
const seen={};
for(let i=0;i<30000;i++){const p=E.pickAttacker(test,'shoot'); seen[p.name]=(seen[p.name]||0)+1;}
ok('the goalkeeper never takes a shot', !seen.GK, `GK picked ${seen.GK||0} times`);
ok('the best player is involved most', seen.Star>seen.Solid && seen.Solid>seen.Fringe,
   `Star ${seen.Star}, Solid ${seen.Solid}, Fringe ${seen.Fringe}`);
ok('quality matters clearly', seen.Star > seen.Fringe*2.5,
   `star/fringe ratio ${(seen.Star/seen.Fringe).toFixed(2)}`);
ok('but the weak player is not frozen out', seen.Fringe/30000 > 0.05,
   `${(seen.Fringe/300).toFixed(1)}%`);

console.log('\nSHOT SELECTION MATCHES THE ACTION');
const dribblers=[mk('Fast',50),mk('Slow',50),gk(60)];
dribblers[0].stats={shooting:40,skill:92,pace:92,composure:50,stamina:60};
dribblers[1].stats={shooting:92,skill:40,pace:40,composure:50,stamina:60};
let dribbleFast=0, shootStrong=0;
for(let i=0;i<20000;i++){
  if(E.pickAttacker(dribblers,'dribble').name==='Fast') dribbleFast++;
  if(E.pickAttacker(dribblers,'shoot').name==='Slow') shootStrong++;
}
ok('the dribbler is chosen to dribble', dribbleFast>12000, `${(dribbleFast/200).toFixed(1)}%`);
ok('the finisher is chosen to shoot', shootStrong>12000, `${(shootStrong/200).toFixed(1)}%`);

console.log('\nRESULTS ARE NOT DECIDED AT KICKOFF');
function run(a,b,n){
  const A=squad(a),B=squad(b);let w=0,l=0,d=0,goals=0;
  for(let i=0;i<n;i++){let sa=0,sb=0;
    for(let m=0;m<16;m++){const min=Math.floor(m*90/16);
      for(const [atk,def,inc] of [[A,B,()=>sa++],[B,A,()=>sb++]]){
        const p=E.pickAttacker(atk,'shoot');
        const ap=E.calcActionPower(p,'shoot',50,min);
        const dp=E.calcDefensePower(def.filter(x=>x.role!=='goalkeeper'),def.find(x=>x.role==='goalkeeper'),50,min);
        if(E.resolveShotOutcome(ap,dp,min)==='goal') inc();}}
    goals+=sa+sb; sa>sb?w++:sb>sa?l++:d++;}
  return {w:w/n,l:l/n,d:d/n,goals:goals/n};
}
const even=run(70,70,1500);
ok('even squads are a coin toss', Math.abs(even.w-even.l)<0.08,
   `${(even.w*100).toFixed(1)}% vs ${(even.l*100).toFixed(1)}%`);
ok('draws happen', even.d>0.05, `${(even.d*100).toFixed(1)}%`);

const small=run(76,70,1500);
ok('a small edge favours but does not guarantee', small.w>0.55 && small.w<0.72,
   `${(small.w*100).toFixed(1)}%`);
ok('the underdog still wins sometimes', small.l>0.15, `${(small.l*100).toFixed(1)}%`);

const big=run(82,70,1500);
ok('a big edge is clearly decisive', big.w>0.70, `${(big.w*100).toFixed(1)}%`);
ok('but not a certainty', big.w<0.92, `${(big.w*100).toFixed(1)}%`);

const huge=run(90,60,1200);
ok('a mismatch is nearly certain', huge.w>0.93, `${(huge.w*100).toFixed(1)}%`);

console.log('\nSCORELINES STAY SANE');
ok('goals per match are reasonable', even.goals>4 && even.goals<16, even.goals.toFixed(2));

console.log('\nSHOT PROBABILITY IS WELL FORMED');
for(const [ap,gkp] of [[0,0],[200,0],[0,200],[60,60]]){
  const p=E.resolveShotOutcome(ap,gkp,45);
  ok(`outcome valid for ap=${ap} gk=${gkp}`, ['goal','save','near_miss','blocked'].includes(p), p);
}
ok('empty squad does not crash', E.pickAttacker([],'shoot')===null);
ok('keeper-only squad still returns someone', !!E.pickAttacker([gk(70)],'shoot'));

console.log('\n'+'='.repeat(50));
console.log(`MATCH TESTS: ${pass} passed, ${fail} failed`);
console.log('='.repeat(50)+'\n');
process.exit(fail?1:0);
