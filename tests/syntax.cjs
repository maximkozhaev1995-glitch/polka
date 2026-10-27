const fs=require('node:fs'),cp=require('node:child_process'),assert=require('node:assert/strict');
let count=0;
for(const path of ['src/stoika.html','index.html']){
  for(const match of fs.readFileSync(path,'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){
    if(!match[1].trim())continue;
    const result=cp.spawnSync(process.execPath,['--check'],{input:match[1],encoding:'utf8'});
    assert.equal(result.status,0,path+' '+result.stderr);count++;
  }
}
assert.equal(cp.spawnSync(process.execPath,['--check','app/shim.js']).status,0);
console.log(`${count} inline scripts and shim syntax passed`);
