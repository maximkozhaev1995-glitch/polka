// Exercise the real matcher and rendered hints in source and built app. No network or DB writes.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test');
const app=fs.readFileSync('src/stoika.html','utf8'),shim=fs.readFileSync('app/shim.js','utf8');
for(const file of ['src/stoika.html','index.html']){
 const source=fs.readFileSync(file,'utf8');
 const DATA=JSON.parse(source.match(/const DATA=(\[.*?\]);/s)[1]);
 const pear=DATA.find(x=>x.b==='Palitra'&&x.n==='Pear Date');
 assert(pear,'real golden catalog flavor must exist');
 const ctx=vm.createContext({DATA,byId:Object.fromEntries(DATA.map(x=>[x.id,x])),
  norm:s=>s.toLowerCase().replace(/ё/g,'е'),aiItem:x=>({id:x.id,brand:x.b,name:x.n}),wh:()=>2,onBar:()=>false});
 vm.runInContext(source.slice(source.indexOf('const cnTxt='),source.indexOf('// Фото, прочитанное на сервере')),ctx);
 vm.runInContext(source.slice(source.indexOf('let learnedPhoto=[];'),source.indexOf('function offerPhotoCorrection(')),ctx);
 const run=(text,raw='PALITRA Pear bate',id=pear.id)=>{
  ctx.records=[{raw_label:raw,flavor_id:id}];ctx.input=text;
  vm.runInContext('learnedPhoto=records',ctx);
  return {match:vm.runInContext('matchText(input,true)',ctx),hints:vm.runInContext('learnedHints(input)',ctx)};
 };
 const photo=(label,focus='Palitra')=>'Фокус: '+focus+'\nЭтикетка 1: '+label;
 test(file+': exact normalized correction is matched and displayed',()=>{
  for(const label of ['PALITRA Pear bate','palitra PEAR BATE','PALITRA  Pear bate']){
   const r=run(photo(label));assert.equal(r.match.found[0]?.id,pear.id);assert.match(r.hints,/Palitra Pear Date/);assert.match(r.hints,/на стойке: нет/);
  }
 });
 test(file+': different OCR text does not reuse a correction',()=>{
  const r=run(photo('PALITRA Pear bite'));assert.equal(r.match.found.length,0);assert.equal(r.hints,'');
 });
 test(file+': uncertainty on current OR saved label is never normalized into approval',()=>{
  for(const marker of ['?','…','...']){
   for(const [label,raw] of [['PALITRA Pear bate'+marker,'PALITRA Pear bate'],['PALITRA Pear bate','PALITRA Pear bate'+marker]]){
    const r=run(photo(label),raw);if(label.endsWith(marker))assert.equal(r.match.found.length,0,label+' / '+raw);assert.equal((r.match.approved_labels||[]).length,0);assert.equal(r.hints,'');
   }
  }
 });
 test(file+': missing, uncertain and different focus cannot display an approval',()=>{
  for(const focus of ['?','Palitra?','Palitra…','Palitra...','Overdose','НЕИЗВЕСТНО']){
   const r=run(photo('PALITRA Pear bate',focus));assert.equal(r.match.found.length,0,focus);assert.equal(r.hints,'',focus);
  }
  const r=run('Этикетка 1: PALITRA Pear bate');assert.equal(r.match.found.length,0);assert.equal(r.hints,'');
 });
 test(file+': visible conflicting brand cannot match or display an approval',()=>{
  for(const label of ['OVERDOSE Pear bate','PALITRA OVERDOSE Pear bate']){
   const r=run(photo(label),label);assert.equal(r.match.found.length,0,label);assert.equal(r.hints,'',label);
  }
 });
 test(file+': explicit different flavor wins and contradictory hint is hidden',()=>{
  const r=run(photo('PALITRA Cactus Pir'),'PALITRA Cactus Pir');
  assert.equal(r.match.found[0]?.name,'Cactus Pir');assert.equal(r.hints,'');
 });
 test(file+': stale warning mappings cannot match or display',()=>{
  for(const label of ['СЛЕПОЙ','ГАНГРЕНА','ИМПОТЕНЦИЯ','ИНФАРКТ','ИНСУЛЬТ','НЕДОНОШЕННОСТЬ','СЛЕПОТА','МЕРТВОРОЖДЕНИЕ','НОВООБРАЗОВАНИЯ','Рак лёгкого','Подробнее о последствиях']){
   const r=run(photo(label),label);assert.equal(r.match.found.length,0,label);assert.equal(r.hints,'',label);
  }
 });
 test(file+': each photo uses its own focus before hint deduplication',()=>{
  const valid=photo('PALITRA Pear bate');
  const r=run('Фото 1:\n'+photo('PALITRA Pear bate','Overdose')+'\nФото 2:\n'+valid+'\nФото 3:\n'+valid);
  assert.equal(r.match.found[0]?.id,pear.id);assert.equal(r.match.found[0]?.jars,2);assert.equal((r.hints.match(/→/g)||[]).length,1);
  const blocked=run('Фото 1:\n'+photo('PALITRA Pear bate','?')+'\nФото 2:\n'+photo('PALITRA Pear bate','Overdose'));
  assert.equal(blocked.match.found.length,0);assert.equal(blocked.hints,'');
 });
 test(file+': unknown catalog IDs and unavailable corrections fail closed',()=>{
  const r=run(photo('PALITRA Pear bate'),'PALITRA Pear bate','missing-id');assert.equal(r.hints,'');assert.equal((r.match.approved_labels||[]).length,0);
  vm.runInContext('learnedPhoto=[]',ctx);assert.equal(vm.runInContext('learnedHints(input)',ctx),'');
 });
}
assert(app.includes('learnedPhoto=await db.listPhotoCorrections()'),'photo command must reload current approved rules');

assert(shim.includes('listPhotoCorrections:async'),'read method required');
assert(shim.includes('savePhotoCorrection:async'),'approval write method required');
assert(shim.includes('photo_corrections?on_conflict=venue_id,raw_label'),'venue-scoped upsert required');
const n=app.slice(app.indexOf('async function cmdNaiti('),app.indexOf('function transferQuantity(',app.indexOf('async function cmdNaiti(')));
assert(n.includes('offerPhotoCorrection(out,text)'),'photo correction button required');
assert(n.includes('x.onBar?", на стойке: есть":", на стойке: нет"'),'find should report explicit status');
const sql=fs.readFileSync('supabase/migrations/20261029_photo_corrections.sql','utf8');
for(const part of ['ENABLE ROW LEVEL SECURITY','is_staff()','me_venue()','REFERENCES public.flavors(id)','TO authenticated'])assert(sql.includes(part),'missing secure migration: '+part);
assert(!sql.includes('TO anon\n'),'Anonymous users must not write');
assert(sql.includes('raw_label !~*'),'database must reject warning labels too');
console.log('PASS: correction persistence wiring and static RLS assertions (not live JWT/RLS evidence)');
