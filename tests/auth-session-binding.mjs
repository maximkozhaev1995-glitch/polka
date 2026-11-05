import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createHmac} from 'node:crypto';
import {localPostgres} from './local-postgres.mjs';
import {execFileSync} from 'node:child_process';

const baseline=process.argv.includes('--baseline');
const pg = await localPostgres();
const bot = 'synthetic-test-bot', secret = 'synthetic-jwt-secret';
const venue = '10000000-0000-0000-0000-000000000001';
try {
 const admin=await pg.connect(), role=await pg.connect();
 for(const name of ['stock-baseline','access-baseline'])await admin.query(fs.readFileSync('tests/fixtures/'+name+'.sql','utf8'));
 for(const name of fs.readdirSync('supabase/migrations').sort()){
  if(baseline && name.endsWith('_bind_telegram_sessions.sql'))continue;
  await admin.query(fs.readFileSync('supabase/migrations/'+name,'utf8'));
 }
 await admin.query("insert into venues values($1);",[venue]);
 await admin.query("insert into users(tg_id,venue_id,name,role) values(42,$1,'Synthetic','manager')",[venue]);
 const db={
  rpc:async(name,args)=>{
   const client=await pg.connect();
   const entries=Object.entries(args);
   try{
    await client.query('set role service_role');
    const query='select public.'+name+'('+entries.map(([key],i)=>key+' => $'+(i+1)).join(',')+') result';
    return {data:(await client.query(query,entries.map(([,value])=>value))).rows[0].result,error:null};
   }catch(error){return {data:null,error:{message:error.message}}}
   finally{await client.end()}
  }
 };
 let allowInvites='true';
 let handler;
 const context=vm.createContext({crypto,TextEncoder,TextDecoder,Uint8Array,URLSearchParams,Request,Response,btoa,atob,console,
  createClient:()=>db,Deno:{env:{get:name=>({TELEGRAM_BOT_TOKEN:bot,APP_JWT_SECRET:secret,ALLOW_INVITE_SIGNUP:allowInvites})[name]},serve:fn=>{handler=fn}}});
 const source=(baseline?execFileSync('git',['show','3b8e0be1217ca50e6a708dafde53dc099d7b02df:supabase/functions/tg-auth/index.ts'],{encoding:'utf8'}):fs.readFileSync('supabase/functions/tg-auth/index.ts','utf8')).replace(/^import .*$/mg,'');
 vm.runInContext(stripTypeScriptTypes(source,{mode:'strip'}),context);
 // Synthetic signatures use the supported future skew to stay after the migration boundary.
 const cutoff=baseline?Math.floor(Date.now()/1000)-10:Number((await admin.query('select auth_date from mixora_private.telegram_auth_cutover')).rows[0].auth_date);
 const now=Math.max(Math.floor(Date.now()/1000),cutoff+10);
 // Use WebCrypto digest for the Widget signing key.
 const botKey=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(bot)));
 function signed(offset=0,id=42){
  const data={id,first_name:'Synthetic',auth_date:now+offset};
  const text=Object.keys(data).sort().map(key=>key+'='+data[key]).join(String.fromCharCode(10));
  return {...data,hash:createHmac('sha256',botKey).update(text).digest('hex')};
 }
 const auth=signed();
 async function login(payload,token,invite){
  const r=await handler(new Request('https://local.test',{method:'POST',body:JSON.stringify({widgetAuth:payload,session_token:token,invite})}));
  return {status:r.status,body:await r.json()};
 }
 const first=await login(auth);
 assert.equal(first.status,200);
 const claims=JSON.parse(Buffer.from(first.body.token.split('.')[1],'base64url'));
 if(baseline){
  if(process.argv.includes('--readd')){
   await admin.query('delete from users where tg_id=42');
   await admin.query("insert into users(tg_id,venue_id,name,role) values(42,$1,'Readded','manager')",[venue]);
   await role.query('set role authenticated');
   await role.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(claims)]);
   assert.equal((await role.query('select me_tg() id')).rows[0].id,null,'old JWT must remain revoked after delete/readd');
  }else{
   assert.equal((await login(auth)).status,401,'signed Telegram proof must not mint a second session');
  }
  throw Error('Baseline unexpectedly passed: review the regression fixture');
 }


 const decode = token => JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
 const renewed=await login(auth,first.body.token);
 assert.equal(renewed.status,200);
 assert.equal(decode(renewed.body.token).sid,claims.sid);
 const deadline=Number((await admin.query('select expires_at from mixora_private.telegram_sessions')).rows[0].expires_at);
 assert(decode(renewed.body.token).exp<=deadline);
 assert.equal((await login(auth)).status,401,'signature alone cannot replay after session creation');
 assert.equal((await login(auth,first.body.token+'tampered')).status,401);
 assert.equal((await admin.query('select count(*)::int n from mixora_private.telegram_sessions')).rows[0].n,1);
 console.log('PASS same signed Widget refresh needs its bound JWT and cannot extend the absolute deadline');


 const race=await Promise.all([login(signed(-3)),login(signed(-3))]);
 assert.deepEqual(race.map(r=>r.status).sort(),[200,401]);
 assert.equal((await admin.query('select count(*)::int n from mixora_private.telegram_sessions')).rows[0].n,2);
 console.log('PASS independent service-role connections cannot bind one signed proof twice');
 const otherSession=race.find(result=>result.status===200);
 assert.equal((await login(auth,otherSession.body.token)).status,401,'another session of the same user cannot refresh this proof');
 const parallelRefresh=await Promise.all([login(auth,first.body.token),login(auth,first.body.token)]);
 assert(parallelRefresh.every(result=>result.status===200&&decode(result.body.token).sid===claims.sid));
 assert.equal((await admin.query('select count(*)::int n from mixora_private.telegram_sessions')).rows[0].n,2);
 console.log('PASS same-user foreign session is denied; parallel refresh keeps a single bound sid');
 const lockA=await pg.connect(),lockB=await pg.connect();
 try{
  await lockA.query('set role service_role');await lockB.query('set role service_role');
  const proofHash='f'.repeat(64);
  await lockA.query('begin');
  await lockA.query('select bind_telegram_session($1,$2,$3)',[42,proofHash,now]);
  const waiting=lockB.query('select bind_telegram_session($1,$2,$3) result',[42,proofHash,now]);
  const pid=(await lockA.query('select pg_backend_pid() pid')).rows[0].pid;
  try{
   for(let attempt=0;;attempt++){
    const blocked=(await admin.query('select exists(select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid))) blocked',[pid])).rows[0].blocked;
    if(blocked)break;
    assert(attempt<100,'proof binding did not overlap');
    await new Promise(resolve=>setTimeout(resolve,20));
   }
  }finally{await lockA.query('commit')}
  assert.equal((await waiting).rows[0].result,null);
  console.log('PASS observed PostgreSQL blocking serializes overlapping initial proof binding');
 }finally{await lockA.end();await lockB.end()}



 allowInvites='false';
 assert.equal((await login(signed(0,43),undefined,'unused')).status,403);
 assert.equal((await admin.query('select count(*)::int n from users where tg_id=43')).rows[0].n,0);
 allowInvites='true';
 await admin.query("insert into invites(code,venue_id,role) values('new-member',$1,'manager')",[venue]);
 assert.equal((await login(signed(0,43),undefined,'new-member')).status,200);
 assert.equal((await login(signed(0,43),undefined,'new-member')).status,401);
 console.log('PASS prebound-only mode denies signup; explicit invite mode creates member and binds proof atomically');
 const refreshedEpoch=claims.membership_epoch;
 await admin.query('delete from users where tg_id=42');
 await admin.query("insert into users(tg_id,venue_id,name,role) values(42,$1,'Readded','manager')",[venue]);
 await role.query('set role authenticated');
 await role.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(claims)]);
 assert.equal((await role.query('select me_tg() id')).rows[0].id,null,'old JWT must stay revoked after delete/readd');
 await assert.rejects(role.query('select apply_order($1,$2,$3)',[venue,crypto.randomUUID(),'[]']),{code:'42501'});
 await assert.rejects(role.query('select apply_stock($1,$2)',[crypto.randomUUID(),'[]']),{code:'42501'});
 assert.equal((await login(auth,first.body.token)).status,401);
 assert.equal((await login(auth)).status,401);
 console.log('PASS delete/readd permanently revokes old JWT, refresh and old signed payload');

 const fresh=await login(signed(-1));
 assert.equal(fresh.status,200);
 const newClaims=decode(fresh.body.token);
 assert.notEqual(newClaims.membership_epoch,refreshedEpoch);
 await role.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(newClaims)]);
 assert.equal((await role.query('select me_tg() id')).rows[0].id,'42');
 await admin.query('update users set membership_epoch=$1 where tg_id=42',[refreshedEpoch]);
 assert.equal((await admin.query('select membership_epoch from users where tg_id=42')).rows[0].membership_epoch,newClaims.membership_epoch);
 const legacy={...newClaims};delete legacy.membership_epoch;
 await role.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(legacy)]);
 assert.equal((await role.query('select me_tg() id')).rows[0].id,null);
 console.log('PASS new signature grants current epoch; direct epoch reset and legacy claims cannot restore old access');

 await admin.query('update mixora_private.telegram_sessions set expires_at=$1',[Math.floor(Date.now()/1000)-1]);
 assert.equal((await login(signed(-1),fresh.body.token)).status,401);
 assert.equal((await login(signed(-600))).status,401,'old proof cannot open a new session');
 assert.equal((await login(signed(cutoff-now))).status,401,'pre-cutover signatures cannot open a session');
 console.log('PASS expired absolute session and stale initial Telegram proof are rejected');

 // The actual client refresh code must send the same signed proof with the bound JWT.
 const shim=fs.readFileSync('app/shim.js','utf8');
 const stored=new Map([['mixora-auth:https://local.test',JSON.stringify({token:fresh.body.token,proof:'mini:synthetic-proof'})]]);
 const requests=[];let failRefresh=false;
 const elements=new Map();
 const el=()=>({dataset:{},appendChild(){},isConnected:true,textContent:'',hidden:true});
 const client=vm.createContext({session:{token:fresh.body.token,user:fresh.body.user},CFG:{url:'https://local.test',anon:'synthetic'},
  URLSearchParams,tg:{initData:'hash=synthetic-proof'},window:{},showWidget(){},document:{querySelector:key=>{if(!elements.has(key))elements.set(key,el());return elements.get(key)},body:{appendChild(){}}},
  $:key=>elements.get(key),msg(){},wall:el(),setTimeout:()=>1,clearTimeout(){},
  sessionStorage:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)},
  fetch:async(_url,options)=>{requests.push(JSON.parse(options.body));return failRefresh?{ok:false,status:401,json:async()=>({error:'session_expired'})}:{ok:true,status:200,json:async()=>({token:fresh.body.token,user:fresh.body.user})}}});
 const begin=shim.indexOf('  let widgetAuth=null;'),end=shim.indexOf('  function showWidget()');
 vm.runInContext(shim.slice(begin,end)+';globalThis.refresh=refreshSession;globalThis.authCall=call;',client);
 assert.deepEqual(await Promise.all([client.refresh(),client.refresh()]),[true,true]);
 assert.equal(requests.length,1);
 assert.equal(requests[0].session_token,fresh.body.token);
 assert.equal(requests[0].initData,'hash=synthetic-proof');
 console.log('PASS client refresh coalesces calls and retains signed proof plus bound token');
 failRefresh=true;
 assert.equal(await client.refresh(),false);
 assert.equal(client.session.token,null);
 assert.equal(stored.size,0);
 client.tg.initData='hash=fresh-mini-proof';
 await client.authCall('');
 assert.equal(requests.at(-1).session_token,undefined);
 console.log('PASS rejected refresh clears resume state and a new login cannot inherit the old token');
 // Exercise the existing Widget element after the login wall has been removed and restored.
 const widgetElements=new Map();
 let widgetScripts=0,widgetStatus=200,tokenNumber=0;
 const loginWall={isConnected:true,remove(){this.isConnected=false}};
 const widgetNode=()=>({dataset:{},hidden:false,textContent:'',appendChild(){widgetScripts++}});
 const widgetContext=vm.createContext({session:null,resolveReady(){},CFG:{url:'https://widget.local.test',anon:'synthetic'},
  tg:null,URLSearchParams,window:{addEventListener(){}},wall:loginWall,msg(){},
  document:{createElement:()=>({setAttribute(){}}),body:{appendChild(node){node.isConnected=true}}},
  $:key=>{if(!widgetElements.has(key))widgetElements.set(key,widgetNode());return widgetElements.get(key)},
  setTimeout:()=>1,clearTimeout(){},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  fetch:async()=>({ok:widgetStatus===200,status:widgetStatus,json:async()=>widgetStatus===200
    ?{token:'synthetic-token-'+(++tokenNumber),user:{tg_id:42}}:{error:'session_expired'}})});
 vm.runInContext(shim.slice(begin,shim.indexOf('  // ===== база ====='))+';globalThis.refresh=refreshSession;globalThis.start=login;',widgetContext);
 await widgetContext.start();
 assert.equal(widgetScripts,1);
 widgetContext.window.__polkaTgAuth({hash:'proof-a'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(loginWall.isConnected,false);
 widgetStatus=401;
 assert.equal(await widgetContext.refresh(),false);
 assert.equal(loginWall.isConnected,true);
 assert.equal(widgetElements.get('#tg-widget').dataset.on,'1');
 assert.equal(widgetScripts,1);
 widgetStatus=200;
 widgetContext.window.__polkaTgAuth({hash:'proof-b'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(loginWall.isConnected,false);
 assert.equal(widgetContext.session.token,'synthetic-token-2');
 console.log('PASS existing Widget callback remains usable after session expiry restores the login wall');



 // Mini App signatures use a different signing algorithm and an independent proof namespace.
 const mini=new URLSearchParams({user:JSON.stringify({id:42,first_name:'Synthetic'}),auth_date:String(now)});
 const miniSecret=createHmac('sha256','WebAppData').update(bot).digest();
 mini.set('hash',createHmac('sha256',miniSecret).update([...mini.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join(String.fromCharCode(10))).digest('hex'));
 async function miniLogin(token){
  const r=await handler(new Request('https://local.test',{method:'POST',body:JSON.stringify({initData:mini.toString(),session_token:token})}));
  return {status:r.status,body:await r.json()};
 }
 const miniFirst=await miniLogin();
 assert.equal(miniFirst.status,200);
 assert.equal((await miniLogin()).status,401);
 assert.equal((await miniLogin(miniFirst.body.token)).status,200);
 assert.equal((await login(signed(-2),miniFirst.body.token)).status,401);
 console.log('PASS Mini App binding, refresh and cross-proof separation');
}finally{await pg.close()}
