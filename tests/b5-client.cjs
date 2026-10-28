const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),cp=require('node:child_process');
const source=fs.readFileSync('src/stoika.html','utf8'),shim=fs.readFileSync('app/shim.js','utf8');
const pendingHelpers=source.slice(source.indexOf('function stockPendingKey()'),source.indexOf('function openReview()'));
const commit=source.slice(source.indexOf('async function commit('),source.indexOf('function askUndo('));
function setup(){const ctx=vm.createContext({console});vm.runInContext(`
let busy=false,draft={a:{d:-1}},stock={a:3},byId={a:{id:'a'}},calls=[],status='',fail=null,after=null;
const memory=new Map(),localStorage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
const crypto={randomUUID:()=> '11111111-1111-4111-8111-111111111111'};
const button={disabled:false,textContent:''},dialog={open:false},$=s=>s==='#dlg'?dialog:button;
const wh=x=>stock[x.id],onBar=()=>false;let lockNames=[];const navigator={locks:{request:async(name,fn)=>{lockNames.push(name);return fn()}}};globalThis.navigator=navigator;
const saveDraft=()=>{},render=()=>{},openReview=()=>{},closeDlg=()=>{},setStatus=s=>status=s,toast=()=>{},esc=x=>x,autoOrder=()=>0,nm=x=>x.id,cmdDraftIds=new Set();
const db={stockScope:()=> 'venue:1',commitStockBatch:async(id,items)=>{calls.push({id,items});if(after)after();if(fail)throw fail;return {applied:true,rows:[{id:'a',delta:-1,left:2}]}}};
`+pendingHelpers+commit,ctx);return s=>vm.runInContext(s,ctx)}
(async()=>{
let run=setup();run(`fail={message:'Stock changed',code:'40001',status:409}`);await run('commit()');assert.equal(run('memory.size'),0);assert.equal(run('busy'),false);assert.equal(run('button.disabled'),false);run('fail=null;stock.a=2');await run('commit()');assert.equal(run('calls.length'),2);assert.equal(run('calls[1].items[0].expected_wh'),2);console.log('PASS #6 40001 clears pending and UI can retry with fresh stock');
run=setup();run(`fail={message:'timeout',status:504}`);await run('commit()');assert.equal(run('memory.size'),1);run('stock.a=2;fail=null');await run('commit(true)');assert.equal(run('calls[1].id===calls[0].id'),true);assert.equal(run('JSON.stringify(calls[1].items)===JSON.stringify(calls[0].items)'),true);assert.equal(run('Object.keys(draft).length'),0);console.log('PASS lost-response retry preserves UUID and original payload after snapshot update');
run=setup();run('after=()=>stock.a=2');await run('commit()');assert.equal(run('Object.keys(draft).length'),0);console.log('PASS live snapshot during response does not leave submitted draft');
run=setup();run('after=()=>draft.a.d=-2');await run('commit()');assert.equal(run('draft.a.d'),-2);console.log('PASS newer draft edit survives response');
for(const status of [408,429,502,503,504]){run=setup();run(`fail={message:'gateway',status:${status}}`);await run('commit()');assert.equal(run('memory.size'),1)}console.log('PASS uncertain HTTP failures preserve pending');
run=setup();run(`memory.set('mixora-stock-pending',JSON.stringify({id:'old',items:[]}))`);await run('commit()');assert.equal(run('calls.length'),0);assert.equal(run('memory.size'),1);console.log('PASS legacy pending blocks new writes without deleting evidence');
run=setup();run(`memory.set('mixora-stock-pending:venue:2','other');fail={code:'40001'}`);await run('commit()');assert.equal(run(`memory.get('mixora-stock-pending:venue:2')`),'other');assert.equal(run(`lockNames[0]`),'mixora-stock:venue:1');console.log('PASS actor/venue scope and lock name preserve other account pending');
run=setup();run(`memory.set(stockPendingKey(),JSON.stringify({version:2,scope:'venue:1',id:'newer',items:[{}],drafts:{}}));clearStockPending({id:'older'})`);assert.equal(run('memory.size'),1);console.log('PASS compare-and-delete preserves another operation UUID');
const adapter=vm.createContext({});vm.runInContext(`let writes=0;const rest=async()=>{writes++;return []},bump=()=>{},listen=()=>({}),MAP={},guardWrite=c=>{if(c==='stock'||c==='moves')throw Error('closed')};`+shim.slice(shim.indexOf('  const db={'),shim.indexOf('  const downloads='))+';globalThis.db=db;globalThis.count=()=>writes',adapter);
for(const c of ['stock','moves'])for(const action of [()=>adapter.db.doc(c+'/a').set({wh:9}),()=>adapter.db.doc(c+'/a').delete(),()=>adapter.db.collection(c).add({}),()=>adapter.db.bulk(c,['a'],{})])await assert.rejects(action());await assert.rejects(()=>adapter.db.setStockBatch({a:{wh:9}}));assert.equal(adapter.count(),0);console.log('PASS all 9 legacy adapter entry points reject before request');
const before=fs.readFileSync('index.html');cp.execFileSync('python3',['build_app.py']);assert.deepEqual(fs.readFileSync('index.html'),before);assert.ok(before.includes(Buffer.from('commitStockBatch')));console.log('PASS #7 build is reproducible and includes RPC');
let scripts=0;for(const path of ['src/stoika.html','index.html'])for(const m of fs.readFileSync(path,'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){if(!m[1].trim())continue;new vm.Script(m[1],{filename:path});scripts++}cp.execFileSync('node',['--check','app/shim.js']);console.log('PASS syntax: '+scripts+' inline script blocks and shim');
})().catch(e=>{console.error(e);process.exitCode=1});
