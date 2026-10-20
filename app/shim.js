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
      list:()=>"suppliers?select=id,name,contact,brands&venue_id=eq."+V(),
      toDoc:r=>({name:r.name,contact:r.contact,brands:r.brands||[]}),
      fromDoc:(id,o)=>{const b={venue_id:V(),name:o.name,contact:o.contact||"",brands:o.brands||[]};if(id)b.id=id;return b},conflict:"id"},
    mixes:{table:"mixes",key:"id",
      list:()=>"mixes?select=id,title,kind,note,tags,parts,by_name,created_at,hidden,in_karta&venue_id=eq."+V(),
      toDoc:r=>{const d={title:r.title,kind:r.kind,note:r.note,tags:r.tags||[],parts:r.parts||[],by:r.by_name,at:r.created_at};if(r.hidden)d.hidden=true;if(r.in_karta)d.inKarta=true;return d},
      fromDoc:(id,o)=>{const b={venue_id:V(),title:o.title,kind:o.kind||"master",note:o.note||"",tags:o.tags||[],parts:o.parts||[],by_name:o.by||null,by_tg:session.user.tg_id,hidden:!!o.hidden,in_karta:!!o.inKarta};if(o.at)b.created_at=o.at;if(id)b.id=id;return b},conflict:"id"},
    items:{table:"flavors",key:"id",
      list:()=>"flavors?select=id,brand,line,name,descr&custom=eq.true&venue_id=eq."+V(),
      toDoc:r=>({b:r.brand,l:r.line||"",n:r.name,d:r.descr||"",s:"name",t:[],bar:false}),
      fromDoc:(id,o)=>({id,brand:o.b,line:o.l||"",name:o.n,descr:o.d||"",custom:true,venue_id:V()}),conflict:"id"},
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
    collection:c=>Object.assign(listen(c),{
      orderBy:()=>({limit:()=>listen(c)}),
      add:async o=>{const m=MAP[c];const r=await rest(m.table,{method:"POST",headers:Object.assign(H(),{Prefer:"return=representation"}),body:JSON.stringify(m.fromDoc(null,o))});bump(c);return{id:String(r[0][m.key])}}}),
    doc:p=>{const [c,id]=p.split("/");return{
      set:async o=>{
        if(c==="order"){await rest("orders?on_conflict=venue_id",{method:"POST",headers:Object.assign(H(),{Prefer:"resolution=merge-duplicates"}),body:JSON.stringify({venue_id:V(),items:o,updated_at:new Date().toISOString()})});bump(c);return}
        const m=MAP[c];await rest(m.table+"?on_conflict="+(m.conflict||m.key),{method:"POST",headers:Object.assign(H(),{Prefer:"resolution=merge-duplicates"}),body:JSON.stringify(m.fromDoc(id,o))});bump(c)},
      delete:async()=>{const m=MAP[c];await rest(m.table+"?"+m.key+"=eq."+encodeURIComponent(id)+"&venue_id=eq."+V(),{method:"DELETE"});bump(c)}}}
  };
  const downloads={save:async({filename,data})=>{const b=new Blob([data],{type:"application/octet-stream"}),u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(u);a.remove()},1500)}};
  window.claude={use:async k=>{
    if(k==="db"){await readyP;return db}
    if(k==="user"){await readyP;return{canEdit:async()=>session.user.role==="manager",name:session.user.name,role:session.user.role}}
    if(k==="downloads")return downloads;
    return null}};
})();
