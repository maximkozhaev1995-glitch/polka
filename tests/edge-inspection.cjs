const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync('supabase/functions/ai/index.ts','utf8');
function runtime(response,env={}){
 let handler,calls=0,fallbackCalls=0;
 const ctx=vm.createContext({
  Response,Request,AbortController,console:{log(){},error(){}},
  Deno:{env:{get:n=>Object.hasOwn(env,n)?env[n]:n==='ANTHROPIC_API_KEY'?'synthetic':null},serve:f=>handler=f},
  Anthropic:class{messages={create:async()=>{calls++;if(response instanceof Error)throw response;return response}}},
  createClient:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{venue_id:'fixture'}})})})})}),
  tgId:async()=>1,venuePhotoHints:async()=>'',out:(b,s=200)=>Response.json(b,{status:s}),
  yandexOcr:async()=>{fallbackCalls++;return false},
  PHOTO_PROMPT:'ordinary',PHOTO_INSPECTION_PROMPT:'inspection',
 });
 const start=source.indexOf('function ocrError');
 const fallback=source.indexOf('async function claudeReadPhotos');
 vm.runInContext(stripTypeScriptTypes(source.slice(start>=0?start:fallback),{mode:'strip'}),ctx);
 return {send:body=>handler(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify(body)})),calls:()=>calls,fallbackCalls:()=>fallbackCalls};
}
const body=()=>({ocr_only:true,photo_mode:'inspection',observation_schema_version:1,messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:'image/jpeg',data:'AA=='}}]}]});
const label={brand:'Palitra',flavor:'?',reason:'partially legible',visibility:'target',confidence:'low',bbox:[0,0,0.5,0.5]};
test('inspection returns structured target including partial label',async()=>{
 const r=runtime({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({complete:true,no_jars:false,labels:[label]})}]});
 const res=await r.send(body());assert.equal(res.status,200);
 const data=await res.json();assert.equal(data.observation_schema_version,1);
 assert.equal(data.observations[0][0].visibility,'target');assert.match(data.observations[0][0].raw_label,/Palitra/);assert.equal(r.calls(),1);
});
test('unversioned inspection rejects before model call',async()=>{
 const r=runtime({stop_reason:'end_turn',content:[{type:'text',text:'Palitra Pear Date'}]});const b=body();delete b.observation_schema_version;
 const res=await r.send(b);assert.equal(res.status,409);assert.equal((await res.json()).error,'client_update_required');assert.equal(r.calls(),0);
});
test('malformed or truncated inspection never falls back or retries',async()=>{
 for(const reply of [{stop_reason:'max_tokens',content:[]},{stop_reason:'end_turn',content:[{type:'text',text:'not json'}]}]){
  const r=runtime(reply),res=await r.send(body());assert.equal(res.status,502);assert.equal(r.calls(),1);assert.equal(r.fallbackCalls(),0);
 }
});
test('regular OCR has no inspection fields',async()=>{
 const r=runtime({stop_reason:'end_turn',content:[{type:'text',text:'Palitra Pear Date'}]});
 const b=body();delete b.photo_mode;delete b.observation_schema_version;
 const res=await r.send(b),data=await res.json();assert.equal(res.status,200);
 assert.equal(data.ocr_texts[0],'Palitra Pear Date');
 for(const k of ['observations','observation_schema_version','inspection'])assert.equal(Object.hasOwn(data,k),false);
});

test('inspection rejects invalid scope, incomplete output and invented fields',async()=>{
 for(const payload of [
  {complete:false,no_jars:false,labels:[label]},
  {complete:true,no_jars:false,labels:[{...label,visibility:'background'}]},
  {complete:true,no_jars:false,labels:[{...label,bbox:[0.9,0,0.5,0.5]}]},
  {complete:true,no_jars:false,labels:[{...label,catalog_id:'invented'}]},
  {complete:true,no_jars:true,labels:[label]},
 ]){
  const r=runtime({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(payload)}]});
  const res=await r.send(body());assert.equal(res.status,502);assert.equal(r.calls(),1);
 }
});

test('empty inspection is explicit and provider errors are terminal',async()=>{
 const empty=runtime({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({complete:true,no_jars:true,labels:[]})}]});
 const res=await empty.send(body());assert.equal(res.status,200);assert.deepEqual((await res.json()).observations,[[]]);
 for(const [reply,status,code] of [
  [Object.assign(new Error('timed out'),{name:'APIConnectionTimeoutError'}),504,'ocr_timeout'],
  [new Error('provider unavailable'),503,'ocr_unavailable'],
  [{stop_reason:'refusal',content:[]},422,'image_rejected'],
 ]){
  const r=runtime(reply),res=await r.send(body());assert.equal(res.status,status);assert.equal((await res.json()).error,code);assert.equal(r.calls(),1);assert.equal(r.fallbackCalls(),0);
 }
 const disabled=runtime({}, {PHOTO_READER:'yandex'});
 assert.equal((await disabled.send(body())).status,503);assert.equal(disabled.calls(),0);
});

test('invalid request never reaches vision provider',async()=>{
 for(const mutate of [b=>b.messages=[],b=>b.messages[0].content.push(b.messages[0].content[0]),b=>b.photo_mode='invalid',b=>b.observation_schema_version=2]){
  const r=runtime({}),b=body();mutate(b);const res=await r.send(b);
  assert.ok([400,409].includes(res.status));assert.equal(r.calls(),0);
 }
});

