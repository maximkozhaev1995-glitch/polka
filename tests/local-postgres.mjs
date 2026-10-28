import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {Client} from 'pg';
export async function freePort(){const s=net.createServer();await new Promise((ok,no)=>s.listen(0,'127.0.0.1',ok).once('error',no));const p=s.address().port;await new Promise(ok=>s.close(ok));return p}
function shortPath(p){return process.platform==='win32'?execFileSync('cmd.exe',['/d','/s','/c',`"for %I in ("${p}") do @echo %~sI"`],{encoding:'utf8',windowsHide:true,windowsVerbatimArguments:true}).trim():p}
export async function localPostgres(){
  if(process.env.MIXORA_TEST_DOCKER==='1')return dockerPostgres();
  const workspace=shortPath(process.cwd());
  const root=path.join(workspace,'.local-tests');await fs.mkdir(root,{recursive:true});
  // Retain only test data for diagnostics. Never delete a computed directory.
  const databaseDir=await fs.mkdtemp(path.join(root,'pg-')),port=await freePort(),password=crypto.randomUUID();
  const binaries=await import(`@embedded-postgres/${process.platform==='win32'?'windows':process.platform}-${process.arch}`);
  const initdb=shortPath(binaries.initdb),pgctl=shortPath(binaries.pg_ctl);
  const pwfile=path.join(databaseDir,'init-password');await fs.writeFile(pwfile,password,{mode:0o600});
  function run(exe,args){return new Promise((ok,no)=>{const p=spawn(exe,args,{windowsHide:true,env:{...process.env,LC_MESSAGES:'C'}});let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);p.on('error',no);p.on('exit',code=>code===0?ok(output):no(Error(output)))})}
  try{await run(initdb,['-D',path.join(databaseDir,'data'),'-U','postgres','--auth=scram-sha-256',`--pwfile=${pwfile}`,'--encoding=UTF8','--locale=C'])}
  finally{await fs.unlink(pwfile)}
  // pg_ctl creates the restricted Windows token required by PostgreSQL; no
  // system account or service is created. The server binds to loopback only.
  await run(pgctl,['-D',path.join(databaseDir,'data'),'-l',path.join(databaseDir,'server.log'),'-o',`-p ${port} -h 127.0.0.1`,'start','-w']);
  const clients=new Set();
  async function connect(){const c=new Client({host:'127.0.0.1',port,user:'postgres',password,database:'postgres'});c.on('error',()=>{});c.once('end',()=>clients.delete(c));await c.connect();clients.add(c);return c}
  async function close(){for(const c of clients)await c.end().catch(()=>{});await run(pgctl,['-D',path.join(databaseDir,'data'),'stop','-m','fast','-w'])}
  return {connect,close,port,databaseDir};
}
// Opt-in isolated Linux fallback when the embedded binary's ICU ABI is absent.
// Only this newly created container is stopped; no host database is contacted.
async function dockerPostgres(){
 const port=await freePort(),password=crypto.randomUUID(),name='mixora-pr77-'+crypto.randomUUID().slice(0,8),clients=new Set();
 const env={...process.env};for(const k of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[k];
 const docker=args=>execFileSync('docker',['--host=unix:///var/run/docker.sock',...args],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 docker(['run','--rm','-d','--name',name,'-p',`127.0.0.1:${port}:5432`,'-e',`POSTGRES_PASSWORD=${password}`,'postgres:17-bookworm']);
 async function connect(){const c=new Client({host:'127.0.0.1',port,user:'postgres',password,database:'postgres'});c.on('error',()=>{});c.once('end',()=>clients.delete(c));await c.connect();clients.add(c);return c}
 try{let ready=false;for(let i=0;i<100;i++){try{const c=await connect();await c.end();ready=true;break}catch{await new Promise(r=>setTimeout(r,100))}}if(!ready)throw Error('Local test PostgreSQL did not start')}
 catch(e){docker(['stop',name]);throw e}
 return{connect,port,databaseDir:'isolated Docker '+name,close:async()=>{for(const c of clients)await c.end().catch(()=>{});docker(['stop',name])}};
}
