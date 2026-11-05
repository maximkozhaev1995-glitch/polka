import {testIdentity} from './test-identity.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { localPostgres } from './local-postgres.mjs';

const legacy = process.argv.includes('--legacy');
const venue = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const pg = await localPostgres();
try {
  const admin = await pg.connect(), a = await pg.connect(), b = await pg.connect();
  for (const fixture of ['stock-baseline', 'access-baseline']) {
    await admin.query(fs.readFileSync('tests/fixtures/' + fixture + '.sql', 'utf8'));
  }
  await admin.query('alter table invites add primary key(code)');
  for (const file of fs.readdirSync('supabase/migrations').sort()) {
    if (legacy && file.endsWith('_atomic_invite_redemption.sql')) continue;
    await admin.query(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
  }
  await admin.query('insert into venues values($1),($2)', [venue, other]);
  await admin.query("insert into invites values ('retry',$1,'manager',null),('race',$1,'manager',null),('foreign',$2,'manager',null)", [venue,other]);
  async function redeem(client, code, id, name) {
    if (legacy) {
      // Separate PostgREST transactions used by the baseline Edge handler.
      const {rows:[invite]} = await client.query('update invites set used_by=$2 where code=$1 and used_by is null returning venue_id', [code,id]);
      if (!invite) return null;
      return (await client.query("insert into users(tg_id,venue_id,name,role) values($1,$2,$3,'manager') returning tg_id,venue_id,name", [id,invite.venue_id,name])).rows[0];
    }
    return (await client.query('select public.redeem_staff_invite($1,$2,$3) result', [code,id,name])).rows[0].result;
  }
  if (!legacy) {
    await a.query('set role service_role');
    await b.query('set role service_role');
  }
  await assert.rejects(redeem(a,'retry',1,null), {code:'23502'});
  assert.equal((await admin.query("select used_by from invites where code='retry'")).rows[0].used_by,null,
    'failed provisioning must not leave the invite consumed even if no compensating request runs');
  assert.equal((await redeem(b,'retry',1,'Retry')).venue_id,venue);
  console.log('PASS provisioning failure rolls back invite and allows retry');

  await a.query('begin');
  assert.equal((await redeem(a,'race',2,'First')).venue_id,venue);
  const loser = redeem(b,'race',3,'Second');
  try {
    const {rows:[{pid}]} = await a.query('select pg_backend_pid() pid');
    for (let tries=0;;tries++) {
      const {rows:[{waiting}]} = await admin.query('select exists(select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))) waiting', [pid]);
      if (waiting) break;
      assert(tries<100,'second transaction never waited on the first');
      await new Promise(resolve=>setTimeout(resolve,20));
    }
  } finally {
    await a.query('commit');
  }
  assert.equal(await loser,null);
  assert.equal(await redeem(b,'race',4,'Replay'),null);
  assert.equal((await admin.query('select count(*)::int n from users where tg_id in (2,3,4)')).rows[0].n,1);
  console.log('PASS overlapping redemption has one winner and rejects replay');

  assert.equal((await redeem(b,'foreign',5,'Other')).venue_id,other);
  await a.query('set role authenticated');
  await a.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(await testIdentity(a,2))]);
  await assert.rejects(redeem(a,'foreign',8,'Forbidden'), {code:'42501'});
  assert.deepEqual((await a.query('select distinct venue_id from users')).rows,[{venue_id:venue}]);
  assert.equal((await a.query('select me_venue() venue')).rows[0].venue,venue);
  assert.equal((await a.query("update invites set used_by=null where code='race'")).rowCount,0);
  assert.equal((await a.query("delete from invites where code='race'")).rowCount,0);
  await assert.rejects(a.query("insert into invites values('used',$1,'manager',99)",[venue]), {code:'42501'});
  await a.query("insert into invites values('unused',$1,'manager',null)",[venue]);
  assert.equal((await a.query("delete from invites where code='unused'")).rowCount,1);
  console.log('PASS staff can issue and withdraw unused codes but cannot reopen a redeemed code');
  await admin.query('delete from users where tg_id=2');
  assert.equal((await a.query('select me_venue() venue,is_staff() staff')).rows[0].staff,false);
  assert.deepEqual((await a.query('select * from users')).rows,[]);
  await assert.rejects(a.query('select public.apply_order($1,$2,$3)',[venue,crypto.randomUUID(),'[]']), {code:'42501'});
  await assert.rejects(a.query('select public.apply_stock($1,$2)',[crypto.randomUUID(),'[]']), {code:'42501'});
  console.log('PASS same session loses staff reads and order/stock writes after membership deletion');
} finally {
  await pg.close();
}
