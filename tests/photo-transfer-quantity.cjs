// Offline regression: quantity in photo transfer commands.
const assert=require('node:assert/strict'),fs=require('node:fs');
const s=fs.readFileSync('src/stoika.html','utf8');
const helper=s.slice(s.indexOf('function transferQuantity('),s.indexOf('async function cmdPerenos('));
const parse=new Function(helper+'return transferQuantity;')();
for(const [text,n] of [['4шт',4],['4 шт.',4],['4 штуки',4],['4',4],['Afzal Pan Raas 4шт',4],['',null]])assert.equal(parse(text),n);
for(const text of ['0шт','1000шт','2шт 4шт'])assert.throws(()=>parse(text));
const vm = require('node:vm');
const cmd = s.slice(s.indexOf('async function cmdPerenos('), s.indexOf('async function cmdPopolnit('));
async function check(count, available, missing, expected) {
 const items = Array.from({length:count}, (_,i)=>({id:String(i),qty:1}));
 const ctx = vm.createContext({items,available,missing,assert});
 vm.runInContext(`
   let draft={}, aiDraftWorkflowPlan=null, aiDraftConfirmation=null, aiPhotoTransferIds=null, draftSource;
   const aiPhotoBatch={items,at:Date.now()}, byId=Object.fromEntries(items.map(x=>[x.id,{...x,b:'Afzal',n:'Pan Raas'}]));
   const wh=()=>available, onBar=()=>false, can=()=>true, cmdDraftIds=new Set();
   const aiPhotoSummary=()=>'', nm=x=>x.n, aiCheckPhotoBatch=()=>{}, aiPhotoLegGuard=()=>()=>{};
   const saveDraft=()=>{}, render=()=>{}, appendPhotoList=()=>{}, aiStockReviewBox=()=>{}, aiRememberPhotoRemainder=()=>{};
   async function readCommandItems(){if(missing.length)throw Error('unmatched labels');return {m:{found:items}}}
 `+helper+cmd,ctx);
 const action = vm.runInContext("cmdPerenos({},'4шт',[{}])",ctx);
 if(expected){await action;assert.equal(vm.runInContext("draft['0'].d",ctx),-4);assert.equal(vm.runInContext("draft['0'].bar",ctx),true);}
 else{await assert.rejects(action);assert.equal(vm.runInContext("Object.keys(draft).length",ctx),0);}
}
(async()=>{await check(1,7,[],true);await check(1,3,[],false);await check(2,7,[],false);await check(1,7,['unknown'],false);console.log('Photo transfer quantity regressions passed');})().catch(e=>{console.error(e);process.exitCode=1});
