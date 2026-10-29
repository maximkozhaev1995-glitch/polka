// Real helper behavior; no network requests, catalog or stock mutations.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync('src/stoika.html','utf8'),shim=fs.readFileSync('app/shim.js','utf8');
const start=app.indexOf('let learnedPhoto=[];'),end=app.indexOf('async function cmdNaiti(',start);
assert(start>0&&end>start);
const helper=app.slice(start,end);
const context={cnTxt:v=>' '+String(v||'').toLowerCase().replace(/[^a-zа-я0-9]+/g,' ').trim()+' ',
 byId:{'fl1':{b:'Сарма',n:'Малина'}},wh:()=>2,onBar:()=>false,document:{createElement:()=>({style:{},append(){}})},db:{savePhotoCorrection:async()=>true},window:{}};
vm.createContext(context);
vm.runInContext(helper,context);
vm.runInContext('learnedPhoto=[{raw_label:"САРМА360 Малина",flavor_id:"fl1"}]',context);
const hints=vm.runInContext('learnedHints("Фокус: САРМА\\nЭтикетка 1: САРМА360 Малина")',context);
assert(hints.includes('Сарма Малина')&&hints.includes('на стойке: нет'),hints);
assert.equal(vm.runInContext('learnedHints("Фокус: ДРУГОЙ\\nЭтикетка 1: САРМА360 Княженика")',context),'');
assert(!helper.includes('stage_stock'),'Learned hints must never stage stock');
assert(shim.includes('listPhotoCorrections:async'),'read method required');
assert(shim.includes('savePhotoCorrection:async'),'approval write method required');
assert(shim.includes('photo_corrections?on_conflict=venue_id,raw_label'),'venue-scoped upsert required');
const n=app.slice(app.indexOf('async function cmdNaiti('),app.indexOf('function transferQuantity(',app.indexOf('async function cmdNaiti(')));
assert(n.includes('offerPhotoCorrection(out,text)'),'photo correction button required');
assert(n.includes('x.onBar?", на стойке: есть":", на стойке: нет"'),'find should report explicit status');
const sql=fs.readFileSync('supabase/migrations/20261029_photo_corrections.sql','utf8');
for(const part of ['ENABLE ROW LEVEL SECURITY','is_staff()','me_venue()','REFERENCES public.flavors(id)','TO authenticated'])assert(sql.includes(part),'missing secure migration: '+part);
assert(!sql.includes('TO anon\n'),'Anonymous users must not write');
console.log('PASS: approved photo corrections, venue-scoped persistence, safe /найти hints and RLS policy');
