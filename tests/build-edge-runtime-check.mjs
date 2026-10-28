// Builds a test-only Deno probe from the exact authentication helpers in this PR.
// No bot token, signing key, model key or production data is read by the probe.
import fs from 'node:fs';
const tg=fs.readFileSync('supabase/functions/tg-auth/index.ts','utf8');
const ai=fs.readFileSync('supabase/functions/ai/index.ts','utf8');
const helpers=tg.slice(tg.indexOf('const enc ='),tg.indexOf('Deno.serve('))+'\n'+ai.slice(ai.indexOf('async function tgId('),ai.indexOf('// ===== Gemini'));
const runner=`
Deno.serve(async (req: Request) => {
 if(Deno.env.get('SUPABASE_URL')!=='https://qnohynnwasoyjakrrrhb.supabase.co')return new Response('isolated test project required',{status:403});
 if(req.method!=='GET')return new Response('GET only',{status:405});
 const tests: string[]=[];
 const check=(name:string,ok:boolean)=>{if(!ok)throw Error(name);tests.push(name)};
 try {
  const now=Math.floor(Date.now()/1000),bot='42:synthetic-test-bot-token',secret='pr77-synthetic-test-secret';
  const params=new URLSearchParams({user:JSON.stringify({id:42,first_name:'Synthetic'}),auth_date:String(now)});
  const signMini=async(p:URLSearchParams)=>{p.delete('hash');const dcs=[...p.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v).join('\\n');p.set('hash',hex(await hmac(await hmac(enc.encode('WebAppData'),bot),dcs)));return p.toString()};
  const mini=await signMini(params);
  check('Mini App valid HMAC',(await checkInitData(mini,bot))?.id===42);
  const tampered=new URLSearchParams(mini);tampered.set('user','{"id":99}');
  check('Mini App tampering rejected',await checkInitData(tampered.toString(),bot)===null);
  check('Mini App expired signature rejected',await checkInitData(await signMini(new URLSearchParams({user:'{"id":42}',auth_date:String(now-90000)})),bot)===null);
  const widget:Record<string,unknown>={id:42,first_name:'Synthetic',auth_date:now};
  const dcs=Object.keys(widget).sort().map(k=>k+'='+widget[k]).join('\\n');
  widget.hash=hex(await hmac(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(bot))),dcs));
  check('Login Widget valid signature',(await checkWidgetAuth(widget,bot))?.id===42);
  check('Login Widget tampering rejected',await checkWidgetAuth({...widget,id:99},bot)===null);
  const claims={sub:'42',tg_id:42,role:'authenticated',aud:'authenticated',iat:now,exp:now+3600};
  const verify=async(token:string)=>tgId(new Request('https://isolated.test',{headers:{authorization:'Bearer '+token}}),secret);
  const jwt=await signJwt(claims,secret);
  check('AI valid signed identity',await verify(jwt)===42);
  check('AI wrong signature rejected',await verify(await signJwt(claims,secret+'wrong'))===null);
  check('AI alg none rejected',await verify(b64u('{"alg":"none"}')+'.'+b64u(JSON.stringify(claims))+'.x')===null);
  for(const [label,extra] of [['expired',{exp:now-1}],['anonymous',{role:'anon'}],['mismatched subject',{tg_id:99}],['wrong audience',{aud:'other'}]] as const){check('AI '+label+' rejected',await verify(await signJwt({...claims,...extra},secret))===null)}
  return Response.json({project:'qnohynnwasoyjakrrrhb',runtime:Deno.version,passed:tests.length,tests,externalModelCalls:0});
 }catch(e){return Response.json({failed:String(e),passed:tests.length,tests},{status:500})}
});
`;
fs.mkdirSync('.local-tests',{recursive:true});
fs.writeFileSync('.local-tests/pr77-runtime-check.ts',helpers+runner);
console.log('Built test-only Deno probe from current PR sources.');
