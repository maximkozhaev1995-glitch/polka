import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const realPostgres = process.argv.includes('--postgres');
const pg = realPostgres ? await (await import('./local-postgres.mjs')).localPostgres() : null;
let db;
try {
  db = pg ? await pg.connect() : new (await import('@electric-sql/pglite')).PGlite();
  const exec = sql => pg ? db.query(sql) : db.exec(sql);
  const apply = file => exec(fs.readFileSync(file, 'utf8'));
  const venue = '10000000-0000-0000-0000-000000000001';
  const other = '10000000-0000-0000-0000-000000000002';
  const actor = async id => {
    await exec('set role authenticated');
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: String(id), tg_id: id, role: 'authenticated' }),
    ]);
  };
  const call = (items, key = randomUUID()) => db.query(
    'select public.apply_stock($1,$2::jsonb) as result', [key, JSON.stringify(items)],
  ).then(r => r.rows[0].result);
  const change = (id, revision, wh) => ({ id, revision, doc: { wh } });
  const undo = (id, revision, target) => ({ id, revision, undo: target });
  const rows = sql => db.query(sql).then(r => r.rows);
  const snapshot = async () => ({
    stock: await rows('select * from stock order by venue_id,flavor_id'),
    moves: await rows('select * from moves order by id'),
  });
  const migrationDir = 'supabase/migrations';
  const migrations = fs.readdirSync(migrationDir).sort();
  const fix = migrations.find(name => name.endsWith('_block_compensation_undo.sql'));

  await apply('tests/fixtures/stock-baseline.sql');
  await apply('tests/fixtures/access-baseline.sql');
  await exec(`
    insert into venues values ('${venue}'), ('${other}');
    insert into users(tg_id,venue_id,name,role) values
      (1,'${venue}','First','master'), (2,'${other}','Second','manager');
    insert into flavors(id,brand,name) values ('a','A','A'), ('b','B','B'), ('c','C','C');
  `);
  for (const file of migrations.filter(name => name !== fix)) await apply(`${migrationDir}/${file}`);

  await actor(1);
  await call([change('a', 0, 5), change('b', 0, 5), change('c', 0, 5)]);
  const original = randomUUID();
  await call([change('a', 1, 3), change('b', 1, 3)], original);
  const legacy = randomUUID();
  const legacyPayload = [
    undo('b', 2, original),
    { ...change('c', 1, 7), reason: `Отмена операции ${original}` },
  ];
  const legacyResult = await call(legacyPayload, legacy);
  await exec('reset role');
  if (fix) await apply(`${migrationDir}/${fix}`);
  await actor(1);

  const key = randomUUID();
  const payload = [undo('a', 2, original)];
  const result = await call(payload, key);
  assert.equal(result[0].doc.wh, 5);
  assert.equal(result[0].doc.revision, 3);
  const before = await snapshot();
  assert.deepEqual(before.moves.filter(m => m.flavor_id === 'a').map(m => [m.operation_id, m.qty]), [
    [before.moves.find(m => m.flavor_id === 'a').operation_id, 5], [original, -2], [key, 2],
  ]);
  assert.deepEqual(await call(payload, key), result);
  assert.deepEqual(await call(legacyPayload, legacy), legacyResult);
  await assert.rejects(call([undo('a', 3, original)]), /stock_undo_not_latest/);
  assert.deepEqual(await snapshot(), before);
  console.log('PASS normal undo, preserved history, UUID replay and repeat undo rejection');

  await assert.rejects(call([undo('a', 3, key)]), /stock_undo_compensation/);
  await assert.rejects(call([change('a', 3, 9), undo('b', 3, legacy)]), /stock_undo_compensation/);
  assert.deepEqual(await snapshot(), before);
  console.log('PASS new and pre-migration compensation rejected, mixed batch rolled back');

  assert.equal((await call([undo('c', 2, legacy)]))[0].doc.wh, 5);
  console.log('PASS ordinary item in mixed request can be undone even with compensation-like reason');

  const own = await snapshot();
  await actor(2);
  assert.deepEqual(await rows('select * from moves'), []);
  await assert.rejects(call([undo('a', 0, key)]), /stock_undo_not_latest/);
  assert.deepEqual(await snapshot(), { stock: [], moves: [] });
  await exec("set role anon; set request.jwt.claims='{}'");
  await assert.rejects(call([undo('a', 3, key)]), /permission denied/);
  await actor(1);
  assert.deepEqual(await snapshot(), own);
  console.log(`PASS venue isolation and anonymous access denied (${pg ? 'PostgreSQL' : 'PGlite'})`);
} finally {
  if (pg) await pg.close();
  else if (db) await db.close();
}
