'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const root=path.resolve(__dirname,'../../..');
function setup(file,opt={}){
 const src=fs.readFileSync(path.join(root,file),'utf8');
 let disk=JSON.stringify(opt.initial||[]),writes=0;
 const events=[],acks=[],messages=[];
 const ctx=vm.createContext({AbortController,setTimeout,clearTimeout,
  window:{POLKA_CONFIG:{url:'https://offline.invalid',anon:'mock-not-credential'}},
  gmBusy:false,gid:'A',mine:JSON.parse(disk),st:{tab:'other'},
  localStorage:{getItem:()=>disk,setItem:(k,v)=>{writes++;events.push('SAVE');if(opt.failWrite===writes)throw Error('storage unavailable');disk=v;}},
  fetch:async(u,o)=>{if(o.method==='POST'){const id=JSON.parse(o.body).p_id;acks.push(id);events.push('ACK:'+id);if(opt.ackHook)await opt.ackHook(ctx,id);return{ok:true};}
   events.push('READ');if(opt.readHook)await opt.readHook(ctx);return{ok:true,json:async()=>opt.rows||[]};},
  toast2:t=>messages.push(t),$:()=>null,render:()=>{}});
 vm.runInContext(src.match(/const saveMine=\(\)=>\{.*?\};/)[0],ctx);
 const start=src.indexOf('async function pollGuestMix()');
 vm.runInContext(src.slice(start,src.indexOf('\npollGuestMix();',start)),ctx);
 return{ctx,events,acks,messages,disk:()=>JSON.parse(disk),poll:()=>vm.runInContext('pollGuestMix()',ctx)};
}
for(const file of ['karta/template.html','karta/index.html']){
 test(file+': second save failure never acknowledges unsaved second delivery',async()=>{
  const h=setup(file,{rows:[{id:'one',name:'One'},{id:'two',name:'Two'}],failWrite:2});await h.poll();
  assert.deepEqual(h.acks,['one']);assert.deepEqual(h.disk().map(x=>x.delivery_id),['one']);
  assert.deepEqual(Array.from(h.ctx.mine,x=>x.delivery_id),['one']);assert.equal(h.ctx.gmBusy,false);
 });
 test(file+': failed save preserves preexisting favorite',async()=>{
  const h=setup(file,{initial:[{name:'Existing'}],rows:[{id:'one',name:'New'}],failWrite:1});await h.poll();
  assert.equal(h.acks.length,0);assert.deepEqual(h.disk(),[{name:'Existing'}]);
  assert.equal(h.ctx.mine.length,1);assert.equal(h.ctx.mine[0].name,'Existing');
 });
 test(file+': missing receipt identity never saves or acknowledges',async()=>{
  const h=setup(file,{rows:[{name:'No id'}]});await h.poll();
  assert.equal(h.acks.length,0);assert.deepEqual(h.disk(),[]);assert(!h.events.includes('SAVE'));
 });
 test(file+': session switch while reading does not misattribute old receipt',async()=>{
  const h=setup(file,{rows:[{id:'old',name:'Old'}],readHook:async ctx=>{ctx.gid='B';}});await h.poll();
  assert.equal(h.acks.length,0);assert.deepEqual(h.disk(),[]);assert.equal(h.ctx.gmBusy,false);
 });
 test(file+': session switch during first ACK does not process remaining old-session receipt',async()=>{
  const h=setup(file,{rows:[{id:'one',name:'One'},{id:'two',name:'Two'}],ackHook:async(ctx,id)=>{if(id==='one')ctx.gid='B';}});await h.poll();
  assert.deepEqual(h.acks,['one']);assert.equal(h.disk().length,1);assert.equal(h.disk()[0].delivery_gid,'A');
 });
 test(file+': failed GET makes no changes and releases busy guard',async()=>{
  const h=setup(file,{rows:[{id:'one'}],readHook:async()=>{throw Error('offline');}});await h.poll();
  assert.equal(h.acks.length,0);assert.deepEqual(h.disk(),[]);assert.equal(h.ctx.gmBusy,false);
 });
}
