"""Catalog-only native probes. Creates/drops ONLY a fresh runner-loopback test DB.
A passing probe reproduces a known release incompatibility, not release readiness.
"""
import json, os, pathlib, subprocess, unittest, uuid
import psycopg as pg
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from psycopg.types.json import Jsonb
URL=os.environ.get('B5_TEST_DATABASE_URL','')
V='00000000-0000-4000-8000-000000000001'
W='00000000-0000-4000-8000-000000000002'
NAME='mixora_b5_test_catalog_'+uuid.uuid4().hex[:10]
class Compatibility(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  config=conninfo_to_dict(URL)
  if os.environ.get('B5_ALLOW_TEST_DATABASE')!='YES' or config.get('host') not in ('127.0.0.1','localhost') or not config.get('dbname','').startswith('mixora_b5_test'):
   raise RuntimeError('Refusing non-loopback/non-test database')
  cls.fixture=subprocess.check_output(['node','tests/b5-wasm/production-compat.mjs','--emit-fixture'],text=True)
  cls.proposal=pathlib.Path('supabase/b5_atomic_stock_PROPOSAL.sql').read_text()
  import re
  cls.unsafe_overlay=re.sub(r'do \$production_compatibility\$[\s\S]*?\$production_compatibility\$;','',cls.proposal)
  cls.conninfo=make_conninfo(URL,dbname=NAME)
  with pg.connect(URL,autocommit=True) as admin:admin.execute(pg.sql.SQL('create database {}').format(pg.sql.Identifier(NAME)))
  cls.addClassCleanup(cls.drop_test_database)
 @classmethod
 def drop_test_database(cls):
  with pg.connect(URL,autocommit=True) as admin:admin.execute(pg.sql.SQL('drop database {}').format(pg.sql.Identifier(NAME)))
 def setUp(self):
  # Runner-created disposable DB only; never the source database.
  with pg.connect(self.conninfo,autocommit=True) as c:
   c.execute('drop schema if exists mixora_internal cascade;drop schema if exists mixora_private cascade;drop schema public cascade;create schema public')
   # anon/authenticated already exist in the service cluster from the original suite.
   fixture=self.fixture.replace('create role anon;','').replace('create role authenticated;','').replace('create role service_role bypassrls;',"do $$begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end$$;")
   c.execute(fixture)
   c.execute("insert into public.venues(id,name) values(%s,'Test'),(%s,'Other')",(V,W))
   c.execute("insert into public.users(tg_id,venue_id,name,role,perms) values(1,%s,'Manager','manager','{}'),(2,%s,'Legacy master','master','{}'),(3,%s,'Other','manager','{}')",(V,V,W))
   c.execute("update public.users set role='master' where tg_id=2")
   c.execute("insert into public.flavors(id,brand,name,pack_g) values('a','Test','A',100),('b','Test','B',100)")
   c.execute("insert into public.stock(venue_id,flavor_id,wh,revision) values(%s,'a',10,7),(%s,'b',10,99)",(V,V))
   c.execute("insert into public.flavor_packs values(%s,'a',150)",(V,))
 def overlay(self):
  with pg.connect(self.conninfo,autocommit=True) as c:c.execute(type(self).unsafe_overlay)
 def user_sql(self,tg,sql,params=()):
  with pg.connect(self.conninfo) as c:
   c.execute('set local role authenticated');c.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(role='authenticated',sub=str(tg),tg_id=str(tg))),))
   return c.execute(sql,params).fetchall()
 def stock(self):
  with pg.connect(self.conninfo) as c:return c.execute("select wh,bar,stop,stop_auto,revision from public.stock where venue_id=%s and flavor_id='a'",(V,)).fetchone()
 def legacy(self,tg,revision,wh):
  return self.user_sql(tg,'select public.apply_stock(%s,%s)',(uuid.uuid4(),Jsonb([dict(id='a',revision=revision,kind='in',doc=dict(wh=wh,bar=False,stop=True,stopAuto=True))])))[0][0]
 def test_baseline_uniform_staff_and_revision(self):
  result=self.legacy(2,7,11);row=self.stock();self.assertEqual(result[0]['doc']['revision'],row[4]);self.assertEqual(row[2:4],(True,True))
 def test_baseline_venue_rls(self):self.assertEqual(self.user_sql(3,'select * from public.stock where venue_id=%s',(V,)),[])
 def test_guard_is_atomic_and_rejects_before_changes(self):
  before=self.stock()
  with self.assertRaises(pg.Error) as error:
   with pg.connect(self.conninfo,autocommit=True) as c:c.execute(self.proposal)
  self.assertEqual(error.exception.sqlstate,'0A000');self.assertEqual(before,self.stock())
  with pg.connect(self.conninfo) as c:self.assertIsNone(c.execute("select to_regclass('mixora_internal.stock_operations')").fetchone()[0])
 def test_historical_overlay_does_not_reconcile_integer_sequence(self):
  self.overlay()
  with pg.connect(self.conninfo) as c:
   self.assertEqual(c.execute("select data_type from information_schema.columns where table_name='stock' and column_name='revision'").fetchone()[0],'integer')
   self.assertLess(c.execute('select last_value from mixora_internal.stock_revision_seq').fetchone()[0],99)
 def test_historical_overlay_keeps_both_protocols_callable(self):
  self.overlay()
  with pg.connect(self.conninfo) as c:
   for sig in ['public.apply_stock(uuid,jsonb)','mixora_private.apply_stock(uuid,jsonb)']:
    self.assertTrue(c.execute("select has_function_privilege('authenticated',%s,'EXECUTE')",(sig,)).fetchone()[0])
 def test_historical_overlay_breaks_legacy_response_and_retry(self):
  self.overlay();result=self.legacy(2,7,11);self.assertNotEqual(result[0]['doc']['revision'],self.stock()[4])
  with self.assertRaises(pg.Error) as error:self.legacy(2,result[0]['doc']['revision'],12)
  self.assertEqual(str(error.exception).splitlines()[0],'stock_stale_revision')
 def test_historical_overlay_reintroduces_role_denial(self):
  self.overlay()
  request=dict(action='change',items=[dict(id='a',revision=str(self.stock()[4]),state=dict(wh=11))])
  with self.assertRaises(pg.Error) as error:
   self.user_sql(2,'select public.mixora_stock_action(%s,%s)',(uuid.uuid4(),Jsonb(request)))
  self.assertEqual(error.exception.sqlstate,'42501')
 def test_historical_overlay_receipt_clears_stop(self):
  self.overlay()
  with pg.connect(self.conninfo,autocommit=True) as c:c.execute("update public.stock set stop=true,stop_auto=true where flavor_id='a'")
  self.user_sql(1,'select public.mixora_commit_stock_batch(%s,%s)',(uuid.uuid4(),Jsonb([dict(id='a',delta=1,expected_wh=10)])))
  self.assertFalse(self.stock()[2])
 def test_historical_overlay_ignores_venue_weight(self):
  self.overlay();request=dict(action='inventory',ig='main',price='1',items=[dict(id='a',revision=str(self.stock()[4]),state=dict(wh=9))])
  # Fix structure is explicit to keep the synthetic request separate from production data.
  result=self.user_sql(1,'select public.mixora_stock_action(%s,%s)',(uuid.uuid4(),Jsonb(request)))[0][0]
  with pg.connect(self.conninfo) as c:self.assertEqual(c.execute('select shortage_g from public.inv_log where operation_id=%s',(result['operation_id'],)).fetchone()[0],100)
 def test_historical_overlay_catalog_editor_is_incompatible(self):
  self.overlay();self.assertEqual(self.user_sql(1,"update public.flavors set strength=7 where id='a' returning id"),[])
  self.assertEqual(self.user_sql(1,"select pack_g from public.flavor_packs where venue_id=%s and flavor_id='a'",(V,))[0][0],150)
if __name__=='__main__':unittest.main(verbosity=2)
