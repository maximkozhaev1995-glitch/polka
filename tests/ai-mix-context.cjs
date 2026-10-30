const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const s=fs.readFileSync('src/stoika.html','utf8');
const item=s.slice(s.indexOf('function aiStrength('),s.indexOf('const cnTxt='));
const snap=s.slice(s.indexOf('function aiSnapshot()'),s.indexOf('// Кто ответил:'));
const c=vm.createContext({});
vm.runInContext(`const DATA=[{id:'known',b:'Brand',n:'Known',t:[]},{id:'unknown',b:'Brand',n:'Unknown',t:[]},{id:'stopped',b:'Brand',n:'Stopped',t:[]},{id:'warehouse',b:'Brand',n:'Warehouse',t:[]}];const strMap={known:7,stopped:3},stock={known:{slow:true},stopped:{stopAuto:true},warehouse:{slow:true}},draft={};const flag=(x,k)=>!!stock[x.id]?.[k],inStop=x=>flag(x,'stop')||flag(x,'stopAuto'),onBar=x=>x.id!=='warehouse',wh=()=>0,oq=()=>0,orderRows=()=>[];${item}${snap};globalThis.api={item:aiItem,snapshot:aiSnapshot,str:aiStrength,data:DATA,strMap};`,c);
const {api}=c;
assert.equal(api.item(api.data[0]).strength,7);assert.equal(api.item(api.data[0]).slow,true);
assert.equal(api.item(api.data[1]).strength,null,'missing strength must not become default 5');
assert.equal(api.item(api.data[2]).stop,true,'automatic stop remains unavailable');
for(const n of [0,11,2.5,'invalid',null]){api.strMap.unknown=n;assert.equal(api.str(api.data[1]),null)}
api.strMap.unknown=1;assert.equal(api.str(api.data[1]),1);api.strMap.unknown=10;assert.equal(api.str(api.data[1]),10);delete api.strMap.unknown;
const snapshot=api.snapshot();assert.match(snapshot,/Known \(НЕЛИКВИД\) \(крепость 7\/10\)/);assert.match(snapshot,/Unknown \(крепость не указана\)/);assert.match(snapshot,/Stopped \(СТОП\) \(крепость 3\/10\)/);assert.doesNotMatch(snapshot,/Warehouse/);
const rules=s.slice(s.indexOf('МИКСЫ — главное'),s.indexOf('\n\nСКЛАД',s.indexOf('МИКСЫ — главное')));
assert.match(rules,/хотя бы один подтверждённый slow-вкус/);assert.match(rules,/данных для оценки крепости микса недостаточно/);assert.match(rules,/не назначай миксу число или категорию крепости/);
assert.match(rules,/СПРАВОЧНИК МИКСОЛОГИИ/);assert.match(rules,/smokersmag.com\/columns\/pipes\/school\/542-pipetobacco-taste-part2/);assert.match(rules,/Колесо из статьи о трубочном табаке не задаёт совместимость/);assert.match(rules,/сначала подтверди конкретные вкусы/);
const helper=vm.createContext({AI_RULES:rules});const extract=s.slice(s.indexOf('const hlpMixRules='),s.indexOf('const hlpList='));vm.runInContext(extract+'globalThis.rules=hlpMixRules()',helper);assert.match(helper.rules,/СПРАВОЧНИК МИКСОЛОГИИ/);
assert.match(rules,/hookah-obninsk.ru\/mixestobacco/);assert.match(helper.rules,/ПРАКТИЧЕСКАЯ ОСНОВА МИКСОЛОГИИ/);assert.match(rules,/соблюдай правила процентов Mixora выше/);
console.log('PASS mix context: slow, stop, warehouse exclusion, known/missing/invalid strength and grounded prompt rules');
