const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('src/stoika.html','utf8');
const ctx=vm.createContext({console,Date,JSON,setTimeout,clearTimeout});
vm.runInContext(`let orderQ={},orderM={},orderVer=0,lastOrderAt='',writes=[],pending=[],errors=[],stored;
let staffReady=true;const byId={b:{id:'b'}},flag=()=>false;
const db={doc:()=>({set:p=>{writes.push(p);return new Promise((resolve,reject)=>pending.push({resolve:()=>{stored=p;resolve()},reject}))}})};
const status={textContent:''},$=()=>status;
const setStatus=m=>{status.textContent=m;errors.push(m)};
const render=()=>{};
${source.slice(source.indexOf('let oTimer=null'),source.indexOf('function addAllStop()'))}
${source.slice(source.indexOf('async function aiCommitProposal('),source.indexOf('function aiSnapshot()'))}
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
  assert.equal(run('Boolean(oDirty||oSaving)'),false);
  run('receive({docs:[]})');
  assert.equal(run('orderQ.a'),undefined);
  run('receive({docs:[{id:"current",data:()=>({q:{a:99},at:"2020-01-01T00:00:00Z"})}]})');
  assert.equal(run('orderQ.a'),undefined,'stale snapshot must not resurrect deletion');
  run('orderQ.a=3;saveOrder();clearTimeout(oTimer);oTimer=null;flushOrder();pending.shift().reject(Error("offline"))');await tick();
  assert.equal(run('oDirty'),true,'failed write must protect local intent');
  assert.equal(run('orderQ.a'),3);
  assert.equal(run('errors.length'),1);

  // Leave an older manual request in flight when the user confirms the proposal.
  run('orderQ.a=1;saveOrder();clearTimeout(oTimer);oTimer=null;flushOrder()');
  const first=run('writes.length');
  let confirmed=false;
  const confirmation=run("aiCommitProposal([{t:'order',id:'b',qty:2}])").then(()=>{confirmed=true});
  await tick();
  assert.equal(run('writes.length'),first,'AI must not dispatch while the manual request can overwrite it');
  assert.equal(confirmed,false);
  run('pending.shift().resolve()');await tick();
  assert.equal(run('writes.length'),first+1);
  assert.equal(run('writes.at(-1).q.b'),2);
  assert.equal(confirmed,false,'confirmation must wait for its own server acknowledgement');
  run('receive({docs:[{id:"current",data:()=>stored}]})');
  assert.equal(run('orderQ.b'),2);

  // A newer manual edit during the AI write must survive the AI response.
  run("orderQ.a=4;orderM.m={q:1};saveOrder();clearTimeout(oTimer);oTimer=null;flushOrder()");
  run('pending.shift().resolve()');await confirmation;
  await tick();
  assert.equal(run('writes.at(-1).q.a'),4);
  assert.equal(run('writes.at(-1).m.m.q'),1);
  run('pending.shift().resolve()');await tick();
  run('receive({docs:[{id:"current",data:()=>writes.at(-2)}]})');
  assert.equal(run('orderQ.a'),4,'delayed snapshot must not overwrite newer acknowledged state');
  assert.equal(run('JSON.stringify(orderQ)'),run('JSON.stringify(stored.q)'));
  assert.equal(run('JSON.stringify(orderM)'),run('JSON.stringify(stored.m)'));

  run('orderQ.a=5;saveOrder();clearTimeout(oTimer);oTimer=null;flushOrder()');
  const superseded=assert.rejects(run("aiCommitProposal([{t:'order',id:'b',qty:7}])"),/заменено/);
  run('orderQ.b=2;saveOrder();clearTimeout(oTimer);oTimer=null;flushOrder()');
  run('pending.shift().resolve()');await tick();
  run('pending.shift().resolve()');await superseded;
  assert.equal(run('stored.q.b'),2);

  run('orderQ.a=6;saveOrder();clearTimeout(oTimer);oTimer=null;flushOrder()');
  const afterOlderFailure=run("aiCommitProposal([{t:'order',id:'b',qty:2}])");
  run('pending.shift().reject(Error("older request failed"))');await tick();
  assert.equal(run('pending.length'),1,'the older failure must not decide confirmation of the queued snapshot');
  run('pending.shift().resolve()');await afterOlderFailure;
  assert.equal(run('stored.q.a'),6);
  assert.equal(run('status.textContent'),'Заказ сохранён');

  const offline=run("aiCommitProposal([{t:'order',id:'b',qty:3}])");
  const failed=assert.rejects(offline,/offline/);
  run('pending.shift().reject(Error("offline"))');await failed;
  assert.equal(run('oDirty'),true);
  assert.equal(run('stored.q.b'),2);
  const retry=run("aiCommitProposal([{t:'order',id:'b',qty:3}])");
  run('pending.shift().resolve()');await retry;
  assert.equal(run('stored.q.b'),3);
  assert.equal(run('Object.keys(stored.q).filter(id=>id==="b").length'),1);
  // New page state populated only by the server subscription.
  run('orderQ={};orderM={};lastOrderAt="";receive({docs:[{id:"current",data:()=>stored}]})');
  assert.equal(run('JSON.stringify(orderQ)'),run('JSON.stringify(stored.q)'));
  assert.equal(run('JSON.stringify(orderM)'),run('JSON.stringify(stored.m)'));
  const send=ctx.api.sendLink;
  for(const contact of ['@supplier','https://t.me/supplier','t.me/supplier/','https://telegram.me/supplier'])
    assert.equal(send({contact},'Заказ + 2'),'https://t.me/supplier?text='+encodeURIComponent('Заказ + 2'));
  assert.match(send({contact:'sales@supplier.ru'},'test'),/^mailto:sales@supplier.ru\?/);
  assert.match(send({contact:'https://wa.me/79991234567'},'test'),/^https:\/\/wa.me\/79991234567\?/);
  assert.equal(send({contact:''},'test'),'');
  console.log('PASS order serialization, AI confirmation, delayed snapshots, offline retry, reload, and supplier contacts');
})().catch(e=>{console.error(e);process.exitCode=1});
