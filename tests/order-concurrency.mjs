import fs from 'node:fs';
import assert from 'node:assert/strict';
import { localPostgres } from './local-postgres.mjs';

const legacy = process.argv.includes('--legacy');
const pg = await localPostgres();
const venue = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const change = (id, before, after, map = 'q') => ({ map, id, before, after });
try {
  const admin = await pg.connect(), a = await pg.connect(), b = await pg.connect();
  for (const file of ['stock-baseline', 'access-baseline']) {
    await admin.query(fs.readFileSync(`tests/fixtures/${file}.sql`, 'utf8'));
  }
  await admin.query(`
    insert into venues values ('${venue}'), ('${other}');
    insert into users(tg_id,venue_id,name,role) values
      (1,'${venue}','First','manager'), (2,'${venue}','Second','master'), (3,'${other}','Other','manager');
    insert into orders(venue_id,items) values ('${venue}','{"q":{"x":1},"m":{}}');
  `);
  for (const f of fs.readdirSync('supabase/migrations').sort()) {
    if (legacy && f.endsWith('_protect_order_writes.sql')) continue;
    await admin.query(fs.readFileSync('supabase/migrations/' + f, 'utf8'));
  }
  async function actor(c, id) {
    await c.query('set role authenticated');
    await c.query("select set_config('request.jwt.claims',$1,false)",
      [JSON.stringify({sub:String(id),tg_id:id,role:'authenticated'})]);
  }
  await actor(a, 1); await actor(b, 2);
  const read = c => c.query('select items from orders').then(r => r.rows[0]?.items);
  const save = (c, edits, key = crypto.randomUUID(), scope = venue) => c.query(
    'select public.apply_order($1,$2,$3::jsonb) result', [scope,key,JSON.stringify(edits)],
  ).then(r => r.rows[0].result);
  if (legacy) {
    const [first, second] = await Promise.all([read(a), read(b)]);
    const upsert = (c, items) => c.query('insert into orders(venue_id,items) values($1,$2) on conflict(venue_id) do update set items=excluded.items',
      [venue, JSON.stringify(items)]);
    first.q.a = 2; second.q.b = 3;
    await upsert(b, second);
    await upsert(a, first); // delayed first request arrives after the other write was acknowledged
    assert.deepEqual((await read(b)).q, { x:1, a:2, b:3 }, 'late whole-document write must not lose acknowledged b');
  }
  const results = await Promise.all([save(a, [change('a', null, 2)]), save(b, [change('b', null, 3)])]);
  assert(results.every(r => r.status === 'applied'));
  assert.deepEqual((await read(a)).q, { x:1, a:2, b:3 });
  console.log('PASS concurrent independent positions survive');

  const same = await Promise.all([save(a, [change('x', 1, 4),change('d',null,1)]), save(b, [change('x', 1, 5), change('c', null, 1)])]);
  assert.deepEqual(same.map(r => r.status).sort(), ['applied','conflict']);
  const conflict = same.find(r => r.status === 'conflict');
  assert.equal(conflict.conflicts[0].id, 'x');
  assert.equal((await read(a)).q.x, same.find(r => r.status === 'applied').order.q.x);
  assert.equal((await read(a)).q[same[1].status === 'conflict'?'c':'d'], undefined);
  console.log('PASS same-position conflict and atomic batch');

  const key = crypto.randomUUID(), old = [change('a', 2, 7)];
  await a.query('begin');
  const applied = await save(a, old, key); // response is lost after commit
  const waiting = save(b, [change('a', 7, 9), change('b', 3, null)]);
  await a.query('commit');
  assert.equal((await waiting).status, 'applied');
  const reloaded = await pg.connect(); await actor(reloaded, 1);
  assert.deepEqual(await save(reloaded, old, key), applied);
  assert.deepEqual(await save(reloaded, old, key), applied);
  assert.equal((await read(reloaded)).q.a, 9);
  assert.equal((await read(reloaded)).q.b, undefined);
  await assert.rejects(save(reloaded, [change('a', 9, 10)], key), /order_idempotency_conflict/);
  const delayedKey=crypto.randomUUID(),delayed=[change('late',null,3)];
  assert.equal((await save(b,[change('late',null,8)])).status,'applied');
  // The timed-out request first reaches PostgreSQL after the newer edit.
  const rejected=await save(a,delayed,delayedKey);
  assert.equal(rejected.status,'conflict');
  assert.deepEqual(await save(reloaded,delayed,delayedKey),rejected);
  assert.equal((await read(reloaded)).q.late,8);
  console.log('PASS late completion, lost response, reload and identical UUID retry');

  const manual = { b:'Brand', n:'Manual', q:2, wids:['wish'] };
  await assert.rejects(save(b,[change('m1',null,{...manual,q:'"><img src=x>'},'m')]),/order_invalid_request/);
  assert.equal((await save(b,[change('m1',null,manual,'m')])).status,'applied');
  assert.deepEqual((await read(a)).m.m1,manual);
  await assert.rejects(a.query("update orders set items='{}'"),/permission denied/);
  await actor(b,3);
  assert.equal(await read(b),undefined);
  assert.equal((await save(b,[change('a',null,11)],undefined,other)).order.q.a,11);
  assert.equal((await read(a)).q.a,9);
  await admin.query('update users set venue_id=$1 where tg_id=1',[other]);
  await assert.rejects(save(a,old,key),/order_scope_changed/);
  await assert.rejects(save(a,[change('cross',null,2)]),/order_scope_changed/);
  assert.deepEqual((await read(a)).q,{a:11});
  await b.query("set role anon;set request.jwt.claims='{}'");
  await assert.rejects(save(b,[change('a',null,1)]),/permission denied/);
  console.log('PASS manual rows, legacy write blocked and venue isolation');
} finally {
  await pg.close();
}
