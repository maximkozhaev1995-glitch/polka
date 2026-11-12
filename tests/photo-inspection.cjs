// Synthetic observations exercise structured inspection without depending on private photos or fixtures.
// The provider mock exercises the production adapter; it performs no network or OCR calls.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {stripTypeScriptTypes} = require('node:module');
const fixture = {pages:[10,10,6,12,6].map((count,page)=>{
  const observations = Array.from({length:count},(_,i)=>({
    label_index:i+1,raw_label:'Deus Kiwi',visibility:'target',confidence:'high',
    reason:'synthetic fixture',bbox:[0.1,0.1,0.2,0.2],
  }));
  if (page === 0) observations[0].raw_label='DEUS BLACK JI?';
  if (page === 2) observations[0].raw_label='DAILY HOOKAH МЯТНАЯ ПАСТИЛКА';
  if (page === 3) observations.push({...observations[0],label_index:count+1,visibility:'fragment'});
  return observations;
})};

const source = fs.readFileSync('src/stoika.html','utf8');
const server = fs.readFileSync('supabase/functions/ai/index.ts','utf8');
function between(text, start, end) {
  const from=text.indexOf(start), to=text.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from,'Cannot locate '+start);
  return text.slice(from,to);
}
const DATA = JSON.parse(source.match(/const DATA=(\[.*?\]);/s)[1]);
const app = vm.createContext({DATA,norm:s=>s.toLowerCase().replace(/ё/g,'е'),aiItem:x=>({id:x.id,brand:x.b,name:x.n})});
vm.runInContext(between(source,'const cnTxt=','// Фото, прочитанное на сервере'),app);
vm.runInContext(between(source,'function normalizeInspectionPage(','async function clarifyInspectionLabels('),app);
vm.runInContext(between(source,'function photoInspectionText(','async function clarifyPhotoTransfer('),app);
const edge = vm.createContext({Deno:{env:{get:()=>null}},console});
vm.runInContext(between(server,'const PHOTO_PROMPT = ','// Human-verified'),edge);
vm.runInContext(stripTypeScriptTypes(between(server,'function ocrError(','async function readPhotos(')),edge);

const textFor = obs=>'Фокус: ?\n'+obs.map(x=>'Этикетка '+x.label_index+': '+x.raw_label).join('\n');
const raw = fixture.pages.map(textFor);
const pages = raw.map((text,i)=>app.normalizeInspectionPage(text,fixture.pages[i]));
assert.deepEqual(pages.map(x=>x.targetCount),[10,10,6,12,6]);
assert.equal(app.normalizeInspectionPage(raw[0],undefined),null);
assert.equal(app.normalizeInspectionPage(raw[0].replace('BLACK JI?','DIFFERENT'),fixture.pages[0]),null);
assert.equal(app.normalizeInspectionPage(raw[0],fixture.pages[0].slice(1)),null);
const summary = app.photoInspectionText(raw,fixture.pages);
assert.match(summary,/Всего банок: 44/);
assert.match(summary,/DAILY HOOKAH МЯТНАЯ ПАСТИЛКА → Starline Мятная пастилка/);
assert.match(summary,/Сомнительные надписи:\n• DEUS BLACK JI\?/);
const extra = ['Deus Kiwi','Deus Kiwi','Zzz Unknown','Satyr ?'].map((raw_label,i)=>({
  ...fixture.pages[0][0],raw_label,label_index:i+1
}));
const duplicate = app.photoInspectionText([textFor(extra)],[extra]);
assert.equal((duplicate.match(/→ Deus Kiwi/g)||[]).length,2);
assert.match(duplicate,/Не найдены в каталоге:\n• Zzz Unknown/);
assert.match(duplicate,/Сомнительные надписи:\n• Satyr \?/);
assert.match(app.photoInspectionText([{failed:'network'},raw[2]],[null,fixture.pages[2]]),/Фото 1: не удалось прочитать/);
assert.match(app.photoInspectionText([raw[0]],[]),/нет данных для подсчёта/);
assert.match(source,/ФОРМАТ МИКСОВ/);
assert.match(source,/Цену называй только по прямому запросу/);

const messages = ()=>[{role:'user',content:[{type:'image',source:{}}]}];
async function read(text,inspection=true) {
  let prompt;
  const client={messages:{create:async (input,opts)=>{
    assert.equal(opts.maxRetries,0);
    prompt=input.messages[0].content[1].text;
    return {content:[{type:'thinking',thinking:'fixture'},{type:'text',text}],stop_reason:'end_turn'};
  }}};
  const reply=await edge.claudeReadPhotos(client,messages(),'',inspection);
  return {reply,prompt};
}
(async()=>{
  const original = fixture.pages[2];
  const labels = original.map(({raw_label,visibility,confidence,reason,bbox})=>{
    const split = raw_label.indexOf(' ');
    return {brand:raw_label.slice(0,split),flavor:raw_label.slice(split+1),visibility,confidence,reason,bbox};
  });
  const {reply,prompt}=await read(JSON.stringify({complete:true,no_jars:false,labels}));
  assert.match(prompt,/Верни только JSON/);
  assert.equal(reply.observation_schema_version,1);
  assert.deepEqual(JSON.parse(JSON.stringify(reply.observations[0])),original);
  assert.equal(reply.texts[0],raw[2]);
  await assert.rejects(read(raw[2]),e=>e.code==='ocr_malformed');
  await assert.rejects(read(JSON.stringify({complete:false})),e=>e.code==='ocr_incomplete');
  assert.match((await read(raw[2],false)).prompt,/Читай только банки этого бренда/);

  // Explicit read-only requests may display the selection, but cannot register a batch or offer actions.
  let options, saved=0;
  const readOnly=vm.createContext({
    aiPhotoNegative:()=>true,
    cmdFindIds:async (_args,_imgs,_signal,opts)=>{
      options=opts; return {inspectionPages:[],m:{found:[],not_found_lines:[]}};
    },
    aiRememberPhotoBatch:()=>{saved++},aiPhotoSummary:()=> 'Проверено',
  });
  vm.runInContext('let lastPhotoIds=["old"];'+between(source,'async function inspectPhoto(','function showPhotoActions('),readOnly);
  const out={};
  await readOnly.inspectPhoto(out,'только посчитай, ничего не делай',[{}],null);
  assert.equal(options.inspection,true);assert.equal(options.out,null);assert.equal(saved,0);
  assert.equal(vm.runInContext('lastPhotoIds.length',readOnly),0);
  console.log('PASS five structured pages, 44 targets, duplicate jars, packaging alias, unknown and uncertain labels, strict schema, read-only route and separate provider prompts');
})().catch(e=>{console.error(e);process.exitCode=1});
