// © 2026 Максим Кожаев. Все права защищены. Копирование, распространение и использование без письменного согласия автора запрещены.
// Полка: слой между приложением и базой. Приложение написано под window.claude.use("db"), здесь тот же интерфейс поверх Supabase.
(function(){
  const CFG=window.POLKA_CONFIG, tg=window.Telegram&&window.Telegram.WebApp;
  if(tg){try{tg.ready();tg.expand()}catch(e){}}
  const $=s=>document.querySelector(s);
  let session=null, resolveReady, readyP=new Promise(r=>resolveReady=r);
  const wall=document.createElement("div");wall.id="login";
  wall.innerHTML='<div class="lg-in"><svg viewBox="0 0 64 64" width="64" height="64"><rect x="8" y="46" width="48" height="6" rx="3" fill="currentColor"/><rect x="9" y="26" width="14" height="16" rx="3.5" fill="#e4600f"/><rect x="25" y="26" width="14" height="16" rx="3.5" fill="#e4600f"/><rect x="41" y="26" width="14" height="16" rx="3.5" fill="#e4600f"/></svg><h1>Полка</h1><p id="lg-msg">Входим…</p><form id="lg-form" hidden><input id="lg-code" placeholder="Код приглашения" autocomplete="off" autocapitalize="off"><button class="btn go" type="submit">Войти</button></form></div>';
  const st=document.createElement("style");st.textContent="#login{position:fixed;inset:0;z-index:999;background:var(--bg,#f6f1ec);color:var(--fg,#24180f);display:grid;place-items:center;padding:24px;text-align:center}#login .lg-in{display:grid;gap:12px;justify-items:center;max-width:320px}#login h1{margin:0;font-size:28px}#login p{margin:0;color:var(--muted,#6e5d4f)}#login form{display:grid;gap:8px;width:100%}#login input{height:48px;font:inherit;font-size:16px;text-align:center;border:1px solid var(--line-ctl,#d2c5b6);border-radius:12px;background:var(--surface,#fffaf5);color:inherit}#login button{height:48px}";
  document.head.appendChild(st);document.addEventListener("DOMContentLoaded",()=>document.body.appendChild(wall));
  if(document.body)document.body.appendChild(wall);
  const msg=t=>{const m=$("#lg-msg");if(m)m.textContent=t};
  async function call(invite){
    const r=await fetch(CFG.url+"/functions/v1/tg-auth",{method:"POST",headers:{"Content-Type":"application/json",apikey:CFG.anon},body:JSON.stringify({initData:tg&&tg.initData||"",invite:invite||""})});
    return {ok:r.ok,status:r.status,body:await r.json().catch(()=>({}))};
  }
  async function login(invite){
    if(!tg||!tg.initData){msg("Откройте приложение из Telegram: бот @PolkaHookahbot.");return}
    const code=invite||localStorage.getItem("polka-invite")||"";
    let r;try{r=await call(code)}catch(e){msg("Нет связи. Проверьте интернет и откройте снова.");return}
    if(r.ok){try{localStorage.removeItem("polka-invite")}catch(e){}session={token:r.body.token,user:r.body.user};wall.remove();resolveReady(session);return}
    const e=r.body.error;
    if(e==="need_invite"||e==="bad_invite"){msg(e==="bad_invite"?"Код не подошёл. Проверьте и введите снова.":"Введите код приглашения, который дал управляющий.");$("#lg-form").hidden=false;return}
    msg(e==="bad_signature"?"Не удалось подтвердить вход. Закройте и откройте приложение заново.":"Что-то пошло не так, попробуйте позже.");
  }
  window.addEventListener("DOMContentLoaded",()=>{
    $("#lg-form").addEventListener("submit",ev=>{ev.preventDefault();const v=$("#lg-code").value.trim();if(!v)return;try{localStorage.setItem("polka-invite",v)}catch(e){}msg("Проверяем…");login(v)});
    login();
  });

  // ===== база =====
  const H=()=>({apikey:CFG.anon,Authorization:"Bearer "+session.token,"Content-Type":"application/json"});
  const V=()=>session.user.venue_id;
  async function rest(path,opt){const r=await fetch(CFG.url+"/rest/v1/"+path,Object.assign({headers:H()},opt));if(!r.ok){let t="";try{t=(await r.json()).message}catch(e){}throw new Error(t||("HTTP "+r.status))}const t=await r.text();return t?JSON.parse(t):null}
  const iso=x=>x?new Date(x).toISOString():undefined;
  const MAP={
    stock:{table:"stock",key:"flavor_id",
      list:()=>"stock?select=flavor_id,wh,bar,stop,stop_auto,slow,retired&venue_id=eq."+V(),
      toDoc:r=>{const d={wh:r.wh,bar:r.bar};if(r.stop)d.stop=true;if(r.stop_auto)d.stopAuto=true;if(r.slow)d.slow=true;if(r.retired)d.retired=true;return d},
      fromDoc:(id,o)=>{const b={venue_id:V(),flavor_id:id,wh:o.wh||0,stop:!!o.stop,stop_auto:!!o.stopAuto,slow:!!o.slow,retired:!!o.retired};if(typeof o.bar==="boolean")b.bar=o.bar;return b},
      conflict:"venue_id,flavor_id"},
    moves:{table:"moves",key:"id",
      list:()=>"moves?select=id,flavor_id,kind,qty,left_after,reason,prev,bar_to,at&venue_id=eq."+V()+"&order=at.desc&limit=400",
      toDoc:r=>({item:r.flavor_id,kind:r.kind,qty:r.qty,left:r.left_after,reason:r.reason||undefined,prev:r.prev||undefined,barTo:r.bar_to===null?undefined:r.bar_to,at:r.at}),
      fromDoc:(id,o)=>({venue_id:V(),flavor_id:o.item,kind:o.kind||"in",qty:o.qty||0,left_after:o.left,reason:o.reason||null,prev:o.prev||null,bar_to:typeof o.barTo==="boolean"?o.barTo:null,at:o.at||new Date().toISOString(),by_tg:session.user.tg_id})},
    suppliers:{table:"suppliers",key:"id",
      list:()=>"suppliers?select=id,name,contact,brands,ctype,legal_address,requisites,items,files&venue_id=eq."+V(),
      toDoc:r=>({name:r.name,contact:r.contact,brands:r.brands||[],ctype:r.ctype||"kalyan",addr:r.legal_address||"",req:r.requisites||"",items:r.items||"",files:r.files||[]}),
      fromDoc:(id,o)=>{const b={venue_id:V(),name:o.name,contact:o.contact||"",brands:o.brands||[],ctype:o.ctype||"kalyan",legal_address:o.addr||"",requisites:o.req||"",items:o.items||"",files:o.files||[]};if(id)b.id=id;return b},conflict:"id"},
    mixes:{table:"mixes",key:"id",
      list:()=>"mixes?select=id,title,kind,note,tags,parts,by_name,created_at,hidden,in_karta&venue_id=eq."+V(),
      toDoc:r=>{const d={title:r.title,kind:r.kind,note:r.note,tags:r.tags||[],parts:r.parts||[],by:r.by_name,at:r.created_at};if(r.hidden)d.hidden=true;if(r.in_karta)d.inKarta=true;return d},
      fromDoc:(id,o)=>{const b={venue_id:V(),title:o.title,kind:o.kind||"master",note:o.note||"",tags:o.tags||[],parts:o.parts||[],by_name:o.by||null,by_tg:session.user.tg_id,hidden:!!o.hidden,in_karta:!!o.inKarta};if(o.at)b.created_at=o.at;if(id)b.id=id;return b},conflict:"id"},
    strength:{table:"flavors",key:"id",patch:true,
      list:()=>"flavors?select=id,strength&strength=not.is.null&limit=1000",
      toDoc:r=>({s:r.strength}),fromDoc:(id,o)=>({strength:o.s})},
    pack:{table:"flavors",key:"id",patch:true,
      list:()=>"flavors?select=id,pack_g&pack_g=not.is.null&limit=1500",
      toDoc:r=>({g:r.pack_g}),fromDoc:(id,o)=>({pack_g:o.g||null})},
    packsizes:{table:"pack_sizes",key:"brand",list:()=>"pack_sizes?select=brand,sizes",toDoc:r=>({sizes:r.sizes||[]}),fromDoc:()=>({})},
    guestmix:{table:"guest_mixes",key:"id",
      fromDoc:(id,o)=>({venue_id:V(),gid:o.gid,name:o.name||null,parts:o.parts||[],note:o.note||null,by_name:o.by||null})},
    wishes:{table:"wishes",key:"id",patch:true,
      list:()=>"wishes?select=id,flavor_id,brand,flavor,state,created_at&venue_id=eq."+V()+"&order=created_at.desc&limit=2000",
      toDoc:r=>({fid:r.flavor_id||"",b:r.brand,f:r.flavor,state:r.state,at:r.created_at}),fromDoc:(id,o)=>({state:o.state})},
    team:{table:"users",key:"tg_id",patch:true,
      list:()=>"users?select=tg_id,name,role,perms&venue_id=eq."+V(),
      toDoc:r=>({name:r.name,role:r.role,perms:r.perms||[]}),fromDoc:(id,o)=>({perms:o.perms||[]})},
    invites:{table:"invites",key:"code",
      list:()=>"invites?select=code,role,created_at&used_by=is.null&venue_id=eq."+V(),
      toDoc:r=>({role:r.role,at:r.created_at}),fromDoc:(id,o)=>({code:id,venue_id:V(),role:o.role||"master"}),conflict:"code"},
    items:{table:"flavors",key:"id",
      list:()=>"flavors?select=id,brand,line,name,descr&custom=eq.true&venue_id=eq."+V(),
      toDoc:r=>({b:r.brand,l:r.line||"",n:r.name,d:r.descr||"",s:"name",t:[],bar:false}),
      fromDoc:(id,o)=>({id,brand:o.b,line:o.l||"",name:o.n,descr:o.d||"",custom:true,venue_id:V()}),conflict:"id"},
    invlog:{table:"inv_log",key:"id",
      list:()=>"inv_log?select=id,ig,items,shortage_units,shortage_g,price_per_g,shortage_rub,at&venue_id=eq."+V()+"&order=at.desc&limit=200",
      toDoc:r=>({ig:r.ig,items:r.items,units:r.shortage_units,g:r.shortage_g,price:r.price_per_g,rub:r.shortage_rub,at:r.at}),
      fromDoc:(id,o)=>({venue_id:V(),ig:o.ig,items:o.items||0,shortage_units:o.units||0,shortage_g:o.g||0,price_per_g:o.price||null,shortage_rub:o.rub||null,by_tg:session.user.tg_id,at:o.at||new Date().toISOString()})},
    tasks:{table:"tasks",key:"id",patch:true,
      list:()=>"tasks?select=id,text,done,done_by,created_at&venue_id=eq."+V()+"&order=created_at.desc&limit=200",
      toDoc:r=>({t:r.text,done:r.done,doneBy:r.done_by,at:r.created_at}),
      fromDoc:(id,o)=>o.t!==undefined?{venue_id:V(),text:o.t,done:!!o.done,by_tg:session.user.tg_id}:{done:!!o.done,done_by:o.done?(o.doneBy||session.user.name||""):null}},
    knowledge:{table:"knowledge",key:"id",
      list:()=>"knowledge?select=id,name,path,created_at&venue_id=eq."+V()+"&order=created_at.desc&limit=200",
      toDoc:r=>({name:r.name,path:r.path,at:r.created_at}),
      fromDoc:(id,o)=>({venue_id:V(),name:o.name,path:o.path,by_tg:session.user.tg_id})},
  };
  const subs={};
  const snapDocs=async c=>{
    if(c==="order"){const rows=await rest("orders?select=items&venue_id=eq."+V());return rows.length?[{id:"current",data:()=>rows[0].items}]:[]}
    const m=MAP[c];if(!m)return[];const rows=await rest(m.list());return rows.map(r=>({id:String(r[m.key]),data:()=>m.toDoc(r)}))};
  async function refresh(c){const s=subs[c];if(!s)return;try{const docs=await snapDocs(c);const h=JSON.stringify(docs.map(d=>[d.id,d.data()]));if(h!==s.hash){s.hash=h;s.fns.forEach(f=>f({docs}))}}catch(e){s.errs.forEach(f=>f(e))}}
  setInterval(()=>{if(!document.hidden&&session)Object.keys(subs).forEach(refresh)},6000);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden&&session)Object.keys(subs).forEach(refresh)});
  const bump=c=>setTimeout(()=>refresh(c),150);
  const listen=c=>({onSnapshot:(f,err)=>{const s=subs[c]||(subs[c]={fns:[],errs:[],hash:""});s.fns.push(f);if(err)s.errs.push(err);refresh(c)}});
  const db={
    bulk:async(c,ids,o)=>{const m=MAP[c];await rest(m.table+"?"+m.key+"=in.("+ids.map(encodeURIComponent).join(",")+")",{method:"PATCH",body:JSON.stringify(m.fromDoc(null,o))});setTimeout(()=>refresh(c),150)},
    collection:c=>Object.assign(listen(c),{
      orderBy:()=>({limit:()=>listen(c)}),
      add:async o=>{const m=MAP[c];const r=await rest(m.table,{method:"POST",headers:Object.assign(H(),{Prefer:"return=representation"}),body:JSON.stringify(m.fromDoc(null,o))});bump(c);return{id:String(r[0][m.key])}}}),
    doc:p=>{const [c,id]=p.split("/");return{
      set:async o=>{
        if(c==="order"){await rest("orders?on_conflict=venue_id",{method:"POST",headers:Object.assign(H(),{Prefer:"resolution=merge-duplicates"}),body:JSON.stringify({venue_id:V(),items:o,updated_at:new Date().toISOString()})});bump(c);return}
        const m=MAP[c];if(m.patch){await rest(m.table+"?"+m.key+"=eq."+encodeURIComponent(id)+(m.table==="flavors"?"":"&venue_id=eq."+V()),{method:"PATCH",body:JSON.stringify(m.fromDoc(id,o))});bump(c);return}
        await rest(m.table+"?on_conflict="+(m.conflict||m.key),{method:"POST",headers:Object.assign(H(),{Prefer:"resolution=merge-duplicates"}),body:JSON.stringify(m.fromDoc(id,o))});bump(c)},
      delete:async()=>{const m=MAP[c];await rest(m.table+"?"+m.key+"=eq."+encodeURIComponent(id)+"&venue_id=eq."+V(),{method:"DELETE"});bump(c)}}},
    uploadFile:async(folder,file)=>{
      const safe=file.name.replace(/[^\w.\-]+/g,"_").slice(-80),path=V()+"/"+folder+"/"+Date.now().toString(36)+"_"+safe;
      const r=await fetch(CFG.url+"/storage/v1/object/files/"+path,{method:"POST",headers:{Authorization:"Bearer "+session.token,apikey:CFG.anon,"Content-Type":file.type||"application/octet-stream","x-upsert":"true"},body:file});
      if(!r.ok){let t="";try{t=(await r.json()).message}catch(e){}throw new Error(t||("HTTP "+r.status))}
      return {path,name:file.name};
    },
    signFile:async path=>{
      const r=await fetch(CFG.url+"/storage/v1/object/sign/files/"+path,{method:"POST",headers:{Authorization:"Bearer "+session.token,apikey:CFG.anon,"Content-Type":"application/json"},body:JSON.stringify({expiresIn:3600})});
      if(!r.ok)throw new Error("HTTP "+r.status);
      const j=await r.json();return CFG.url+"/storage/v1"+j.signedURL;
    },
    deleteFile:async path=>{await fetch(CFG.url+"/storage/v1/object/files/"+path,{method:"DELETE",headers:{Authorization:"Bearer "+session.token,apikey:CFG.anon}})}
  };
  const downloads={save:async({filename,data})=>{const b=new Blob([data],{type:"application/octet-stream"}),u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(u);a.remove()},1500)}};
  // ИИ-ассистент: цикл «запрос → инструменты → ответ» выполняется здесь, ключ ИИ остаётся на сервере
  const imgToBlock=file=>new Promise((res,rej)=>{const fr=new FileReader();fr.onerror=()=>rej({code:"image_rejected"});fr.onload=()=>{const im=new Image();im.onerror=()=>rej({code:"image_rejected"});im.onload=()=>{const k=Math.min(1,1280/Math.max(im.width,im.height)),c=document.createElement("canvas");c.width=Math.round(im.width*k);c.height=Math.round(im.height*k);c.getContext("2d").drawImage(im,0,0,c.width,c.height);res({type:"image",source:{type:"base64",media_type:"image/jpeg",data:c.toDataURL("image/jpeg",.75).split(",")[1]}})};im.src=fr.result};fr.readAsDataURL(file)});
  const wait=(ms,signal)=>new Promise((res,rej)=>{const t=setTimeout(res,ms);if(signal)signal.addEventListener("abort",()=>{clearTimeout(t);rej({name:"AbortError"})},{once:true})});
  async function callAI(body,signal,onWait){
    // Бесплатный Gemini иногда отвечает «занят» или «слишком много запросов»: ждём и пробуем ещё два раза
    for(let a=0;;a++){
      const r=await fetch(CFG.url+"/functions/v1/ai",{method:"POST",signal,headers:H(),body:JSON.stringify(body)});
      const j=await r.json().catch(()=>({}));
      if(r.ok)return j;
      const e=j.error||(r.status===401?"session_expired":"server_error");
      if((e==="busy"||(e==="rate_limited"&&j.scope!=="daily"))&&a<2){if(onWait)onWait(a);await wait(a?9000:5000,signal);continue}
      throw {code:e==="not_configured"?"not_configured":e,text:""}}}
  const sample=async(turns,opts)=>{
    opts=opts||{};
    const first=turns[0]&&turns[0].role==="user"?turns[0].content:"";
    let msgs=turns.slice(2).map(t=>({role:t.role,content:t.content}));
    if(opts.images&&opts.images.length){
      const blocks=await Promise.all(opts.images.map(imgToBlock));
      const last=msgs[msgs.length-1];last.content=[...blocks,{type:"text",text:String(last.content)}]}
    const tools=(opts.tools||[]).map(t=>({name:t.name,description:t.description,input_schema:t.inputSchema}));
    const byName=Object.fromEntries((opts.tools||[]).map(t=>[t.name,t]));
    let text="";
    for(let step=0;step<8;step++){
      if(opts.signal&&opts.signal.aborted)throw {code:"cancelled",text};
      let r;try{r=await callAI({system:first,messages:msgs,tools},opts.signal,()=>{if(opts.onText)opts.onText({text:(text?text+"\n":"")+"ИИ занят, жду очередь…"})})}catch(e){if(e&&e.name==="AbortError")throw {code:"cancelled",text};throw Object.assign({text},e)}
      if(step===0)msgs.forEach(m=>{if(Array.isArray(m.content))m.content=m.content.map(b=>b.type==="image"?{type:"text",text:"[фото уже разобрано выше]"}:b)});
      msgs.push({role:"assistant",content:r.content});
      const part=r.content.filter(b=>b.type==="text").map(b=>b.text).join("");
      if(part){text+=(text?"\n":"")+part;if(opts.onText)opts.onText({text})}
      if(r.stop_reason==="refusal")throw {code:"refused",text};
      if(r.stop_reason!=="tool_use")break;
      const results=[];
      for(const b of r.content.filter(b=>b.type==="tool_use")){
        let content,err=false;
        try{const t=byName[b.name];if(!t)throw new Error("нет такого инструмента");content=JSON.stringify(await t.execute(b.input||{}))}catch(e){err=true;content=String(e&&e.message||e)}
        results.push({type:"tool_result",tool_use_id:b.id,content,is_error:err||undefined})}
      msgs.push({role:"user",content:results})}
    return {text:text||"Готово."}};
  sample.limits=async()=>({images:{mediaTypes:["image/jpeg","image/png","image/webp"]}});
  window.claude={use:async k=>{
    if(k==="db"){await readyP;return db}
    if(k==="user"){await readyP;window.__me=String(session.user.tg_id);return{canEdit:async()=>session.user.role==="manager",name:session.user.name,role:session.user.role,perms:session.user.perms||[]}}
    if(k==="downloads")return downloads;
    if(k==="sample"){await readyP;return sample}
    return null}};
})();
