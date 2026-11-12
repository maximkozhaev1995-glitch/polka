const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');

const shim = fs.readFileSync('app/shim.js', 'utf8');
const section = (start, end) => shim.slice(shim.indexOf(start), shim.indexOf(end));

test('Telegram reload resumes the same proof only', async () => {
  const requests = [];
  const ctx = vm.createContext({
    CFG: {url: 'https://example.invalid', anon: 'public'}, URLSearchParams, session: null,
    tg: {initData: 'hash=proof1'},
    sessionStorage: {getItem: () => JSON.stringify({token: 'previous', proof: 'mini:proof1'})},
    fetch: async (_, options) => {
      requests.push(JSON.parse(options.body));
      return {ok: true, status: 200, json: async () => ({})};
    }
  });
  const call = vm.runInContext(section('  let widgetAuth=null;', '  // Токен живёт') + 'call;', ctx);
  await call('');
  assert.equal(requests[0].session_token, 'previous');
  ctx.tg.initData = 'hash=proof2';
  await call('');
  assert.equal(requests[1].session_token, undefined);
});

test('the order RPC checks the authenticated scope and preserves the operation identity', async () => {
  const requests = [];
  const result = {status: 'applied', order: {q: {a: 3}, m: {}, revision: 1}};
  const ctx = vm.createContext({
    session: {user: {venue_id: 'venue1', tg_id: 17}},
    V: () => 'venue1', bump: () => {},
    rest: async (path, options) => {
      requests.push({path, body: JSON.parse(options.body)});
      return result;
    }
  });
  const db = vm.runInContext(section('  function stockDocument(', '    bulk:') + '}; db;', ctx);
  assert.equal(typeof db.applyOrder, 'function');
  const changes = [{map: 'q', id: 'a', before: 1, after: 3}];
  assert.equal(await db.applyOrder('request', changes, db.orderScope()), result);
  assert.deepEqual(requests, [{path: 'rpc/apply_order', body: {
    p_venue_id: 'venue1', p_request_id: 'request', p_changes: changes
  }}]);
  await assert.rejects(db.applyOrder('request', changes, {venue: 'venue2', actor: 17}));
  await assert.rejects(db.applyOrder('request', changes, {venue: 'venue1', actor: 18}));
  assert.equal(requests.length, 1);
});

test('the home venue label only reads the current venue and drops stale replies', async () => {
  let venue='current', resolve;
  const paths=[];
  const ctx=vm.createContext({V:()=>venue,session:{user:{tg_id:17}},rest:path=>{
    paths.push(path);return new Promise(done=>{resolve=done});
  }});
  const db=vm.runInContext(section('  function stockDocument(','    bulk:')+'}; db;',ctx);
  assert.equal(typeof db.venueName,'function');
  const first=db.venueName();
  resolve([{name:'Бар'}]);
  assert.equal(await first,'Бар');
  const previous=db.venueName();
  venue='other';resolve([{name:'Бар'}]);
  assert.equal(await previous,'');
  assert.deepEqual(paths,Array(2).fill('venues?select=name&id=eq.current&limit=1'));
});

test('reference datasets require an active session and reject switched-session replies', async () => {
  const claims={sid:'s',membership_epoch:'e'};
  const session={user:{venue_id:'v',tg_id:1},token:'.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.test'};
  const req=[];
  let resolve;
  const ctx=vm.createContext({session,V:()=>session.user.venue_id,atob,rest:(path,options)=>{
    req.push({path,options});return new Promise(done=>{resolve=done});
  }});
  const db=vm.runInContext(section('  function stockDocument(','    bulk:')+'}; db;',ctx);
  assert.equal(typeof db.referenceChunks,'function');
  await assert.rejects(db.referenceChunks('stock'),/invalid/);
  const read=db.referenceChunks('official');
  assert.equal(req[0].path,'reference_catalog_chunks?select=dataset,part,total_parts,content,sha256&dataset=eq.official&order=part.asc&limit=512');
  assert.equal(req[0].options.method,'GET');
  assert.equal(req[0].options.cache,'no-store');
  session.user.tg_id=2;
  resolve([]);
  await assert.rejects(read,/scope_changed/);
  session.token=null;
  await assert.rejects(db.referenceChunks('flvr'),/session_required/);
  assert.equal(req.length,1);
});

test('an older move journal result cannot overwrite a newer one', async () => {
  const pending = [], seen = [], errors = [];
  const ctx = vm.createContext({
    subs: {moves: {hash: '', fns: [({docs}) => seen.push(docs[0].id)], errs: [e => errors.push(e)]}},
    snapDocs: () => new Promise((resolve, reject) => pending.push({resolve, reject}))
  });
  const refresh = vm.runInContext(section('  async function refresh(c)', '  setInterval(') + 'refresh;', ctx);
  const older = refresh('moves'), newer = refresh('moves');
  pending[1].resolve([{id: 'new', data: () => ({})}]); await newer;
  pending[0].resolve([{id: 'old', data: () => ({})}]); await older;
  assert.deepEqual(seen, ['new']);
  assert.equal(errors.length, 0);
});

test('stock recovery identifies the original request and actor after a lost response', async () => {
  const store = new Map(), calls = [];
  const ctx = vm.createContext({
    session: {user: {venue_id: 'venue1', tg_id: 17}}, V: () => 'venue1', bump() {},
    crypto: {randomUUID: () => 'unique'},
    localStorage: {getItem: k => store.get(k), setItem: (k,v) => store.set(k,v), removeItem: k => store.delete(k)},
    rest: async (_, options) => { calls.push(options.body); if (calls.length === 1) throw Error('network'); return []; }
  });
  const db = vm.runInContext(section('  function stockDocument(', '    bulk:') + '}; db;', ctx);
  await assert.rejects(db.applyStock([{id: 'a'}]), /network/);
  assert.equal(typeof db.pendingStockRequestId, 'function');
  assert.equal(db.pendingStockRequestId(), 'unique');
  const recovered = await db.recoverStock();
  assert.equal(recovered.requestId, 'unique');
  assert.equal(recovered.scope, 'venue1:17');
  assert.equal(calls[0], calls[1]);
});

test('HTTP 401 never replays a stock operation after a venue switch', async () => {
  const session = {token: 'old', user: {venue_id: 'a', tg_id: 1}};
  let calls = 0;
  const ctx = vm.createContext({session, CFG: {url: ''}, V: () => session.user.venue_id, H: () => ({}), db: {actionScope: () => session.user.venue_id},
    fetch: async () => (++calls === 1 ? {status: 401} : {status: 200, ok: true, text: async () => '[]'}),
    refreshSession: async () => { session.user.venue_id = 'b'; session.token = 'new'; return true; }
  });
  const rest = vm.runInContext(section('  async function rest(', '  const iso=') + 'rest;', ctx);
  await assert.rejects(rest('rpc/apply_stock', {method: 'POST'}), /заведение|сессия/i);
  assert.equal(calls, 1);
});

test('a delayed receipt cannot clear a newer pending stock request from another tab', async () => {
  const store=new Map();
  let resolve;
  const ctx=vm.createContext({
    session:{user:{tg_id:17}}, V:()=>'venue1',bump(){},crypto:{randomUUID:()=>'old'},
    localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
    rest:()=>new Promise(done=>{resolve=done})
  });
  const db=vm.runInContext(section('  function stockDocument(','    bulk:')+'}; db;',ctx);
  const older=db.applyStock([{id:'a'}]);
  const key='mixora-stock-pending:venue1:17';
  store.set(key,JSON.stringify({body:{p_request_id:'new'}}));
  resolve([]);await older;
  assert.equal(db.pendingStockRequestId(),'new');
});

test('stock receipts and repeated table reads describe the same reviewed state',async()=>{
  const store=new Map();
  const ctx=vm.createContext({V:()=>'v',session:{user:{tg_id:1}},bump(){},crypto:{randomUUID:()=>'req'},
    localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
    rest:async()=>[{id:'a',doc:{bar:false,wh:3,revision:2,slow:false,retired:false,stop:true,stopAuto:true}}]
  });
  vm.runInContext(section('  const MAP={','  const subs=')+section('  function stockDocument(','    bulk:')+'};',ctx);
  const receipt=await vm.runInContext("db.applyStock([{id:'a'}])",ctx);
  const polled=vm.runInContext("MAP.stock.toDoc({wh:3,bar:false,revision:2,stop:true,stop_auto:true,slow:false,retired:false})",ctx);
  assert.equal(JSON.stringify(receipt[0].doc),JSON.stringify(polled));
});

test('inspection uses one page at a time and only retries failed pages on manual resubmission', async () => {
  const calls = [];
  let active = 0, maxActive = 0;
  const ctx = vm.createContext({
    console: {warn() {}}, session: {token: 'offline', user: {venue_id: 'a', tg_id: 1}},
    imgToBlock: async key => ({source: {data: key}}),
    normalizeInspectionPage: (text, obs) => text === 'valid' && Array.isArray(obs),
    callAI: async body => {
      const key = body.messages[0].content[0].source.data;
      calls.push(key);
      maxActive = Math.max(++active, maxActive);
      await Promise.resolve();
      active--;
      if (key === 'b' && calls.filter(x => x === 'b').length === 1) throw {code: 'ocr_malformed'};
      return {inspection: true, observation_schema_version: 1, ocr: 'fixture', ocr_texts: ['valid'], observations: [[]]};
    }
  });
  const read = vm.runInContext(section('  const readPhotos=async(', '  const sample=async(') + 'readLabels;', ctx);
  const first = await read(['a','b','c'], null, {inspection: true});
  assert.equal(first.failed, 1);
  assert.equal(maxActive, 1);
  await read(['a','b','c'], null, {inspection: true});
  assert.deepEqual(calls, ['a','b','c','b']);
  ctx.session.user.tg_id = 2;
  await read(['a'], null, {inspection: true});
  assert.deepEqual(calls, ['a','b','c','b','a']);
});
