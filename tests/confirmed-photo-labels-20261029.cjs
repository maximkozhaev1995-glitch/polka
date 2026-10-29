// Photo-inventory corrections provided by venue staff, 2026-10-29.
// Assert only safe recognition of correctly read labels. NEVER convert a
// completely different flavor (or brand) into a learned global alias.
const fs=require("node:fs"),assert=require("node:assert/strict"),vm=require("node:vm");
const source=fs.readFileSync("src/stoika.html","utf8");
const DATA=JSON.parse(source.match(/const DATA=(\[.*?\]);/s)[1]);
const ctx=vm.createContext({DATA,norm:s=>s.toLowerCase().replace(/ё/g,"е"),aiItem:x=>({id:x.id,brand:x.b,name:x.n,line:x.l})});
vm.runInContext(source.slice(source.indexOf("const cnTxt="),source.indexOf("// Фото, прочитанное на сервере")),ctx);
function find(label,focus){
 const text="Фокус: "+focus+"\nЭтикетка 1: "+label;
 return JSON.parse(JSON.stringify(vm.runInContext("matchText("+JSON.stringify(text)+",true)",ctx)));
}
const confirmed=[
 ["Black Burn Currant Shock","Black Burn","Currant Shock",""],
 ["Jent Sweet Clover","Jent","Sweet Clover",""],
 ["Bonche Olive","Bonche","Olive",""],
 ["Deus Black J","Deus","Black JI",""],
 ["Musthave Alova","Musthave","Alova",""],
 ["Overdose Амбровый банан","Overdose","Амбровый банан",""],
 ["Palitra Margarita","Palitra","Margarita",""],
 ["База Одуванчик","База","Одуванчик",""],
 ["Сарма Виноградный сок","Сарма","Виноградный сок",""],
 ["Сарма Мультифруктовый сок","Сарма","Мультифруктовый сок",""],
 ["Сарма 360 Жёлтый арбуз","Сарма","Жёлтый арбуз","360"],
 ["Хулиган Соник","Хулиган","Соник",""]
];
for(const [label,focus,name,line] of confirmed){
 const catalog=DATA.filter(x=>x.b===focus&&x.n===name&&(line?x.l===line:true));
 assert.equal(catalog.length,1,"Missing or duplicate catalog entry: "+focus+" "+name+" "+line);
 const result=find(label,focus);
 assert.equal(result.found.length,1,"Correct photo label not recognized: "+label);
 assert.equal(result.found[0].id,catalog[0].id,"Wrong flavor matched: "+label);
}
const nonSynonyms=[
 ["Bonche Clover Oil","Bonche","Jent","Sweet Clover"],
 ["Jent Sweet Clover","Bonche","Jent","Sweet Clover"],
 ["Bonche Чаяна","Bonche","Bonche","Olive"],
 ["Musthave Aloe","Musthave","Musthave","Alova"],
 ["Сарма Манговый сок","Сарма","Сарма","Виноградный сок"],
 ["Сарма Спелый арбуз","Сарма","Сарма","Жёлтый арбуз"],
 ["Palitra Mango Rita","Palitra","Palitra","Margarita"],
 ["Deus Black Aeon","Deus","Deus","Black JI"]
];
for(const [label,focus,wrongBrand,wrongName] of nonSynonyms){
 const result=find(label,focus);
 assert.equal(result.found.some(x=>x.brand===wrongBrand&&x.name===wrongName),false,
  "Unsafe automatic synonym: "+label+" --> "+wrongBrand+" "+wrongName);
}
console.log("PASS 12 staff-confirmed catalog labels; 8 unsafe automatic substitutions rejected");
