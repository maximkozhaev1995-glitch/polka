// LOCAL DRAFT until owner approves publication and one hosted run.
// UI-01 uses the actual staff-page source, mocked model output and no database adapter.
// This does not test deployed login, live OCR, real iPhone/Safari, or virtual keyboards.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import http from 'node:http';import assert from 'node:assert/strict';import {chromium} from 'playwright';
const source=fs.readFileSync('src/stoika.html','utf8');
const sourceSha256=createHash('sha256').update(source).digest('hex');
assert.equal(sourceSha256,'b1cb572688a5ed16276a5aa74c9b6723674b6f9f3128b5bd7d896c6ea0facbef','Unexpected application source: review the new version before running');
assert(process.env.MIXORA_UI_ARTIFACT_DIR,'A fresh runner temporary artifact directory is required');
const artifactDir=path.resolve(process.env.MIXORA_UI_ARTIFACT_DIR);
assert(!fs.existsSync(artifactDir),'Artifact directory must not already exist');
fs.mkdirSync(artifactDir);
const passed=[],blockedRequests=[],blockedLocalRequests=[],allowedRequests=[];
let blockedWebSockets=0,successful=false;
const csp="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'";
assert(!/POLKA_CONFIG|supabase\.co|eyJhbGci/.test(source),'Source unexpectedly contains live config or a credential-shaped value');
const bootstrap=`window.__demoDB=true;window.__made=[];window.__revoked=[];const createURL=URL.createObjectURL.bind(URL),revokeURL=URL.revokeObjectURL.bind(URL);URL.createObjectURL=f=>{const u=createURL(f);window.__made.push(u);return u};URL.revokeObjectURL=u=>{window.__revoked.push(u);revokeURL(u)};
const sample=Object.assign(async()=>({text:'Тестовый ответ',src:'test'}),{limits:async()=>({images:{mediaTypes:['image/png','image/jpeg']}}),readLabels:async files=>{window.__readNames=files.map(f=>f.name);return{text:'Фокус: NOVATESTBRAND\\nЭтикетка 1: NOVATESTBRAND SYNTHETIC FLAVOR',failed:0}}});window.claude={use:async name=>name==='sample'?sample:null};`;
const html=source.replace('<script>','<script>'+bootstrap+'</script><script>').replace(/<link[^>]+(?:https?:)?\/\/[^>]*>/g,'');
const server=http.createServer((req,res)=>{if(req.method!=='GET'||req.url!=='/'){res.writeHead(404);res.end();return}res.writeHead(200,{'content-type':'text/html;charset=utf-8','Content-Security-Policy':csp,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(html)});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const origin='http://127.0.0.1:'+server.address().port;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAALklEQVR4nO3NMQEAMAgAoLkSdrSzXazg5wMFiK58F/7JKhaLxWKxWCwWi8XilQEZuwGag5kAGwAAAABJRU5ErkJggg==','base64');
const files=[{name:'Первое фото.png',mimeType:'image/png',buffer:png},{name:'Второе "фото".png',mimeType:'image/png',buffer:png}];
let browser,count=0;const errors=[];async function test(name,fn){await fn();console.log('PASS',name);passed.push(name);count++}
try{
 browser=await chromium.launch({headless:true,args:['--disable-background-networking']});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,serviceWorkers:'block',acceptDownloads:false});
 // Application routes are deny-by-default before any page. This is not an OS firewall.
 // Chromium background networking is disabled best-effort by its launch switch.
 await context.route('**/*',route=>{
   const request=route.request();const u=new URL(request.url());
   if(request.url()===origin+'/'&&!u.username&&!u.password&&!u.search&&!u.hash&&request.method()==='GET'){
     allowedRequests.push({method:'GET',path:'/'});return route.continue();
   }
   (u.origin===origin?blockedLocalRequests:blockedRequests).push({protocol:u.protocol,host:u.hostname,method:request.method()});
   return route.abort('blockedbyclient');
 });
 await context.routeWebSocket('**/*',ws=>{blockedWebSockets++;ws.close()});
 const probe=await context.newPage();
 await test('external navigation is denied before app load',async()=>{
   await assert.rejects(()=>probe.goto('https://ui90-network-probe.invalid/',{timeout:5000}));
   assert.equal(blockedRequests.length,1);assert.equal(blockedRequests[0].host,'ui90-network-probe.invalid');
   assert.equal(allowedRequests.length,0);
 });
 await probe.close();
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.name));
 await page.goto(origin);await page.waitForFunction(()=>typeof sampleFn!=='undefined'&&sampleFn&&aiCanImg);
 await test('served page enforces no-connect CSP',async()=>{
   const result=await page.evaluate(async()=>{
     try{await fetch('data:text/plain,synthetic');return 'unexpected-success'}catch{return 'blocked'}
   });
   assert.equal(result,'blocked');
 });
 await test('main mobile home screen fits without horizontal overflow',async()=>{
   assert(await page.locator('#home-screen').isVisible());
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(artifactDir,'01-home-390.png')});
 });
 await page.evaluate(()=>{st.tab='ai';render();fitChat()});
 const unchanged=await page.evaluate(()=>JSON.stringify({stock,draft}));
 await test('mobile composer shows every selected file as a decoded thumbnail',async()=>{await page.locator('#ai-photo').setInputFiles(files);await page.waitForFunction(()=>[...document.querySelectorAll('#ai-imgs img')].length===2&&[...document.querySelectorAll('#ai-imgs img')].every(i=>i.complete&&i.naturalWidth>0));assert.equal(await page.locator('#ai-imgs .photo-tile').count(),2);assert(await page.locator('#ai-imgs').isVisible());const box=await page.locator('#ai-imgs').boundingBox();assert(box.width<=390);assert(await page.locator('#ai-in').isVisible())});
 await test('selected thumbnail opens full photo with escaped filename and close control',async()=>{await page.locator('#ai-imgs .photo-open').nth(1).click();assert(await page.locator('#dlg').evaluate(d=>d.open));assert.equal(await page.locator('#dlg h2').textContent(),'Второе "фото".png');await page.waitForFunction(()=>document.querySelector('#dlg .photo-full')?.naturalWidth>0);await page.locator('#photo-close').click()});
 await test('one removal keeps other file and releases obsolete preview URLs',async()=>{const before=await page.evaluate(()=>window.__revoked.length);await page.locator('#ai-imgs .photo-remove').nth(1).click();assert.equal(await page.locator('#ai-imgs img').count(),1);assert.deepEqual(await page.evaluate(()=>aiImgs.map(f=>f.name)),['Первое фото.png']);assert((await page.evaluate(()=>window.__revoked.length))>before)});
 await test('sent lookup retains photo preview and offers catalog candidate without stock changes',async()=>{await page.locator('#ai-in').fill('/найти');await page.locator('#ai-send').click();await page.waitForFunction(()=>!aiCtl);assert(await page.locator('#ai-imgs').isHidden());assert.equal(await page.locator('#ai-log .msg.user img').count(),1);assert.deepEqual(await page.evaluate(()=>window.__readNames),['Первое фото.png']);assert.match(await page.locator('#ai-log .msg.assistant').last().innerText(),/NOVATESTBRAND/);assert.match(await page.locator('#ai-log .msg.assistant').last().innerText(),/Ничего не добавлено/);assert.equal(await page.evaluate(()=>JSON.stringify({stock,draft})),unchanged);await page.locator('#ai-log .msg.user .photo-open').click();await page.waitForFunction(()=>document.querySelector('#dlg .photo-full')?.naturalWidth>0);await page.locator('#photo-close').click()});
 await test('new main dialog clears sent/pending previews and revokes object URLs',async()=>{await page.locator('#ai-photo').setInputFiles(files);await page.locator('#ai-new').click();assert.equal(await page.locator('#ai-log img').count(),0);assert.equal(await page.evaluate(()=>aiImgs.length),0);assert(await page.locator('#ai-imgs').isHidden());assert(await page.evaluate(()=>window.__made.every(u=>window.__revoked.includes(u))))});
 await test('helper previews survive redraw and remain attached to sent message',async()=>{await page.evaluate(()=>hOpen());await page.locator('#hsh-ph').setInputFiles(files);await page.waitForFunction(()=>document.querySelectorAll('#hsh-imgs img').length===2);const made=await page.evaluate(()=>window.__made.length);await page.evaluate(()=>{hDraw();hDraw()});assert.equal(await page.evaluate(()=>window.__made.length),made);await page.locator('#hsh-imgs .photo-remove').nth(1).click();await page.locator('#hsh-send').click();await page.waitForFunction(()=>!hCtl);assert.equal(await page.locator('#hsh-log .msg.user img').count(),1);await page.evaluate(()=>hDraw());assert.equal(await page.locator('#hsh-log .msg.user img').count(),1);await page.locator('#hsh-log .msg.user .photo-open').click();await page.waitForFunction(()=>document.querySelector('#dlg .photo-full')?.naturalWidth>0);await page.locator('#photo-close').click()});
 await test('helper reset releases sent photos and keeps binary images out of localStorage',async()=>{await page.locator('#hsh-new').click();assert.equal(await page.locator('#hsh-log img').count(),0);assert(await page.evaluate(()=>window.__made.every(u=>window.__revoked.includes(u))));assert.equal(await page.evaluate(()=>Object.values(localStorage).some(v=>/blob:|data:image/.test(v))),false);assert.equal(await page.evaluate(()=>JSON.stringify({stock,draft})),unchanged)});
 await test('short mobile viewport keeps pending photos and input accessible without horizontal overflow',async()=>{await page.evaluate(()=>hClose());await page.setViewportSize({width:390,height:600});await page.locator('#ai-photo').setInputFiles(files);await page.waitForFunction(()=>document.querySelector('#ai-imgs img')?.naturalWidth>0);await page.evaluate(()=>fitChat());assert(await page.locator('#ai-in').isVisible());assert(await page.locator('#ai-imgs').isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const box=await page.locator('#ai-in').boundingBox();assert(box.y>=0&&box.y+box.height<=600)});
 await page.screenshot({path:path.join(artifactDir,'02-photo-composer-390x600.png')});
 await page.setViewportSize({width:390,height:844});
 await page.waitForFunction(()=>document.querySelector('#ai-imgs img')?.naturalWidth>0);
 await page.screenshot({path:path.join(artifactDir,'03-photo-composer-390x844.png')});
 assert.equal(blockedRequests.filter(x=>x.host!=='ui90-network-probe.invalid').length,0,'Unexpected external app requests were safely blocked');
 assert.equal(blockedWebSockets,0,'Unexpected WebSocket attempts were safely blocked');
 assert.deepEqual(errors,[]);successful=true;console.log(count+' isolated mobile UI groups passed; no live APIs called');
 }catch(error){
 console.error('UI-01 FAILED:',error?.name||'Error');
 process.exitCode=1;
 }finally{
 fs.writeFileSync(path.join(artifactDir,'summary.json'),JSON.stringify({
   success:successful,sourceSha256,passedCount:count,passed,
   viewport:{width:390,height:844},shortViewport:{width:390,height:600},
   blockedExternalCount:blockedRequests.length,blockedLocalCount:blockedLocalRequests.length,blockedWebSockets,
   allowedLoopbackRequestCount:allowedRequests.length,
   backendAdapter:'absent',model:'mocked',images:'embedded synthetic PNG only',
   scope:'Chromium mobile viewport emulation; not real iPhone/Safari, keyboard, authentication, database or OCR',
   errorDetails:successful?null:'See sanitized runner assertion status; no DOM, headers, config or private data exported'
 },null,2));
 if(browser)await browser.close();await new Promise(ok=>server.close(ok));
}

