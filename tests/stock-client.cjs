const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const shim=fs.readFileSync('app/shim.js','utf8'),source=fs.readFileSync('src/stoika.html','utf8');
const storage=new Map(),requests=[],ledger=new Map();let loseReply=false,fail=false;
const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
const context=vm.createContext({localStorage,crypto:require('node:crypto').webcrypto,
  session:{user:{tg_id:1}},V:()=> 'venue',bump:()=>{},
  rest:async(path,opt)=>{assert.equal(path,'rpc/apply_stock');const body=JSON.parse(opt.body);requests.push(body);
    if(fail)throw Error('stock_stale_revision');
    let rows=ledger.get(body.p_request_id);if(!rows){rows=body.p_items.map(e=>({id:e.id,doc:{...e.doc,revision:e.revision+1}}));ledger.set(body.p_request_id,rows)}
    if(loseReply){loseReply=false;throw Error('network disconnected after commit')}return rows}});
const dbSource=shim.slice(shim.indexOf('  const db={'),shim.indexOf('    bulk:'))+'};globalThis.db=db;';
vm.runInContext(dbSource,context);
const db=context.db,items=[{id:'a',revision:0,doc:{wh:2},kind:'in'}];
let count=0;const test=async(n,f)=>{await f();console.log('PASS',n);count++};
(async()=>{
await test('unknown outcome retains durable idempotency key',async()=>{loseReply=true;await assert.rejects(db.applyStock(items),/network/);assert(db.hasPendingStock());assert.equal(ledger.size,1)});
await test('retry after reload sends the exact persisted body',async()=>{vm.runInContext(dbSource.replace('const db=','globalThis.db=').replace(';globalThis.db=db;',';'),context);await context.db.applyStock(items);assert.deepEqual(requests[0],requests[1]);assert.equal(ledger.size,1);assert(!db.hasPendingStock())});
await test('different intent cannot replace unresolved operation',async()=>{loseReply=true;await assert.rejects(db.applyStock(items));const n=requests.length;await assert.rejects(db.applyStock([{...items[0],doc:{wh:8}}]),/неподтверждённый/);assert.equal(requests.length,n)});
await test('explicit recovery replays original and returns items for reconciliation',async()=>{const r=await db.recoverStock();assert.deepEqual(JSON.parse(JSON.stringify(r.items)),items);assert(!db.hasPendingStock());assert.equal(ledger.size,2)});
await test('definite SQL rejection releases pending identity',async()=>{fail=true;await assert.rejects(db.applyStock(items),/stock_stale/);assert(!db.hasPendingStock());fail=false});
await test('storage failure prevents a request from being sent',async()=>{const old=localStorage.setItem;localStorage.setItem=()=>{throw Error('storage full')};const n=requests.length;await assert.rejects(db.applyStock(items),/storage full/);assert.equal(requests.length,n);localStorage.setItem=old});
// Execute the real review handler with a transactional API stub.
const ui=vm.createContext({localStorage,window:{},console});
vm.runInContext(`let stock={a:{wh:3,revision:4},b:{wh:2,revision:1}},draft={a:{d:-1},b:{d:1}},busy=false,fail=false,writes=0,closed=false;
let nodes={'#dlg-ok':{disabled:false},'#stock-recover':{}},cmdDraftIds=new Set(),byId={a:{id:'a'},b:{id:'b'}};
const $=s=>nodes[s],wh=x=>stock[x.id].wh,saveDraft=()=>{},closeDlg=()=>closed=true,setStatus=()=>{},render=()=>{};
const db={stockScope:()=> 'venue:1',hasPendingStock:()=>false,applyStock:async entries=>{writes++;if(fail)throw Error('stock_stale_revision');return entries.map(e=>({id:e.id,doc:{...e.doc,revision:e.revision+1}}))}};
`+source.slice(source.indexOf('function stockEntry('),source.indexOf('async function toBar('))+
source.slice(source.indexOf('async function commit(){'),source.indexOf('function askUndo(')),ui);
await test('review uses one batch and double click persists once',async()=>{await Promise.all([vm.runInContext('commit()',ui),vm.runInContext('commit()',ui)]);assert.equal(vm.runInContext('writes',ui),1);assert.equal(vm.runInContext('Object.keys(draft).length',ui),0);assert.equal(vm.runInContext('stock.a.wh',ui),2)});
await test('failed batch keeps every reviewed draft item',async()=>{vm.runInContext('draft={a:{d:-1},b:{d:1}};fail=true',ui);await vm.runInContext('commit()',ui);assert.equal(vm.runInContext('Object.keys(draft).length',ui),2);assert.equal(vm.runInContext('busy',ui),false)});
await test('post-commit order error cannot leave a replayable draft',async()=>{vm.runInContext('draft={a:{d:-2}};fail=false',ui);await vm.runInContext('commit()',ui);assert.equal(vm.runInContext('Object.keys(draft).length',ui),0);assert.equal(vm.runInContext('stock.a.wh',ui),0)});
await test('legacy direct stock/journal writes absent from app source',async()=>{assert(!/db\.doc\("(?:stock|moves)\//.test(source));assert(!/db\.collection\("moves"\)\.add/.test(source));assert(!/setStockBatch/.test(source));assert.match(shim,/if\(c==="stock"\|\|c==="moves"\)throw/)});
await test('reviewed transfer preserves automatic stop and slow flag',async()=>{
 vm.runInContext('stock.a={wh:3,revision:4,bar:false,stop:true,stopAuto:true,slow:true};draft={a:{d:-1,bar:true}};fail=false',ui);
 await vm.runInContext('commit()',ui);
 assert.equal(vm.runInContext('stock.a.stop',ui),true);assert.equal(vm.runInContext('stock.a.stopAuto',ui),true);
 assert.equal(vm.runInContext('stock.a.slow',ui),true);assert.equal(vm.runInContext('stock.a.bar',ui),true);
});
await test('quick transfer preserves both manual and automatic stop',async()=>{
 const quick=vm.createContext({console});
 vm.runInContext(`let db={},busy=false,stock={},sent;const wh=()=>3,stockOne=async(id,doc)=>{sent=doc},autoOrder=()=>0,toast=()=>{},render=()=>{},setStatus=()=>{},nm=()=>'',esc=x=>x;`+source.slice(source.indexOf('async function toBar('),source.indexOf('const IGROUPS=')),quick);
 for(const auto of [false,true]){vm.runInContext('stock={a:{wh:3,revision:0,bar:false,stop:true,stopAuto:'+auto+',slow:true}}',quick);await vm.runInContext('toBar({id:"a"},1)',quick);
  assert.equal(vm.runInContext('sent.stop',quick),true);assert.equal(vm.runInContext('sent.stopAuto',quick),auto);assert.equal(vm.runInContext('sent.slow',quick),true);
 }
});
console.log(`${count} stock client tests passed`);
})().catch(e=>{console.error(e);process.exitCode=1});
