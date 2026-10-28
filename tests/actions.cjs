const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('src/stoika.html','utf8');
const tools=source.slice(source.indexOf('const AI_TOOLS='),source.indexOf('function aiSnapshot()'));
const send=source.slice(source.indexOf('async function aiSend()'),source.indexOf('// Короткая память чата:'));
const fixes=source.slice(source.indexOf('function orderFixBox('),source.indexOf('// «Перенеси со склада'));
const ctx=vm.createContext({console,AbortController,setTimeout,clearTimeout});
vm.runInContext(`
let writes=[],fail=false,stock={a:{wh:3}},draft={},orderQ={},orderM={},lastOrderAt=null,oTimer=null;
let isMgr=true,aiOrdPhoto=false,aiOrdAsk=true,aiOrdSeen=new Set(),inCmd=false,cmdDraftIds=new Set();
const DATA=[{id:'a',b:'Brand',n:'A',l:'Strong',t:[]},{id:'b',b:'Brand',n:'B',t:[]}],byId=Object.fromEntries(DATA.map(x=>[x.id,x]));
const wh=x=>stock[x.id]?.wh||0,onBar=x=>!!stock[x.id]?.bar,flag=(x,k)=>!!stock[x.id]?.[k],oq=x=>orderQ[x.id]||0;
const nm=x=>x.b+' '+x.n,aiItem=x=>({id:x.id,brand:x.b,name:x.n}),ordGate=()=>null,can=()=>true;
const saveDraft=()=>{},render=()=>{},saveOrder=()=>{throw Error('unexpected legacy save')},revertWish=()=>{},wishIdsFor=()=>[];
const db={doc:path=>({set:async value=>{if(fail)throw Error('API failed');writes.push({path,value})}}),setStockBatch:async docs=>{if(fail)throw Error('API failed');writes.push({docs})}};
const stockActionItem=(x,state)=>({id:x.id,revision:'0',state});const runStockAction=async request=>{if(fail)throw Error('API failed');writes.push({request})};
const esc=s=>String(s);let boxes=[];const document={createElement:()=>{const buttons=[{},{}];const box={querySelectorAll:()=>buttons,buttons};boxes.push(box);return box}};
`+tools+fixes+`
let input={value:'поставь в заказ'},aiImgs=[],aiCtl=null,photoAcc=null,aiTurns=[],aiView=[],sampleFn;
let cmdMatch={found:[],ambiguous:[],not_found_lines:[]};const matchText=()=>cmdMatch,ambTxt=()=>'';const $=()=>input,renderAiImgs=()=>{},parseCmd=()=>null,ordAsked=()=>true,photoAccNew=()=>({}),aiBubble=()=>({classList:{remove(){},add(){}},append(){}}),aiUi=()=>{},AI_RULES='',aiSnapshot=()=>'',photoNote=()=>{},photoHead=()=>'',aiSrc=()=>{},aiScroll=()=>{},aiErr=()=>'',aiKeep=()=>{};
`+source.slice(source.indexOf('async function cmdFindIds('),source.indexOf('async function aiSend()'))+send+`;globalThis.api={tools:AI_TOOLS,proposal:aiProposalTools,box:aiProposalBox,commit:aiCommitProposal,cancel:cancelAiProposals};`,ctx);
const run=s=>vm.runInContext(s,ctx);
let count=0;async function test(name,fn){await fn();console.log('PASS',name);count++}
(async()=>{
await test('set_order proposal writes nothing',()=>{run(`p={list:[],draft:{}};T=api.proposal(p);T.find(t=>t.name==='set_order').execute({ids:['a','b'],qty:2});`);assert.equal(run('writes.length'),0);assert.equal(run('Object.keys(orderQ).length'),0)});
await test('repeat tool calls do not duplicate',()=>{run(`T.find(t=>t.name==='set_order').execute({id:'a',qty:2})`);assert.equal(run('p.list.length'),2)});
await test('unknown product fails before persistence',()=>{assert.throws(()=>run(`T.find(t=>t.name==='set_order').execute({id:'missing',qty:1})`));assert.equal(run('writes.length'),0)});
await test('cancel does not write',()=>{run(`api.box({append(){}},p);boxes.at(-1).buttons[1].onclick()`);assert.equal(run('writes.length'),0)});
await test('double confirmation saves once',async()=>{run(`api.box({append(){}},p)`);await run('boxes.at(-1).buttons[0].onclick()');await run('boxes.at(-1).buttons[0].onclick()');assert.equal(run('writes.length'),1);assert.equal(run('orderQ.a'),2)});
await test('API failure leaves order unchanged and cannot replay',async()=>{run(`fail=true;p={list:[{t:'order',id:'a',qty:9,txt:'A 9'}]};api.box({append(){}},p)`);await run('boxes.at(-1).buttons[0].onclick()');await run('boxes.at(-1).buttons[0].onclick()');assert.equal(run('orderQ.a'),2);assert.equal(run('writes.length'),1);run('fail=false')});
await test('flag proposal writes nothing',async()=>{run(`p={list:[],draft:{}};api.proposal(p).find(t=>t.name==='set_flag').execute({id:'a',flag:'stop',on:true})`);assert.equal(run('writes.length'),1);await run('api.commit(p.list)');assert.equal(run('writes.length'),2);assert.equal(run('writes.at(-1).request.items[0].state.stop'),true)});
await test('mixed table batch is rejected before writes',async()=>{run(`p.list.push({t:'order',id:'a',qty:1})`);await assert.rejects(run('api.commit(p.list)'));assert.equal(run('writes.length'),2)});
await test('stock tool is isolated until successful reply',()=>{run(`p={list:[],draft:{}};api.proposal(p).find(t=>t.name==='stage_stock').execute({id:'a',delta:-2,toBar:true})`);assert.equal(run('Object.keys(draft).length'),0);assert.equal(run('p.draft.a.d'),-2);assert.equal(run('writes.length'),2)});
await test('model error after tools discards all changes',async()=>{run(`sampleFn=async(turns,o)=>{o.tools.find(t=>t.name==='stage_stock').execute({id:'a',delta:-1});o.tools.find(t=>t.name==='set_order').execute({id:'a',qty:7});throw Error('API down')};input.value='order';`);await run('aiSend()');assert.equal(run('Object.keys(draft).length'),0);assert.equal(run('orderQ.a'),2);assert.equal(run('writes.length'),2)});
await test('stopped model reply discards all changes',async()=>{run(`sampleFn=async(turns,o)=>{o.tools.find(t=>t.name==='set_order').execute({id:'a',qty:7});aiCtl.abort();return {text:'done'}};input.value='order'`);await run('aiSend()');assert.equal(run('orderQ.a'),2);assert.equal(run('writes.length'),2)});
await test('model prose fallbacks never modify state',()=>{run(`orderFixBox({},'добавил Brand A в заказ','закажи');stockFixBox({},'перенёс Brand A 2 шт',{},true)`);assert.equal(run('writes.length'),2);assert.equal(run('Object.keys(draft).length'),0)});
await test('new request cancels previous pending proposals',async()=>{run(`p={list:[{t:'order',id:'a',qty:8,txt:'A'}]};api.box({append(){}},p);oldBox=boxes.at(-1);input.value='test'`);await run('aiSend()');await run('oldBox.buttons[0].onclick()');assert.equal(run('writes.length'),2)});
await test('/заказать requires confirmation',async()=>{run(`aiCtl=new AbortController();cmdMatch={found:[{id:'b'}],ambiguous:[],not_found_lines:[]};out={append(){}}`);await run(`cmdZakazat(out,'Brand B',[])`);assert.equal(run('writes.length'),2);assert.equal(run('orderQ.b'),2);run('boxes.at(-1).buttons[1].onclick()')});
await test('/списать и заказать creates only draft and proposal',async()=>{run(`cmdMatch={found:[{id:'a'},{id:'b'}],ambiguous:[],not_found_lines:[]}`);await run(`cmdSpisatZakaz(out,'Brand A; Brand B',[])`);assert.equal(run('draft.a.d'),-3);assert.equal(run('writes.length'),2);assert.equal(run('orderQ.b'),2);run('boxes.at(-1).buttons[1].onclick();draft={}')});
await test('ambiguous command fails before modifying draft',async()=>{run(`cmdMatch={found:[],ambiguous:[{options:[]}],not_found_lines:[]}`);await assert.rejects(run(`cmdPerenos(out,'Brand Raspberry',[])`));assert.equal(run('Object.keys(draft).length'),0);assert.equal(run('writes.length'),2)});
await test('missing product command does not write',async()=>{run(`cmdMatch={found:[],ambiguous:[],not_found_lines:['missing']}`);await run(`cmdPerenos(out,'missing',[])`);assert.equal(run('writes.length'),2)});
await test('unwrapped persistence tools reject direct calls',()=>{assert.throws(()=>run(`api.tools.find(t=>t.name==='set_order').execute({id:'a',qty:1})`));assert.throws(()=>run(`api.tools.find(t=>t.name==='set_flag').execute({id:'a',flag:'stop',on:true})`));assert.equal(run('writes.length'),2)});
await test('failed OCR command leaves no draft',async()=>{run(`sampleFn={readLabels:async()=>({text:'Brand A',failed:true})};aiCtl=new AbortController()`);await assert.rejects(run(`cmdPerenos(out,'',[{}])`));assert.equal(run('Object.keys(draft).length'),0);assert.equal(run('writes.length'),2)});
await test('stopped OCR command leaves no draft',async()=>{run(`sampleFn={readLabels:async()=>{aiCtl.abort();return {text:'Brand A'}}}`);await assert.rejects(run(`cmdPerenos(out,'',[{}])`));assert.equal(run('Object.keys(draft).length'),0);assert.equal(run('writes.length'),2)});
console.log(count+' action tests passed');
})().catch(e=>{console.error(e);process.exitCode=1});
