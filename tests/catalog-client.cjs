const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const shim=fs.readFileSync('app/shim.js','utf8'),calls=[];
let failOverrides=false;
const rest=async(path,opt)=>{calls.push({path,opt});
 if(opt){assert(!path.startsWith('flavors?'),'client must not mutate shared catalog');return []}
 if(path.startsWith('flavors?select=id,strength'))return [{id:'a',strength:5},{id:'b',strength:4}];
 if(path.startsWith('flavors?select=id,pack_g'))return [{id:'a',pack_g:50}];
 if(failOverrides)throw Error('override request failed');
 if(path.startsWith('flavor_strengths?'))return [{flavor_id:'a',strength:8}];
 if(path.startsWith('flavor_packs?'))return [{flavor_id:'a',pack_g:null}];
 throw Error('Unexpected request '+path);
};
const ctx=vm.createContext({rest,V:()=> 'venue-a',H:()=>({Authorization:'Bearer test'}),setTimeout:()=>{},bump:()=>{},listen:()=>({}),Map,session:{user:{tg_id:1}},localStorage:{getItem:()=>null}});
vm.runInContext(shim.slice(shim.indexOf('  const MAP={'),shim.indexOf('  const subs={}'))+
 shim.slice(shim.indexOf('  const snapDocs='),shim.indexOf('  async function refresh('))+
 shim.slice(shim.indexOf('  const db={'),shim.indexOf('  const downloads='))+'globalThis.api=db;globalThis.read=snapDocs;',ctx);
(async()=>{
 let docs=await ctx.read('strength');let values=Object.fromEntries(docs.map(d=>[d.id,d.data().s]));assert.deepEqual(values,{a:8,b:4});
 docs=await ctx.read('pack');assert.equal(docs[0].data().g,null);
 await ctx.api.doc('strength/a').set({s:7});let last=calls.at(-1);assert.equal(last.path,'flavor_strengths?on_conflict=venue_id,flavor_id');assert.deepEqual(JSON.parse(last.opt.body),{venue_id:'venue-a',flavor_id:'a',strength:7});
 await ctx.api.doc('pack/a').set({g:100});assert.deepEqual(JSON.parse(calls.at(-1).opt.body),{venue_id:'venue-a',flavor_id:'a',pack_g:100});
 await ctx.api.bulk('strength',['a','b','a'],{s:6});assert.equal(calls.at(-1).opt.method,'POST');assert.deepEqual(JSON.parse(calls.at(-1).opt.body),[{venue_id:'venue-a',flavor_id:'a',strength:6},{venue_id:'venue-a',flavor_id:'b',strength:6}]);
 await ctx.api.doc('pack/a').delete();assert.equal(calls.at(-1).path,'flavor_packs?flavor_id=eq.a&venue_id=eq.venue-a');
 failOverrides=true;await assert.rejects(ctx.read('strength'),/override request failed/);
 const template=fs.readFileSync('karta/template.html','utf8'),guestCalls=[];
 const guest=vm.createContext({URLSearchParams,Map,window:{POLKA_CONFIG:{url:'https://test.invalid',anon:'public-test',venue:'fallback-venue'}},location:{search:'?v=venue-b'},ALL:[{id:'a',b:'Test',n:'A',st:5},{id:'b',b:'Test',n:'B',st:4}],DATA:[],MIXES:[],render:()=>{},fetch:async url=>{guestCalls.push(url);return{ok:true,json:async()=>url.includes('public_stock?')?[{flavor_id:'a',slow:true}]:url.includes('public_mixes?')?[]:url.includes('flavor_strengths?')?[{flavor_id:'a',strength:3}]:[{id:'a',strength:7}]}}});
 const start=template.indexOf('/* Живые данные:');
 await vm.runInContext(template.slice(start,template.indexOf('</script>',start)),guest);
 assert.equal(guest.ALL[0].st,3);assert.equal(guest.DATA.length,1);assert.equal(guest.DATA[0].sl,true);
 assert(guestCalls.some(url=>url.includes('flavor_strengths?')&&url.includes('venue_id=eq.venue-b')));
 console.log('PASS catalog client: defaults, local override, null clear, single/bulk writes, scoped delete, failure propagation and venue guest card');
})().catch(e=>{console.error(e);process.exitCode=1});
