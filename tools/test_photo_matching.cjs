// Offline regression checks; no credentials, network, or extra dependencies.
// Run: node tools/test_photo_matching.cjs
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const source=readFileSync(require('node:path').join(__dirname,'../src/stoika.html'),'utf8');
const DATA=JSON.parse(source.match(/const DATA=(\[.*?\]);/s)[1]);
const ctx=vm.createContext({DATA,norm:s=>s.toLowerCase().replace(/ё/g,'е'),aiItem:x=>({id:x.id,brand:x.b,name:x.n})});
vm.runInContext(source.slice(source.indexOf('const cnTxt='),source.indexOf('// Фото, прочитанное на сервере')),ctx);
const match=(text,photo=true)=>JSON.parse(JSON.stringify(vm.runInContext(`matchText(${JSON.stringify(text)},${photo})`,ctx)));
test('complete brand and name on one label match the catalog',()=>{
 assert.deepEqual(match('Этикетка 1: Darkside Supernova').found.map(x=>[x.brand,x.name]),[['Darkside','Supernova']]);
});
test('cropped, uncertain and misspelled labels do not become confident matches',()=>{
 for(const text of ['BONCHE COFF?','BONCHE COFF…','PALITRA Pear bate','Darkside Pearlescent','Darkside Supernova?']){
  const r=match('Этикетка 1: '+text);assert.equal(r.found.length,0,text);assert.equal(r.new_flavors.length,0,text);assert.equal(r.not_found_lines.length,1,text);
 }
});
test('brands and names from different labels or document lines never combine',()=>{
 for(const text of ['Этикетка 1: Darkside\nЭтикетка 2: Supernova','Darkside\nSupernova','Этикетка 1: Bonche Supernova'])assert.equal(match(text).found.length,0,text);
});
test('brandless and ambiguous labels remain unresolved',()=>{
 for(const text of ['Этикетка 1: Supernova','Этикетка 1: Cola','Этикетка 1: Darkside Supernova Dark Mint'])assert.equal(match(text).found.length,0,text);
});
test('repeated jars are counted while unknown labels remain visible',()=>{
 const r=match('Этикетка 1: Darkside Supernova\nЭтикетка 2: Darkside Supernova\nЭтикетка 3: BONCHE COFF?');
 assert.equal(r.found.length,1);assert.equal(r.found[0].jars,2);assert.deepEqual(r.not_found_lines,['BONCHE COFF?']);
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
 const r=match(labels.map((l,i)=>`Этикетка ${i+1}: ${l}`).join('\n'));
 assert.equal(r.found.length,13);
 assert.ok(r.found.every(x=>x.brand==='Black Burn'));
 assert.equal(r.found.reduce((n,x)=>n+x.jars,0),15);
 for(const name of ['Blueberry','Overdose'])assert.ok(r.found.some(x=>x.name===name));
 for(const name of ['Juicy Smoothie','Black Cola'])assert.equal(r.found.find(x=>x.name===name).jars,2);
 assert.deepEqual(r.not_found_lines,['JENT ?']);
});
