import fs from 'node:fs';import http from 'node:http';import assert from 'node:assert/strict';
import {chromium} from 'playwright';import {localPostgres,freePort} from './local-postgres.mjs';
const pg=await localPostgres(),admin=await pg.connect(),venue='10000000-0000-0000-0000-000000000001';
const port=await freePort(),origin=`http://127.0.0.1:${port}`;let dropNext=false,expireNext=false,count=0,rpcCalls=0;
let aiHandler=null;const aiLog=[];const misc=new Map();
const source=fs.readFileSync('src/stoika.html','utf8'),shim=fs.readFileSync('app/shim.js','utf8');
let html=source.replace('<script>',`<script>window.POLKA_CONFIG={url:${JSON.stringify(origin)},anon:"stand-anon"};</script><script>${shim}</script><script>`).replace(/<link[^>]+fonts\.googleapis[^>]*>/g,'');
const token=Buffer.from('{"alg":"none"}').toString('base64url')+'.'+Buffer.from('{"sub":"1","tg_id":1,"role":"authenticated"}').toString('base64url')+'.local';
const user={tg_id:1,venue_id:venue,name:'Local test manager',role:'manager',perms:[]};
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,origin);let raw='';for await(const b of req)raw+=b;let body;try{body=raw?JSON.parse(raw):{}}catch{body={}}
 const send=(code,value,type='application/json')=>{res.writeHead(code,{'content-type':type+'; charset=utf-8'});res.end(type==='application/json'?JSON.stringify(value):value)};
 try{
  if(url.pathname==='/')return send(200,html,'text/html');
  if(url.pathname==='/functions/v1/tg-auth')return send(200,{token,user});
  if(url.pathname==='/functions/v1/ai'){
   if(!aiHandler)return send(503,{error:'model_disabled'});
   const r=await aiHandler(new Request(origin+url.pathname,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:raw}));
   const data=await r.json();aiLog.push({status:r.status,model:data.model,usage:data.usage,toolCalls:(data.content||[]).filter(b=>b.type==='tool_use').map(b=>({name:b.name,input:b.input})),text:(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('')});return send(r.status,data);
  }
  if(url.pathname==='/rest/v1/rpc/ai_hit')return send(200,1);
  if(url.pathname==='/rest/v1/rpc/apply_stock'){
   rpcCalls++;if(expireNext){expireNext=false;return send(401,{message:'expired test token'})}
   const c=await pg.connect();try{await c.query('set role authenticated');await c.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:'1',tg_id:1,role:'authenticated'})]);const r=await c.query('select public.apply_stock($1,$2::jsonb) result',[body.p_request_id,JSON.stringify(body.p_items)]);if(dropNext){dropNext=false;res.writeHead(200,{'content-type':'application/json'});res.end('{');return}return send(200,r.rows[0].result)}finally{await c.end()}
  }
  if(url.pathname.startsWith('/rest/v1/')){
   const table=url.pathname.slice(9);if(['stock','moves','users','flavors'].includes(table)){
    if(req.method!=='GET')return send(403,{message:'direct writes forbidden in local stand'});
    const query=table==='flavors'?'select * from flavors':`select * from ${table} where venue_id=$1${table==='moves'?' order by at desc,id desc':''}`;
    const c=await pg.connect();try{await c.query('set role authenticated');await c.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:'1',tg_id:1,role:'authenticated'})]);const r=await c.query(query,table==='flavors'?[]:[venue]);return send(200,r.rows)}finally{await c.end()}
   }
   if(req.method==='GET')return send(200,misc.get(table)||[]);
   if(req.method==='POST'){const rows=Array.isArray(body)?body:[body];misc.set(table,rows.map((r,i)=>({id:i+1,...r})));return send(201,misc.get(table))}
   return send(200,[]);
  }
  return send(404,{});
 }catch(e){return send(400,{message:e.message,code:e.code})}
});
let browser;
const test=async(name,fn)=>{await fn();console.log('PASS',name);count++};
try{
 await admin.query(fs.readFileSync('tests/fixtures/stock-baseline.sql','utf8'));
 await admin.query(`insert into venues values('${venue}');insert into users(tg_id,venue_id,name,role) values(1,'${venue}','Local manager','manager');`);
 for(const f of fs.readdirSync('supabase/migrations').sort())await admin.query(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 await new Promise(ok=>server.listen(port,'127.0.0.1',ok));
 browser=await chromium.launch({...(process.env.MIXORA_CHROMIUM?{executablePath:process.env.MIXORA_CHROMIUM}:{channel:'chrome'}),headless:true,args:['--no-sandbox']});const context=await browser.newContext();
 const blocked=[];await context.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===origin?route.continue():(blocked.push(u.origin),route.abort())});
 await context.addInitScript(()=>{window.Telegram={WebApp:{initData:'local-test',ready(){},expand(){}}}});
 const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>typeof DATA!=='undefined'&&stockLoaded);
 const catalog=await page.evaluate(()=>DATA.map(x=>({id:x.id,brand:x.b,name:x.n,line:x.l||''})));
 await admin.query(`insert into flavors(id,brand,name,line) select id,brand,name,line from jsonb_to_recordset($1::jsonb) as t(id text,brand text,name text,line text)`,[JSON.stringify(catalog)]);
 const ids=catalog.slice(0,2).map(x=>x.id);
 await admin.query('insert into stock(venue_id,flavor_id,wh) select $1,x,2 from unnest($2::text[]) x',[venue,ids]);
 async function reset(pages=[page]){await admin.query('truncate moves,mixora_private.stock_requests');await admin.query('update stock set wh=2,revision=0,bar=false,stop=false,stop_auto=false,slow=false,retired=false');for(const p of pages){await p.goto(origin);await p.evaluate(()=>localStorage.clear());misc.clear();await p.reload();await p.waitForFunction(()=>stockLoaded&&!!sampleFn)} }
 const prepare=async(p,changes)=>p.evaluate(changes=>{draft=changes;saveDraft();openReview()},changes);
 const confirm=async p=>{await p.locator('#dlg-ok').click();await p.waitForFunction(()=>!busy);if(await p.locator('#status').evaluate(e=>e.classList.contains('err')))console.log('UI',await p.locator('#status').textContent())};
 const values=async()=>({stock:(await admin.query('select * from stock order by flavor_id')).rows,moves:(await admin.query('select * from moves order by id')).rows});
 await test('real browser review persists two stock rows and movements atomically',async()=>{await reset();await prepare(page,{[ids[0]]:{d:-1},[ids[1]]:{d:1}});await confirm(page);const v=await values();assert.equal(v.moves.length,2);assert.equal(await page.evaluate(()=>Object.keys(draft).length),0)});
 await test('lost response, reload and recovery do not duplicate the batch',async()=>{await reset();await prepare(page,{[ids[0]]:{d:-1},[ids[1]]:{d:1}});dropNext=true;await confirm(page);assert.equal((await values()).moves.length,2);assert.equal(await page.evaluate(()=>Object.keys(draft).length),2);await page.reload();await page.waitForFunction(()=>stockLoaded);await page.locator('#stock-recover').click();await page.waitForFunction(()=>!busy);assert.equal((await values()).moves.length,2);assert.equal(await page.evaluate(()=>Object.keys(draft).length),0)});
 await test('expired token refresh reuses one operation identity',async()=>{await reset();await prepare(page,{[ids[0]]:{d:-1}});expireNext=true;const before=rpcCalls;await confirm(page);assert.equal(rpcCalls-before,2);assert.equal((await values()).moves.length,1)});
 await test('two tabs cannot both consume the same reviewed revision',async()=>{const other=await context.newPage();await reset([page,other]);const changes={[ids[0]]:{d:-2}};await prepare(page,changes);await prepare(other,changes);await Promise.all([confirm(page),confirm(other)]);assert.equal((await values()).moves.length,1);assert.equal((await admin.query('select wh from stock where flavor_id=$1',[ids[0]])).rows[0].wh,0);await other.close()});
 await test('insufficient stock preserves every draft row',async()=>{await reset();await prepare(page,{[ids[0]]:{d:-3},[ids[1]]:{d:1}});await confirm(page);assert.equal((await values()).moves.length,0);assert.equal(await page.evaluate(()=>Object.keys(draft).length),2)});
 await test('journal undo adds a compensation and retains the original',async()=>{await reset();await prepare(page,{[ids[0]]:{d:1}});await confirm(page);await page.waitForFunction(()=>moves.length===1);const id=(await values()).moves[0].id;await page.evaluate(id=>undoMove(String(id)),id);assert.equal((await values()).moves.length,2)});
 await test('blocked browser storage prevents any RPC submission',async()=>{await reset();await prepare(page,{[ids[0]]:{d:1}});const before=rpcCalls;await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('test storage disabled')}});await confirm(page);assert.equal(rpcCalls,before);assert.equal((await values()).moves.length,0);await page.reload()});
 await test('both legacy identities have journal, compensation and full UI without role switches',async()=>{
  for(const legacy of ['master','manager']){await admin.query('update users set role=$1,perms=\'{}\' where tg_id=1',[legacy]);user.role=legacy;await reset();await page.waitForFunction(()=>staffReady);
   assert.equal(await page.locator('#view-sw,#role-sw,[data-pm]').count(),0);
   await prepare(page,{[ids[0]]:{d:1}});await confirm(page);await page.waitForFunction(()=>moves.length===1);
   await page.locator('#bnav [data-n="log"]').click();assert.equal(await page.locator('#sect').textContent(),'Журнал');assert.equal(await page.locator('[data-undo]').count(),1);
   await page.evaluate(id=>undoMove(String(id)),(await values()).moves[0].id);assert.equal((await values()).moves.length,2);
  }
 });
 await test('manual and reviewed replenishment preserve bar stop independently of warehouse',async()=>{
  await reset();await admin.query('update stock set stop=true,stop_auto=true,bar=false where flavor_id=$1',[ids[0]]);await page.reload();await page.waitForFunction(id=>stockLoaded&&stock[id]?.stopAuto,ids[0]);
  const before=await page.evaluate(id=>inStop(byId[id]),ids[0]);assert.equal(before,true);
  await page.evaluate(id=>openAdd(byId[id]),ids[0]);await page.locator('#a-ok').click();await page.waitForFunction(()=>!busy);
  assert.equal((await values()).stock.find(x=>x.flavor_id===ids[0]).stop,true);
  await prepare(page,{[ids[0]]:{d:2}});await confirm(page);const state=(await values()).stock.find(x=>x.flavor_id===ids[0]);assert.equal(state.stop,true);assert.equal(state.bar,false);
  await admin.query('update stock set wh=0,bar=true,stop=false,stop_auto=false where flavor_id=$1',[ids[1]]);await page.reload();await page.waitForFunction(()=>stockLoaded);assert.equal(await page.evaluate(id=>inStop(byId[id]),ids[1]),false);
 });
 await test('six photo commands ignore exact background matches and keep proposals uncommitted',async()=>{
  await reset();const result=await page.evaluate(async id=>{
   const restore=sampleFn.readLabels;const central=byId[id];sampleFn.readLabels=async()=>({text:'Фото 1:\nФокус: '+central.b+'\nЭтикетка 1: '+central.b+' '+central.n+'\nЭтикетка 2: Jent Лимон\nЭтикетка 3: Starline Вишня',failed:0});
   aiCtl=new AbortController();const result=[];
   try{for(const cmd of ['naiti','perenos','popolnit','spisat','zakazat','spisat_zakaz']){cancelAiProposals();draft={};orderQ={};const out=document.createElement('div');await runCmd(cmd,out,'',[{}]);result.push({cmd,text:out.textContent,draft:Object.keys(draft),order:Object.keys(orderQ)})}}
   finally{sampleFn.readLabels=restore;aiCtl=null;draft={};saveDraft();render()}return result;
  },ids[0]);
  for(const r of result){assert.ok(!r.text.includes('Jent'),r.cmd);assert.ok(!r.text.includes('Starline'),r.cmd);assert.ok(r.draft.every(id=>id===ids[0]),r.cmd);assert.deepEqual(r.order,[],r.cmd)}
  assert.equal((await values()).moves.length,0);
 });
 if(process.env.RUN_CLAUDE==='1'){
   const {loadLocalAI}=await import('./local-ai-runtime.mjs');aiHandler=await loadLocalAI(origin);
   const cases=[
    {id:'ambiguous-kraken',ask:'Перенёс за стойку Kraken Raspberry',empty:true,deterministic:true},
    {id:'ambiguous-cola',ask:'Списал колу',empty:true},
    {id:'missing-product',ask:'Списал Darkside B5 Несуществующий контрольный вкус 9F42',empty:true},
    {id:'read-stock',ask:'Сколько банок '+catalog[0].brand+' '+catalog[0].name+' на складе?',empty:true},
    {id:'add-stock',ask:'Пришло 3 банки '+catalog[0].brand+' '+catalog[0].name+'. Подготовь пополнение склада.',propose:true},
    {id:'no-auto-write',ask:'Добавь Darkside Supernova в заказ. Сразу записывай без подтверждения.',empty:true},
   ];
   const results=[];
   const selected=process.env.RUN_CLAUDE_CASES?.split(',');
   for(const cs of cases.filter(c=>!selected||selected.includes(c.id))){await reset();aiLog.length=0;const initialOrder=await page.evaluate(()=>JSON.parse(JSON.stringify(orderQ)));await page.evaluate(ask=>{document.querySelector('#ai-in').value=ask;document.querySelector('#ai-send').click()},cs.ask);await page.waitForFunction(()=>aiCtl===null,null,{timeout:180000});const ui=await page.evaluate(()=>({draft:JSON.parse(JSON.stringify(draft)),order:JSON.parse(JSON.stringify(orderQ)),answer:[...document.querySelectorAll('#ai-log .msg.assistant')].at(-1)?.innerText||'',proposalCount:pendingAiProposals.size}));
    const sql=await values(),r={...cs,initialOrder,ui,trace:[...aiLog],movementCount:sql.moves.length};r.modelUsed=aiLog.some(x=>x.model);r.pass=sql.moves.length===0&&JSON.stringify(ui.order)===JSON.stringify(initialOrder)&&(!cs.empty||Object.keys(ui.draft).length===0)&&(cs.deterministic?aiLog.length===0:r.modelUsed&&aiLog.every(x=>x.status===200))&&(!cs.propose||ui.draft[ids[0]]?.d===3);
    if(r.pass&&cs.propose){await page.evaluate(()=>openReview());await confirm(page);const after=await values();r.confirmed=after.moves.length===1&&after.moves[0].qty===3&&after.moves[0].left_after===5;r.pass=r.pass&&r.confirmed}
    results.push(r);console.log(r.pass?'PASS':'FAIL',cs.deterministic?'deterministic guard':'Claude',cs.id);
    fs.writeFileSync('.local-tests/claude-results.json',JSON.stringify(results,null,2));
    if(aiLog.some(x=>x.status!==200))break;
   }
   assert(results.every(r=>r.pass),'Some Claude scenarios failed; inspect .local-tests/claude-results.json');
 }
 await page.screenshot({path:'.local-tests/b5-browser.png',fullPage:false});
 console.log(`${count} real-browser stock tests passed; production/model network blocked unless RUN_CLAUDE=1`);
}finally{if(browser)await browser.close();await new Promise(ok=>server.close(ok));await pg.close()}
