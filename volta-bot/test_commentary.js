'use strict';
// test_commentary.js — commentary variety, context, and per-player chants.
const fs=require('fs'),os=require('os'),path=require('path');
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'vt-comm-'));
const db=require('./config/database');
const comm=require('./game-engine/commentary');
const chants=require('./game-engine/playerChants');
const {buildPlayer}=require('./utils/playerGenerator');
let pass=0,fail=0;
const ok=(l,c,d)=>{c?(console.log('  ✓ '+l),pass++):(console.log('  ✗ '+l+(d?' — '+d:'')),fail++)};

(async()=>{
await db.connectDB();

console.log('\nCONCURRENT MATCHES DO NOT STARVE EACH OTHER');
// Regression: one shared Set meant two live games ate the same pool.
const seenA=new Set(), seenB=new Set();
for(let i=0;i<6;i++){
  seenA.add(comm.buildBurst('goal',{player:'A',team:'TA',matchId:'match-A'},600).join('|'));
  seenB.add(comm.buildBurst('goal',{player:'B',team:'TB',matchId:'match-B'},600).join('|'));
}
ok('match A gets multiple distinct sequences', seenA.size>=3, `${seenA.size} unique`);
ok('match B gets multiple distinct sequences', seenB.size>=3, `${seenB.size} unique`);
ok('the two matches overlap (independent pools)',
   [...seenA].some(x=>[...seenB].some(y=>y.split('|')[1]===x.split('|')[1])), 'pools are separate');

console.log('\nHISTORY IS RELEASED WHEN A MATCH ENDS');
comm.endMatch('match-A');
ok('endMatch does not throw', true);

console.log('\nCOMMENTARY REFLECTS THE SCORELINE');
const note=(f,a,m)=>comm.scorelineNote({forGoals:f,againstGoals:a,minute:m});
ok('a 90th-minute winner is called out', /last kick/i.test(note(2,1,90)||''), note(2,1,90));
ok('a late equaliser is called out', /levelled/i.test(note(2,2,86)||''), note(2,2,86));
ok('a rout is called out', /embarrassing/i.test(note(5,0,60)||''), note(5,0,60));
ok('a comeback to level is called out', /all the way back/i.test(note(2,2,50)||''), note(2,2,50));
ok('an early opener is called out', /early one/i.test(note(1,0,10)||''), note(1,0,10));
ok('an unremarkable goal gets no note', note(2,0,40)===null, String(note(2,0,40)));
ok('missing context is handled', comm.scorelineNote({minute:50})===null);

console.log('\nGOAL BURSTS CARRY THE CONTEXT');
const late=comm.buildBurst('goal',{player:'Okafor',team:'T',matchId:'m1',forGoals:2,againstGoals:1},5400);
ok('a late winner gains an extra line', late.some(l=>/last kick/i.test(l)), late.join(' / ').slice(0,80));
const dull=comm.buildBurst('goal',{player:'Okafor',team:'T',matchId:'m2',forGoals:2,againstGoals:0},1200);
ok('a routine goal does not', !dull.some(l=>/last kick/i.test(l)));
ok('the player name is filled in', late.some(l=>l.includes('Okafor')));
ok('no placeholder leaks through', !late.join(' ').includes('{player}'));

console.log('\nEVERY PLAYER HAS THEIR OWN CHANT');
const J='1@s.whatsapp.net';
const p1=buildPlayer(J,'Legendary'), p2=buildPlayer(J,'Common');
const c1=chants.chantFor(p1), c2=chants.chantFor(p2);
ok('a chant is produced', !!c1, c1);
ok('it contains the player name', c1.includes(p1.nickname||p1.name), c1);
ok('different players get different chants', c1!==c2 || p1.name===p2.name);
ok('the same player always gets the same chant', chants.chantFor(p1)===c1);
ok('no placeholder leaks through', !c1.includes('{n}'));
ok('a missing player is handled', chants.chantFor(null)===null);

console.log('\nCHANTS ARE RESERVED FOR REAL MOMENTS');
const m=(o)=>chants.momentFor(o);
ok('a hat-trick sings', m({playerGoals:3,minute:40,scorerTeam:3,otherTeam:0})==='hattrick');
ok('a 90th-minute winner sings', m({playerGoals:1,minute:90,scorerTeam:2,otherTeam:1})==='winner');
ok('a late equaliser sings', m({playerGoals:1,minute:85,scorerTeam:1,otherTeam:1})==='equaliser');
ok('a comeback to level sings', m({playerGoals:1,minute:50,scorerTeam:2,otherTeam:2})==='comeback');
ok('an Elite brace sings', m({playerGoals:2,minute:30,scorerTeam:2,otherTeam:0,rarity:'Elite'})==='brace');
ok('a Common brace does NOT', m({playerGoals:2,minute:30,scorerTeam:2,otherTeam:0,rarity:'Common'})===null);
ok('a routine goal does NOT', m({playerGoals:1,minute:20,scorerTeam:1,otherTeam:0})===null);
ok('a consolation in a rout does NOT', m({playerGoals:1,minute:70,scorerTeam:1,otherTeam:5})===null);

console.log('\nHOW OFTEN DOES A CHANT ACTUALLY FIRE?');
let fired=0, goals=0;
for(let match=0;match<400;match++){
  let a=0,b=0;
  for(let g=0;g<6;g++){
    const minute=Math.floor(Math.random()*90)+1;
    if(Math.random()<0.55) a++; else b++;
    goals++;
    if(chants.momentFor({minute,scorerTeam:a,otherTeam:b,playerGoals:1,rarity:'Rare'})) fired++;
  }
}
const rate=fired/goals*100;
console.log(`      ${fired} chants across ${goals} goals (${rate.toFixed(1)}%)`);
ok('chants are not constant', rate<45, `${rate.toFixed(1)}%`);
ok('chants are not vanishingly rare', rate>3, `${rate.toFixed(1)}%`);

console.log('\nCHANT BLOCK RENDERS');
const block=chants.chantOnGoal(p1,{minute:90,scorerTeam:2,otherTeam:1,playerGoals:1});
ok('a special goal produces a block', !!block && block.includes('🎵'), (block||'').slice(0,60));
ok('a routine goal produces nothing',
   chants.chantOnGoal(p1,{minute:20,scorerTeam:1,otherTeam:0,playerGoals:1})==='');

console.log('\n'+'='.repeat(50));
console.log(`COMMENTARY TESTS: ${pass} passed, ${fail} failed`);
console.log('='.repeat(50)+'\n');
process.exit(fail?1:0);
})();
