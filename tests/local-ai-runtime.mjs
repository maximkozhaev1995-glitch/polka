import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
// Executes the unchanged Edge Function source in a local Node compatibility
// harness. This is NOT a Deno/Supabase deployment or a gateway-auth test.
export async function loadLocalAI(localOrigin){
 const configuredBase=process.env.ANTHROPIC_API_KEY?'https://api.anthropic.com':process.env.ANTHROPIC_BASE_URL;
 if(!configuredBase||(!process.env.ANTHROPIC_API_KEY&&!process.env.ANTHROPIC_AUTH_TOKEN))throw Error('Claude access is not configured');
 const allowedOrigin=new URL(configuredBase).origin;
 const budgetFile=path.resolve('.local-tests/claude-b5-budget.json');
 let budget=fs.existsSync(budgetFile)?JSON.parse(fs.readFileSync(budgetFile,'utf8')):{limit:75,attempts:[]};
 const nativeFetch=globalThis.fetch;let unavailable=false;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(url.origin===allowedOrigin&&url.pathname.endsWith('/messages')){
   if(unavailable)return new Response(JSON.stringify({error:{type:'invalid_request_error',message:'Local circuit breaker: model source unavailable'}}),{status:400,headers:{'content-type':'application/json'}});
   if(budget.attempts.length>=75)return new Response(JSON.stringify({error:{type:'invalid_request_error',message:'Authorized 75-request budget exhausted'}}),{status:400,headers:{'content-type':'application/json'}});
   const record={number:budget.attempts.length+1,at:new Date().toISOString(),status:null};budget.attempts.push(record);fs.writeFileSync(budgetFile,JSON.stringify(budget,null,2));
   let response;try{response=await nativeFetch(input,{...init,signal:AbortSignal.timeout(60000)});record.status=response.status;const body=await response.clone().json().catch(()=>({}));record.model=body.model;record.usage=body.usage;record.errorType=body.error?.type;if(response.status===503)unavailable=true;}
   catch(e){record.errorType=e.name;unavailable=true;throw e}
   finally{fs.writeFileSync(budgetFile,JSON.stringify(budget,null,2));console.log('Claude requests used:',budget.attempts.length,'/ 75; last status:',record.status||record.errorType)}
   return response;
  }
  if(url.origin===localOrigin)return nativeFetch(input,init);
  throw Error('Local test blocked an unexpected outbound destination');
 };
 const values={SUPABASE_URL:localOrigin,SUPABASE_SERVICE_ROLE_KEY:'local-test-only',AI_PROVIDER:'claude',AI_MODEL:process.env.MIXORA_TEST_CLAUDE_MODEL||'claude-haiku-5-5',
  ANTHROPIC_API_KEY:process.env.ANTHROPIC_API_KEY,ANTHROPIC_AUTH_TOKEN:process.env.ANTHROPIC_AUTH_TOKEN,ANTHROPIC_BASE_URL:process.env.ANTHROPIC_BASE_URL};
 let handler;globalThis.Deno={env:{get:key=>values[key]},serve:fn=>{handler=fn}};
 let code=fs.readFileSync('supabase/functions/ai/index.ts','utf8').replace('"npm:@anthropic-ai/sdk"','"@anthropic-ai/sdk"').replace('"npm:@supabase/supabase-js@2"','"@supabase/supabase-js"');
 code=stripTypeScriptTypes(code,{mode:'transform'});
 const runtime=path.resolve('.local-tests/ai-runtime.mjs');fs.writeFileSync(runtime,code);await import(pathToFileURL(runtime).href+'?run='+Date.now());
 if(!handler)throw Error('Local AI handler did not initialise');return handler;
}
