import {testIdentity} from './test-identity.mjs';
import fs from 'node:fs';import http from 'node:http';import assert from 'node:assert/strict';
import {chromium} from 'playwright';import {localPostgres,freePort} from './local-postgres.mjs';
const pg=await localPostgres(),admin=await pg.connect(),venue='10000000-0000-0000-0000-000000000001';
const port=await freePort(),origin=`http://127.0.0.1:${port}`;let dropNext=false,expireNext=false,count=0,rpcCalls=0;
let aiHandler=null;const aiLog=[];const misc=new Map();
const source=fs.readFileSync('src/stoika.html','utf8'),shim=fs.readFileSync('app/shim.js','utf8');
let html=source.replace('<script>',`<script>window.POLKA_CONFIG={url:${JSON.stringify(origin)},anon:"stand-anon"};</script><script>${shim}</script><script>`).replace(/<link[^>]+fonts\.googleapis[^>]*>/g,'');
const token=Buffer.from('{"alg":"none"}').toString('base64url')+'.'+Buffer.from('{"sub":"1","tg_id":1,"role":"authenticated"}').toString('base64url')+'.local';
const user={tg_id:1,venue_id:venue,name:'Local test manager',role:'manager',perms:[]};
let dropOrderResponse=false;
const orderRequests=[];
async function orderQuery(sql,args){
 const c=await pg.connect();
 try{
  await c.query('set role authenticated');
  await c.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(await testIdentity(c,1))]);
  return (await c.query(sql,args)).rows;
 }finally{await c.end()}
}
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
  if(url.pathname==='/rest/v1/orders'&&req.method==='GET'){
   return send(200,await orderQuery('select items,revision from orders'));
  }
  if(url.pathname==='/rest/v1/rpc/apply_order'){
   orderRequests.push(body);
   const [row]=await orderQuery('select public.apply_order($1,$2,$3::jsonb) result',[body.p_venue_id,body.p_request_id,JSON.stringify(body.p_changes)]);
   if(dropOrderResponse){
    dropOrderResponse=false;
    res.writeHead(200,{'content-type':'application/json','content-length':'2'});
    res.write('{',()=>res.destroy());
    return;
   }
   return send(200,row.result);
  }
  if(url.pathname==='/rest/v1/rpc/apply_stock'){
   rpcCalls++;if(expireNext){expireNext=false;return send(401,{message:'expired test token'})}
   const c=await pg.connect();
   try{
    await c.query('set role authenticated');
    await c.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(await testIdentity(c,1))]);
    const r=await c.query('select public.apply_stock($1,$2::jsonb) result',[body.p_request_id,JSON.stringify(body.p_items)]);
    if(dropNext){
     dropNext=false;
     // Interrupt the HTTP response after PostgreSQL has committed the RPC.
     res.writeHead(200,{'content-type':'application/json','content-length':'2'});
     res.write('{',()=>res.destroy());
     return;
    }
    return send(200,r.rows[0].result);
   }finally{await c.end()}
  }
  if(url.pathname.startsWith('/rest/v1/')){
   const table=url.pathname.slice(9);if(['stock','moves','users','flavors'].includes(table)){
    if(req.method!=='GET')return send(403,{message:'direct writes forbidden in local stand'});
    const query=table==='flavors'?'select * from flavors':`select * from ${table} where venue_id=$1${table==='moves'?' order by at desc,id desc':''}`;
    const c=await pg.connect();try{await c.query('set role authenticated');await c.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(await testIdentity(c,1))]);const r=await c.query(query,table==='flavors'?[]:[venue]);return send(200,r.rows)}finally{await c.end()}
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
 await admin.query(fs.readFileSync('tests/fixtures/access-baseline.sql','utf8'));
 await admin.query(`insert into venues values('${venue}');insert into users(tg_id,venue_id,name,role) values(1,'${venue}','Local manager','manager');`);
 for(const f of fs.readdirSync('supabase/migrations').sort())await admin.query(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 await new Promise(ok=>server.listen(port,'127.0.0.1',ok));
 browser=await chromium.launch({...(process.env.MIXORA_CHROMIUM?{executablePath:process.env.MIXORA_CHROMIUM}:{channel:'chrome'}),headless:true,args:['--no-sandbox']});
 async function newContext(options){
  const ctx=await browser.newContext(options);
  await ctx.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await ctx.addInitScript(()=>{window.Telegram={WebApp:{initData:'local-test',ready(){},expand(){}}}});
  return ctx;
 }
 const context=await newContext();
 const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>typeof DATA!=='undefined'&&stockLoaded);
 const catalog=await page.evaluate(()=>DATA.map(x=>({id:x.id,brand:x.b,name:x.n,line:x.l||''})));
 await admin.query(`insert into flavors(id,brand,name,line) select id,brand,name,line from jsonb_to_recordset($1::jsonb) as t(id text,brand text,name text,line text)`,[JSON.stringify(catalog)]);
 const ids=catalog.slice(0,2).map(x=>x.id);
 await admin.query('insert into stock(venue_id,flavor_id,wh) select $1,x,2 from unnest($2::text[]) x',[venue,ids]);
 async function reset(pages=[page]){
  await Promise.all(pages.map(p=>p.goto('about:blank')));
  await admin.query('truncate moves,mixora_private.stock_requests,orders,mixora_private.order_requests');
  await admin.query('update stock set wh=2,revision=0,bar=false,stop=false,stop_auto=false,slow=false,retired=false');
  misc.clear();
  for(const p of pages){
   await p.goto(origin);
   await p.evaluate(()=>{localStorage.clear();sessionStorage.clear()});
   await p.reload();
   await p.waitForFunction(()=>stockLoaded&&!!sampleFn);
  }
 }
 const prepare=async(p,changes)=>p.evaluate(changes=>{draft=changes;saveDraft();openReview()},changes);
 const confirm=async p=>{await p.locator('#dlg-ok').click();await p.waitForFunction(()=>!busy);if(await p.locator('#status').evaluate(e=>e.classList.contains('err')))console.log('UI',await p.locator('#status').textContent())};
 const values=async()=>({stock:(await admin.query('select * from stock order by flavor_id')).rows,moves:(await admin.query('select * from moves order by id')).rows});
 await test('real browser review persists two stock rows and movements atomically',async()=>{await reset();await prepare(page,{[ids[0]]:{d:-1},[ids[1]]:{d:1}});await confirm(page);const v=await values();assert.equal(v.moves.length,2);assert.equal(await page.evaluate(()=>Object.keys(draft).length),0)});
 async function checkRecoveryOnHome(p,mobile=false){
  await reset([p]);
  const recovery=p.locator('#stock-recover');
  await p.locator('#home-screen').waitFor({state:'visible'});
  assert(await recovery.isHidden());
  assert(await p.locator('#stock-recovery').isHidden());
  assert.equal(await p.evaluate(()=>db.hasPendingStock()),false);
  await prepare(p,{[ids[0]]:{d:-1},[ids[1]]:{d:1}});
  const stockPost=r=>r.method()==='POST'&&new URL(r.url()).pathname==='/rest/v1/rpc/apply_stock';
  const first=p.waitForRequest(stockPost);
  dropNext=true;
  await confirm(p);
  const original=(await first).postDataJSON();
  const committed=await values();
  assert.equal(committed.moves.length,2);
  assert.deepEqual(ids.map(id=>committed.stock.find(row=>row.flavor_id===id).wh),[1,3]);
  assert.equal(await p.evaluate(()=>Object.keys(draft).length),2);
  await p.reload();
  await p.waitForFunction(()=>stockLoaded);
  await p.locator('#home-screen').waitFor({state:'visible'});
  assert.equal(await p.evaluate(()=>db.hasPendingStock()),true);
  await recovery.waitFor({state:'visible',timeout:5000});
  const message=p.locator('#stock-recovery-message');
  const route='**/rest/v1/rpc/apply_stock';
  if(mobile){
   const box=await recovery.boundingBox(),view=p.viewportSize();
   assert(box&&box.x>=0&&box.y>=0&&box.x+box.width<=view.width&&box.y+box.height<=view.height);
   assert(await recovery.evaluate(el=>{
    const r=el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
   }),'the recovery button must receive touches without scrolling');
   await p.screenshot({path:`.local-tests/stock-recovery-mobile-${view.width}-pending.png`});
  }
  if(mobile&&p.viewportSize().width===320){
   const before=rpcCalls;
   await p.route(route,request=>request.fulfill({
    status:503,contentType:'application/json',body:JSON.stringify({message:'Тестовый сбой связи'}),
   }),{times:1});
   const failed=p.waitForRequest(stockPost);
   await recovery.tap();
   assert.deepEqual((await failed).postDataJSON(),original);
   await p.waitForFunction(()=>!busy);
   assert(await message.isVisible());
   assert.match(await message.innerText(),/Не удалось восстановить результат/);
   assert(await recovery.isVisible());
   assert(await recovery.isEnabled());
   assert.equal(await p.evaluate(()=>db.hasPendingStock()),true);
   assert.equal(rpcCalls,before);
   assert.deepEqual(await values(),committed);
   await p.screenshot({path:'.local-tests/stock-recovery-mobile-320-error.png'});
  }
  let release;
  const gate=new Promise(resolve=>{release=resolve});
  let attempts=0;
  await p.route(route,async request=>{attempts++;await gate;await request.continue()});
  const before=rpcCalls;
  try{
   const replay=p.waitForRequest(stockPost);
   if(mobile)await recovery.tap();else await recovery.click();
   assert.deepEqual((await replay).postDataJSON(),original);
   assert(await recovery.isDisabled());
   // Exercise the handler guard as well as the disabled button.
   await recovery.dispatchEvent('click');
   release();
   await p.waitForFunction(()=>!busy&&!db.hasPendingStock());
   assert.equal(attempts,1);
   assert.equal(rpcCalls,before+1);
  }finally{
   release();
   await p.unroute(route);
  }
  assert.deepEqual(await values(),committed);
  assert.equal(await p.evaluate(()=>Object.keys(draft).length),0);
  assert(await recovery.isHidden());
  assert(await message.isVisible());
  assert.match(await message.innerText(),/Результат восстановлен/);
  if(mobile)await p.screenshot({path:`.local-tests/stock-recovery-mobile-${p.viewportSize().width}-complete.png`});
  await p.reload();
  await p.waitForFunction(()=>stockLoaded);
  assert(await recovery.isHidden());
  assert(await p.locator('#stock-recovery').isHidden());
  assert.equal(await p.evaluate(()=>db.hasPendingStock()),false);
  assert.equal(rpcCalls,before+1);
 }
 for(const viewport of [{width:320,height:568},{width:390,height:844}]){
  await test(`mobile ${viewport.width}x${viewport.height} home restores lost response with one exact replay`,async()=>{
   const mobile=await newContext({viewport,isMobile:true,hasTouch:true,deviceScaleFactor:1});
   try{await checkRecoveryOnHome(await mobile.newPage(),true)}finally{await mobile.close()}
  });
 }
 await test('desktop home restores lost response and clears the reviewed draft',async()=>{await checkRecoveryOnHome(page)});
 const mobileFailures=[];
 for(const [width,height] of [[320,568],[360,800],[390,844],[430,932],[844,390],[390,460]]){
  const size=width+'x'+height;
  const mobile=await newContext({viewport:{width,height},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  const p=await mobile.newPage();
  const check=async(defect,fn)=>{
   try{await test(defect+' mobile '+size,fn)}
   catch(error){mobileFailures.push(error);console.error('FAIL',defect,size,error.message)}
  };
  try{
   const home=tab=>p.locator('#home-screen [data-home="'+tab+'"]');
   const row=p.locator('[data-row="'+ids[0]+'"]');
   const toast=p.locator('#toast');
   await check('D6 stock toast leaves AI controls reachable',async()=>{
    await p.clock.install();
    await reset([p]);
    await home('wh').tap();
    await p.locator('#q').fill(catalog[0].name);
    // Use a click for selection here so D6 can be reproduced independently of D7.
    await row.click();
    await row.locator('[data-v="tobar"]').tap();
    await toast.waitFor({state:'visible'});
    assert(await toast.locator('#t-undo').isVisible());
    const transferred=await values();
    assert.equal(transferred.moves.length,1);
    assert.equal(transferred.stock.find(x=>x.flavor_id===ids[0]).wh,1);
    await p.locator('#home-btn').tap();
    await home('ai').tap();
    assert.equal(await toast.evaluate(el=>el.hidden),false,'Toast timer must still be active when entering AI');
    const blocked=await p.evaluate(()=>['#ai-in','#ai-send'].map(selector=>{
     const el=document.querySelector(selector),r=el.getBoundingClientRect();
     const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
     return {selector,hit:hit?.id||hit?.closest('#toast')?.id,reachable:r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&el.contains(hit)};
    }).filter(control=>!control.reachable));
    assert.deepEqual(blocked,[],'AI controls must receive touches during the stock toast');
    await p.screenshot({path:'.local-tests/mobile-ai-'+size+'.png'});
    const input=p.locator('#ai-in');
    await input.tap();
    assert(await input.evaluate(el=>document.activeElement===el));
    await input.pressSequentially('Mixora');
    assert.equal(await input.inputValue(),'Mixora');
    await p.locator('#ai-send').tap({trial:true,timeout:2000});
    await p.locator('#home-btn').tap();
    assert(await toast.locator('#t-undo').isVisible(),'Undo remains available outside AI until the toast expires');
    await p.clock.fastForward(6001);
    assert(await toast.isHidden());
    await p.reload();
    await p.waitForFunction(()=>stockLoaded);
    await home('ai').tap();
    assert(await input.isVisible());
    assert(await toast.isHidden());
    assert.deepEqual(await values(),transferred);
   });
   await check('D7 rapid touches on different controls are preserved',async()=>{
    await reset([p]);
    await home('wh').click();
    await p.locator('#q').fill(catalog[0].name);
    const cancelled=await row.evaluate(el=>{
     const touch=target=>target.dispatchEvent(new Event('touchend',{bubbles:true,cancelable:true}));
     return [touch(document.querySelector('#q')),touch(el.querySelector('.nm'))];
    });
    const inputBox=await p.locator('#q').boundingBox(),rowBox=await row.locator('.nm').boundingBox();
    await p.touchscreen.tap(inputBox.x+inputBox.width/2,inputBox.y+inputBox.height/2);
    await p.touchscreen.tap(rowBox.x+rowBox.width/2,rowBox.y+rowBox.height/2);
    assert.deepEqual({touches:cancelled,actions:await row.locator('[data-v="tobar"]').count()},{touches:[true,true],actions:1});
    assert.equal(await p.locator('html').evaluate(el=>getComputedStyle(el).touchAction),'pan-x pan-y');
    await p.screenshot({path:'.local-tests/mobile-search-'+size+'.png'});
    await p.touchscreen.tap(rowBox.x+rowBox.width/2,rowBox.y+rowBox.height/2);
    await p.touchscreen.tap(rowBox.x+rowBox.width/2,rowBox.y+rowBox.height/2);
    assert.equal(await p.evaluate(()=>visualViewport.scale),1);
    await p.locator('#q').fill(catalog[0].brand);
    await p.evaluate(()=>{document.activeElement.blur();scrollTo(0,0)});
    const beforeSwipe=await p.evaluate(()=>({y:scrollY,remaining:document.scrollingElement.scrollHeight-innerHeight-scrollY}));
    assert(beforeSwipe.remaining>100,'Catalog search must produce a scrollable list');
    const session=await mobile.newCDPSession(p);
    const y=height-60;
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:width/2,y}]});
    for(let distance=30;distance<=150;distance+=30){
     await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:width/2,y:y-distance}]});
    }
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await p.waitForFunction(previous=>scrollY>previous,beforeSwipe.y,{timeout:2000});
   });
  }finally{await mobile.close()}
 }
 if(mobileFailures.length)throw new AggregateError(mobileFailures,'Mobile UI regressions');
 await test('expired token refresh reuses one operation identity',async()=>{await reset();await prepare(page,{[ids[0]]:{d:-1}});expireNext=true;const before=rpcCalls;await confirm(page);assert.equal(rpcCalls-before,2);assert.equal((await values()).moves.length,1)});
 await test('two tabs cannot both consume the same reviewed revision',async()=>{const other=await context.newPage();await reset([page,other]);const changes={[ids[0]]:{d:-2}};await prepare(page,changes);await prepare(other,changes);await Promise.all([confirm(page),confirm(other)]);assert.equal((await values()).moves.length,1);assert.equal((await admin.query('select wh from stock where flavor_id=$1',[ids[0]])).rows[0].wh,0);await other.close()});
 await test('insufficient stock preserves every draft row',async()=>{await reset();await prepare(page,{[ids[0]]:{d:-3},[ids[1]]:{d:1}});await confirm(page);assert.equal((await values()).moves.length,0);assert.equal(await page.evaluate(()=>Object.keys(draft).length),2)});
 await test('journal undo adds a compensation and retains the original',async()=>{await reset();await prepare(page,{[ids[0]]:{d:1}});await confirm(page);await page.waitForFunction(()=>moves.length===1);const id=(await values()).moves[0].id;await page.evaluate(id=>undoMove(String(id)),id);assert.equal((await values()).moves.length,2)});
 await test('blocked browser storage prevents any RPC submission',async()=>{await reset();await prepare(page,{[ids[0]]:{d:1}});const before=rpcCalls;await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('test storage disabled')}});await confirm(page);assert.equal(rpcCalls,before);assert.equal((await values()).moves.length,0);await page.reload()});
 await test('both legacy identities have journal, compensation and full UI without role switches',async()=>{
  for(const legacy of ['master','manager']){await admin.query('update users set role=$1,perms=\'{}\' where tg_id=1',[legacy]);user.role=legacy;await reset();await page.waitForFunction(()=>staffReady);
   assert.equal(await page.locator('#view-sw,#role-sw,[data-pm]').count(),0);
   await prepare(page,{[ids[0]]:{d:1}});await confirm(page);await page.waitForFunction(()=>moves.length===1);
   await page.locator('#home-screen [data-home="log"]').click();assert.equal(await page.locator('#sect').textContent(),'Журнал');assert.equal(await page.locator('[data-undo]').count(),1);
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
 await test('independent clients save manual and AI orders, review conflict, and replay after reload',async()=>{
  const otherContext=await newContext();
  try{
   const second=await otherContext.newPage(),[a,b]=ids;
   await admin.query('truncate orders,mixora_private.order_requests');
   await admin.query('insert into orders(venue_id,items,revision) values($1,$2,1)',[venue,{q:{[a]:1},m:{}}]);
   const stored=async()=>(await admin.query('select items,revision::int revision from orders')).rows[0];
   await Promise.all([page.reload(),second.goto(origin)]);
   await Promise.all([page,second].map(p=>p.waitForFunction(id=>orderQ[id]===1,a)));
   await Promise.all([
    page.evaluate(id=>{orderQ[id]=2;saveOrder();return flushOrder()},a),
    second.evaluate(id=>aiCommitProposal([{t:'order',id,qty:3}]),b),
   ]);
   assert.deepEqual((await stored()).items.q,{[a]:2,[b]:3});
   await Promise.all([page,second].map(p=>p.waitForFunction(([a,b])=>orderQ[a]===2&&orderQ[b]===3,ids)));

   // Freeze the second client's reads so it edits the version it actually saw.
   const orderRead='**/rest/v1/orders?**';
   await second.route(orderRead,r=>r.abort());
   await page.evaluate(id=>{orderQ[id]=4;saveOrder();return flushOrder()},a);
   await second.evaluate(id=>{orderQ[id]=5;saveOrder();return flushOrder()},a);
   const message=second.locator('#order-save-message');
   assert(await message.isVisible());
   assert.match(await message.innerText(),/Заказ изменён на другом устройстве/);
   assert.equal(await second.evaluate(id=>orderQ[id],a),5);
   assert.equal((await stored()).items.q[a],4);
   await second.reload();
   await second.waitForFunction(()=>!!orderConflict);
   assert.equal(await second.evaluate(id=>orderQ[id],a),5);
   await second.locator('#order-save-retry').click();
   assert.match(await second.locator('#dlg-body').innerText(),/на сервере 4 шт\. · ваша правка 5 шт\./);
   await second.locator('#order-apply-draft').click();
   await second.waitForFunction(()=>!oSaving&&!oDirty);
   assert.deepEqual((await stored()).items.q,{[a]:5,[b]:3});
   await second.unroute(orderRead);

   dropOrderResponse=true;
   await assert.rejects(second.evaluate(id=>aiCommitProposal([{t:'order',id,qty:6}]),b),/сохранение заказа не подтверждено/);
   const lost=orderRequests.at(-1);
   assert.equal((await stored()).items.q[b],6);
   await page.reload();
   await page.waitForFunction(id=>orderQ[id]===6,b);
   await page.evaluate(id=>{orderQ[id]=7;saveOrder();return flushOrder()},b);
   const newer=await stored();
   await second.reload();
   await second.waitForFunction(()=>!!orderRequest);
   assert.equal(await second.evaluate(id=>orderQ[id],b),6);
   await second.locator('#order-save-retry').click();
   await second.waitForFunction(id=>!oSaving&&!oDirty&&orderQ[id]===7,b);
   assert.deepEqual(orderRequests.at(-1),lost);
   assert.deepEqual(await stored(),newer);
   assert.deepEqual(newer.items.q,{[a]:5,[b]:7});

   // Confirming the displayed quantity is still checked against the server.
   await second.route(orderRead,r=>r.abort());
   await page.evaluate(id=>{orderQ[id]=8;saveOrder();return flushOrder()},b);
   await assert.rejects(second.evaluate(([a,b])=>aiCommitProposal([{t:'order',id:b,qty:7},{t:'order',id:a,qty:6}]),ids),/Заказ изменён/);
   assert.equal((await stored()).items.q[a],5,'the stale AI line rejects the whole batch');
   await second.locator('#order-save-retry').click();
   assert.match(await second.locator('#dlg-body').innerText(),/на сервере 8 шт\. · ваша правка 7 шт\./);
   await second.unroute(orderRead);
   await page.evaluate(id=>{orderQ[id]=9;saveOrder();return flushOrder()},b);
   await second.waitForFunction(id=>orderRemote.q[id]===9,b);
   await second.locator('#order-discard-draft').click();
   assert.equal(await second.evaluate(id=>orderQ[id],b),9);
   assert.equal((await stored()).items.q[b],9);

   // A live snapshot may update the model while a focused input keeps the
   // old on-screen value. The input must still compare against that value.
   await second.evaluate(id=>{
    go('order');$('#q').value=byId[id].n;$('#q').dispatchEvent(new Event('input',{bubbles:true}));
   },b);
   const input=second.locator('#list input.oin[data-id="'+b+'"]');
   await input.fill('10');
   await page.evaluate(id=>{orderQ[id]=11;saveOrder();return flushOrder()},b);
   await second.waitForFunction(id=>orderQ[id]===11,b);
   assert.equal(await input.inputValue(),'10');
   await input.blur();
   await second.waitForFunction(()=>!!orderConflict);
   assert.equal(await second.evaluate(id=>orderQ[id],b),10);
   assert.equal((await stored()).items.q[b],11);
  }finally{await otherContext.close()}
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
