// Independent worker viewed actual Drive pixels. This executes only transcribed text,
// never OCR, a model, Supabase, stock or order writes. See provenance manifest.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const evidence=JSON.parse(fs.readFileSync('tests/fixtures/unknown-brand-transcriptions.json','utf8'));
for(const file of ['src/stoika.html','index.html']){
 const s=fs.readFileSync(file,'utf8'),DATA=JSON.parse(s.match(/const DATA=(\[.*?\]);/s)[1]);
 const before=JSON.stringify(DATA),c=vm.createContext({DATA,norm:s=>s.toLowerCase().replace(/ё/g,'е'),aiItem:x=>({id:x.id,brand:x.b,name:x.n}),wh:()=>0,onBar:()=>false});
 vm.runInContext(s.slice(s.indexOf('const cnTxt='),s.indexOf('// Фото, прочитанное на сервере')),c);
 vm.runInContext(s.slice(s.indexOf('let photoAcc=null'),s.indexOf('// Новый вкус с фото')),c);
 vm.runInContext(s.slice(s.indexOf('function photoInspectionText('),s.indexOf('// Corrections are suggestions only:')),c);
 assert(!DATA.some(x=>x.b.replace(/\W/g,'').toLowerCase()==='dailyhookah'));
 for(const photo of evidence.photos)for(const label of photo.labels){
  const raw=label.brand+' '+label.flavor,input='Фокус: '+label.brand+'\nЭтикетка 1: '+raw;
  test(file+': '+photo.filename+' '+label.flavor+' remains review-only',()=>{
   const m=c.matchText(input,true);assert.equal(m.outcomes[0].status,'unknown_brand');assert.equal(m.outcomes[0].raw,raw);assert.equal(m.outcomes[0].brand,label.brand);assert.equal(m.outcomes[0].flavor_id,undefined);
   assert.equal(m.found.length,0);assert.equal(m.new_flavors.length,0);assert.deepEqual(Object.keys(m.jars_by_brand),[]);
   assert.match(c.photoReviewText(m),/возможность добавления нового бренда/);
   const inspected=c.photoInspectionText(['Этикетка 1: '+raw]);assert(inspected.includes(raw));assert.match(inspected,/возможность добавления нового бренда/);
   vm.runInContext('photoAcc=photoAccNew()',c);c.photoNote(input);assert.equal(vm.runInContext('photoAcc.newf.length',c),0);assert.equal(vm.runInContext('Object.keys(photoAcc.jars).length',c),0);assert.equal(JSON.stringify(DATA),before);
  });
 }
 for(const photo of evidence.photos)test(file+': '+photo.filename+' DAILY and neighboring STARLINE never combine',()=>{
  const a=photo.labels[0],raw=a.brand+' '+a.flavor,neighbor=photo.neighbor.brand+' '+photo.neighbor.flavor;
  const input='Фокус: DAILY HOOKAH\nЭтикетка 1: '+raw+'\nЭтикетка 2: '+neighbor,m=c.matchText(input,true);
  assert.equal(m.found.length,0);assert.equal(m.new_flavors.length,0);assert.equal(m.outcomes[0].status,'unknown_brand');assert.equal(m.outcomes[0].raw,raw);assert.equal(m.outcomes[1].raw,neighbor);assert.equal(m.outcomes[1].status,'unreadable');assert(m.outcomes.every(x=>!x.flavor_id));
  const inspected=c.photoInspectionText(['Этикетка 1: '+raw+'\nЭтикетка 2: '+neighbor]);assert(inspected.includes(raw));assert.match(inspected,/возможность добавления нового бренда/);assert(!inspected.includes('DAILY HOOKAH '+photo.neighbor.flavor));
 });
}
