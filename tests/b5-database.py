"""Destructive fixture, ONLY a disposable database explicitly approved by owner.
No production URL accepted. Run with B5_TEST_DATABASE_URL, B5_ALLOW_TEST_DATABASE=YES.
Requires psycopg 3. Creates fixture in an EMPTY database named mixora_b5_test*.
This fixture does not establish compatibility with production triggers/RLS/baseline.
"""
import os, unittest, uuid, pathlib
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
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
   c.execute('truncate public.users,public.flavors,public.stock,public.moves,mixora_internal.stock_operations restart identity')
   c.execute("insert into public.users values(1,%s,'manager','{}'),(2,%s,'manager','{}'),(3,%s,'master',NULL),(4,%s,'manager','{}')",(V,V,V,W))
   c.execute("insert into public.flavors values('a',null),('b',null),('c',null),('foreign',%s)",(W,))
   c.execute("insert into public.stock values(%s,'a',10,false,false,false),(%s,'b',10,false,false,false),(%s,'c',1,false,false,false)",(V,V,V))
 def call(self,key,items,tg=1,barrier=None):
  from psycopg.types.json import Jsonb
  with pg.connect(URL) as c:
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
 def test_legacy_trigger_automatic_stop(self):
  with pg.connect(URL,autocommit=True) as c:
   c.execute("update public.users set perms=ARRAY['add'] where tg_id=3")
   c.execute("update public.stock set wh=0,stop=true,stop_auto=true where flavor_id='a'")
  self.call(uuid.uuid4(),[dict(id='a',delta=1,expected_wh=0)],3)
  with pg.connect(URL) as c:
   self.assertEqual(c.execute("select wh,stop,stop_auto from public.stock where flavor_id='a'").fetchone(),(1,False,False))
  with pg.connect(URL,autocommit=True) as c:c.execute("update public.stock set stop=true,stop_auto=false where flavor_id='a'")
  self.call(uuid.uuid4(),[dict(id='a',delta=1,expected_wh=1)],3)
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
if __name__=='__main__':
 if not(URL and APPROVED):
  print('NOT RUN: explicit permission and disposable test database required')
  raise SystemExit(2)
 unittest.main(verbosity=2)
