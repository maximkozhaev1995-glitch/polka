// User-confirmed historical brand relation; no catalogue additions, no live OCR.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
for(const file of ['src/stoika.html','index.html']){
 const s=fs.readFileSync(file,'utf8'),DATA=JSON.parse(s.match(/const DATA=(\[.*?\]);/s)[1]),before=JSON.stringify(DATA),byId=Object.fromEntries(DATA.map(x=>[x.id,x]));
 const c=vm.createContext({DATA,byId,norm:s=>s.toLowerCase().replace(/ё/g,'е'),aiItem:x=>({id:x.id,brand:x.b,name:x.n}),wh:()=>0,onBar:()=>false});
 vm.runInContext(s.slice(s.indexOf('const cnTxt='),s.indexOf('// Фото, прочитанное на сервере')),c);
 const match=(focus,label)=>c.matchText('Фокус: '+focus+'\nЭтикетка 1: '+label,true);
 for(const [flavor,id] of [['МЯТНАЯ ПАСТИЛКА','b0ce70454b00'],['ЯГОДНЫЙ СОРБЕТ','6f285d308079'],['ВИНОГРАДНОЕ ЖЕЛЕ','f51b4d9c7a68']])test(file+': historical Daily Hookah '+flavor+' resolves existing Starline ID',()=>{const raw='DAILY HOOKAH '+flavor,m=match('DAILY HOOKAH',raw);assert.equal(m.found.length,1);assert.equal(m.found[0].id,id);assert.equal(m.outcomes[0].status,'known_product');assert.equal(m.outcomes[0].brand,'Starline');assert.equal(m.outcomes[0].raw,raw);assert.equal(m.new_flavors.length,0);assert.equal(JSON.stringify(DATA),before);});
 test(file+': canonical same brand does not combine neighboring flavor labels',()=>{const m=c.matchText('Фокус: DAILY HOOKAH\nЭтикетка 1: DAILY HOOKAH МЯТНАЯ ПАСТИЛКА\nЭтикетка 2: STARLINE БЕЛЬГИЙСКИЕ ВАФЛИ',true);assert.deepEqual(Array.from(m.found,x=>x.id).sort(),['b0ce70454b00','ee621548205a'].sort());assert.deepEqual(Array.from(m.outcomes,x=>x.label_number),[1,2]);assert(m.found.every(x=>x.jars===1));const separate=c.matchText('Фокус: DAILY HOOKAH\nЭтикетка 1: DAILY HOOKAH\nЭтикетка 2: МЯТНАЯ ПАСТИЛКА',true);assert.equal(separate.found.length,0);});
 test(file+': absent historical flavor is known brand unknown flavor, never catalogue insertion',()=>{const m=match('DAILY HOOKAH','DAILY HOOKAH ZZTESTFLAVORUNLISTED');assert.equal(m.outcomes[0].status,'unknown_flavor');assert.equal(m.outcomes[0].brand,'Starline');assert.equal(m.found.length,0);assert.equal(m.new_flavors.length,0);});
 test(file+': typo, uncertainty, spoof context and synthetic unknown remain unrecognized',()=>{
  for(const [focus,label] of [['DAILY HOOLAH','DAILY HOOLAH МЯТНАЯ ПАСТИЛКА'],['ZZTESTBRANDUNLISTED','ZZTESTBRANDUNLISTED МЯТНАЯ ПАСТИЛКА'],['NOTDAILY HOOKAH','NOTDAILY HOOKAH МЯТНАЯ ПАСТИЛКА'],['ZZTESTBRANDUNLISTED','ZZTESTBRANDUNLISTED daily hookah aroma']]){const m=match(focus,label);assert.equal(m.found.length,0);assert.equal(m.outcomes[0].status,'unknown_brand');}
  assert.equal(match('DAILY HOOKAH?','DAILY HOOKAH? МЯТНАЯ ПАСТИЛКА').found.length,0);
  assert.equal(match('Darkside','Darkside DAILY HOOKAH МЯТНАЯ ПАСТИЛКА').found.length,0);
 });
}
