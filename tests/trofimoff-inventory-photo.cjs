// Trofimoff's: five user-supplied photos manually checked 2026-10-29.
// Offline catalog matching fixture (not a live vision/OCR quality claim).
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('src/stoika.html','utf8');
const DATA=JSON.parse(source.match(/const DATA=(\[.*?\]);/s)[1]);
const ctx=vm.createContext({DATA,norm:s=>s.toLowerCase().replace(/ё/g,'е'),aiItem:x=>({id:x.id,brand:x.b,name:x.n,line:x.l,jars:1})});
vm.runInContext(source.slice(source.indexOf('const cnTxt='),source.indexOf('// Фото, прочитанное на сервере')),ctx);
const photos=[
 ['Stout','Lavander','Wintergreen','Crespino','Old School Orange','Mangifera','Cashmere Guava','Cantaloupe','Red Currant','Rhubarb'],
 ['Cantaloupe','Coke','Regan','Apricot','Bailey\'s','Apricot','Red Currant','The Rose','Sujuk','Nurr'],
 ['Drama','Limoncello','Kiwi','Finlandia Vanila','Shurale','Crud','Crio','Añejo','Salvia','Pepe','Spirit','Cavendish'],
 ['Jasminum'],
 ['Dark Plum']
];
const target=new Map();
let physical=0;
for(const [i,names] of photos.entries()){
 const input='Фокус: Trofimoff\'s\n'+names.map((name,j)=>'Этикетка '+(j+1)+': Trofimoff\'s '+name).join('\n');
 const text=JSON.stringify(input);
 const res=JSON.parse(JSON.stringify(vm.runInContext('matchText('+text+',true)',ctx)));
 assert.equal(res.not_found_lines.length,0,'photo '+(i+1)+' has unknown labels: '+res.not_found_lines);
 assert.equal(res.found.reduce((s,item)=>s+(item.jars||1),0),names.length,'jar count mismatch in photo '+(i+1));
 for(const item of res.found){
  assert.equal(item.brand,"Trofimoff's",'brand contamination');
  target.set(item.name,item.line);
 }
 physical+=names.length;
}
assert.equal(physical,34);
assert.equal(target.size,31,'31 unique Trofimoff\'s flavors verified');
for(const wrong of ['Black Plum','Coffee Guava','White Rose','Black Vanilla']){
 const r=JSON.parse(JSON.stringify(vm.runInContext('matchText('+JSON.stringify("Фокус: Trofimoff's\nЭтикетка 1: Trofimoff's "+wrong)+',true)',ctx)));
 assert.equal(r.found.length,0,'old mistranscription must not become a different flavor: '+wrong);
}
console.log('PASS: 5 Trofimoff photo transcriptions, 34 foreground jars, 31 unique flavors; incorrect old transcriptions rejected');
