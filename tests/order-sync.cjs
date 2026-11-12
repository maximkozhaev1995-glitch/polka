const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const source = fs.readFileSync('src/stoika.html', 'utf8');
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}

const ctx = vm.createContext({ console, crypto: { randomUUID } });
const run = code => vm.runInContext(code, ctx);
run(`
  let orderQ = {}, orderM = {}, orderVer = 0;
  const writes = [], pending = [], errors = [], storage = new Map(), timers = new Map();
  let timerId = 0;
  const setTimeout = callback => { timers.set(++timerId, callback); return timerId };
  const clearTimeout = id => timers.delete(id);
  function fireAutosave() {
    if (!timers.has(oTimer)) throw Error('Manual edit did not schedule an autosave');
    const callback = timers.get(oTimer);
    timers.delete(oTimer);
    callback();
  }
  const sessionStorage = {
    getItem: k => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: k => storage.delete(k),
  };
  const db = {
    orderScope: () => ({ venue: 'venue', actor: 1 }),
    applyOrder: (id, changes, scope) => {
      writes.push({ id, changes: JSON.parse(JSON.stringify(changes)), scope });
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
  };
  const $ = () => null, setStatus = message => errors.push(message), render = () => {};
  ${section('let oTimer=null', 'function addAllStop()')}
  ${section('function sendLink(', 'let XL=null')}
  restoreOrderDraft();
  globalThis.api = {sendLink};
`);
const tick = () => new Promise(resolve => setImmediate(resolve));
const changes = index => JSON.parse(run('JSON.stringify(writes[' + index + '].changes)'));
function ack(revision, q, m = {}) {
  run('pending.shift().resolve(' + JSON.stringify({ status: 'applied', order: { revision, q, m } }) + ')');
  return tick();
}

(async () => {
  run('receiveOrder({ revision:1, q:{existing:4}, m:{note:{b:"Other",n:"Manual",q:2}} })');
  run('orderQ.a=1;saveOrder();fireAutosave()');
  assert.deepEqual(changes(0), [{ map: 'q', id: 'a', before: null, after: 1 }]);
  run('orderQ.a=2;saveOrder();fireAutosave()');
  assert.equal(run('writes.length'), 1, 'rapid manual edits serialize');
  run('receiveOrder({revision:2,q:{existing:4,remote:5},m:{note:{b:"Other",n:"Manual",q:2}}})');
  assert.equal(run('orderQ.a'), 2, 'a poll cannot override the in-flight edit');
  const manual = { note: { b: 'Other', n: 'Manual', q: 2 } };
  await ack(3, { a: 1, existing: 4, remote: 5 }, manual);
  assert.deepEqual(changes(1), [{ map: 'q', id: 'a', before: 1, after: 2 }]);
  assert.equal(run('orderQ.remote'), 5);
  assert.equal(run('orderM.note.q'), 2);
  run('delete orderQ.a;saveOrder();fireAutosave()');
  await ack(4, { a: 2, existing: 4, remote: 5 }, manual);
  assert.deepEqual(changes(2), [{ map: 'q', id: 'a', before: 2, after: null }]);
  await ack(5, { existing: 4, remote: 5 }, manual);
  assert.equal(run('!!(oDirty||oSaving)'), false);
  run('receiveOrder({revision:3,q:{a:99},m:{}})');
  assert.equal(run('orderQ.a'), undefined, 'an old revision cannot resurrect a deletion');

  run('orderQ.a=3;saveOrder();fireAutosave();pending.shift().reject(Error("offline"))');
  await tick();
  assert.equal(run('oDirty'), true);
  assert.equal(run('orderQ.a'), 3);
  assert.equal(run('errors.length'), 1);
  assert.equal(run('JSON.parse(storage.get(orderDraftKey)).request.id'), run('writes[3].id'));
  run('restoreOrderDraft();flushOrder()');
  assert.equal(run('writes[4].id'), run('writes[3].id'), 'retry uses the original request ID');
  assert.deepEqual(changes(4), changes(3));
  await ack(6, { a: 3, existing: 4, remote: 5 }, manual);
  assert.equal(run('storage.has(orderDraftKey)'), false);
  assert.equal(run('orderQ.existing'), 4);
  const send=ctx.api.sendLink;
  for(const contact of ['@supplier','https://t.me/supplier','t.me/supplier/','https://telegram.me/supplier'])
    assert.equal(send({contact},'Заказ + 2'),'https://t.me/supplier?text='+encodeURIComponent('Заказ + 2'));
  assert.match(send({contact:'sales@supplier.ru'},'test'),/^mailto:sales@supplier.ru\?/);
  assert.match(send({contact:'https://wa.me/79991234567'},'test'),/^https:\/\/wa.me\/79991234567\?/);
  assert.equal(send({contact:''},'test'),'');
  console.log('Order autosave, serialization, acknowledgement, conflict-safe deltas, retry and supplier contacts passed');
})().catch(error => { console.error(error); process.exitCode = 1 });
