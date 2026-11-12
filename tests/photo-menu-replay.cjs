// Run from this checkout with Playwright installed. Pass the folder holding the five original JPEGs.
// All HTTP requests are intercepted, including login, OCR, stock updates and order updates.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
if (!process.env.MIXORA_PHOTO_FIXTURE || !process.argv[2]) throw Error('Set MIXORA_PHOTO_FIXTURE to the replay JSON path and pass the folder containing the original JPEG files.');
const fixture = JSON.parse(fs.readFileSync(process.env.MIXORA_PHOTO_FIXTURE, 'utf8'));

const html = fs.readFileSync('index.html', 'utf8');
const native = JSON.parse(html.match(/const DATA=(\[.*?\]);/s)[1]);
function itemId({brand, name}) {
  const hits = native.filter(x => x.b === brand && x.n === name);
  assert.equal(hits.length, 1, brand + ' ' + name);
  return hits[0].id;
}
const stockRows = fixture.stock.map(x => ({...x, flavor_id: itemId(x)}));
const corrections = fixture.corrections.map(x => ({raw_label: x.raw_label, flavor_id: itemId(x)}));
const files = fixture.files.map(({name, sha256}) => {
  const filename = path.join(process.argv[2], name);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'), sha256);
  return filename;
});
const choices = ['В заказ', 'Перенести за стойку', 'Пополнить склад', 'Перенести и заказать с нулевым остатком'];
const origin = 'https://mixora-offline.invalid';
const entry = origin+'/polka/';
const sections = {ai:'ИИ-ассистент',bar:'Стойка',off:'Не на стойке',stock:'Склад',stop:'Стоп-лист',order:'Заказ',slow:'Неликвид',sup:'Контрагенты',journal:'Журнал'};
async function serveApp(route) {
  const url=new URL(route.request().url());
  const prefix=new URL(entry).pathname;
  if (url.origin!==origin || !url.pathname.startsWith(prefix)) return false;
  const rel=decodeURIComponent(url.pathname.slice(prefix.length));
  if (!rel || rel==='index.html') {await route.fulfill({contentType:'text/html; charset=utf-8',body:html});return true}
  const base=path.resolve('.');
  const target=path.resolve(base,rel);
  if (target.startsWith(base+path.sep) && fs.existsSync(target) && fs.statSync(target).isFile()) await route.fulfill({path:target});
  else await route.abort();
  return true;
}
async function loginWall(browser) {
  const ctx=await browser.newContext({serviceWorkers:'block'});
  const page=await ctx.newPage(),widgets=[],business=[];
  try{
    await ctx.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if (await serveApp(route)) return;
      if(url.pathname.endsWith('/telegram-widget.js'))widgets.push(url.href);
      if(url.origin===api)business.push(url.pathname);
      return route.abort();
    });
    await page.goto(entry);
    await page.locator('#tg-widget[data-on="1"]').waitFor({state:'attached'});
    assert.ok(await page.locator('#login').isVisible());
    assert.match(await page.locator('#lg-msg').innerText(),/Войдите через Telegram/);
    assert.equal(await page.locator('#tg-widget script[data-telegram-login]').getAttribute('data-telegram-login'),'PolkaHookahbot');
    assert.deepEqual(business,[]);
    assert.equal(widgets.length,1);
    assert.equal(await page.locator('#mixora-work-menu').isVisible(),false);
    console.log('PASS normal signed-out entry displays production Telegram login, no authentication or business request submitted');
  } finally {await ctx.close();}
}
async function visibleSections(page) {
  const root=page.locator('#mixora-work-menu'), home=root.locator('.wm-tile[data-nav]');
  const ids=await home.evaluateAll(nodes=>nodes.map(n=>n.dataset.nav));
  assert.deepEqual([...ids].sort(),Object.keys(sections).sort());
  for (const id of ids) {
    const link=root.locator('.wm-tile[data-nav="'+id+'"]');
    assert.match(await link.innerText(),new RegExp(sections[id],'i'));
    await link.click();
    const view=root.locator('.wm-main[data-route="'+id+'"]');
    await view.waitFor();
    if (id==='ai') {
      assert.ok(await view.locator('[data-ai-host] #ai-in').isVisible());
      await view.locator('[data-chat-back]').click();
    } else {
      assert.match(await view.innerText(),new RegExp(sections[id],'i'));
      await root.locator('[data-dock="home"]').click();
    }
  }
  await root.locator('[data-dock="more"]').click();
  const extra=root.locator('.wm-extra');
  const extraIds=await extra.locator('[data-nav]').evaluateAll(nodes=>nodes.map(n=>n.dataset.nav));
  const nativeIds=['mixes','chk','know','inv','pack','str','wish','team'];
  assert.deepEqual([...extraIds].sort(),['ai','off','stop','slow','sup','journal',...nativeIds].sort());
  for(const key of nativeIds) {
    await extra.locator('[data-nav="'+key+'"]').click();
    const view=root.locator('.wm-main[data-route="'+key+'"] [data-native-host] .wrap');
    await view.waitFor();
    assert.equal(await page.evaluate(()=>st.tab),key);
    assert.ok((await view.innerText()).trim().length>0,key);
    await root.locator('[data-dock="more"]').click();
  }
  await root.locator('[data-dock="home"]').click();
  console.log('PASS full TEST navigation '+ids.map(id=>sections[id]).join(', ')+' and eight native sections via Ещё');
}
const api = new URL(html.match(/window\.POLKA_CONFIG=\{url:"([^"]+)"/)[1]).origin;

async function scenario(browser, mode) {
  const context = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, serviceWorkers:'block'});
  const page = await context.newPage();
  page.setDefaultTimeout(5500);
  const errors = [], writes = [], hashes = new Set(), movements=[];
  let authCalls=0;
  let permitted = '', order = null, reads = 0;
  const missing = stockRows.find(x => x.wh === 0).flavor_id;
  const rows = stockRows.filter(x => mode !== 'sparse' || x.flavor_id !== missing).map(x => ({...x}));
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.Telegram = {WebApp:{initData:'hash=offline', ready(){}, expand(){}}};
  });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), json = body => route.fulfill({json:body});
    if (await serveApp(route)) return;
    if (url.origin !== api) return route.abort();
    const table = url.pathname.split('/').pop();
    if (table === 'tg-auth') {
      authCalls++;
      assert.equal(req.postDataJSON().initData,'hash=offline');
      const claims = Buffer.from(JSON.stringify({sid:'offline',membership_epoch:1})).toString('base64url');
      return json({token:'fixture.'+claims+'.fixture',user:{tg_id:1,name:'QA',venue_id:'10000000-0000-0000-0000-000000000001',role:'manager'}});
    }
    if (table === 'ai') {
      const body = req.postDataJSON();
      if (!body.ocr_only || body.photo_mode !== 'inspection' || body.observation_schema_version !== 1) {
        errors.push('Unexpected AI request, missing structured inspection contract');
        return route.fulfill({status:409,json:{error:'client_update_required'}});
      }
      const image = body.messages[0].content[0];
      const data = Buffer.from(image.source.data,'base64');
      assert.equal(image.source.media_type,'image/jpeg');
      assert.ok(data.length > 10000);
      hashes.add(crypto.createHash('sha256').update(data).digest('hex'));
      const observations = fixture.pages[reads++];
      assert.ok(observations,'Duplicate OCR request');
      const text = 'Фокус: ?\n' + observations.map(x=>'Этикетка '+x.label_index+': '+x.raw_label).join('\n');
      return json({ocr:'local replay',inspection:true,observation_schema_version:1,observations:[observations],ocr_texts:[text]});
    }
    if (req.method() === 'GET') {
      if (table === 'photo_corrections') return json(corrections);
      if (table === 'moves') return json(movements);
      if (table === 'stock') {
        if (mode === 'unavailable') return route.fulfill({status:503,json:{message:'offline fixture failure'}});
        return json(rows);
      }
      if (table === 'orders') return json(order ? [{items:order,revision:1}] : []);
      return json([]);
    }
    if (table !== permitted || req.method() !== 'POST') {
      errors.push('Unexpected write '+table); return route.abort();
    }
    const payload = req.postDataJSON();
    writes.push({table,payload});
    if (table === 'apply_stock') {
      const result = payload.p_items.map(entry => {
        const current=rows.find(x=>x.flavor_id===entry.id);
        assert.ok(current);
        assert.equal(current.revision,entry.revision);
        Object.assign(current,entry.doc,{revision:entry.revision+1});
        movements.push({id:crypto.randomUUID(),operation_id:crypto.randomUUID(),flavor_id:entry.id,kind:entry.kind,qty:1,left_after:current.wh,bar_to:true,at:new Date().toISOString(),stock_revision:current.revision});
        return {id:entry.id,doc:{...entry.doc,revision:current.revision}};
      });
      return json(result);
    }
    if (table === 'apply_order') {
      const q={};
      for (const change of payload.p_changes) {
        assert.equal(change.map,'q'); assert.equal(change.before,null); q[change.id]=change.after;
      }
      order={q,m:{}}; return json({status:'applied',order:{...order,revision:1}});
    }
    throw Error('Unhandled mock write');
  });
  const chat = page.locator('#ai-log'), menu = chat.locator('.photo-actions');
  const button = name => chat.getByRole('button',{name,exact:true});
  const state = () => page.evaluate(() => ({
    draft:Object.fromEntries(Object.entries(draft).map(([id,row])=>[id,row.d])),
    order:{...orderQ},
    ids:typeof aiPhotoBatch === 'undefined' ? [] : aiPhotoBatch?.ids || [],
  }));
  try {
    await page.goto(entry+(mode==='unavailable'?'#mixora/ai':''));
    await page.waitForFunction(() => typeof sampleFn === 'function' && staffReady);
    if (mode !== 'unavailable') await page.waitForFunction(() => stockLoaded);
    const ui=page.locator('#mixora-work-menu');
    assert.equal(authCalls,1);
    if (mode!=='unavailable') {
      await ui.locator('.wm-tile[data-nav="ai"]').waitFor();
      if (mode==='regular') await visibleSections(page);
      await ui.locator('.wm-tile[data-nav="ai"]').click();
      await ui.locator('[data-ai-host] #ai-photo').setInputFiles(files);
      await ui.locator('[data-ai-host] #ai-send').click();
    }
    if (mode === 'unavailable') {
      await page.waitForFunction(()=>!aiCtl);
      assert.equal(await menu.count(),0);
      assert.deepEqual((await state()).draft,{});
      assert.deepEqual((await state()).order,{});
      assert.equal(await page.evaluate(()=>stockLoaded),false);
      assert.equal(await ui.locator('[data-ai-host] #ai-send').isVisible(),false);
      assert.deepEqual(writes,[]);
      console.log('PASS failed stock load blocks photo actions'); return;
    }
    const question = button('Deus Black JI');
    await question.waitFor();
    assert.match(await chat.innerText(), /43 из 44/);
    assert.deepEqual((await state()).draft,{});
    assert.deepEqual((await state()).order,{});
    await question.click();
    await page.waitForFunction(()=>!aiCtl);
    assert.deepEqual(await menu.getByRole('button').allTextContents(),choices);
    assert.ok(await menu.getByRole('button').evaluateAll(nodes=>nodes.every(el=>el.getBoundingClientRect().right<=innerWidth+1 && el.scrollWidth<=el.clientWidth+1)));
    const first = await state();
    assert.deepEqual([...first.ids].sort(), stockRows.map(x=>x.flavor_id).sort());
    assert.deepEqual(first.draft,{}); assert.deepEqual(first.order,{});
    assert.equal(reads,5); assert.equal(hashes.size,5);
    const assistantCount = await chat.locator('.msg.assistant').count();
    const inStock = rows.filter(x=>x.wh>0);
    const eligible = stockRows.filter(x=>!x.slow);
    const zero = stockRows.filter(x=>x.wh===0&&!x.slow);
    const stockSets=[[],inStock,stockRows,inStock], orderSets=[eligible,[],[],zero];
    for (const [i,name] of choices.entries()) {
      await menu.getByRole('button',{name,exact:true}).click();
      if(mode==='sparse'&&i===3)assert.match(await chat.innerText(),/без складской записи/i);
      const current=await state();
      assert.deepEqual(current.draft,Object.fromEntries(stockSets[i].map(x=>[x.flavor_id,i===2?1:-1])));
      assert.deepEqual(current.order,{});
      const proposed = chat.locator('[data-order-row]');
      const displayed = await proposed.evaluateAll(fields=>fields.map(field=>[field.closest('label').firstChild.textContent.trim(),Number(field.value)]));
      assert.deepEqual(displayed.sort(),orderSets[i].map(x=>[x.brand+' '+x.name,1]).sort());
      if (i === 2) {
        await button('Изменить черновик').click();
        const plus=page.locator('#dlg-body [data-draft-step][data-step="1"]').first();
        await plus.click(); await page.locator('#dlg-back').click();
        assert.ok(Object.values((await state()).draft).includes(2));
      }
      await button('Отмена').first().click();
      assert.deepEqual(await menu.getByRole('button').allTextContents(),choices);
      assert.deepEqual((await state()).draft,{}); assert.deepEqual((await state()).order,{});
      assert.equal(await chat.locator('.msg.assistant').count(),assistantCount);
      assert.deepEqual(writes,[]);
    }
    if (mode === 'sparse') {
      assert.equal(zero.length,8);
      console.log('PASS known missing row goes into the combined order only; explicit order and replenish remain available');
      return;
    }
    await menu.getByRole('button',{name:choices[3],exact:true}).click();
    const field=chat.locator('[data-order-row]').first();
    const details=field.locator('xpath=ancestor::details');
    if (!await details.evaluate(el=>el.open)) await details.locator('summary').click();
    await field.fill('3');
    const firstOrderName = await field.evaluate(el=>el.closest('label').firstChild.textContent.trim());
    const expectedOrder = Object.fromEntries(zero.map(x=>[x.flavor_id,x.brand+' '+x.name===firstOrderName?3:1]));
    assert.deepEqual(writes,[]);
    permitted='apply_order';
    await button('Подтвердить заказ').click();
    await page.waitForFunction(()=>document.querySelector('#ai-log').innerText.includes('Сохранено в черновик заказа'));
    assert.deepEqual(writes.map(w=>w.table),['apply_order']);
    assert.deepEqual(order.q,expectedOrder);
    permitted='';
    await button('Проверить и подтвердить').click();
    assert.equal(writes.length,1);
    permitted='apply_stock';
    await page.locator('#dlg-ok').click();
    await page.waitForFunction(()=>!document.querySelector('#dlg').open && Object.keys(draft).length===0);
    assert.deepEqual(writes.map(w=>w.table),['apply_order','apply_stock']);
    const moves=writes[1].payload.p_items;
    assert.equal(moves.length,inStock.length);
    for (const x of stockRows.filter(x=>x.wh>0)) {
      const move=moves.find(m=>m.id===x.flavor_id);
      assert.equal(move.doc.wh,x.wh-1);assert.equal(move.doc.bar,true);
    }
    assert.deepEqual(errors,[]); assert.equal(reads,5);
    await button('Открыть журнал').click();
    const journal=ui.locator('.wm-main[data-route="journal"]');
    await journal.locator('.wm-journal').first().waitFor();
    assert.equal(await journal.locator('.wm-journal').count(),inStock.length);
    await ui.locator('[data-dock="order"]').click();
    const quantities=ui.locator('[data-order-qty]');
    assert.deepEqual(await quantities.evaluateAll(fields=>Object.fromEntries(fields.map(f=>[f.dataset.orderQty,Number(f.value)]))),expectedOrder);
    console.log('PASS post-confirmation journal displays all 36 mock moves; visible order quantities match eight confirmed rows');
    console.log('PASS original JPEGs, 43/44 + explicit choice, 44 matched, menu quantities 37 orders / 36 transfer / 44 replenish / 36 + 8 combined; four cancellations, edited stock and order, 2 confirmed mock requests.');
  } catch (e) {
    console.error('Scenario', mode, 'structured requests',reads,'errors',errors,'chat', (await chat.innerText().catch(()=>'' )).slice(-1250));
    throw e;
  } finally {
    await context.close();
    assert.deepEqual(errors,[]);
  }
}
(async()=>{
  const browser=await chromium.launch({headless:true});
  try { await loginWall(browser); for (const mode of ['regular','sparse','unavailable']) await scenario(browser,mode); }
  finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
