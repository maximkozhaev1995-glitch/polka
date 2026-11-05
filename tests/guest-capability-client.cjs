const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('karta/template.html','utf8');
function fixture({storageFails=false,ackFails=false}={}){
 const store=new Map([['karta-gid','glegacy']]),calls=[];
 const ctx=vm.createContext({crypto:require('node:crypto').webcrypto,Uint8Array,console,
 localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>{if(storageFails&&k==='karta-mixes')throw Error('quota');store.set(k,v)}},
 window:{POLKA_CONFIG:{url:'https://fixture.invalid',anon:'synthetic'}},mine:[],st:{},toast2(){},$:()=>null,render(){},
 fetch:async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});if(url.endsWith('/list_guest_mixes'))return {ok:true,json:async()=>[{id:'synthetic-id',name:'test'}]};if(ackFails)throw Error('lost response');return {ok:true,json:async()=>true};}});
 vm.runInContext('const saveMine=()=>{try{localStorage.setItem("karta-mixes",JSON.stringify(mine));return true}catch{return false}};'+source.slice(source.indexOf('let gid=""'),source.indexOf('let QRL='))+source.slice(source.indexOf('let gmTimer='),source.indexOf('\npollGuestMix();')),ctx);
 return {ctx,store,calls,poll:()=>vm.runInContext('pollGuestMix()',ctx)};
}
test('rotates weak code with cryptographic capability preserving legacy recovery reference',()=>{
 const f=fixture();assert.match(f.store.get('karta-gid'),/^g[0-9a-f]{32}$/);assert.equal(f.store.get('karta-gid-legacy'),'glegacy');
});
test('failed durable save never acknowledges and does not retain unsaved row',async()=>{
 const f=fixture({storageFails:true});await f.poll();assert.equal(f.calls.filter(c=>c.url.endsWith('/list_guest_mixes')).length,1);assert.equal(f.calls.filter(c=>c.url.endsWith('/claim_guest_mix')).length,0);assert.equal(f.ctx.mine.length,0);
});
test('lost acknowledgment retry does not duplicate saved mix and carries capability',async()=>{
 const f=fixture({ackFails:true});await f.poll();await f.poll();assert.equal(f.ctx.mine.length,1);
 assert.equal(JSON.parse(f.store.get('karta-mixes')).length,1);
 const acks=f.calls.filter(c=>c.url.endsWith('/claim_guest_mix'));assert.equal(acks.length,2);
 assert.equal(acks[0].body.p_gid,f.store.get('karta-gid'));assert.equal(acks[0].body.p_id,'synthetic-id');
 // Recreate in-memory state from the durable document, as after reload.
 f.ctx.mine=JSON.parse(f.store.get('karta-mixes'));await f.poll();assert.equal(f.ctx.mine.length,1);
});
test('staff scanner accepts full secure QR and rejects weak/truncated codes',()=>{
 const staff=fs.readFileSync('src/stoika.html','utf8');const ctx=vm.createContext({});
 vm.runInContext(staff.slice(staff.indexOf('function parseGuestCode('),staff.indexOf('function scanGuestMix(')),ctx);
 const code='g'+'a'.repeat(32);assert.equal(ctx.parseGuestCode('https://t.me/test?startapp=guest_'+code),code);
 assert.equal(ctx.parseGuestCode('gshort'),'');assert.equal(ctx.parseGuestCode(code+'extra'),'');
});

