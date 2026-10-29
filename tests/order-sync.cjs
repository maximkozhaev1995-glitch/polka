const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('src/stoika.html','utf8');
const ctx=vm.createContext({console,Date,JSON,setTimeout,clearTimeout});
vm.runInContext(`let orderQ={},orderM={},orderVer=0,lastOrderAt='',writes=[],pending=[],errors=[];
const db={doc:()=>({set:p=>{writes.push(p);return new Promise((resolve,reject)=>pending.push({resolve,reject}))}})};
const setStatus=m=>errors.push(m);
const render=()=>{};
${source.slice(source.indexOf('let oTimer=null'),source.indexOf('function addAllStop()'))}
${source.slice(source.indexOf('function sendLink('),source.indexOf('let XL=null'))}
globalThis.api={saveOrder,flushOrder,sendLink};`,ctx);
const subscription=source.split('\n').find(l=>l.includes('db.collection("order").onSnapshot'));
vm.runInContext('let receive;db.collection=()=>({onSnapshot:f=>receive=f});'+subscription,ctx);
const run=s=>vm.runInContext(s,ctx);
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
  run('orderQ.a=1;saveOrder();clearTimeout(oTimer);oTimer=null;flushOrder()');
  assert.equal(run('writes.length'),1);
  run('orderQ.a=2;saveOrder();clearTimeout(oTimer);oTimer=null;flushOrder()');
  assert.equal(run('writes.length'),1,'writes must be serialized');
  assert.equal(run('writes[0].q.a'),1,'in-flight payload must be immutable');
  run('receive({docs:[{id:"current",data:()=>({q:{a:1},at:lastOrderAt})}]})');
  assert.equal(run('orderQ.a'),2,'background snapshot must not undo pending edits');
  run('pending.shift().resolve()');await tick();
  assert.equal(run('writes[1].q.a'),2);
  run('delete orderQ.a;saveOrder();clearTimeout(oTimer);oTimer=null;pending.shift().resolve()');await tick();
  assert.equal(run('writes[2].q.a'),undefined,'latest deletion must persist');
  run('pending.shift().resolve()');await tick();
  assert.equal(run('oDirty||oSaving'),false);
  run('receive({docs:[]})');
  assert.equal(run('orderQ.a'),undefined);
  run('receive({docs:[{id:"current",data:()=>({q:{a:99},at:"2020-01-01T00:00:00Z"})}]})');
  assert.equal(run('orderQ.a'),undefined,'stale snapshot must not resurrect deletion');
  run('orderQ.a=3;saveOrder();clearTimeout(oTimer);oTimer=null;flushOrder();pending.shift().reject(Error("offline"))');await tick();
  assert.equal(run('oDirty'),true,'failed write must protect local intent');
  assert.equal(run('orderQ.a'),3);
  assert.equal(run('errors.length'),1);
  const send=ctx.api.sendLink;
  for(const contact of ['@supplier','https://t.me/supplier','t.me/supplier/','https://telegram.me/supplier'])
    assert.equal(send({contact},'Заказ + 2'),'https://t.me/supplier?text='+encodeURIComponent('Заказ + 2'));
  assert.match(send({contact:'sales@supplier.ru'},'test'),/^mailto:sales@supplier.ru\?/);
  assert.match(send({contact:'https://wa.me/79991234567'},'test'),/^https:\/\/wa.me\/79991234567\?/);
  assert.equal(send({contact:''},'test'),'');
  console.log('Order serialization, rapid changes, deletion, failure and supplier contacts passed');
})().catch(e=>{console.error(e);process.exitCode=1});
