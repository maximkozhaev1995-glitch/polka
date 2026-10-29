// Catalog-only production snapshot. Every row below is synthetic; no remote connection.
// PASS means an incompatibility was reproduced and the deployment guard rejected it.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const m=JSON.parse(fs.readFileSync('tests/fixtures/b5-production-catalog.json','utf8'));
const proposal=fs.readFileSync('supabase/b5_atomic_stock_PROPOSAL.sql','utf8');
const unsafeOverlay=proposal.replace(/do \$production_compatibility\$[\s\S]*?\$production_compatibility\$;/,'');
const names=['venues','users','flavors','stock','moves','inv_log','flavor_packs','flavor_strengths'];
const qi=x=>'"'+x.replaceAll('"','""')+'"';
const ql=x=>"'"+x.replaceAll("'","''")+"'";
const V='00000000-0000-4000-8000-000000000001',W='00000000-0000-4000-8000-000000000002';
function createTable(schema,name,columns){return `create table ${qi(schema)}.${qi(name)}(${columns.map(c=>`${qi(c.column)} ${c.type}${c.identity?' generated '+(c.identity==='a'?'always':'by default')+' as identity':c.default?' default '+c.default:''}${c.not_null?' not null':''}`).join(',')});`}
function fixture(){
 let sql="create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to anon,authenticated,service_role;create schema mixora_private;grant usage on schema mixora_private to authenticated;";
 for(const n of names)sql+=createTable('public',n,m.columns.filter(c=>c.table===n));
 for(const t of m.private_tables)sql+=createTable(t.schema,t.name,m.private_columns.filter(c=>c.table===t.name));
 for(const c of m.constraints)sql+=`alter table public.${qi(c.table)} add constraint ${qi(c.name)} ${c.definition};`;
 for(const c of m.private_constraints)sql+=`alter table ${qi(c.schema)}.${qi(c.table)} add constraint ${qi(c.name)} ${c.definition};`;
 const order=['me_tg()','is_staff()','me_role()','me_venue()','enforce_master_stock()','users_default_manager()','mixora_private.apply_stock(uuid,jsonb)','apply_stock(uuid,jsonb)'];
 for(const sig of order){const f=m.functions.find(f=>f.signature===sig);assert(f,sig);sql+=f.definition+';';}
 for(const t of m.triggers)sql+=t.definition+';';
 for(const p of m.policies){sql+=`create policy ${qi(p.policyname)} on ${qi(p.schemaname)}.${qi(p.tablename)} as ${p.permissive} for ${p.cmd} to ${p.roles.map(qi).join(',')}${p.qual?' using ('+p.qual+')':''}${p.with_check?' with check ('+p.with_check+')':''};`;}
 // Reproduce the observed application grants, not Supabase-managed admin roles.
 const privileges={a:'insert',r:'select',w:'update',d:'delete',D:'truncate',x:'references',t:'trigger'};
 for(const t of [...m.tables,...m.private_tables]){
  if(t.rls)sql+=`alter table ${qi(t.schema)}.${qi(t.name)} enable row level security;`;
  for(const acl of t.acl||[]){const match=acl.match(/^([^=]*)=([^/]+)\//);if(!match)continue;const role=match[1]||'public';if(!['anon','authenticated','service_role','public'].includes(role))continue;
   const grants=[...match[2]].map(c=>privileges[c]).filter(Boolean);if(grants.length)sql+=`grant ${grants.join(',')} on ${qi(t.schema)}.${qi(t.name)} to ${qi(role)};`;
  }
 }
 for(const f of m.functions){const sig=f.signature.includes('.')?f.signature:'public.'+f.signature;
  sql+=`revoke all on function ${sig} from public,anon,authenticated,service_role;`;
  for(const acl of f.acl||[]){const match=acl.match(/^([^=]*)=([^/]+)\//);if(!match||!match[2].includes('X'))continue;const role=match[1]||'public';if(['anon','authenticated','service_role','public'].includes(role))sql+=`grant execute on function ${sig} to ${qi(role)};`;}
 }
 for(const index of m.indexes)if(!m.constraints.some(c=>c.name===index.indexname)&&!m.private_constraints.some(c=>c.name===index.indexname))sql+=index.indexdef+';';
 // Observed postgres default privileges must also apply to newly created RPCs/views.
 sql+='alter default privileges in schema public grant all on tables to anon,authenticated,service_role;alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;';
 return sql;
}
if(process.argv.includes('--emit-fixture')){process.stdout.write(fixture());process.exit(0)}
const db=new PGlite();await db.waitReady;await db.exec(fixture());
await db.query("insert into public.venues(id,name) values($1,'Test venue'),($2,'Other test venue')",[V,W]);
await db.query("insert into public.users(tg_id,venue_id,name,role,perms) values(1,$1,'Test manager','manager','{}'),(2,$1,'Test legacy master','master','{}'),(3,$2,'Other employee','manager','{}')",[V,W]);
// Production trigger forces newly inserted role to manager; preserve a legacy master explicitly.
await db.exec("update public.users set role='master' where tg_id=2");
await db.query("insert into public.flavors(id,brand,name,pack_g) values('a','Test','Synthetic A',100),('b','Test','Synthetic B',100)");
await db.query("insert into public.stock(venue_id,flavor_id,wh,revision) values($1,'a',10,7),($1,'b',10,99)",[V]);
await db.query("insert into public.flavor_packs values($1,'a',150)",[V]);
async function asUser(tg,fn){return db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:'authenticated',sub:String(tg),tg_id:String(tg)})]);return fn(tx);});}
async function legacy(tg,doc,revision,key=randomUUID()){return asUser(tg,async tx=>(await tx.query('select public.apply_stock($1,$2::jsonb) as result',[key,JSON.stringify([{id:'a',revision,kind:'in',doc}])])).rows[0].result);}
async function action(tg,request){return asUser(tg,async tx=>(await tx.query('select public.mixora_stock_action($1,$2::jsonb) as result',[randomUUID(),JSON.stringify(request)])).rows[0].result);}
const stock=async()=>(await db.query("select * from public.stock where venue_id=$1 and flavor_id='a'",[V])).rows[0];
let count=0;async function test(name,fn){await fn();console.log('PASS',name);count++;}
const findings=[];
await test('actual baseline allows both legacy roles, keeps manual stop and matches RPC revision',async()=>{
 await db.exec("update public.stock set stop=true,stop_auto=true where flavor_id='a'");
 const result=await legacy(2,{wh:11,bar:false,stop:true,stopAuto:true},7);const row=await stock();assert.equal(row.stop,true);assert.equal(row.stop_auto,true);assert.equal(result[0].doc.revision,row.revision);assert.equal(row.revision,8);
});
await test('actual baseline denies other-venue stock via real me_tg claims helper and RLS',async()=>{
 const rows=await asUser(3,tx=>tx.query('select * from public.stock where venue_id=$1',[V]));assert.equal(rows.rows.length,0);
});
await test('production compatibility guard rejects overlay before schema or business changes',async()=>{
 const before=await stock();await assert.rejects(()=>db.exec(proposal),e=>e.code==='0A000'&&e.message.includes('apply_stock'));
 // A failed explicit BEGIN must be rolled back before subsequent disposable probes.
 await db.exec('rollback');assert.deepEqual(await stock(),before);
 assert.equal((await db.query("select to_regclass('mixora_internal.stock_operations') as x")).rows[0].x,null);
});
// Test-only bypass in an in-memory engine to reproduce WHY the deployment is blocked.
await db.exec(unsafeOverlay);
await test('existing integer revision is not widened or sequence-seeded by historical proposal',async()=>{
 const type=(await db.query("select data_type from information_schema.columns where table_name='stock' and column_name='revision'")).rows[0].data_type;
 const seq=(await db.query('select last_value from mixora_internal.stock_revision_seq')).rows[0].last_value;const max=(await db.query('select max(revision) as n from public.stock')).rows[0].n;
 assert.equal(type,'integer');assert(seq<max);findings.push('existing integer revision/global sequence not reconciled');
});
await test('historical proposal leaves both deployed legacy RPC entry points callable',async()=>{
 for(const sig of ['public.apply_stock(uuid,jsonb)','mixora_private.apply_stock(uuid,jsonb)'])assert.equal((await db.query("select has_function_privilege('authenticated',$1,'EXECUTE') as x",[sig])).rows[0].x,true);
 findings.push('two independently tracked write protocols remain callable');
});
await test('overlay makes legacy RPC response revision disagree with persisted stock and breaks retry',async()=>{
 const before=await stock();const result=await legacy(2,{wh:12,bar:false,stop:true,stopAuto:true},before.revision);const row=await stock();
 assert.notEqual(result[0].doc.revision,row.revision);
 await assert.rejects(()=>legacy(2,{wh:13,bar:false,stop:true,stopAuto:true},result[0].doc.revision),e=>e.message==='stock_stale_revision');
 findings.push(`legacy response revision ${result[0].doc.revision} differs from stored ${row.revision}`);
});
await test('new RPC reintroduces per-role denial for an approved equal-rights employee',async()=>{
 await assert.rejects(async()=>action(2,{action:'change',items:[{id:'a',revision:String((await stock()).revision),state:{wh:13}}]}),e=>e.code==='42501');
 findings.push('legacy master denied by new RPC despite uniform-staff contract');
});
await test('new receipt clears automatic stop contrary to released independent stop-list contract',async()=>{
 await db.exec("update public.stock set stop=true,stop_auto=true where flavor_id='a'");const before=await stock();
 await asUser(1,tx=>tx.query('select public.mixora_commit_stock_batch($1,$2::jsonb)',[randomUUID(),JSON.stringify([{id:'a',delta:1,expected_wh:before.wh}])]));
 assert.equal((await stock()).stop,false);findings.push('new receipt automatically clears stop');
});
await test('new inventory uses global package default instead of venue override',async()=>{
 const before=await stock();const op=await action(1,{action:'inventory',ig:'main',price:'1',items:[{id:'a',revision:String(before.revision),state:{wh:before.wh-1}}]});
 const row=(await db.query('select shortage_g from public.inv_log where operation_id=$1',[op.operation_id])).rows[0];assert.equal(Number(row.shortage_g),100);assert.notEqual(Number(row.shortage_g),150);
 findings.push('inventory ignores venue package weight');
});
await test('old direct catalog editor updates no shared row under production restrictive RLS',async()=>{
 const r=await asUser(1,tx=>tx.query("update public.flavors set strength=7 where id='a' returning id"));assert.equal(r.rows.length,0);
 const r2=await asUser(1,tx=>tx.query("select pack_g from public.flavor_packs where venue_id=$1 and flavor_id='a'",[V]));assert.equal(r2.rows[0].pack_g,150);
 findings.push('PR75 catalog adapter incompatible with venue-owned settings');
});
console.log(JSON.stringify({probes_passed:count,release_compatible:false,guard_verified:true,catalog_sha256:createHash('sha256').update(fs.readFileSync('tests/fixtures/b5-production-catalog.json')).digest('hex'),findings},null,2));
await db.close();
