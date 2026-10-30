// CI guard for Mixora's isolated test branch. Never reads credentials or writes databases.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const stage='qnohynnwasoyjakrrrhb';
const production='wwcgvwfmlkegaqkksujo';
const stageVenue='10000000-0000-0000-0000-000000000001';
const productionVenue='e58bb6aa-8a0e-4697-9ef6-0bc001f0e21e';
const files=['app/config.js','app/shim.js','index.html','karta/template.html','karta/index.html','tools/build_karta.py'];
const source=Object.fromEntries(files.map(p=>[p,fs.readFileSync(p,'utf8')]));
for (const [path,code] of Object.entries(source)){
  assert(!code.includes(production),path+': production Supabase ref remains');
  assert(!code.includes(productionVenue),path+': production venue remains');
}
for(const path of ['app/config.js','index.html','karta/template.html','karta/index.html','tools/build_karta.py']){
  assert(source[path].includes(stage),path+': test project ref missing');
}
for(const path of ['karta/template.html','karta/index.html','tools/build_karta.py']){
  assert(source[path].includes(stageVenue),path+': test venue missing');
}
for(const path of ['app/config.js','index.html','karta/template.html','karta/index.html']){
  assert(source[path].includes('https://'+stage+'.supabase.co'),path+': test API endpoint missing');
}
for(const path of ['app/config.js','index.html','karta/template.html','karta/index.html']){
  assert(/anon:"[^"]+"/.test(source[path]),path+': public test key missing');
}
const key=path=>source[path].match(/anon:"([^"]+)"/)?.[1];
assert.equal(key('app/config.js'),key('index.html'),'staff generated page public key drift');
assert.equal(key('karta/template.html'),key('karta/index.html'),'guest generated page public key drift');
assert.equal(key('app/config.js'),key('karta/template.html'),'staff and guest public keys differ');
console.log('PASS: static staging URL, test venue, public-key and production-reference guard');
