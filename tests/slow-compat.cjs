const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const source=fs.readFileSync('src/stoika.html','utf8');
// Immutable pre-audit PR #77 baseline. Only the auth-state identifier may differ.
const before=JSON.parse(fs.readFileSync('tests/fixtures/slow-contract.json','utf8'));
for(const name of ['idleDays','journalDays','idleText','slowCand']){
 const line=s=>s.split('\n').find(l=>l.startsWith('const '+name+'='));
 assert.equal(line(source),before.definitions[name],name+' algorithm changed');
}
const ctx=vm.createContext({Date,DATA:[{id:'old'},{id:'new'},{id:'marked'},{id:'empty'}],moves:[{item:'new',qty:-1,at:new Date().toISOString()},{item:'old',qty:-1,at:new Date(Date.now()-40*864e5).toISOString()}],flag:(x,k)=>k==='slow'&&x.id==='marked',wh:x=>x.id==='empty'?0:2,onBar:()=>false});
for(const name of ['idleDays','journalDays','idleText','slowCand'])vm.runInContext(source.split('\n').find(l=>l.startsWith('const '+name+'=')),ctx);
assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('slowCand().map(x=>x.id)',ctx))),['old']);
assert.ok(source.includes('id="t-slow"'));assert.ok(source.includes('data-v="retire"'));
console.log('PASS slow section: 4 unchanged algorithms, updated archive action, 30-day selection and retained navigation');
// Archive eligibility and confirmation are intentional changes requested by the owner.
const archive=vm.createContext({stock:{a:{wh:0,slow:true,stop:true}},on:false,dialogs:0,writes:[],buttons:{},
 flag:(x,k)=>!!archive.stock[x.id]?.[k],wh:x=>archive.stock[x.id]?.wh||0,onBar:()=>archive.on,
 toast:()=>{},closeDlg:()=>{},nm:()=> 'Taste',esc:s=>s,
 showDlg:()=>{archive.dialogs++},$:s=>archive.buttons[s]||(archive.buttons[s]={}),
 putDoc:(x,d)=>{archive.writes.push(d);archive.stock[x.id]=d}});
for(const prefix of ['const dcopy=','const gone=','function retire(','function unretire(','function askRetire('])vm.runInContext(source.split('\n').find(l=>l.startsWith(prefix)),archive);
const ar=s=>vm.runInContext(s,archive);
assert.equal(ar('gone({id:"a"})'),true);
ar('askRetire({id:"a"})');assert.equal(archive.writes.length,0);assert.equal(archive.dialogs,1);
archive.buttons['#dlg-back'].onclick();assert.equal(archive.writes.length,0);
archive.on=true;ar('retire({id:"a"})');assert.equal(archive.writes.length,0);
archive.on=false;archive.stock.a.wh=1;ar('retire({id:"a"})');assert.equal(archive.writes.length,0);
archive.stock.a.wh=0;delete archive.stock.a.stop;assert.equal(ar('gone({id:"a"})'),false);
archive.stock.a.stop=true;ar('askRetire({id:"a"})');archive.buttons['#rt-ok'].onclick();assert.equal(archive.writes.length,1);assert.equal(archive.stock.a.retired,true);assert.equal(archive.stock.a.wh,0);
ar('unretire({id:"a"})');assert.equal(archive.stock.a.retired,undefined);
assert.ok(source.includes('["slow","Неликвид"],["log","Журнал"]'));
assert.ok(!source.includes('html+=takenHtml()'));
assert.ok(!source.includes('))navAnim()'));
assert.ok(source.includes('else if(k==="retire")askRetire(x)'));
console.log('PASS archive: both flags, empty warehouse and counter, cancel without write, confirmation, restore; quick navigation and no list entrance restart');
