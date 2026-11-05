import fs from 'node:fs';
import assert from 'node:assert/strict';
import {localPostgres} from './local-postgres.mjs';

const pg=await localPostgres();
const venue=crypto.randomUUID(),foreign=crypto.randomUUID();
try {
  const admin=await pg.connect(),first=await pg.connect(),second=await pg.connect();
  for(const fixture of ['stock-baseline','access-baseline']) {
    await admin.query(fs.readFileSync('tests/fixtures/'+fixture+'.sql','utf8'));
  }
  for(const migration of fs.readdirSync('supabase/migrations').sort()) {
    await admin.query(fs.readFileSync('supabase/migrations/'+migration,'utf8'));
  }
  await admin.query('insert into venues values($1),($2)',[venue,foreign]);
  await admin.query("insert into flavors(id,brand,name,custom,venue_id) values('shared','QA','Shared',false,null),('own','QA','Own',true,$1),('foreign','QA','Foreign',true,$2)",[venue,foreign]);
  await admin.query("insert into favorites(id) values('existing-synthetic')");
  await first.query('set role anon');
  await second.query('set role anon');
  for(const connection of [first,second]) {
    await assert.rejects(connection.query('select * from favorites'),{code:'42501'});
    await assert.rejects(connection.query("update favorites set id='tampered'"),{code:'42501'});
    await assert.rejects(connection.query('delete from favorites'),{code:'42501'});
    assert.deepEqual((await connection.query("select id from flavors where id in ('shared','own','foreign') order by id")).rows,[{id:'shared'}]);
  }
  assert.deepEqual((await admin.query('select * from favorites')).rows,[{id:'existing-synthetic'}]);
  console.log('PASS legacy favorites retained without guest access and private flavors hidden');

  await admin.query('create trigger wishes_limit_t before insert on wishes for each row execute function wishes_limit()');
  const wish=(connection,flavor,device,id='shared')=>connection.query(
    'insert into wishes(venue_id,flavor_id,brand,flavor,device) values($1,$2,$3,$4,$5)',
    [venue,id,'QA',flavor,device]);
  await assert.rejects(first.query("insert into wishes(venue_id,brand,flavor,device,created_at) values($1,'QA','backdated','device-qa','2000-01-01')",[venue]),{code:'42501'});
  await assert.rejects(wish(first,'foreign','device-qa','foreign'),/wish_flavor_scope/);
  await first.query("insert into wishes(venue_id,brand,flavor,device) select $1,'QA','before-'||g,'device-qa' from generate_series(1,9)g",[venue]);
  const deviceRace=await Promise.allSettled([wish(first,'race-a','device-qa'),wish(second,'race-b','device-qa')]);
  assert.equal(deviceRace.filter(x=>x.status==='fulfilled').length,1);
  assert.match(deviceRace.find(x=>x.status==='rejected').reason.message,/wish_limit/);
  assert.equal((await admin.query('select count(*)::int n from wishes where venue_id=$1',[venue])).rows[0].n,10);
  await admin.query("insert into wishes(venue_id,brand,flavor,device) select $1,'QA','capacity-'||g,'device-'||g from generate_series(1,89)g",[venue]);
  const venueRace=await Promise.allSettled([wish(first,'last-a','fresh-device-a'),wish(second,'last-b','fresh-device-b')]);
  assert.equal(venueRace.filter(x=>x.status==='fulfilled').length,1);
  assert.match(venueRace.find(x=>x.status==='rejected').reason.message,/wish_limit/);
  assert.equal((await admin.query('select count(*)::int n from wishes where venue_id=$1',[venue])).rows[0].n,100);
  await assert.rejects(first.query('select * from wishes'),{code:'42501'});
  await second.query("insert into wishes(venue_id,flavor_id,brand,flavor,device) values($1,'foreign','QA','separate','device-qa')",[foreign]);
  console.log('PASS concurrent device and venue budgets, protected time, flavor scope and separate venue');

  await admin.query("insert into stock(venue_id,flavor_id,wh,bar,stop) values($1,'shared',1,true,false),($1,'own',1,true,true),($1,'foreign',1,false,false)",[venue]);
  await admin.query("insert into mixes(id,venue_id,title,note,by_name,in_karta,hidden) values('published',$1,'Published','Public note','Private author',true,false),('hidden',$1,'Hidden','','Private author',true,true),('private',$1,'Private','','Private author',false,false)",[venue]);
  await admin.query('grant select on public_stock,public_mixes to anon');
  assert.deepEqual((await first.query('select flavor_id from public_stock where venue_id=$1',[venue])).rows,[{flavor_id:'shared'}]);
  assert.deepEqual((await first.query('select title,note,by_name from public_mixes where venue_id=$1',[venue])).rows,[{title:'Published',note:'Public note',by_name:null}]);
  console.log('PASS public card projection excludes hidden content and employee name');
} finally {
  await pg.close();
}
