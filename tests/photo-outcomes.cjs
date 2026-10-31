// Offline outcome and UI-message regression. No image/model/network/database calls.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test');
for(const path of ['src/stoika.html','index.html']){
 const source=fs.readFileSync(path,'utf8');
 const DATA=JSON.parse(source.match(/const DATA=(\[.*?\]);/s)[1]);
 const before=JSON.stringify(DATA),byId=Object.fromEntries(DATA.map(x=>[x.id,x]));
 const c=vm.createContext({DATA,byId,norm:s=>s.toLowerCase().replace(/ё/g,'е'),aiItem:x=>({id:x.id,brand:x.b,name:x.n,wh:0,onBar:false}),wh:()=>0,onBar:()=>false,flag:()=>false});
 vm.runInContext(source.slice(source.indexOf('const cnTxt='),source.indexOf('// Фото, прочитанное на сервере')),c);
 vm.runInContext(source.slice(source.indexOf('function photoInspectionText('),source.indexOf('// Corrections are suggestions only:')),c);
 vm.runInContext(source.slice(source.indexOf('let photoAcc=null'),source.indexOf('// Новый вкус с фото')),c);
 vm.runInContext(source.slice(source.indexOf('async function cmdNaiti('),source.indexOf('function transferQuantity(')),c);
 c.aiCtl={signal:null};c.learnedHints=()=>'';c.offerPhotoCorrection=()=>{};
 const raw=(brand,label)=>'Фокус: '+brand+'\nЭтикетка 1: '+label;
 const match=(brand,label)=>c.matchText(raw(brand,label),true);
 const check=(m,status)=>{assert.equal(m.outcomes[0].status,status);if(status!=='known_product'){assert.equal(m.found.length,0);assert.equal(m.new_flavors.length,0)}return m.outcomes[0]};
 test(path+': four outcomes keep raw text and never add unknown catalogue entries',()=>{
  check(match('Darkside','Darkside Supernova'),'known_product');
  const unknown=check(match('ZZTESTBRANDUNLISTED','ZZTESTBRANDUNLISTED ZZTESTFLAVORUNLISTED'),'unknown_brand');
  assert.equal(unknown.raw,'ZZTESTBRANDUNLISTED ZZTESTFLAVORUNLISTED');assert.equal(unknown.brand,'ZZTESTBRANDUNLISTED');
  check(match('Darkside','Darkside ZZTESTFLAVORUNLISTED'),'unknown_flavor');
  check(match('?','? ZZTESTFLAVORUNLISTED'),'unreadable');
  assert.equal(JSON.stringify(DATA),before);
 });
 test(path+': unknown focus must be corroborated on its own label',()=>{
  for(const label of ['OTHERLABEL Flavor','Darkside Supernova','ZZTESTBRANDUNLISTED ?'])check(match('ZZTESTBRANDUNLISTED',label),'unreadable');
  for(const focus of ['?','НЕИЗВЕСТНО','Unknown','ZZTESTBRANDUNLISTED?'])check(match(focus,focus+' Flavor'),'unreadable');
 });
 test(path+': uncertain, warning and conflicting labels are never new-brand/flavor candidates',()=>{
  for(const label of ['Darkside ?','Darkside ZZTEST…','Darkside ZZTEST...','Darkside ГАНГРЕНА','Darkside Подробнее о последствиях','Darkside Palitra ZZTEST'])check(match('Darkside',label),'unreadable');
  for(const label of ['ГАНГРЕНА','РАК ЛЁГКОГО','?','BLACK AFGANO'])assert.equal(c.photoOutcome(label).status,'unreadable');
 });
 test(path+': missing flavor and ambiguous product variant are not new flavors',()=>{
  check(match('Darkside','Darkside'),'unreadable');
  const m=match('Kraken','Kraken Raspberry');check(m,'unreadable');assert.equal(m.outcomes[0].reason,'variant');
 });
 test(path+': packaging warnings are not candidates or counted products',()=>{
  for(const label of ['КУРЕНИЕ УБИВАЕТ','Курение вызывает рак','СЛЕПОТА','WARNING smoking kills']){
   assert.equal(c.photoOutcome(label).status,'unreadable');
   const rendered=c.photoInspectionText(['Этикетка 1: '+label]);
   assert.match(rendered,/Всего прочитано: 0 банок/);assert.doesNotMatch(rendered,/добавления нового бренда/);
  }
 });
 test(path+': unknown brands sharing known flavor words remain review-only',()=>{
  for(const label of ['NOVABRAND MANGO','ZZTESTBRANDUNLISTED Мятная пастилка']){
   assert.equal(c.photoOutcome(label).status,'unknown_brand');assert.equal(c.photoOutcome(label).brand,null);
   assert.match(c.photoInspectionText(['Этикетка 1: '+label]),/строка ещё не подтверждена как название товара/);
  }
 });
 test(path+': conflicting focus and missing label fail closed',()=>{
  const conflict=match('Darkside Deus','Darkside Supernova');check(conflict,'unreadable');assert.equal(conflict.outcomes[0].reason,'conflicting_brands');
  const empty=c.matchText('Фокус: Darkside',true);check(empty,'unreadable');assert.match(c.photoReviewText(empty),/более чёткое фото/);
 });
 test(path+': background brand is not converted into foreground review candidate',()=>{
  const m=c.matchText(raw('Darkside','Darkside Supernova')+'\nЭтикетка 2: Palitra ZZTEST',true);
  assert.equal(m.outcomes.length,1);assert.equal(m.outcomes[0].status,'known_product');
 });
 test(path+': multi-photo results retain independent outcomes',()=>{
  const m=c.matchText('Фото 1:\n'+raw('Darkside','Darkside Supernova')+'\nФото 2:\n'+raw('ZZTESTBRANDUNLISTED','ZZTESTBRANDUNLISTED Flavor'),true);
  assert.deepEqual(Array.from(m.outcomes,x=>x.status),['known_product','unknown_brand']);assert.equal(m.found.length,1);assert.equal(m.new_flavors.length,0);
 });
 test(path+': inspection preserves raw unknown label without inventing multiword brand boundary',()=>{
  const label='ZZTEST MULTI BRAND ZZTEST FLAVOR',o=c.photoOutcome(label);assert.equal(o.status,'unknown_brand');assert.equal(o.brand,null);assert.equal(o.raw,label);
  const rendered=c.photoInspectionText(['Этикетка 1: '+label+'\nЭтикетка 2: Darkside ZZTESTFLAVOR\nЭтикетка 3: ?']);
  assert.match(rendered,/возможность добавления нового бренда/);assert.match(rendered,/вкус не найден/);assert.match(rendered,/более чёткое фото/);assert.match(rendered,/Ничего не добавлено/);
 });
 test(path+': photo chat uses strict matcher and cannot queue automatic new-flavor proposals',()=>{
  vm.runInContext('photoAcc=photoAccNew()',c);
  const output=c.photoNote(raw('ZZTESTBRANDUNLISTED','ZZTESTBRANDUNLISTED Flavor'));
  assert.match(output,/возможность добавления нового бренда/);
  assert.equal(vm.runInContext('photoAcc.newf.length',c),0);assert.equal(vm.runInContext('Object.keys(photoAcc.jars).length',c),0);
  assert.match(vm.runInContext('photoHead(photoAcc)',c),/добавления нового бренда/);
  c.photoNote(raw('Darkside','Darkside ZZTESTFLAVOR'));
  assert.equal(vm.runInContext('photoAcc.newf.length',c),0);
 });
 test(path+': /найти reports recognition outcomes, not empty inventory',async()=>{
  for(const [brand,label,expected] of [['ZZTESTBRANDUNLISTED','ZZTESTBRANDUNLISTED Flavor',/нового бренда/],['Darkside','Darkside ZZTESTFLAVOR',/вкус не найден/],['?','?',/более чёткое фото/]]){
   c.cmdFindIds=async()=>({m:match(brand,label),text:raw(brand,label)});const out={};await c.cmdNaiti(out,'',[{}]);
   assert.match(out.textContent,expected);assert.doesNotMatch(out.textContent,/Не нашёл ничего на складе/);
  }
  c.cmdFindIds=async()=>({m:match('Darkside','Darkside Supernova'),text:raw('Darkside','Darkside Supernova')});const out={};await c.cmdNaiti(out,'',[{}]);
  assert.match(out.textContent,/Распознано по каталогу/);assert.match(out.textContent,/на складе 0/);assert.match(out.textContent,/на стойке: нет/);
 });
}
