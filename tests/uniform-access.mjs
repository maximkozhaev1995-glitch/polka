import fs from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),v='10000000-0000-0000-0000-000000000001',other='10000000-0000-0000-0000-000000000002';
await db.exec(fs.readFileSync('tests/fixtures/stock-baseline.sql','utf8'));
await db.exec(fs.readFileSync('tests/fixtures/access-baseline.sql','utf8'));
await db.exec(`insert into venues values('${v}'),('${other}');insert into users(tg_id,venue_id,name,role) values(1,'${v}','A','manager'),(2,'${v}','B','master'),(3,'${other}','C','manager');insert into flavors(id,brand,name) values('a','Brand','A'),('b','Brand','B');`);
for(const f of fs.readdirSync('supabase/migrations').sort())await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
const admin=()=>db.exec('reset role');
const actor=async(id,extra={})=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:String(id),tg_id:id,role:'authenticated',...extra})])};
const call=(id,rev,wh,extra={},key=crypto.randomUUID())=>db.query('select public.apply_stock($1,$2::jsonb) r',[key,JSON.stringify([{id,revision:rev,doc:{wh,...extra},kind:'in'}])]).then(r=>r.rows[0].r);
let count=0;async function test(name,f){await f();console.log('PASS',name);count++}
await test('both legacy roles have identical capability and venue',async()=>{for(const id of [1,2]){await actor(id);const r=(await db.query('select me_role() r,me_venue() v,is_staff() ok')).rows[0];assert.equal(r.r,'staff');assert.equal(r.v,v);assert.equal(r.ok,true)}});
await test('former master can populate, write off, inventory, mark and undo',async()=>{await actor(2);const key=crypto.randomUUID();await call('a',0,5,{bar:true},key);await call('a',1,3,{bar:true,stop:true,slow:true});const undo=crypto.randomUUID();await db.query('select public.apply_stock($1,$2::jsonb)',[undo,JSON.stringify([{id:'a',revision:2,undo:(await db.query('select operation_id from moves order by id desc limit 1')).rows[0].operation_id}])]);assert.equal((await db.query("select wh from stock where flavor_id='a'")).rows[0].wh,5);assert.equal((await db.query('select count(*)::int n from moves')).rows[0].n,3)});
await test('journal is readable and original movements are immutable',async()=>{for(const id of [1,2]){await actor(id);assert.equal((await db.query('select count(*)::int n from moves')).rows[0].n,3);await assert.rejects(db.exec('delete from moves'),/permission denied/);await assert.rejects(db.exec('update stock set wh=90'),/permission denied/)}});
await test('both accounts can edit orders, suppliers, tasks and private files',async()=>{for(const id of [1,2]){await actor(id);await db.query('insert into suppliers values($1,$2,$1)',[String(id),v]);await db.query('insert into tasks values($1,$2)',[String(id),v]);await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['files',v+'/contractors/'+id]);await db.query('insert into orders values($1,$2) on conflict(venue_id) do update set items=$2',[v,JSON.stringify({by:id})])}});
await test('protected knowledge cannot be deleted by either account',async()=>{await admin();await db.exec(`insert into knowledge_cat values(1,'${v}',true);insert into knowledge values(1,'${v}',1);`);for(const id of [1,2]){await actor(id);await db.exec('delete from knowledge;delete from knowledge_cat');assert.equal((await db.query('select count(*)::int n from knowledge')).rows[0].n,1)}});
await test('forged legacy role/perms/venue claims confer no cross-venue access',async()=>{await actor(2,{venue_id:other,app_role:'manager',perms:['all']});await assert.rejects(db.query('insert into suppliers values($1,$2,$1)',['foreign',other]),/row-level security/);await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['files',other+'/contractors/x']),/row-level security/);await actor(3);assert.equal((await db.query('select count(*)::int n from moves')).rows[0].n,0)});
await test('registered member in another venue cannot mutate foreign custom flavor',async()=>{await admin();await db.query("insert into flavors(id,brand,name,venue_id,custom) values('custom','X','X',$1,true)",[other]);await actor(2);await assert.rejects(call('custom',0,1),/stock_unknown_item/);const r=await db.query("update flavors set name='hacked' where id='custom' returning id");assert.equal(r.rows.length,0)});
await test('deleted membership revokes capabilities with the same signed identity',async()=>{await admin();await db.exec('delete from users where tg_id=3');await actor(3);assert.equal((await db.query('select is_staff() ok')).rows[0].ok,false);await assert.rejects(call('b',0,1),/stock_forbidden/)});
await test('mismatched signed identity claims do not authorize RLS',async()=>{await actor(2,{tg_id:1});assert.equal((await db.query('select me_tg() id,is_staff() ok')).rows[0].ok,false)});
await test('anonymous and nonexistent users cannot call RPC',async()=>{await actor(999);await assert.rejects(call('b',0,1),/stock_forbidden/);await db.exec("set role anon;set request.jwt.claims='{}'");assert.equal((await db.query('select is_staff() ok')).rows[0].ok,false);await assert.rejects(call('b',0,1),/permission denied/)});
await test('uniform RPC keeps idempotency, revisions and full rollback',async()=>{await actor(2);const key=crypto.randomUUID();await call('b',0,4,{},key);await call('b',0,4,{},key);await assert.rejects(call('b',0,4),/stale_revision/);await assert.rejects(db.query('select public.apply_stock($1,$2::jsonb)',[crypto.randomUUID(),JSON.stringify([{id:'a',revision:3,doc:{wh:8}},{id:'b',revision:1,doc:{wh:-2}}])]),/invalid_quantity/);assert.equal((await db.query("select wh from stock where flavor_id='a'")).rows[0].wh,5);assert.equal((await db.query("select count(*)::int n from moves where flavor_id='b'")).rows[0].n,1)});
await test('no active policy still splits staff by legacy role',async()=>{await admin();const rows=(await db.query("select * from pg_policies where schemaname in ('public','storage') and (coalesce(qual,'')||coalesce(with_check,'')) like '%me_role(%'")).rows;assert.equal(rows.length,0)});
await test('shared catalog cannot be changed, inserted or deleted by staff',async()=>{
 for(const id of [1,2]){await actor(id);
  assert.equal((await db.query("update flavors set name='hacked' where id='a' returning id")).rows.length,0);
  assert.equal((await db.query("delete from flavors where id='a' returning id")).rows.length,0);
  await assert.rejects(db.query("insert into flavors(id,brand,name) values('global-hack','X','X')"),/row-level security/);
 }
});
await test('own custom flavor remains editable but cannot become global or move venues',async()=>{
 await actor(2);await db.query("insert into flavors(id,brand,name,custom,venue_id) values('own-custom','X','Local',true,$1)",[v]);
 assert.equal((await db.query("update flavors set name='Local edit' where id='own-custom' returning id")).rows.length,1);
 await assert.rejects(db.query("update flavors set venue_id=null where id='own-custom'"),/row-level security/);
 await assert.rejects(db.query("update flavors set venue_id=$1 where id='own-custom'",[other]),/row-level security/);
 assert.equal((await db.query("select id from flavors where id='custom'")).rows.length,0);
});
await test('strength and pack overrides are local, validated and available to both roles',async()=>{
 for(const id of [1,2]){await actor(id);
  await db.query("insert into flavor_strengths values($1,'a',7) on conflict(venue_id,flavor_id) do update set strength=excluded.strength",[v]);
  await db.query("insert into flavor_packs values($1,'a',100) on conflict(venue_id,flavor_id) do update set pack_g=excluded.pack_g",[v]);
  await assert.rejects(db.query("insert into flavor_strengths values($1,'a',3)",[other]),/row-level security/);
  await assert.rejects(db.query("insert into flavor_packs values($1,'custom',100)",[v]),/row-level security/);
  await assert.rejects(db.query("update flavor_strengths set strength=11"),/check constraint/);
  await assert.rejects(db.query("update flavor_packs set pack_g=-1"),/check constraint/);
 }
 await admin();assert.equal((await db.query("select strength from flavors where id='a'")).rows[0].strength,null);
 await db.query("insert into users(tg_id,venue_id,name,role) values(4,$1,'Other','master')",[other]);await actor(4);
 assert.equal((await db.query('select * from flavor_strengths')).rows.length,0);
 assert.equal((await db.query('select * from flavor_packs')).rows.length,0);
 await db.query("insert into flavor_strengths values($1,'a',3)",[other]);await actor(2);
 assert.equal((await db.query("select strength from flavor_strengths where flavor_id='a'")).rows[0].strength,7);
 await db.query("update flavor_packs set pack_g=null where flavor_id='a'");
 assert.equal((await db.query("select pack_g from flavor_packs where flavor_id='a'")).rows[0].pack_g,null);
});
await test('guests may read shared flavor strength for guest cards but cannot write settings',async()=>{
 await db.exec("set role anon;set request.jwt.claims='{}'");
 assert.equal((await db.query("select * from flavor_strengths where flavor_id='a'")).rows.length,2);
 await assert.rejects(db.query("update flavor_strengths set strength=1"),/permission denied/);
 await assert.rejects(db.query('select * from flavor_packs'),/permission denied/);
});
console.log(`${count} uniform access/RLS/RPC tests passed (local PGlite, metadata fixture)`);await db.close();
