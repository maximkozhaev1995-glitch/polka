const {readFileSync}=require('node:fs');
const {stripTypeScriptTypes}=require('node:module');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {test}=require('node:test');

const shim=readFileSync('app/shim.js','utf8');
const page=readFileSync('src/stoika.html','utf8');
const server=readFileSync('supabase/functions/ai/index.ts','utf8');
const section=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const photo={name:'fixture.jpg'};
const success={ocr:'fixture',ocr_texts:['Этикетка 1: Deus Kiwi']};

function client(respond){
 const requests=[];
 const context=vm.createContext({
  CFG:{url:'https://stand.invalid'},H:()=>({}),console:{warn(){}},
  fetch:async (url,options)=>{
   assert.equal(url,'https://stand.invalid/functions/v1/ai');
   const body=JSON.parse(options.body);
   requests.push(body);
   return respond(body);
  },
  FileReader:class { readAsDataURL(){this.onload()} },
  Image:class { width=1;height=1;set src(value){this.onload()} },
  document:{createElement:()=>({getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,AA=='})},
 });
 vm.runInContext(section(shim,'  const imgToBlock=','  const sample=')+'\nthis.readLabels=readLabels',context);
 return {readLabels:context.readLabels,requests};
}

test('inspection sends its version and regular OCR sends neither inspection field',async()=>{
 const {readLabels,requests}=client(body=>Response.json({...success,inspection:body.photo_mode==='inspection'}));
 assert.equal((await readLabels([photo],null,{inspection:true})).failed,0);
 assert.equal((await readLabels([photo])).failed,0);
 assert.equal(requests.length,2);
 assert.equal(requests[0].ocr_only,true);
 assert.equal(requests[0].photo_mode,'inspection');
 assert.equal(requests[0].observation_schema_version,1);
 for(const field of ['photo_mode','observation_schema_version'])assert.equal(Object.hasOwn(requests[1],field),false);
});

test('409 displays an incompatible client error without retry or mutation fallback',async()=>{
 const {readLabels,requests}=client(()=>Response.json({error:'client_update_required'},{status:409}));
 const box={value:'Что на фото?'},out={classList:new Set()};
 out.classList.remove=out.classList.delete.bind(out.classList);
 let mutations=0;
 const context=vm.createContext({
  AbortController,$:()=>box,aiImgs:[photo],aiCtl:null,lastPhotoIds:[],
  sampleFn:Object.assign(()=>{mutations++;throw Error('Unexpected tool loop')},{readLabels}),
  cancelAiProposals(){},renderAiImgs(){},parseCmd:()=>null,photoInspection:()=>true,
  attachMessagePhotos(){},aiBubble:role=>role==='assistant'?out:{},aiUi(){},render(){},
  photoInspectionText:()=> 'Generic OCR error',
  runCmd(){mutations++;throw Error('Unexpected mutation command')},
 });
 vm.runInContext(page.split('\n').find(line=>line.startsWith('function aiErr(')),context);
 vm.runInContext(section(page,'async function inspectPhoto(','// Corrections are suggestions only:'),context);
 vm.runInContext(section(page,'async function aiSend()','// Короткая память чата:'),context);
 await context.aiSend();
 assert.equal(requests.length,1);
 assert.match(out.textContent,/Несовместимая версия клиента/);
 assert(out.classList.has('err'));
 assert.equal(mutations,0);
});

test('inspection keeps structured observations aligned with their photos',async()=>{
 const target={raw_label:'Overdose амбровый ба?ан',visibility:'target'};
 const fragment={raw_label:'Black Burn Pudding',visibility:'fragment'};
 const {readLabels,requests}=client(()=>Response.json({...success,inspection:true,observations:[[target,fragment]]}));
 const result=await readLabels([photo,photo],null,{inspection:true});
 assert.deepEqual(JSON.parse(JSON.stringify(result.observations)),[[target,fragment],[target,fragment]]);
 assert.equal(requests.length,2);
 assert.equal(Object.hasOwn(await readLabels([photo]),'observations'),false);
});

test('local ai handler supports versioned inspection and regular OCR',async()=>{
 let handler;
 const ocrModes=[];
 const local=vm.createContext({
  Deno:{serve:fn=>{handler=fn},env:{get:name=>name==='ANTHROPIC_API_KEY'?'test-fixture':null}},
  tgId:async()=>1,Anthropic:class {},
  createClient:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{venue_id:'fixture'}})})})})}),
  venuePhotoHints:async()=>'',out:(body,status=200)=>Response.json(body,{status}),
  readPhotos:async (provider,messages,hints,inspection)=>{
   ocrModes.push(inspection===true);
   return {by:success.ocr,texts:success.ocr_texts,...(inspection?{inspection:true,observation_schema_version:1,observations:[[]]}:{})};
  },
 });
 vm.runInContext(stripTypeScriptTypes(server.slice(server.indexOf('Deno.serve(')),{mode:'strip'}),local);
 const {readLabels,requests}=client(body=>handler(new Request('https://stand.invalid',{method:'POST',body:JSON.stringify(body)})));
 for(const inspection of [true,false]){
  const result=await readLabels([photo],null,{inspection});
  assert.equal(result.failed,0);
  assert.match(result.text,/Deus Kiwi/);
 }
 assert.deepEqual(ocrModes,[true,false]);
 assert.equal(requests[0].observation_schema_version,1);
});

