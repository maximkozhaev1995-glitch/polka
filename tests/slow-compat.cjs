const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const source=fs.readFileSync('src/stoika.html','utf8');
// Immutable pre-audit PR #77 baseline. Only the auth-state identifier may differ.
const before=JSON.parse(fs.readFileSync('tests/fixtures/slow-contract.json','utf8'));
for(const name of ['idleDays','journalDays','idleText','slowCand','gone']){
 const line=s=>s.split('\n').find(l=>l.startsWith('const '+name+'='));
 assert.equal(line(source),before.definitions[name],name+' algorithm changed');
}
const block=s=>s.slice(s.indexOf('if(st.tab==="slow"){take();'),s.indexOf('if(st.tab==="wh"){take();',s.indexOf('if(st.tab==="slow"){take();'))).replaceAll('staffReady','isMgr');
assert.equal(block(source),before.actions,'slow actions changed');
const ctx=vm.createContext({Date,DATA:[{id:'old'},{id:'new'},{id:'marked'},{id:'empty'}],moves:[{item:'new',qty:-1,at:new Date().toISOString()},{item:'old',qty:-1,at:new Date(Date.now()-40*864e5).toISOString()}],flag:(x,k)=>k==='slow'&&x.id==='marked',wh:x=>x.id==='empty'?0:2,onBar:()=>false});
for(const name of ['idleDays','journalDays','idleText','slowCand'])vm.runInContext(source.split('\n').find(l=>l.startsWith('const '+name+'=')),ctx);
assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('slowCand().map(x=>x.id)',ctx))),['old']);
assert.ok(source.includes('id="t-slow"'));assert.ok(source.includes('data-v="retire"'));
console.log('PASS slow section: 5 unchanged algorithms, unchanged actions, 30-day selection and retained navigation');
