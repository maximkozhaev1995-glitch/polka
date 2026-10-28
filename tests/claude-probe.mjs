import {loadLocalAI} from './local-ai-runtime.mjs';
await loadLocalAI('http://127.0.0.1:1');
const base=process.env.ANTHROPIC_API_KEY?'https://api.anthropic.com':process.env.ANTHROPIC_BASE_URL;
const headers={'content-type':'application/json','anthropic-version':'2023-06-01'};
if(process.env.ANTHROPIC_API_KEY)headers['x-api-key']=process.env.ANTHROPIC_API_KEY;else headers.Authorization='Bearer '+process.env.ANTHROPIC_AUTH_TOKEN;
const r=await fetch(base.replace(/\/$/,'')+'/v1/messages',{method:'POST',headers,body:JSON.stringify({model:'claude-sonnet-5-5',max_tokens:32,messages:[{role:'user',content:'Reply with OK only.'}]})});
const d=await r.json();console.log(JSON.stringify({status:r.status,model:d.model,usage:d.usage,errorType:d.error?.type,text:d.content?.filter(x=>x.type==='text').map(x=>x.text).join('').slice(0,80)}));
