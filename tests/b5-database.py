"""Destructive fixture, ONLY a disposable database explicitly approved by owner.
No production URL accepted. Run with B5_TEST_DATABASE_URL, B5_ALLOW_TEST_DATABASE=YES.
Requires psycopg 3. Creates fixture in an EMPTY database named mixora_b5_test*.
This fixture does not establish compatibility with production triggers/RLS/baseline.
"""
import os, unittest, uuid, pathlib
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from time import monotonic
URL=os.environ.get('B5_TEST_DATABASE_URL')
APPROVED=os.environ.get('B5_ALLOW_TEST_DATABASE')=='YES'
V='00000000-0000-4000-8000-000000000001'
W='00000000-0000-4000-8000-000000000002'
@unittest.skipUnless(URL and APPROVED,'NOT RUN: explicit permission and disposable test database required')
class Database(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  global pg
  import psycopg as pg
  with pg.connect(URL,autocommit=True) as c:
   name=c.execute('select current_database()').fetchone()[0]
   if not name.startswith('mixora_b5_test'): raise RuntimeError('Refusing non-test database')
   if c.execute("select count(*) from information_schema.tables where table_schema='public'").fetchone()[0]:raise RuntimeError('Refusing non-empty database')
   c.execute(pathlib.Path('tests/fixtures/b5-minimal.sql').read_text())
   legacy=pathlib.Path('supabase/migrations_003.sql').read_text()
   c.execute(legacy[legacy.index('create or replace function enforce_master_stock()'):])
   c.execute(pathlib.Path('supabase/b5_atomic_stock_PROPOSAL.sql').read_text())
 def setUp(self):
  with pg.connect(URL,autocommit=True) as c:
   c.execute('truncate public.users,public.flavors,public.stock,public.moves,public.inv_log,mixora_internal.stock_operations,mixora_internal.stock_effects,mixora_internal.stock_reversals restart identity')
   c.execute("insert into public.users values(1,%s,'manager','{}'),(2,%s,'manager','{}'),(3,%s,'master',NULL),(4,%s,'manager','{}')",(V,V,V,W))
   c.execute("insert into public.flavors(id,venue_id) values('a',null),('b',null),('c',null),('foreign',%s)",(W,))
   c.execute("insert into public.stock values(%s,'a',10,false,false,false),(%s,'b',10,false,false,false),(%s,'c',1,false,false,false)",(V,V,V))
 def call(self,key,items,tg=1,barrier=None):
  from psycopg.types.json import Jsonb
  with pg.connect(URL,application_name="mixora-b5-test-rpc") as c:
   c.execute("set local statement_timeout='10s'");c.execute("set local lock_timeout='5s'")
   c.execute('set local role authenticated');c.execute("select set_config('test.tg',%s,true)",(str(tg),))
   if barrier:barrier.wait(timeout=10)
   return c.execute('select public.mixora_commit_stock_batch(%s,%s)',(key,Jsonb(items))).fetchone()[0]
 def state(self):
  with pg.connect(URL) as c:return (c.execute('select flavor_id,wh,bar from public.stock order by flavor_id').fetchall(),c.execute('select count(*) from public.moves').fetchone()[0])
 def error(self,code,fn):
  with self.assertRaises(pg.Error) as e:fn()
  self.assertEqual(e.exception.sqlstate,code)
 def test_1_null_permissions(self):
  for perms in [None,[None]]:
   with pg.connect(URL,autocommit=True) as c:c.execute('update public.users set perms=%s where tg_id=3',(perms,))
   for delta in [-1,1]:self.error('42501',lambda:self.call(uuid.uuid4(),[dict(id='a',delta=delta,expected_wh=10)],3))
 def test_2_first_receipt(self):
  with pg.connect(URL,autocommit=True) as c:c.execute("delete from public.stock where flavor_id='a'")
  self.call(uuid.uuid4(),[dict(id='a',delta=5,expected_wh=0)])
  self.assertEqual(self.state()[0][0][1],5);self.assertEqual(self.state()[1],1)
 def test_3_null_bar(self):
  with pg.connect(URL,autocommit=True) as c:c.execute("update public.stock set bar=null where flavor_id='a'")
  self.call(uuid.uuid4(),[dict(id='a',delta=-1,expected_wh=10,bar=False,expected_bar=False)])
  self.assertEqual(self.state()[0][0][1],9)
  self.error('22023',lambda:self.call(uuid.uuid4(),[dict(id='a',delta=-1,expected_wh=9,bar=True)]))
  self.error('22023',lambda:self.call(uuid.uuid4(),[dict(id='a',delta=-1,expected_wh=9,expected_bar=True)]))
  self.error('22023',lambda:self.call(uuid.uuid4(),[dict(id='a',delta=-1,expected_wh=9,extra=True)]))
 def test_4_idempotency(self):
  key=uuid.uuid4();items=[dict(id='a',delta=-1,expected_wh=10)];barrier=Barrier(2)
  with ThreadPoolExecutor(2) as ex:
   futures=[ex.submit(self.call,key,items,1,barrier) for _ in range(2)];results=[f.result(timeout=20) for f in futures]
  self.assertEqual(results[0],results[1]);self.assertEqual(self.call(key,items),results[0]);self.assertEqual(self.state()[1],1)
  self.error('23505',lambda:self.call(key,[dict(id='a',delta=-2,expected_wh=10)]))
  self.error('23505',lambda:self.call(key,items,2))
 def test_5_atomic_rollback(self):
  before=self.state();key=uuid.uuid4()
  self.error('23514',lambda:self.call(key,[dict(id=x,delta=-2,expected_wh=1 if x=='c' else 10) for x in 'abc']))
  self.assertEqual(before,self.state())
  with pg.connect(URL) as c:self.assertEqual(c.execute('select count(*) from mixora_internal.stock_operations where operation_id=%s',(key,)).fetchone()[0],0)
 def test_6_concurrent_employees(self):
  barrier=Barrier(2)
  def work(tg):
   try:self.call(uuid.uuid4(),[dict(id='a',delta=-1,expected_wh=10)],tg,barrier);return 'ok'
   except pg.Error as e:return e.sqlstate
  with ThreadPoolExecutor(2) as ex:self.assertCountEqual(list(ex.map(work,[1,2])),['ok','40001'])
  self.assertEqual(self.state()[0][0][1],9);self.assertEqual(self.state()[1],1)
 def test_concurrent_revocation_and_flavor_transfer(self):
  for change,expected in [("update public.users set perms='{}' where tg_id=3",'42501'),("update public.flavors set venue_id='"+W+"' where id='a'",'22023')]:
   with pg.connect(URL,autocommit=True) as c:c.execute("update public.users set perms=ARRAY['take'] where tg_id=3")
   before=self.state()
   with pg.connect(URL) as blocker, ThreadPoolExecutor(1) as ex:
    blocker.execute(change)
    future=ex.submit(self.call,uuid.uuid4(),[dict(id='a',delta=-1,expected_wh=10)],3)
    try:
     deadline=monotonic()+5;blocked=False
     with pg.connect(URL,autocommit=True) as monitor:
      while monotonic()<deadline:
       blocked=monitor.execute("select exists(select 1 from pg_stat_activity where application_name='mixora-b5-test-rpc' and wait_event_type='Lock')").fetchone()[0]
       if blocked or future.done():break
       Event().wait(0.02)
     self.assertTrue(blocked,'RPC did not wait for authorization/catalog row lock')
     blocker.commit()
     self.error(expected,lambda:future.result(timeout=15))
    finally:blocker.rollback()
   self.assertEqual(self.state(),before)
 def test_legacy_trigger_automatic_stop(self):
  with pg.connect(URL,autocommit=True) as c:
   c.execute("update public.users set perms=ARRAY['add'] where tg_id=3")
   c.execute("update public.stock set wh=0,stop=true,stop_auto=true where flavor_id='a'")
  self.call(uuid.uuid4(),[dict(id='a',delta=1,expected_wh=0)],3)
  with pg.connect(URL) as c:
   self.assertEqual(c.execute("select wh,stop,stop_auto from public.stock where flavor_id='a'").fetchone(),(1,False,False))
  with pg.connect(URL,autocommit=True) as c:c.execute("update public.stock set bar=null where flavor_id='a'")
  self.call(uuid.uuid4(),[dict(id='a',delta=1,expected_wh=1,bar=False,expected_bar=False)],3)
  with pg.connect(URL,autocommit=True) as c:c.execute("update public.stock set stop=true,stop_auto=false where flavor_id='a'")
  self.call(uuid.uuid4(),[dict(id='a',delta=1,expected_wh=2)],3)
  with pg.connect(URL) as c:self.assertEqual(c.execute("select stop from public.stock where flavor_id='a'").fetchone()[0],True)
 def test_access_and_isolation(self):
  with pg.connect(URL) as c:
   for table,column,priv in [('stock','wh','UPDATE'),('stock','flavor_id','INSERT'),('moves','qty','UPDATE'),('moves','flavor_id','INSERT')]:
    self.assertFalse(c.execute('select has_column_privilege(%s,%s,%s,%s)',('authenticated','public.'+table,column,priv)).fetchone()[0])
  for sql in ["insert into public.stock values(null,'z',0,false,false,false)","update public.stock set wh=99","delete from public.moves","truncate public.stock"]:
   def direct():
    with pg.connect(URL) as c:c.execute('set local role authenticated');c.execute(sql)
   self.error('42501',direct)
  self.error('22023',lambda:self.call(uuid.uuid4(),[dict(id='foreign',delta=1,expected_wh=0)]))
  with pg.connect(URL,autocommit=True) as c:c.execute('update public.users set role=null where tg_id=3')
  self.error('42501',lambda:self.call(uuid.uuid4(),[dict(id='a',delta=-1,expected_wh=10)],3))
 def action(self,key,request,tg=1,barrier=None):
  from psycopg.types.json import Jsonb
  with pg.connect(URL,application_name='mixora-b5-test-action') as c:
   c.execute("set local statement_timeout='10s'");c.execute("set local lock_timeout='5s'")
   c.execute('set local role authenticated');c.execute("select set_config('test.tg',%s,true)",(str(tg),))
   if barrier:barrier.wait(timeout=10)
   return c.execute('select public.mixora_stock_action(%s,%s)',(key,Jsonb(request))).fetchone()[0]
 def patch(self,id,state):
  with pg.connect(URL) as c:r=c.execute('select revision from public.stock where flavor_id=%s and venue_id=%s',(id,V)).fetchone()
  return dict(id=id,revision=str(r[0] if r else 0),state=state,reason="Test adjustment")
 def test_action_permissions_and_flags(self):
  req=dict(action='change',items=[self.patch('a',dict(slow=True))])
  self.error('42501',lambda:self.action(uuid.uuid4(),req,3));self.action(uuid.uuid4(),req)
  self.error('40001',lambda:self.action(uuid.uuid4(),req))
  for state in [dict(stop_auto=True),dict(wh=-1),dict(bar=None)]:
   self.error('22023',lambda:self.action(uuid.uuid4(),dict(action='change',items=[self.patch('a',state)])))
  with pg.connect(URL,autocommit=True) as c:c.execute("update public.stock set wh=0,bar=true where flavor_id='a'")
  self.action(uuid.uuid4(),dict(action='finish',items=[self.patch('a',{})]))
  with pg.connect(URL) as c:self.assertEqual(c.execute("select bar,stop,stop_auto from public.stock where flavor_id='a'").fetchone(),(False,True,True))
 def test_action_parallel_replay_and_competing_updates(self):
  request=dict(action='change',items=[self.patch('a',dict(wh=8,bar=True))]);key=uuid.uuid4();barrier=Barrier(2)
  with ThreadPoolExecutor(2) as ex:
   results=[ex.submit(self.action,key,request,1,barrier) for _ in range(2)];self.assertEqual(results[0].result(timeout=20),results[1].result(timeout=20))
  self.assertEqual(self.state()[1],1)
  request=dict(action='change',items=[self.patch('a',dict(wh=7))]);barrier=Barrier(2)
  def worker(tg):
   try:self.action(uuid.uuid4(),request,tg,barrier);return 'ok'
   except pg.Error as e:return e.sqlstate
  with ThreadPoolExecutor(2) as ex:self.assertCountEqual(list(ex.map(worker,[1,2])),['ok','40001'])
 def test_undo_concurrent_once_history_and_aba(self):
  original=self.call(uuid.uuid4(),[dict(id='a',delta=-1,expected_wh=10)])['operation_id']
  req=dict(action='undo',original_id=original);barrier=Barrier(2)
  def worker(_):
   try:return self.action(uuid.uuid4(),req,1,barrier)
   except pg.Error as e:return e.sqlstate
  with ThreadPoolExecutor(2) as ex:results=list(ex.map(worker,[1,2]))
  self.assertEqual(sum(isinstance(r,dict) for r in results),1);self.assertIn('23505',results)
  self.assertEqual(self.state()[1],2);self.assertEqual(self.state()[0][0][1],10)
  self.error('42501',lambda:self.action(uuid.uuid4(),req,4));self.error('42501',lambda:self.action(uuid.uuid4(),req,3))
  original=self.action(uuid.uuid4(),dict(action='change',items=[self.patch('a',dict(wh=9))]))['operation_id']
  with pg.connect(URL,autocommit=True) as c:c.execute("update public.stock set wh=8 where flavor_id='a';update public.stock set wh=9 where flavor_id='a'")
  self.error('40001',lambda:self.action(uuid.uuid4(),dict(action='undo',original_id=original)))
 def test_undo_batch_atomic_rollback_and_replay(self):
  original=self.call(uuid.uuid4(),[dict(id=x,delta=-1,expected_wh=10) for x in ['a','b']])['operation_id']
  self.action(uuid.uuid4(),dict(action='change',items=[self.patch('b',dict(slow=True))]))
  before=self.state();self.error('40001',lambda:self.action(uuid.uuid4(),dict(action='undo',original_id=original)))
  self.assertEqual(before,self.state())
  original=self.action(uuid.uuid4(),dict(action='change',items=[self.patch('a',dict(wh=8))]))['operation_id']
  key=uuid.uuid4();req=dict(action='undo',original_id=original);result=self.action(key,req)
  self.assertEqual(self.action(key,req),result);self.error('23505',lambda:self.action(key,dict(action='undo',original_id=str(uuid.uuid4()))))
 def test_inventory_and_catalog_transaction(self):
  with pg.connect(URL,autocommit=True) as c:c.execute("update public.flavors set brand='Test',pack_g=100 where id in ('a','b')")
  req=dict(action='inventory',ig='main',price='2',items=[self.patch('a',dict(wh=8)),self.patch('b',dict(wh=7))]);req['items'][1]['revision']='0'
  before=self.state();self.error('40001',lambda:self.action(uuid.uuid4(),req));self.assertEqual(before,self.state())
  req['items'][1]=self.patch('b',dict(wh=7));op=self.action(uuid.uuid4(),req)
  with pg.connect(URL) as c:self.assertEqual(c.execute('select shortage_units,shortage_g,shortage_rub from public.inv_log where operation_id=%s',(op['operation_id'],)).fetchone(),(5,500,1000))
  self.action(uuid.uuid4(),dict(action='undo',original_id=op['operation_id']))
  with pg.connect(URL) as c:self.assertEqual(c.execute('select sum(shortage_units) from public.inv_log').fetchone()[0],0)
  req=dict(action='create',flavor=dict(brand='Test',name='New'),items=[dict(id='new',revision='0',state=dict(wh=3))]);key=uuid.uuid4()
  self.error('42501',lambda:self.action(key,req,3));result=self.action(key,req);self.assertEqual(result,self.action(key,req))
  req['items']=[dict(id='broken',revision='0',state=dict(wh=-1))];self.error('22023',lambda:self.action(uuid.uuid4(),req))
  with pg.connect(URL) as c:self.assertEqual(c.execute("select count(*) from public.flavors where id='broken'").fetchone()[0],0)
 def test_new_api_acl_and_history_view(self):
  with pg.connect(URL) as c:
   for privilege in ['INSERT','UPDATE','DELETE','TRUNCATE']:
    self.assertFalse(c.execute("select has_table_privilege('authenticated','public.inv_log',%s)",(privilege,)).fetchone()[0])
   self.assertFalse(c.execute("select has_function_privilege('anon','public.mixora_stock_action(uuid,jsonb)','EXECUTE')").fetchone()[0])
  op=self.call(uuid.uuid4(),[dict(id='a',delta=-1,expected_wh=10)])
  self.action(uuid.uuid4(),dict(action='undo',original_id=op['operation_id']))
  with pg.connect(URL) as c:
   self.assertEqual(c.execute('select compensated from public.mixora_stock_moves where operation_id=%s',(op['operation_id'],)).fetchone()[0],True)

 def test_review_null_undo_writeoff_unknown_weight_and_create_undo(self):
  with pg.connect(URL,autocommit=True) as c:
   c.execute("update public.stock set bar=null,stop=null,slow=null,retired=null where flavor_id='a'")
   c.execute("update public.users set perms=ARRAY['take'] where tg_id=3")
  self.error('42501',lambda:self.action(uuid.uuid4(),dict(action='change',items=[self.patch('a',dict(wh=9))]),3))
  self.error('42501',lambda:self.call(uuid.uuid4(),[dict(id='a',delta=-1,expected_wh=10)],3))
  op=self.action(uuid.uuid4(),dict(action='change',items=[self.patch('a',dict(bar=True,stop=True,slow=True))]))
  self.action(uuid.uuid4(),dict(action='undo',original_id=op['operation_id']))
  with pg.connect(URL) as c:self.assertEqual(c.execute("select bar,stop,slow,retired from public.stock where flavor_id='a'").fetchone(),(False,False,False,False))
  op=self.action(uuid.uuid4(),dict(action='inventory',ig='main',price='1',items=[self.patch('a',dict(wh=8))]))
  with pg.connect(URL) as c:self.assertEqual(c.execute('select unknown_weight_items from public.inv_log where operation_id=%s',(op['operation_id'],)).fetchone()[0],1)
  op=self.action(uuid.uuid4(),dict(action='create',flavor=dict(brand='Test',name='Soft undo'),items=[dict(id='undo-new',revision='0',state=dict(wh=2))]))
  self.action(uuid.uuid4(),dict(action='undo',original_id=op['operation_id']))
  with pg.connect(URL) as c:
   self.assertEqual(c.execute("select wh,retired from public.stock where flavor_id='undo-new'").fetchone(),(0,True))
   self.assertEqual(c.execute("select count(*) from public.flavors where id='undo-new'").fetchone()[0],1)

if __name__=='__main__':
 if not(URL and APPROVED):
  print('NOT RUN: explicit permission and disposable test database required')
  raise SystemExit(2)
 unittest.main(verbosity=2)
