const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.env.SOURCE||'src/stoika.html','utf8');
const data=source.match(/const DATA=(\[.*?\]);/s)[0];
const code=source.slice(source.indexOf('const cnTxt='),source.indexOf('let photoAcc='));
const ctx=vm.createContext({console});
vm.runInContext(data+`;const norm=s=>String(s).toLowerCase().replace(/ё/g,'е');const wh=()=>0,onBar=x=>x.bar;const aiItem=x=>({id:x.id,brand:x.b,name:x.n,line:x.l});`+code+`;globalThis.match=matchText;globalThis.items=DATA;`,ctx);
const tests=JSON.parse(fs.readFileSync('tests/fixtures/matching-cases.json','utf8')).cases;let bad=0;
for(const c of tests){const m=ctx.match(c.text),got=m.found.flatMap(f=>{const x=ctx.items.find(x=>x.id===f.id);return Array(f.jars||1).fill(x.b+'|'+(x.l?x.l+'|':'')+x.n)});try{assert.deepEqual(Array.from(got).sort(),Array.from(c.want).sort());if(c.amb!==undefined)assert.equal((m.ambiguous||[]).length,c.amb);console.log('PASS',c.id)}catch{bad++;console.log('FAIL',c.id,JSON.stringify(got))}}
console.log(`${tests.length-bad}/${tests.length} passed`);process.exitCode=bad?1:0;
let sweepBad=0;
for(const x of ctx.items)for(const pre of ['', 'Этикетка 1: ']){const m=ctx.match(pre+x.b+' '+(x.l?x.l+' ':'')+x.n);const ids=m.found.map(f=>f.id);if(!ids.length&&!x.l&&(m.ambiguous||[]).some(a=>a.options.some(o=>o.id===x.id)))continue;if(ids.length!==1||ids[0]!==x.id){sweepBad++;console.log('SWEEP FAIL',x.b,x.l,x.n,JSON.stringify(ids))}}
console.log(`catalog sweep: ${ctx.items.length*2} cases, ${sweepBad} failures`);if(sweepBad)process.exitCode=1;
