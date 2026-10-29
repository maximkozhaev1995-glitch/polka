// Offline regression checks; no credentials, network, or extra dependencies.
// Run with Node 24+: node tools/test_photo_matching.cjs
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const source=readFileSync(require('node:path').join(__dirname,'../src/stoika.html'),'utf8');
const DATA=JSON.parse(source.match(/const DATA=(\[.*?\]);/s)[1]);
const ctx=vm.createContext({DATA,norm:s=>s.toLowerCase().replace(/ё/g,'е'),aiItem:x=>({id:x.id,brand:x.b,name:x.n})});
vm.runInContext(source.slice(source.indexOf('const cnTxt='),source.indexOf('// Фото, прочитанное на сервере')),ctx);
const match=(text,photo=true)=>JSON.parse(JSON.stringify(vm.runInContext(`matchText(${JSON.stringify(photo&&!/^Фокус:/m.test(text)?'Фокус: Darkside\n'+text:text)},${photo})`,ctx)));
test('complete brand and name on one label match the catalog',()=>{
 assert.deepEqual(match('Этикетка 1: Darkside Supernova').found.map(x=>[x.brand,x.name]),[['Darkside','Supernova']]);
});
test('isolated unreadable word before a complete name preserves exact match',()=>{
 const r=match('Фокус: BLACKBURN\nЭтикетка 1: BLACKBURN ? CURRANT SHOCK КИСЛАЯ ЧЕРНАЯ СМОРОДИНА');
 assert.deepEqual(r.found.map(x=>x.name),['Currant Shock']);assert.deepEqual(r.not_found_lines,[]);
 for(const label of ['BLACKBURN CURRANT SHOCK?', 'BLACKBURN ? CURRANT', 'BLACKBURN ? CURRANT SHOCK CHERRY SHOCK'])assert.equal(match('Фокус: BLACKBURN\nЭтикетка 1: '+label).found.length,0,label);
});
test('cropped, uncertain and unrelated labels do not become confident matches',()=>{
 for(const text of ['BONCHE COFF?','BONCHE COFF…','Darkside Pearlescent','Darkside Supernova?']){
  const brand=text.startsWith('BONCHE')?'Bonche':text.startsWith('PALITRA')?'Palitra':'Darkside';
  const r=match('Фокус: '+brand+'\nЭтикетка 1: '+text);assert.equal(r.found.length,0,text);assert.equal(r.new_flavors.length,0,text);assert.equal(r.not_found_lines.length,1,text);
 }
});
test('unique brand-scoped OCR spelling errors do resolve to a known catalog flavor',()=>{
 const r=match('Фокус: Palitra\nЭтикетка 1: PALITRA Pear bate');
 assert.deepEqual(r.found.map(x=>x.name),['Pear Date']);
 assert.deepEqual(r.not_found_lines,[]);
});
test('brands and names from different labels or document lines never combine',()=>{
 for(const text of ['Этикетка 1: Darkside\nЭтикетка 2: Supernova','Darkside\nSupernova','Этикетка 1: Bonche Supernova'])assert.equal(match(text).found.length,0,text);
});
test('brandless and ambiguous labels remain unresolved',()=>{
 for(const text of ['Этикетка 1: Supernova','Этикетка 1: Cola','Этикетка 1: Darkside Supernova Dark Mint'])assert.equal(match(text).found.length,0,text);
});
test('repeated jars are counted while unknown labels remain visible',()=>{
 const r=match('Этикетка 1: Darkside Supernova\nЭтикетка 2: Darkside Supernova\nЭтикетка 3: Darkside Supernova?');
 assert.equal(r.found.length,1);assert.equal(r.found[0].jars,2);assert.deepEqual(r.not_found_lines,['Darkside Supernova?']);
});
test('full-name lines without label numbering work without cross-line guessing',()=>{
 assert.equal(match('Darkside Supernova\nDarkside Dark Mint').found.length,2);
});
test('text lookup keeps its existing fuzzy label support',()=>{
 assert.equal(match('Этикетка 1: PALITRA Pear bate',false).found[0].name,'Pear Date');
});
test('owner photo: 15 Black Burn jars, bilingual labels, repetitions, cropped bottom row',()=>{
 // Manual transcription of visible labels, not a claim about the remote OCR output.
 const labels=[
  'BLACK BURN RED ORANGE Красный апельсин',
  'BLACK BURN JUICY SMOOTHIE Тропический смузи',
  'BLACK BURN PEACH YOGURT Персиковый йогурт',
  'BLACK BURN REAL P. F. Настоящая маракуйя',
  'BLACK BURN BLACK COLA Черная кола',
  'BLACKBURN BLACK HONEY Мед',
  'BLACK BURN JUICY SMOOTHIE Тропический смузи',
  'BLACK BURN BLACK COLA Черная кола',
  'BLACKBURN BLUEBERRY Голубика',
  'BLACKBURN GOOSEBERRY SHOCK Кислый крыжовник',
  'BLACK BURN SHOCK CURRANT SHOCK Черная смородина',
  'BLACK BURN EPIC YOGURT Черничный йогурт',
  'BLACK BURN OVER DOSE Лимон лайм',
  'BLACK BURN CHERRY SHOCK Кислая вишня',
  'BLACKBURN BANANINI Банан',
  'JENT ?'
 ];
 const r=match('Фокус: BLACKBURN\n'+labels.map((l,i)=>`Этикетка ${i+1}: ${l}`).join('\n'));
 assert.equal(r.found.length,13);
 assert.ok(r.found.every(x=>x.brand==='Black Burn'));
 assert.equal(r.found.reduce((n,x)=>n+x.jars,0),15);
 for(const name of ['Blueberry','Overdose'])assert.ok(r.found.some(x=>x.name===name));
 for(const name of ['Juicy Smoothie','Black Cola'])assert.equal(r.found.find(x=>x.name===name).jars,2);
 assert.deepEqual(r.not_found_lines,[]);
});
test('complete background brands are excluded even when the catalog match is exact',()=>{
 const r=match('Фокус: BLACKBURN\nЭтикетка 1: BLACKBURN RED ORANGE\nЭтикетка 2: Starline Вишня\nЭтикетка 3: Jent Лимон');
 assert.deepEqual(r.found.map(x=>x.brand),['Black Burn']);assert.deepEqual(r.not_found_lines,[]);
 assert.deepEqual(Object.keys(r.jars_by_brand),['Black Burn']);
});
test('focus is spatial metadata, not a majority vote over background labels',()=>{
 const r=match('Фокус: Darkside\nЭтикетка 1: Darkside Supernova\n'+Array.from({length:10},(_,i)=>`Этикетка ${i+2}: Starline Вишня`).join('\n'));
 assert.equal(r.found.length,1);assert.equal(r.found[0].brand,'Darkside');
});
test('missing or ambiguous focus yields no actionable items',()=>{
 for(const raw of ['Этикетка 1: Darkside Supernova','Фокус: ?\nЭтикетка 1: Darkside Supernova']){
  const r=JSON.parse(JSON.stringify(vm.runInContext(`matchText(${JSON.stringify(raw)},true)`,ctx)));assert.equal(r.found.length,0);
 }
});
test('each photo has its own focus and label numbering',()=>{
 const r=match('Фото 1:\nФокус: Black Burn\nЭтикетка 1: BLACKBURN RED ORANGE\nЭтикетка 2: Jent Лимон\nФото 2:\nФокус: Darkside\nЭтикетка 1: Darkside Supernova\nЭтикетка 2: Starline Вишня');
 assert.deepEqual(r.found.map(x=>x.brand),['Black Burn','Darkside']);
});
vm.runInContext(source.slice(source.indexOf('function photoTools('),source.indexOf('const AI_TOOLS=[')),ctx);
test('all mutation tools reject background IDs before execution',()=>{
 const tools=['stage_stock','set_order','set_flag'].map(name=>({name,execute:()=>{throw Error('executed')}}));
 ctx.focusTestTools=tools;ctx.focusTestAcc={jars:{center:1}};
 for(const name of tools.map(x=>x.name)){
  assert.throws(()=>vm.runInContext(`photoTools(focusTestTools,focusTestAcc).find(t=>t.name===${JSON.stringify(name)}).execute({id:'background'})`,ctx),/основного бренда/);
  assert.throws(()=>vm.runInContext(`photoTools(focusTestTools,focusTestAcc).find(t=>t.name===${JSON.stringify(name)}).execute({id:'center'})`,ctx),/executed/);
 }
 assert.throws(()=>vm.runInContext("photoTools(focusTestTools,focusTestAcc).find(t=>t.name==='set_order').execute({ids:['center','background']})",ctx),/основного бренда/);
});
const server=readFileSync(require('node:path').join(__dirname,'../supabase/functions/ai/index.ts'),'utf8');
const geometry=vm.createContext({});
vm.runInContext(require('node:module').stripTypeScriptTypes(server.slice(server.indexOf('function ocrBox('),server.indexOf('async function yandexOcr(')),{mode:'strip'}),geometry);
test('reserve OCR selects a large central label and excludes small distant labels',()=>{
 const block=(text,x0,y0,x1,y1)=>({lines:[{text}],boundingBox:{vertices:[{x:x0,y:y0},{x:x1,y:y1}]}});
 geometry.blocks=[block('BLACKBURN RED ORANGE',10,10,110,60),block('BLACKBURN BLACK COLA',120,70,220,120),block('BLACKBURN BLUEBERRY',230,130,330,180),...Array.from({length:10},(_,i)=>block('Starline Вишня',i*30,210,i*30+12,216))];
 const labels=JSON.parse(JSON.stringify(vm.runInContext('labelGroups(blocks,true)',geometry)));
 assert.equal(labels[0],'Фокус: BLACKBURN BLACK COLA');assert.ok(labels.every(t=>!t.includes('Starline')));
});
test('reserve OCR without coordinates never infers the central brand',()=>{
 geometry.blocks=[{lines:[{text:'Starline Вишня'}]}];
 assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('labelGroups(blocks,true)',geometry))),['Фокус: ?']);
});
