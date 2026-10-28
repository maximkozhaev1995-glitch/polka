// Offline regression: quantity in photo transfer commands.
const assert=require('node:assert/strict'),fs=require('node:fs');
const s=fs.readFileSync('src/stoika.html','utf8');
const helper=s.slice(s.indexOf('function transferQuantity('),s.indexOf('async function cmdPerenos('));
const parse=new Function(helper+'return transferQuantity;')();
for(const [text,n] of [['4шт',4],['4 шт.',4],['4 штуки',4],['4',4],['Afzal Pan Raas 4шт',4],['',null]])assert.equal(parse(text),n);
for(const text of ['0шт','1000шт','2шт 4шт'])assert.throws(()=>parse(text));
const cmd=s.slice(s.indexOf('async function cmdPerenos('),s.indexOf('async function cmdPopolnit('));
async function check(count,available,missing,expected){
 const calls=[],found=Array.from({length:count},(_,i)=>({id:String(i),jars:1}));
 const byId=Object.fromEntries(found.map(x=>[x.id,{...x,b:'Afzal',n:'Pan Raas'}]));
 const run=new Function('cmdFindIds','aiCtl','byId','wh','draft','AI_TOOLS','render',helper+cmd+'return cmdPerenos;')(async()=>({m:{found,not_found_lines:missing}}),{signal:null},byId,()=>available,{},[{name:'stage_stock',execute:x=>calls.push(x)}],()=>{});
 await run({},'4шт',[{}]);assert.equal(calls.length,expected?1:0);if(expected)assert.deepEqual(calls[0],{id:'0',delta:-4,toBar:true});
}
(async()=>{await check(1,7,[],true);await check(1,3,[],false);await check(2,7,[],false);await check(1,7,['unknown'],false);console.log('Photo transfer quantity regressions passed');})().catch(e=>{console.error(e);process.exitCode=1});
