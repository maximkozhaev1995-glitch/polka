import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
process.on('uncaughtException',e=>{console.error('FAIL',e.code||'',e.message,e.position,e.internalPosition,e.where);process.exit(1)});
const db=new PGlite();await db.waitReady;
const V='00000000-0000-4000-8000-000000000001',W='00000000-0000-4000-8000-000000000002';
console.log('ENGINE', (await db.query('select version()')).rows[0].version);
await db.exec(fs.readFileSync('tests/fixtures/b5-minimal.sql','utf8'));
await db.exec(fs.readFileSync('supabase/b5_atomic_stock_PROPOSAL.sql','utf8'));
async function reset(){await db.exec(`truncate public.users,public.flavors,public.stock,public.moves,public.inv_log,mixora_internal.stock_operations,mixora_internal.stock_effects,mixora_internal.stock_reversals restart identity;
insert into public.users values(1,'${V}','manager','{}'),(2,'${V}','manager','{}'),(3,'${V}','master',NULL),(4,'${W}','manager','{}');
insert into public.flavors(id,venue_id) values('a',null),('b',null),('c',null),('foreign','${W}');
insert into public.stock values('${V}','a',10,false,false,false),('${V}','b',10,false,false,false),('${V}','c',1,false,false,false);`)}
async function call(items,tg=1,key=randomUUID()){
 return db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('test.tg',$1,true)",[String(tg)]);return (await tx.query('select public.mixora_commit_stock_batch($1,$2::jsonb) as result',[key,JSON.stringify(items)])).rows[0].result});
}
const item=(id='a',delta=-1,expected_wh=10)=>({id,delta,expected_wh});
const state=async()=>({stock:(await db.query('select * from public.stock order by flavor_id')).rows,moves:(await db.query('select * from public.moves order by id')).rows,ops:(await db.query('select * from mixora_internal.stock_operations')).rows});
async function error(code,fn){await assert.rejects(fn,e=>{assert.equal(e.code,code);return true})}
let passed=0;async function test(name,fn){await reset();await fn();console.log('PASS',name);passed++}
await test('#1 NULL/NULL-element permissions and NULL role fail closed',async()=>{
 for(const perms of [null,[null]]){await db.query('update public.users set perms=$1::text[] where tg_id=3',[perms]);for(const delta of [-1,1])await error('42501',()=>call([item('a',delta)],3));
 for(const bar of [true,false]){await db.query('update public.stock set bar=$1 where flavor_id=$2',[!bar,'a']);await error('42501',()=>call([{...item('a',0),bar,expected_bar:!bar}],3))}}
 await db.exec('update public.users set role=null where tg_id=3');await error('42501',()=>call([item()],3));assert.equal((await state()).moves.length,0);
});
await test('#2 first receipt creates stock and movement',async()=>{await db.exec("delete from public.stock where flavor_id='a'");await call([item('a',5,0)]);let s=await state();assert.equal(s.stock[0].wh,5);assert.equal(s.moves.length,1);assert.equal(s.moves[0].qty,5)});
await test('#3 NULL bar and required expected_bar',async()=>{await db.exec("update public.stock set bar=null where flavor_id='a'");await call([{...item(),bar:false,expected_bar:false}]);assert.equal((await state()).stock[0].wh,9);await error('22023',()=>call([{...item('a',-1,9),bar:true}]));await error('22023',()=>call([{...item('a',-1,9),expected_bar:true}]));await error('22023',()=>call([{...item('a',-1,9),unknown:true}]))});
await test('#4 SERIAL replay, payload/actor/venue mismatch, canonical order',async()=>{const key=randomUUID(),payload=[item('b'),item('a')];const result=await call(payload,1,key);assert.deepEqual(await call([...payload].reverse(),1,key),result);assert.equal((await state()).moves.length,2);await error('23505',()=>call([item('a',-2)],1,key));await error('23505',()=>call(payload,2,key));await error('23505',()=>call(payload,4,key))});
await test('#5 entire batch and operation key roll back; failed UUID can retry',async()=>{const before=await state(),key=randomUUID();await error('23514',()=>call([item('a',-2),item('b',-2),item('c',-2,1)],1,key));assert.deepEqual(await state(),before);await call([item()],1,key);assert.equal((await state()).moves.length,1)});
await test('#6 SERIAL stale employee receives 40001 and fresh retry succeeds',async()=>{await call([item()],1);const before=await state();await error('40001',()=>call([item()],2));assert.deepEqual(await state(),before);await call([item('a',-1,9)],2);assert.equal((await state()).stock[0].wh,8)});
await test('table/column DML, private schema and anon RPC are denied',async()=>{
 for(const [table,col,priv] of [['stock','wh','UPDATE'],['stock','flavor_id','INSERT'],['moves','qty','UPDATE'],['moves','flavor_id','INSERT']])assert.equal((await db.query('select has_column_privilege($1,$2,$3,$4) as allowed',['authenticated','public.'+table,col,priv])).rows[0].allowed,false);

 for(const role of ['authenticated','anon'])for(const sql of ["insert into public.stock values(null,'z',0,false,false,false)",'update public.stock set wh=99','delete from public.stock','truncate public.stock',"insert into public.moves(flavor_id) values('a')",'update public.moves set qty=99','delete from public.moves','truncate public.moves','select * from mixora_internal.stock_operations'])await error('42501',()=>db.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.exec(sql)}));
 await error('42501',()=>db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('select public.mixora_commit_stock_batch($1,$2::jsonb)',[randomUUID(),JSON.stringify([item()])])}));
});
await test('venue isolation, missing identity, empty and invalid batches',async()=>{
 await error('22023',()=>call([item('foreign',1,0)]));await error('42501',()=>call([item()],999));await error('22023',()=>call([]));await error('22023',()=>call([item(),item()]));await error('22023',()=>call([item('a',0)]));
});
await test('legacy stock trigger permits automatic stop removal on authorized receipt',async()=>{
 const legacy=fs.readFileSync('supabase/migrations_003.sql','utf8');
 await db.exec(legacy.slice(legacy.indexOf('create or replace function enforce_master_stock()')));
 await db.exec(fs.readFileSync('supabase/b5_atomic_stock_PROPOSAL.sql','utf8'));
 await db.exec("update public.users set perms=ARRAY['add'] where tg_id=3;update public.stock set wh=0,stop=true,stop_auto=true where flavor_id='a'");
 await call([item('a',1,0)],3);
 const a=(await state()).stock[0];assert.equal(a.wh,1);assert.equal(a.stop,false);assert.equal(a.stop_auto,false);
 await db.exec("update public.stock set bar=null where flavor_id='a'");
 await call([{...item('a',1,1),bar:false,expected_bar:false}],3);

 // A manual stop remains manual after receipt.
 await db.exec("update public.stock set stop=true,stop_auto=false where flavor_id='a'");
 await call([item('a',1,2)],3);assert.equal((await state()).stock[0].stop,true);
 await error('42501',()=>db.transaction(async tx=>{await tx.query("select set_config('test.tg','3',true)");await tx.exec("update public.stock set stop=false where flavor_id='a'")}));

});
async function action(request,tg=1,key=randomUUID()){
 return db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('test.tg',$1,true)",[String(tg)]);return (await tx.query('select public.mixora_stock_action($1,$2::jsonb) as result',[key,JSON.stringify(request)])).rows[0].result});
}
async function patch(id,state){const r=(await db.query('select revision from public.stock where flavor_id=$1 and venue_id=$2',[id,V])).rows[0];return {id,revision:String(r?.revision??0),state,...(state.wh!==undefined?{reason:'Test adjustment'}:{})}}
await test('restored actions: role checks, flags, finish and stale revision',async()=>{
 const change={action:'change',items:[await patch('a',{slow:true})]};await error('42501',()=>action(change,3));
 await action(change);await error('40001',()=>action(change));
 await action({action:'finish',items:[await patch('a',{})]});assert.equal((await state()).stock[0].wh,9);
 await db.exec("update public.stock set wh=0,bar=true where flavor_id='a'");
 await action({action:'finish',items:[await patch('a',{})]});const a=(await state()).stock[0];assert.equal(a.stop_auto,true);assert.equal(a.bar,false);
});
await test('append-only undo: replay, double undo, ABA and legacy rejection',async()=>{
 const op=await call([item()]);const count=(await state()).moves.length;const key=randomUUID(),req={action:'undo',original_id:op.operation_id};
 const result=await action(req,1,key);assert.deepEqual(await action(req,1,key),result);assert.equal((await state()).moves.length,count+1);assert.equal((await state()).stock[0].wh,10);
 await error('23505',()=>action(req));await error('42501',()=>action(req,4));await error('42501',()=>action(req,3));
 const next=await action({action:'change',items:[await patch('a',{wh:9})]});
 await db.exec("update public.stock set wh=8 where flavor_id='a';update public.stock set wh=9 where flavor_id='a'");
 await error('40001',()=>action({action:'undo',original_id:next.operation_id}));
});
await test('inventory all-or-nothing, server totals and compensating summary',async()=>{
 await db.exec("update public.flavors set brand='Test',pack_g=100 where id in ('a','b')");
 const bad={action:'inventory',ig:'main',price:'2',items:[await patch('a',{wh:8}),{...await patch('b',{wh:7}),revision:'0'}]};const before=await state();
 await error('40001',()=>action(bad));assert.deepEqual(await state(),before);
 const req={...bad,items:[await patch('a',{wh:8}),await patch('b',{wh:7})]};const op=await action(req);
 let log=(await db.query('select * from public.inv_log where operation_id=$1',[op.operation_id])).rows[0];assert.equal(log.shortage_units,5);assert.equal(Number(log.shortage_g),500);
 await action({action:'undo',original_id:op.operation_id});const total=(await db.query('select sum(shortage_units) as n from public.inv_log')).rows[0];assert.equal(Number(total.n),0);
});
await test('catalog and initial stock atomic creation, replay and foreign denial',async()=>{
 const key=randomUUID(),req={action:'create',flavor:{brand:'Test',name:'New'},items:[{id:'new',revision:'0',state:{wh:3}}]};
 await error('42501',()=>action(req,3));const r=await action(req,1,key);assert.deepEqual(await action(req,1,key),r);
 assert.equal((await db.query("select count(*) as n from public.flavors where id='new'")).rows[0].n,1);
 const broken={...req,items:[{id:'broken',revision:'0',state:{wh:-1}}]};await error('22023',()=>action(broken));assert.equal((await db.query("select count(*) as n from public.flavors where id='broken'")).rows[0].n,0);
 await error('22023',()=>action({action:'change',items:[{id:'foreign',revision:'0',state:{wh:1}}]}));
});

console.log(`${passed} embedded SQL groups PASS. Native concurrent-session tests NOT RUN.`);
await db.close();
