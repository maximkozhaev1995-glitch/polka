// Request-local source references only; no image persistence or network.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
for(const file of ['src/stoika.html','index.html']){
 const s=fs.readFileSync(file,'utf8'),DATA=JSON.parse(s.match(/const DATA=(\[.*?\]);/s)[1]);
 const c=vm.createContext({DATA,norm:s=>s.toLowerCase().replace(/ё/g,'е'),aiItem:x=>({id:x.id,brand:x.b,name:x.n}),wh:()=>0,onBar:()=>false});
 vm.runInContext(s.slice(s.indexOf('const cnTxt='),s.indexOf('// Фото, прочитанное на сервере')),c);
 vm.runInContext(s.slice(s.indexOf('let photoAcc=null'),s.indexOf('// Новый вкус с фото')),c);
 vm.runInContext(s.slice(s.indexOf('function photoInspectionText('),s.indexOf('// Corrections are suggestions only:')),c);
 test(file+': repeated labels retain source photo and label numbers without merging candidates',()=>{
  const m=c.matchText('Фото 2:\nФокус: NOVABRAND\nЭтикетка 7: NOVABRAND MANGO\nФото 4:\nФокус: NOVABRAND\nЭтикетка 7: NOVABRAND MANGO',true);
  assert.deepEqual(Array.from(m.outcomes,x=>[x.photo_index,x.label_number,x.raw]),[[2,7,'NOVABRAND MANGO'],[4,7,'NOVABRAND MANGO']]);
  assert.match(c.photoReviewText(m),/Фото 4 · этикетка 7/);assert.equal(m.found.length,0);assert.equal(m.new_flavors.length,0);
 });
 test(file+': empty label never absorbs neighbor and empty focus never borrows next line',()=>{
  const m=c.matchText('Фокус: Darkside\nЭтикетка 1:\nЭтикетка 2: Darkside Supernova',true);
  assert.equal(m.outcomes[0].status,'unreadable');assert.equal(m.outcomes[0].raw,'');assert.equal(m.outcomes[1].label_number,2);assert.equal(m.found[0].name,'Supernova');assert.equal(m.found[0].jars,1);
  const empty=c.matchText('Фокус:\nЭтикетка 1: Darkside Supernova',true);assert.equal(empty.found.length,0);assert.equal(empty.outcomes[0].status,'unreadable');
 });
 test(file+': separate brand and flavor jars cannot combine',()=>{
  const m=c.matchText('Фокус: Darkside\nЭтикетка 1: Darkside\nЭтикетка 2: Supernova',true);
  assert.equal(m.found.length,0);assert.deepEqual(Array.from(m.outcomes,x=>x.label_number),[1,2]);assert.equal(m.outcomes[0].status,'unreadable');assert.equal(m.outcomes[1].status,'unreadable');
 });
 test(file+': inspection preserves original index after failed photo',()=>{
  const out=c.photoInspectionText([{failed:'network'},'Этикетка 9: NOVABRAND MANGO']);
  assert.match(out,/Фото 1: не удалось прочитать/);assert.match(out,/Фото 2 · этикетка 9/);assert.doesNotMatch(out,/Фото 1 · этикетка 9/);
 });
 test(file+': general photo chat receives explicit attachment index and stores no add proposals',()=>{
  vm.runInContext('photoAcc=photoAccNew()',c);
  c.photoNote('Фокус: NOVABRAND\nЭтикетка 3: NOVABRAND MANGO',{photo_index:5});
  assert.match(vm.runInContext('photoHead(photoAcc)',c),/Фото 5 · этикетка 3/);assert.equal(vm.runInContext('photoAcc.newf.length',c),0);
 });
}
assert.match(fs.readFileSync('app/shim.js','utf8'),/opts\.photo\(t\|\|"",\{photo_index:i\+1\}\)/);
