'use strict';
// test_help.js — help must stay honest as commands change.
const fs=require('fs');
const { COMMANDS, CATEGORIES, resolve, byCategory } = require('./config/commandIndex');
let pass=0,fail=0;
const ok=(l,c,d)=>{c?(console.log('  ✓ '+l),pass++):(console.log('  ✗ '+l+(d?' — '+d:'')),fail++)};

// Every command name the router can dispatch.
const src=fs.readFileSync('commands/router.js','utf8');
const routed=[...src.matchAll(/^\s{2}([a-z0-9_]+):\s*\(\)\s*=>\s*require\('\.\/[a-z0-9_-]+'\)/gm)].map(m=>m[1]);
const { ALIASES } = require('./config/commandIndex');

console.log('\nTHE INDEX MATCHES REALITY');
const undocumented = routed.filter(c => !COMMANDS[c] && !ALIASES[c]);
ok('every routed command is documented or aliased', undocumented.length===0,
   undocumented.length ? undocumented.join(', ') : '');
const phantom = Object.keys(COMMANDS).filter(c => !routed.includes(c) && c!=='skiptour');
ok('help documents nothing that does not exist', phantom.length===0,
   phantom.length ? phantom.join(', ') : '');

console.log('\nSTALE ENTRIES ARE GONE');
const help=require('./commands/help');
const menu=help.topLevel('owner');
for (const dead of ['maccept','mreject','mpay']) {
  ok(`no longer advertises !loan ${dead}`, !menu.includes(dead));
}

console.log('\nNEW COMMANDS ARE PRESENT');
for (const c of ['agent','derby','borrow','lend','diag']) {
  ok(`${c} is documented`, !!COMMANDS[c]);
}

console.log('\nACCESS IS RESPECTED');
const plain=help.topLevel('all');
ok('a normal player is not shown owner tools', !plain.includes('OWNER'));
ok('the owner is', help.topLevel('owner').includes('OWNER'));
ok('staff see staff tools', help.topLevel('staff').includes('STAFF'));
ok('a normal player does not', !plain.includes('STAFF'));

console.log('\nDRILL-DOWN WORKS');
ok('a category renders', (help.category('squad','all')||'').includes('!squad'));
ok('an unknown category returns nothing', help.category('nonsense','all')===null);
ok('a single command renders', (help.single('borrow')||'').includes('How to use it'));
ok('an alias resolves to its command', resolve('flip')==='coinflip');
ok('a bare ! prefix is tolerated', resolve('!squad')==='squad');
ok('an unknown command resolves to null', resolve('zzz')===null);

console.log('\nQUALITY OF THE ENTRIES');
const noDesc=Object.entries(COMMANDS).filter(([,c])=>!c.s||c.s.length<12);
ok('every command has a real description', noDesc.length===0, noDesc.map(x=>x[0]).join(', '));
const badCat=Object.entries(COMMANDS).filter(([,c])=>!CATEGORIES[c.cat]);
ok('every command sits in a real category', badCat.length===0, badCat.map(x=>x[0]).join(', '));
const shouty=Object.entries(COMMANDS).filter(([,c])=>c.s===c.s.toUpperCase()&&/[A-Z]{4}/.test(c.s));
ok('no descriptions are shouting', shouty.length===0);

console.log('\nTHE FULL MENU IS BACK');
const old=fs.existsSync('commands/help.legacy.js.bak')?fs.readFileSync('commands/help.legacy.js.bak','utf8'):'';
const oldMenu=(old.match(/const MENU = `([\s\S]*?)`;/)||[])[1]||'';
const ownerCmds=Object.keys(COMMANDS).filter(c=>!COMMANDS[c].hidden);
const missing=ownerCmds.filter(c=>!menu.includes('!'+c));
ok('top-level menu lists every owner-visible command', missing.length===0, missing.join(', '));
const quick=['start','squad','play','daily','league'];
ok('the quick-start line only names real commands', quick.every(c=>COMMANDS[c]), '');
if (oldMenu) {
  const oldCmdSet=new Set((oldMenu.match(/!\w+/g)||[]).map(s=>s.slice(1)));
  const newSet=new Set(newCmdSet);
  const gone=[...oldCmdSet].filter(c=>COMMANDS[c]&&!newSet.has(c));
  ok('the menu is as complete as the old wall — nothing lost', gone.length===0, gone.join(', '));
}

console.log('\n'+'='.repeat(48));
console.log(`HELP TESTS: ${pass} passed, ${fail} failed`);
console.log('='.repeat(48)+'\n');
process.exit(fail?1:0);
