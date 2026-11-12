import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { webcrypto } from 'node:crypto';

const source = fs.readFileSync(new URL('../supabase/functions/ai/index.ts', import.meta.url), 'utf8');
const epoch = '12345678-1234-1234-1234-123456789abc';
const fakeEnv = { APP_JWT_SECRET: 'offline-fixture-not-a-real-secret', ANTHROPIC_AUTH_TOKEN: 'offline-fixture-token', ANTHROPIC_BASE_URL: 'https://router.cheap', SUPABASE_URL: 'https://wwcgvwfmlkegaqkksujo.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'offline-fixture-service' };

async function fixture(photoText = 'Фокус: Musthave\nЭтикетка 1: Musthave Coconut Shake') {
  let handler, modelCalls = 0, requestedModel;
  class Anthropic {
    messages = { create: async body => {
      modelCalls++; requestedModel = body.model;
      return { model: body.model, stop_reason: 'end_turn', content: [{type:'text',text:photoText}], usage: {input_tokens:1,output_tokens:1} };
    } };
  }
  const createClient = () => ({
    from: table => ({ select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return {data:[],error:null}; }, maybeSingle() { return {data:table==='users'?{tg_id:123,venue_id:'offline-venue',membership_epoch:epoch}:null,error:null}; } }),
    rpc: async () => ({data:1,error:null}),
  });
  const sandbox = { Anthropic, createClient, Response, Request, Headers, TextEncoder, TextDecoder, atob, btoa, AbortSignal, setTimeout, crypto:webcrypto, URL, console:{log(){},error(){},warn(){}}, fetch:()=>{throw Error('NETWORK_FORBIDDEN');}, Deno:{env:{get:key=>fakeEnv[key]},serve:fn=>{handler=fn;}} };
  const code = stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm,''));
  vm.runInNewContext(code,sandbox);
  const b64 = data => Buffer.from(JSON.stringify(data)).toString('base64url');
  const now = Math.floor(Date.now()/1000);
  const unsigned = b64({alg:'HS256',typ:'JWT'})+'.'+b64({role:'authenticated',aud:'authenticated',sub:'123',tg_id:123,membership_epoch:epoch,iat:now,exp:now+600});
  const key = await webcrypto.subtle.importKey('raw',new TextEncoder().encode(fakeEnv.APP_JWT_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const token = unsigned+'.'+Buffer.from(await webcrypto.subtle.sign('HMAC',key,new TextEncoder().encode(unsigned))).toString('base64url');
  return {call: body=>handler(new Request('https://offline.invalid/ai',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)})),state:()=>({modelCalls,requestedModel})};
}

const image = {type:'image',source:{type:'base64',media_type:'image/jpeg',data:'offline-image'}};
test('production rejects old inspection client before any paid model call',async()=>{
  const f=await fixture();
  const r=await f.call({ocr_only:true,photo_mode:'inspection',messages:[{role:'user',content:[image]}]});
  assert.equal(r.status,409);
  assert.deepEqual(await r.json(),{error:'client_update_required'});
  assert.equal(f.state().modelCalls,0);
});
test('production normal photo reader still defaults to Sonnet',async()=>{
  const f=await fixture();
  const r=await f.call({ocr_only:true,messages:[{role:'user',content:[image]}]});
  assert.equal(r.status,200);
  const body=await r.json();
  assert.equal(body.model,'claude-sonnet-5-5');
  assert.equal(body.ocr,'sonnet');
  assert.equal(body.ocr_texts.length,1);
  assert.equal(f.state().modelCalls,1);
});
test('production text assistant retains the current provider',async()=>{
  const f=await fixture();
  const r=await f.call({system:'offline fixture',messages:[{role:'user',content:'hello'}],tools:[]});
  assert.equal(r.status,200);
  assert.equal((await r.json()).model,'claude-haiku-5-5');
  assert.equal(f.state().modelCalls,1);
});

test('empty shelf report is incomplete and never retried', async () => {
  const f = await fixture(JSON.stringify({complete:true, no_jars:true, labels:[]}));
  const r = await f.call({ocr_only:true,photo_mode:'inspection',observation_schema_version:1,messages:[{role:'user',content:[image]}]});
  assert.equal(r.status,502);
  assert.deepEqual(await r.json(),{error:'ocr_incomplete'});
  assert.equal(f.state().modelCalls,1);
});
