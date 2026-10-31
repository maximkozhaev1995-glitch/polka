// Historical filename retained. Owner correction supersedes old unknown-brand ground truth:
// DAILY HOOKAH is a historical Starline name. Text stage only, NOT live OCR/API.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const evidence=JSON.parse(fs.readFileSync('tests/fixtures/unknown-brand-transcriptions.json','utf8'));
for(const file of ['src/stoika.html','index.html']){
 const s=fs.readFileSync(file,'utf8'),DATA=JSON.parse(s.match(/const DATA=(\[.*?\]);/s)[1]),before=JSON.stringify(DATA);
 const c=vm.createContext({DATA,norm:s=>s.toLowerCase().replace(/ё/g,'е'),aiItem:x=>({id:x.id,brand:x.b,name:x.n}),wh:()=>0,onBar:()=>false});
 vm.runInContext(s.slice(s.indexOf('const cnTxt='),s.indexOf('// Фото, прочитанное на сервере')),c);
 vm.runInContext(s.slice(s.indexOf('function photoInspectionText('),s.indexOf('// Corrections are suggestions only:')),c);
 for(const photo of evidence.photos)for(const label of photo.labels)test(file+': '+photo.filename+' '+label.flavor+' corrected existing Starline match',()=>{
  const raw=label.brand+' '+label.flavor,m=c.matchText('Фокус: '+label.brand+'\nЭтикетка 1: '+raw,true);
  assert.equal(m.outcomes[0].status,'known_product');assert.equal(m.outcomes[0].raw,raw);assert.equal(m.outcomes[0].brand,label.canonical_brand);assert.equal(m.found.length,1);assert.equal(m.found[0].id,label.expected_id);assert.equal(m.new_flavors.length,0);assert.equal(JSON.stringify(DATA),before);
  const inspected=c.photoInspectionText(['Этикетка 1: '+raw]);assert.match(inspected,/Starline/i);assert.doesNotMatch(inspected,/возможность добавления нового бренда/);
 });
 for(const photo of evidence.photos)test(file+': '+photo.filename+' same canonical brand keeps two physical labels separate',()=>{
  const a=photo.labels[0],b=photo.neighbor,raw=a.brand+' '+a.flavor,neighbor=b.brand+' '+b.flavor;
  const m=c.matchText('Фокус: DAILY HOOKAH\nЭтикетка 1: '+raw+'\nЭтикетка 2: '+neighbor,true);
  assert.deepEqual(Array.from(m.found,x=>x.id).sort(),[a.expected_id,b.expected_id].sort());assert(m.found.every(x=>x.jars===1));assert.deepEqual(Array.from(m.outcomes,x=>[x.raw,x.label_number]),[[raw,1],[neighbor,2]]);assert.equal(m.new_flavors.length,0);assert.equal(JSON.stringify(DATA),before);
 });
}
