// LIN-02: actual-source behavioral tests, isolated data; no network or persistence.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test');
const item=(id,b,n,l='',a=[])=>({id,b,n,l,a,t:[]});
const seed=[item('guard-rare','GuardBrand','Other Rare Flavor','Rare'),item('core','GuardBrand','Grape','Core'),item('dark-other','GuardBrand','Supernova','Core'),item('vanilla','Сарма','Ваниль'),item('sarma','Сарма','Княженика','360'),item('kraken-s','Kraken','Raspberry','Medium Seco'),item('kraken-l','Kraken','Wild Strawberry','Strong Ligero'),item('unlined','Kraken','Cream Waffles'),item('star','Starline','Мятная пастилка'),item('plain','Palitra','Lemon Marmelade'),item('flavor-core','Palitra','Core Apple'),item('perfume','Deus','Ganymede','Perfume')];
function context(file,extra=[]){const s=fs.readFileSync(file,'utf8'),DATA=JSON.parse(JSON.stringify(seed.concat(extra)));const c=vm.createContext({DATA,byId:Object.fromEntries(DATA.map(x=>[x.id,x])),norm:s=>String(s).toLowerCase().replace(/ё/g,'е'),aiItem:x=>({id:x.id,brand:x.b,name:x.n,line:x.l}),wh:()=>0,onBar:()=>false});
 vm.runInContext(s.slice(s.indexOf('const cnTxt='),s.indexOf('// Фото, прочитанное на сервере')),c);
 vm.runInContext('let learnedPhoto=[]; const learnedKey=s=>cnTxt(s).trim();',c);
 vm.runInContext(s.slice(s.indexOf('function photoInspectionText('),s.indexOf('// Corrections are suggestions only:')),c);return{c,s};}
const ids=v=>Array.from(v,x=>x.id);
for(const file of process.env.LIN02_SOURCE_ONLY?['src/stoika.html']:['src/stoika.html','index.html']){
 const check=(name,fn)=>test(file+': '+name,()=>fn(context(file)));
 check('single Core candidate cannot satisfy visible RARE',({c})=>assert.deepEqual(ids(c.photoMatchChunk('GUARDBRAND GRAPE; на наклейке RARE',true,true).hit),[]));
 check('Sarma360 raw marker survives normalized brand and cannot fit null line',({c})=>assert.deepEqual(ids(c.photoMatchChunk('САРМА360 ВАНИЛЬ',true,true).hit),[]));
 check('explicit compatible Sarma360 remains useful',({c})=>assert.deepEqual(ids(c.photoMatchChunk('САРМА360 Княженика',true,true).hit),['sarma']));
 check('unlabelled single known flavor remains useful',({c})=>assert.deepEqual(ids(c.photoMatchChunk('GUARDBRAND GRAPE',true,true).hit),['core']));
 check('flavor word Core is not line evidence',({c})=>assert.deepEqual(ids(c.photoMatchChunk('Palitra Core Apple',true,true).hit),['flavor-core']));
 check('explicit unknown line declaration cannot fit Core',({c})=>assert.deepEqual(ids(c.photoMatchChunk('GuardBrand Grape линейка Experimental',true,true).hit),[]));
 check('contradictory line declarations do not select either',({c})=>assert.deepEqual(ids(c.photoMatchChunk('GuardBrand Core Rare Grape',true,true).hit),[]));
 check('single Kraken S variant cannot satisfy L code',({c})=>assert.deepEqual(ids(c.photoMatchChunk('Kraken Magnum L01 Raspberry',true,true).hit),[]));
 check('single unlined Kraken cannot satisfy S code',({c})=>assert.deepEqual(ids(c.photoMatchChunk('Kraken Magnum S01 Cream Waffles',true,true).hit),[]));
 check('explicit Kraken class aliases compare as Seco or Ligero, not unrelated line',({c})=>{c.DATA.find(x=>x.id==='kraken-s').l='Seco';assert.deepEqual(ids(c.photoMatchChunk('Kraken Magnum S01 Raspberry',true,true).hit),['kraken-s']);assert.equal(c.photoMatchChunk('Kraken Magnum L01 Raspberry',true,true).hit.length,0)});
 check('compatible Kraken S code remains matched',({c})=>assert.deepEqual(ids(c.photoMatchChunk('Kraken Magnum S01 Raspberry',true,true).hit),['kraken-s']));
 check('direct fuzzy candidate cannot cross explicit line',({c})=>assert.equal(c.photoFuzzyCandidate('GuardBrand Rare Grapp','GuardBrand'),null));
 check('normal fuzzy match survives',({c})=>assert.equal(c.photoFuzzyCandidate('Palitra Lemon Marmalade','Palitra')?.id,'plain'));
 check('saved correction cannot bypass explicit incompatible line',({c})=>{c.saved=[{raw_label:'GuardBrand RARE Grappe',flavor_id:'core'}];vm.runInContext('learnedPhoto=saved',c);const r=c.matchPhotoText('Фокус: GuardBrand\nЭтикетка 1: GuardBrand RARE Grappe');assert.equal(r.found.length,0);assert.equal(r.approved_labels.length,0)});
 check('command matching never assigns incompatible singleton',({c})=>{const r=c.matchText('GuardBrand RARE Grape');assert.equal(r.found.length,0);assert.ok(r.ambiguous.length)});
 check('inspection retains line reason and never emits mapping arrow for conflict',({c})=>{const r=c.photoInspectionText(['Этикетка 1: GuardBrand Rare Grape']);assert.doesNotMatch(r,/→ GuardBrand Grape/);assert.match(r,/линейк/i)});
 check('line refusal preserves raw text, candidates and label provenance',({c})=>{const r=c.matchPhotoText('Фокус: GuardBrand\nЭтикетка 7: GuardBrand RARE Grape',true,{photo_index:3});const o=r.outcomes[0];assert.equal(o.reason,'line_conflict');assert.equal(o.raw,'GuardBrand RARE Grape');assert.equal(o.photo_index,3);assert.equal(o.label_number,7);assert.equal(o.candidates[0].id,'core');assert.equal(o.flavor_id,undefined);assert.deepEqual(Array.from(o.line_markers),['rare']);});
 check('separate jar lines never transfer from neighboring label',({c})=>{const r=c.matchPhotoText('Фокус: GuardBrand\nЭтикетка 1: GuardBrand RARE Grape\nЭтикетка 2: GuardBrand Supernova');assert.deepEqual(ids(r.found),['dark-other']);});
 check('fuzzy rejected by line retains review candidates and reason',({c})=>{const r=c.matchPhotoText('Фокус: GuardBrand\nЭтикетка 1: GuardBrand RARE Grapp');assert.equal(r.found.length,0);assert.equal(r.outcomes[0].reason,'line_conflict');assert.equal(r.outcomes[0].candidates[0].id,'core');});
 check('learned rejected by line retains review evidence',({c})=>{c.saved=[{raw_label:'GuardBrand RARE Very Different',flavor_id:'core'}];vm.runInContext('learnedPhoto=saved',c);const r=c.matchPhotoText('Фокус: GuardBrand\nЭтикетка 1: GuardBrand RARE Very Different');assert.equal(r.found.length,0);assert.equal(r.outcomes[0].reason,'line_conflict');assert.equal(r.outcomes[0].candidates[0].id,'core');});
 check('Daily historical alias remains brand-only usable',({c})=>assert.deepEqual(ids(c.photoMatchChunk('DAILY HOOKAH Мятная пастилка',true,true).hit),['star']));
 test(file+': explicit line chooses compatible variant, absent line chooses neither',()=>{const{c}=context(file,[item('rare','GuardBrand','Grape','Rare')]);assert.deepEqual(ids(c.photoMatchChunk('GuardBrand Rare Grape',true,true).hit),['rare']);assert.deepEqual(ids(c.photoMatchChunk('GuardBrand Grape',true,true).hit),[]);assert.deepEqual(ids(c.photoMatchChunk('GuardBrand Core Grape',true,true).hit),['core']);});
 test(file+': text command keeps compatible variant without rejected sibling ambiguity',()=>{const{c}=context(file,[item('rare','GuardBrand','Grape','Rare')]);const r=c.matchText('GuardBrand Rare Grape');assert.deepEqual(ids(r.found),['rare']);assert.equal(r.ambiguous.length,0)});
 test(file+': saved correction cannot disambiguate missing line',()=>{const{c}=context(file,[item('rare','GuardBrand','Grape','Rare')]);c.saved=[{raw_label:'GuardBrand Grape',flavor_id:'core'}];vm.runInContext('learnedPhoto=saved',c);assert.equal(c.matchPhotoText('Фокус: GuardBrand\nЭтикетка 1: GuardBrand Grape').found.length,0)});
}
