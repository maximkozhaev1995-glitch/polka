// Deterministic near-printed/handwritten label regression tests. No AI requests, no DB writes.
const fs=require("node:fs"),vm=require("node:vm"),assert=require("node:assert/strict");
const app=fs.readFileSync("src/stoika.html","utf8");
const built=fs.readFileSync("index.html","utf8");
const start=app.indexOf("function photoFuzzyCandidate(");
const end=app.indexOf("// A near OCR spelling",start);
assert(start>0&&end>start,"real photo matching helper must exist");
const helper=app.slice(start,end);
const utils=app.slice(app.indexOf("const TR="),app.indexOf("function fixBrands("));
const levStart=app.indexOf("const lev="),levEnd=app.indexOf("// label —",levStart);
assert(levStart>0&&levEnd>levStart);
const fakeData=[
 {id:"pal-lemon",b:"Palitra",n:"Lemon Marmelade",l:"",a:[]},
 {id:"pal-wood",b:"Palitra",n:"Wood Berry",l:"",a:[]},
 {id:"pal-cola",b:"Palitra",n:"Cola",l:"",a:[]},
 {id:"pal-berry",b:"Palitra",n:"Very Berry",l:"",a:[]},
 {id:"dark-pom",b:"Darkside",n:"Помело",l:"Core",a:[]},
 {id:"dark-grape",b:"Darkside",n:"Grape",l:"Core",a:[]},
 {id:"star-waffles",b:"Starline",n:"Бельгийские вафли",l:"",a:[]},
 {id:"star-mille",b:"Starline",n:"Клубничный мильфей",l:"",a:[]},
 {id:"kraken-strong",b:"Kraken",n:"Raspberry",l:"Strong Ligero",a:[]},
 {id:"kraken-medium",b:"Kraken",n:"Raspberry",l:"Medium Seco",a:[]},
];
const context={DATA:fakeData,cnTxt:s=>" "+String(s||"").toLowerCase().replace(/ё/g,"е").replace(/[^a-zа-я0-9]+/g," ").trim()+" ",
 photoBrandText:s=>s};
vm.createContext(context);
vm.runInContext(utils+app.slice(levStart,levEnd)+helper,context);
const match=(s,brand)=>vm.runInContext("photoFuzzyCandidate("+JSON.stringify(s)+","+JSON.stringify(brand)+")",context);
assert.equal(match("PALITRA Lemon marmalade","Palitra")?.id,"pal-lemon","Marmalade/Marmelade typography");
assert.equal(match("Palitra woob berry","Palitra")?.id,"pal-wood","Woob/Wood OCR correction");
assert.equal(match("Darkside помелоу","Darkside")?.id,"dark-pom","Russian ending error");
assert.equal(match("Darkside Pomelow","Darkside")?.id,"dark-pom","Latin packaging label");
assert.equal(match("STARLINE КЛУБНИЧНЫЙ МИЛФЕЙ","Starline")?.id,"star-mille","Soft-sign omission");
assert.equal(match("STARLINE БЕЛЬГИЙСКИЕ ВАФЛИ","Starline")?.id,"star-waffles","Unrelated learned label must not hijack exact catalog flavor");
assert.equal(match("PALITRA LEMO?","Palitra"),null,"Unknown text must not be guessed");
assert.equal(match("Palitra Lemon marmalade","Darkside"),null,"Wrong-brand context");
assert.equal(match("Palitra Very Berry","Darkside"),null,"Another brand cannot supply flavor");
assert.equal(match("Kraken Raspberry","Kraken"),null,"Duplicate flavor across lines needs explicit line");
assert(app.includes("(!detected.hit.length||detected.hit.some(x=>x.id===approved.id))"),"incorrect learning must never override an explicit catalog match");
assert(app.includes("Исправить ещё одну этикетку"),"correction button must support multiple labels");
assert(app.includes('finally{b.disabled=false}'),"correction button should re-enable after saving");
assert(built.includes(helper),"built app must include exactly same brand-aware helper");
assert(built.includes("Исправить ещё одну этикетку"),"built app must include multi correction UI");
console.log("PASS: brand-aware fuzzy photo OCR, font differences, no cross-brand or line conflation, multi-label learning");
