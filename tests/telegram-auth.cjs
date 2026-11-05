(async()=>{
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const key='local-only-test-secret',token='123:local-only-bot-token';
const context=vm.createContext({crypto,TextEncoder,TextDecoder,URLSearchParams,Uint8Array,btoa,atob,Date,Number,JSON,Request,Deno:{env:{get:n=>n==='APP_JWT_SECRET'?key:undefined}}});
const source=fs.readFileSync('supabase/functions/tg-auth/index.ts','utf8');
vm.runInContext(stripTypeScriptTypes(source.slice(source.indexOf('const enc ='),source.indexOf('Deno.serve(')),{mode:'strip'}),context);
const ai=fs.readFileSync('supabase/functions/ai/index.ts','utf8');
vm.runInContext(stripTypeScriptTypes(ai.slice(ai.indexOf('async function tgId('),ai.indexOf('// ===== Gemini')),{mode:'strip'}),context);
const run=s=>vm.runInContext(s,context);let count=0;async function test(n,f){await f();console.log('PASS',n);count++}
const now=Math.floor(Date.now()/1000);
context.botToken=token;context.testSecret=key;context.testNow=now;
context.miniParams=new URLSearchParams({user:JSON.stringify({id:42,first_name:'Test'}),auth_date:String(now)});
await test('valid Mini App HMAC is accepted',async()=>{await run(`(async()=>{const dcs=[...miniParams.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v).join('\\n');const secret=await hmac(enc.encode('WebAppData'),botToken);miniParams.set('hash',hex(await hmac(secret,dcs)))})()`);assert.equal((await run('checkInitData(miniParams.toString(),botToken)')).id,42)});
await test('tampered and unsigned Mini App payloads are rejected',async()=>{context.tampered=new URLSearchParams(context.miniParams);context.tampered.set('user','{"id":99}');assert.equal(await run('checkInitData(tampered.toString(),botToken)'),null);assert.equal(await run("checkInitData('user=%7B%22id%22%3A42%7D',botToken)"),null)});
await test('expired correctly signed Mini App payload is rejected',async()=>{context.expired=new URLSearchParams({user:'{"id":42}',auth_date:String(now-90000)});await run(`(async()=>{const dcs=[...expired.entries()].sort(([a],[b])=>a<b?-1:1).map(([k,v])=>k+'='+v).join('\\n');expired.set('hash',hex(await hmac(await hmac(enc.encode('WebAppData'),botToken),dcs)))})()`);assert.equal(await run('checkInitData(expired.toString(),botToken)'),null)});
context.widget={id:42,first_name:'Test',auth_date:now};
await test('valid Login Widget signature is accepted',async()=>{await run(`(async()=>{const dcs=Object.keys(widget).sort().map(k=>k+'='+widget[k]).join('\\n');widget.hash=hex(await hmac(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(botToken))),dcs))})()`);assert.equal((await run('checkWidgetAuth(widget,botToken)')).id,42)});
await test('tampered Widget identity is rejected',async()=>{assert.equal(await run('checkWidgetAuth({...widget,id:99},botToken)'),null)});
const claims={membership_epoch:'10000000-0000-0000-0000-000000000001',sub:'42',tg_id:42,role:'authenticated',aud:'authenticated',iat:now,exp:now+3600};context.claims=claims;
const sign=async value=>{context.payload=value;return run('signJwt(payload,testSecret)')};
const verify=async jwt=>{context.request=new Request('https://local.test',{headers:{authorization:'Bearer '+jwt}});return run('tgId(request)')};
await test('AI validates the HMAC-signed authenticated Telegram subject',async()=>{assert.equal(await verify(await sign(claims)),42)});
await test('AI rejects tampered signatures and alg:none',async()=>{const t=await sign(claims);assert.equal(await verify(t.slice(0,-2)+'xx'),null);assert.equal(await verify(Buffer.from('{"alg":"none"}').toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.x'),null)});
await test('AI rejects expired tokens, anon role and mismatched identity',async()=>{for(const extra of [{exp:now-1},{role:'anon'},{tg_id:99},{aud:'other'},{iat:now+500}])assert.equal(await verify(await sign({...claims,...extra})),null)});
await test('auth handler binds verified signatures through the server session RPC',async()=>{
  let handler,rpcResult={data:null};
  const calls=[];
  context.Response=Response;
  context.console=console;
  context.Deno.serve=fn=>{handler=fn};
  context.Deno.env.get=name=>({TELEGRAM_BOT_TOKEN:token,APP_JWT_SECRET:key})[name];
  context.createClient=()=>({
    rpc:async(name,args)=>{calls.push({name,args:JSON.parse(JSON.stringify(args))});return rpcResult}
  });
  vm.runInContext('{'+stripTypeScriptTypes(source.slice(source.indexOf('const cors =')),{mode:'strip'})+'}',context);
  const request=body=>handler(new Request('https://local.test',{method:'POST',body:JSON.stringify(body)}));
  assert.equal((await request({widgetAuth:{...context.widget,id:99}})).status,401);
  assert.equal(calls.length,0);
  assert.equal((await request({widgetAuth:context.widget})).status,401);
  assert.equal(calls[0].name,'bind_telegram_session');
  assert.equal(calls[0].args.p_tg_id,42);
  assert.equal(calls[0].args.p_allow_invites,false);
  rpcResult={data:{session_id:'10000000-0000-0000-0000-000000000002',membership_epoch:claims.membership_epoch,expires_at:now+86400,user:{tg_id:42,venue_id:'local-venue',name:'Test'}}};
  const accepted=await request({widgetAuth:context.widget});
  assert.equal(accepted.status,200);
  const jwt=(await accepted.json()).token;
  assert.equal(await verify(jwt),42);
  assert.equal((await request({widgetAuth:context.widget,session_token:jwt})).status,200);
  assert.equal(calls.at(-1).args.p_session_id,rpcResult.data.session_id);
  assert.equal((await request({widgetAuth:context.widget,session_token:jwt+'bad'})).status,401);
});
console.log(`${count} cryptographic Telegram/JWT tests passed; no real login or external API`);

})().catch(e=>{console.error(e);process.exitCode=1});
