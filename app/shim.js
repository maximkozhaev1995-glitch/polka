// © 2026 Максим Кожаев. Все права защищены. Копирование, распространение и использование без письменного согласия автора запрещены.
// Полка: слой между приложением и базой. Приложение написано под window.claude.use("db"), здесь тот же интерфейс поверх Supabase.
(function(){
  const CFG=window.POLKA_CONFIG, tg=window.Telegram&&window.Telegram.WebApp;
  if(tg){try{tg.ready();tg.expand()}catch(e){}}
  const $=s=>document.querySelector(s);
  let session=null, resolveReady, readyP=new Promise(r=>resolveReady=r);
  const wall=document.createElement("div");wall.id="login";
  wall.innerHTML='<div class="lg-in"><svg width="120" height="72" style="color:var(--fg,#eef1ec)" viewBox="0 0 159 96" aria-hidden="true"><path d="M12.3 90.8C9.0 88.4 5.8 83.5 4.7 79.3C4.4 78.0 4.3 74.6 4.5 73.2C5.2 68.1 9.0 62.5 16.5 55.2C21.6 50.3 24.1 47.6 26.0 44.9C26.8 43.8 28.4 41.3 28.9 40.6C29.1 40.2 29.5 39.5 29.7 39.1C30.7 37.4 32.9 32.6 33.9 30.2C34.0 29.7 34.3 29.0 34.4 28.8C34.5 28.6 34.6 28.2 34.7 28.0C34.7 27.8 35.0 26.9 35.3 26.1C35.7 25.2 36.2 23.6 36.6 22.6C37.2 20.7 37.4 20.2 38.3 17.6C42.0 7.8 47.9 3.3 56.9 3.3C62.6 3.2 66.8 5.3 70.6 10.1C72.4 12.3 75.7 17.8 77.2 21.2C77.4 21.7 77.9 22.6 78.2 23.1C78.4 23.7 79.0 24.8 79.4 25.7C79.8 26.6 80.3 27.6 80.5 28.0C80.6 28.4 80.8 28.7 80.8 28.8C80.8 28.8 81.4 30.1 81.7 30.8C82.1 31.6 83.3 34.5 83.9 35.9C85.1 38.6 87.0 43.0 87.7 44.5C87.8 44.8 88.1 45.5 88.4 46.2C88.7 47.0 89.0 47.8 89.1 48.0C89.3 48.3 89.6 49.0 89.8 49.5C90.0 50.0 90.4 50.9 90.7 51.5C91.3 52.7 91.4 52.9 91.8 54.0C92.0 54.4 92.2 54.8 92.2 54.9C92.2 54.9 92.6 55.6 92.9 56.5C94.7 60.4 96.7 63.8 98.6 66.0C100.1 67.8 100.8 68.5 102.2 69.4C106.4 72.2 111.4 72.1 115.8 69.0C116.9 68.2 117.1 68.4 116.4 69.5C114.8 72.2 112.9 73.9 110.2 75.3C105.9 77.4 102.2 77.8 97.5 76.7C89.6 74.8 84.0 69.3 74.4 53.8C74.1 53.4 73.7 52.8 73.5 52.4C73.2 51.9 72.4 50.7 71.7 49.7C70.2 47.3 68.0 44.1 67.4 43.1C66.6 42.1 65.8 41.1 65.0 39.8C61.0 34.1 55.7 28.6 52.6 27.1C48.4 24.9 44.7 26.0 43.0 30.1C41.6 33.1 41.2 34.6 39.9 41.0C39.8 41.7 39.5 43.4 39.2 44.7C38.9 46.0 38.6 47.6 38.5 48.2C38.3 49.5 37.4 53.0 37.1 54.2C36.3 56.9 36.1 57.6 35.7 58.4C33.4 64.6 31.3 67.4 23.7 75.0C19.1 79.5 17.2 81.7 15.8 84.1C15.6 84.6 15.3 85.1 15.1 85.3C14.6 86.2 13.6 88.8 13.2 90.2C13.0 91.2 12.9 91.2 12.3 90.8ZM144.5 91.0C144.5 90.9 144.4 90.8 144.4 90.7C144.4 90.2 143.2 86.6 142.4 84.6C141.8 83.0 140.3 80.4 138.1 77.0C137.4 75.9 135.2 72.9 134.4 72.0C132.5 69.8 128.6 65.7 126.8 64.1C125.9 63.2 124.8 62.2 124.3 61.8C122.7 60.2 118.9 56.8 116.8 55.0C116.3 54.6 115.3 53.7 114.5 53.0C113.8 52.2 112.9 51.4 112.5 51.0C112.1 50.7 110.2 48.9 108.2 47.0C103.9 42.7 102.6 41.5 101.2 40.5C98.9 38.8 96.3 37.5 93.7 36.6C92.1 36.1 92.2 36.3 93.1 33.8C95.8 26.9 98.8 21.0 101.5 17.1C103.2 14.8 106.6 12.3 109.3 11.5C115.6 9.5 121.5 11.6 125.2 17.1C126.6 19.3 128.3 22.8 129.4 26.0C129.6 26.5 130.0 27.5 130.4 28.3C130.7 29.1 131.0 30.0 131.1 30.4C131.4 31.1 131.9 32.2 132.1 32.9C132.2 33.1 132.6 34.2 133.0 35.1C133.9 37.7 134.0 38.0 134.6 39.4C134.8 40.0 135.4 41.3 135.7 42.2C136.1 43.1 136.6 44.4 136.9 45.0C137.2 45.6 137.5 46.4 137.7 46.8C138.3 48.2 141.1 53.6 142.0 55.2C144.5 59.3 145.7 61.1 147.8 64.0C150.8 67.9 152.1 70.5 152.6 73.5C153.0 75.6 152.8 78.5 152.2 80.4C151.7 82.0 151.6 82.4 151.3 83.0C150.1 85.6 148.1 88.2 145.4 90.5C144.8 91.1 144.7 91.2 144.5 91.0Z" fill="currentColor"/><path d="M47.5 40.5C50.5 38.2 54.5 39 57.5 42.5C64 51 70 63 78 72C84 78.5 91 82 99.5 83C93 88.5 85 90.5 77 88.5C69 86 62.5 78 57.5 70C53 62.5 48.5 54 46.5 49C45.3 45.5 45.6 42.3 47.5 40.5Z" fill="#6ba3a1"/></svg><h1 style="font:500 24px Jost,system-ui,sans-serif;letter-spacing:.2em">MIXORA</h1><p id="lg-msg">Входим…</p><form id="lg-form" hidden><input id="lg-code" placeholder="Код приглашения" autocomplete="off" autocapitalize="off"><button class="btn go" type="submit">Войти</button></form><div id="tg-widget" hidden></div></div>';
  const st=document.createElement("style");st.textContent="#login{position:fixed;inset:0;z-index:999;background:var(--bg,#f6f1ec);color:var(--fg,#24180f);display:grid;place-items:center;padding:24px;text-align:center}#login .lg-in{display:grid;gap:12px;justify-items:center;max-width:320px}#login h1{margin:0;font-size:28px}#login p{margin:0;color:var(--muted,#6e5d4f)}#login form{display:grid;gap:8px;width:100%}#login input{height:48px;font:inherit;font-size:16px;text-align:center;border:1px solid var(--line-ctl,#d2c5b6);border-radius:12px;background:var(--surface,#fffaf5);color:inherit}#login button{height:48px}#tg-widget{display:grid;justify-items:center;margin-top:4px}";
  document.head.appendChild(st);document.addEventListener("DOMContentLoaded",()=>document.body.appendChild(wall));
  if(document.body)document.body.appendChild(wall);
  const msg=t=>{const m=$("#lg-msg");if(m)m.textContent=t};
  // Вне Telegram (обычный браузер) нет initData — входим через Telegram Login Widget,
  // его подпись проверяется на сервере отдельной функцией (см. tg-auth)
  let widgetAuth=null;
  async function call(invite){
    const body={invite:invite||""};
    if(tg&&tg.initData)body.initData=tg.initData;else if(widgetAuth)body.widgetAuth=widgetAuth;
    const r=await fetch(CFG.url+"/functions/v1/tg-auth",{method:"POST",headers:{"Content-Type":"application/json",apikey:CFG.anon,Authorization:"Bearer "+CFG.anon},body:JSON.stringify(body)});
    return {ok:r.ok,status:r.status,body:await r.json().catch(()=>({}))};
  }
  // Токен живёт 12 часов: обновляем заранее, чтобы открытое на всю смену приложение не теряло доступ к базе
  let refreshT=0,refreshP=null;
  const planRefresh=()=>{clearTimeout(refreshT);refreshT=setTimeout(()=>refreshSession().catch(()=>{}),11*3600e3)};
  function refreshSession(){
    if(!refreshP)refreshP=call("").then(r=>{if(!r.ok)return false;session.token=r.body.token;session.user=r.body.user;planRefresh();return true}).finally(()=>{refreshP=null});
    return refreshP;
  }
  function showWidget(){
    const el=$("#tg-widget");if(!el||el.dataset.on)return;el.dataset.on="1";el.hidden=false;
    window.__polkaTgAuth=user=>{widgetAuth=user;msg("Проверяем…");login()};
    const s=document.createElement("script");s.async=true;s.src="https://telegram.org/js/telegram-widget.js?22";
    s.setAttribute("data-telegram-login",(CFG.tgBot||"PolkaHookahbot"));
    s.setAttribute("data-size","large");s.setAttribute("data-radius","12");
    s.setAttribute("data-onauth","__polkaTgAuth(user)");s.setAttribute("data-request-access","write");
    el.appendChild(s);
    msg("Войдите через Telegram:");
  }
  async function login(invite){
    if(!tg||!tg.initData){if(!widgetAuth){showWidget();return}}
    let code=invite||"";if(!code)try{code=localStorage.getItem("polka-invite")||""}catch(e){}
    let r;try{r=await call(code)}catch(e){msg("Нет связи. Проверьте интернет и откройте снова.");return}
    if(r.ok){try{localStorage.removeItem("polka-invite")}catch(e){}session={token:r.body.token,user:r.body.user};planRefresh();wall.remove();resolveReady(session);return}
    const e=r.body.error;
    if(e==="need_invite"||e==="bad_invite"){msg(e==="bad_invite"?"Код не подошёл. Проверьте и введите снова.":"Введите код приглашения, который дал управляющий.");$("#lg-form").hidden=false;return}
    if(e==="bad_signature")widgetAuth=null;
    msg(e==="bad_signature"?(tg&&tg.initData?"Не удалось подтвердить вход. Закройте и откройте приложение заново.":"Не удалось подтвердить вход. Попробуйте войти через Telegram ещё раз."):"Что-то пошло не так, попробуйте позже.");
    if(!tg||!tg.initData)showWidget();
  }
  window.addEventListener("DOMContentLoaded",()=>{
    $("#lg-form").addEventListener("submit",ev=>{ev.preventDefault();const v=$("#lg-code").value.trim();if(!v)return;try{localStorage.setItem("polka-invite",v)}catch(e){}msg("Проверяем…");login(v)});
    login();
  });

  // ===== база =====
  const H=()=>({apikey:CFG.anon,Authorization:"Bearer "+session.token,"Content-Type":"application/json"});
  const V=()=>session.user.venue_id;
  async function rest(path,opt,again){const r=await fetch(CFG.url+"/rest/v1/"+path,Object.assign({headers:H()},opt));if(r.status===401&&!again&&await refreshSession().catch(()=>false)){if(opt&&opt.headers&&opt.headers.Authorization)opt=Object.assign({},opt,{headers:Object.assign({},opt.headers,H())});return rest(path,opt,true)}if(!r.ok){let t="";try{t=(await r.json()).message}catch(e){}throw new Error(t||("HTTP "+r.status))}const t=await r.text();return t?JSON.parse(t):null}
  const iso=x=>x?new Date(x).toISOString():undefined;
  const MAP={
    stock:{table:"stock",key:"flavor_id",
      list:()=>"stock?select=flavor_id,wh,bar,stop,stop_auto,slow,retired,revision&venue_id=eq."+V(),
      toDoc:r=>{const d={wh:r.wh,bar:r.bar,revision:r.revision};if(r.stop)d.stop=true;if(r.stop_auto)d.stopAuto=true;if(r.slow)d.slow=true;if(r.retired)d.retired=true;return d},
      fromDoc:(id,o)=>{const b={venue_id:V(),flavor_id:id,wh:o.wh||0,stop:!!o.stop,stop_auto:!!o.stopAuto,slow:!!o.slow,retired:!!o.retired};if(typeof o.bar==="boolean")b.bar=o.bar;return b},
      conflict:"venue_id,flavor_id"},
    moves:{table:"moves",key:"id",
      list:()=>"moves?select=id,flavor_id,kind,qty,left_after,reason,prev,bar_to,at,operation_id,stock_revision&venue_id=eq."+V()+"&order=at.desc&limit=400",
      toDoc:r=>({item:r.flavor_id,kind:r.kind,qty:r.qty,left:r.left_after,reason:r.reason||undefined,prev:r.prev||undefined,barTo:r.bar_to===null?undefined:r.bar_to,at:r.at,operationId:r.operation_id,revision:r.stock_revision}),
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
      list:()=>"users?select=tg_id,name&venue_id=eq."+V(),
      toDoc:r=>({name:r.name}),fromDoc:()=>({})},
    invites:{table:"invites",key:"code",
      list:()=>"invites?select=code,created_at&used_by=is.null&venue_id=eq."+V(),
      toDoc:r=>({at:r.created_at}),fromDoc:(id,o)=>({code:id,venue_id:V(),role:"manager"}),conflict:"code"},
    items:{table:"flavors",key:"id",
      list:()=>"flavors?select=id,brand,line,name,descr&custom=eq.true&venue_id=eq."+V(),
      toDoc:r=>({b:r.brand,l:r.line||"",n:r.name,d:r.descr||"",s:"name",t:[],bar:false}),
      fromDoc:(id,o)=>({id,brand:o.b,line:o.l||"",name:o.n,descr:o.d||"",custom:true,venue_id:V()}),conflict:"id"},
    invlog:{table:"inv_log",key:"id",
      list:()=>"inv_log?select=id,ig,items,shortage_units,shortage_g,price_per_g,shortage_rub,at&venue_id=eq."+V()+"&order=at.desc&limit=200",
      toDoc:r=>({ig:r.ig,items:r.items,units:r.shortage_units,g:r.shortage_g,price:r.price_per_g,rub:r.shortage_rub,at:r.at}),
      fromDoc:(id,o)=>({venue_id:V(),ig:o.ig,items:o.items||0,shortage_units:o.units||0,shortage_g:o.g||0,price_per_g:o.price||null,shortage_rub:o.rub||null,by_tg:session.user.tg_id,at:o.at||new Date().toISOString()})},
    tasks:{table:"tasks",key:"id",patch:true,
      list:()=>"tasks?select=id,text,recur,weekday,created_at&venue_id=eq."+V()+"&order=created_at.desc&limit=200",
      toDoc:r=>({t:r.text,recur:r.recur||"daily",weekday:r.weekday,at:r.created_at}),
      fromDoc:(id,o)=>({venue_id:V(),text:o.t,recur:o.recur||"daily",weekday:o.weekday===undefined?null:o.weekday,by_tg:session.user.tg_id})},
    tasklog:{table:"task_log",key:"id",
      list:()=>"task_log?select=id,task_id,on_date,by_name,at&venue_id=eq."+V()+"&order=at.desc&limit=500",
      toDoc:r=>({taskId:String(r.task_id),date:r.on_date,byName:r.by_name,at:r.at}),
      fromDoc:(id,o)=>({venue_id:V(),task_id:+o.taskId,on_date:o.date,by_tg:session.user.tg_id,by_name:o.byName||session.user.name||""})},
    knowcat:{table:"knowledge_cat",key:"id",
      list:()=>"knowledge_cat?select=id,name,protected,created_at&venue_id=eq."+V()+"&order=created_at.asc&limit=200",
      toDoc:r=>({name:r.name,protected:!!r.protected,at:r.created_at}),
      fromDoc:(id,o)=>{const b={venue_id:V(),name:o.name,by_tg:session.user.tg_id};if(id)b.id=id;return b}},
    knowledge:{table:"knowledge",key:"id",
      list:()=>"knowledge?select=id,cat_id,title,body,body2,name,path,blocks,created_at&venue_id=eq."+V()+"&order=created_at.asc&limit=500",
      toDoc:r=>({catId:r.cat_id?String(r.cat_id):"",title:r.title||"",body:r.body||"",body2:r.body2||"",name:r.name||"",path:r.path||"",blocks:r.blocks||null,at:r.created_at}),
      fromDoc:(id,o)=>{const b={venue_id:V(),cat_id:+o.catId,title:o.title||"",blocks:o.blocks||[],by_tg:session.user.tg_id};if(id)b.id=id;return b}},
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
    stockScope:()=>V()+":"+session.user.tg_id,
    hasPendingStock:()=>!!localStorage.getItem("mixora-stock-pending:"+V()+":"+session.user.tg_id),
    // Persist request identity BEFORE sending. Unknown outcomes can only replay the
    // exact original request; a different intent is blocked until it is resolved.
    applyStock:async items=>{
      const key="mixora-stock-pending:"+V()+":"+session.user.tg_id;
      const signature=JSON.stringify(items);let saved=localStorage.getItem(key),pending=saved?JSON.parse(saved):null;
      if(pending&&pending.signature!==signature)throw new Error("Есть неподтверждённый результат склада. Повторите прежнее действие или восстановите его через журнал.");
      if(!pending){pending={signature,body:{p_request_id:crypto.randomUUID(),p_items:items}};localStorage.setItem(key,JSON.stringify(pending))}
      try{const result=await rest("rpc/apply_stock",{method:"POST",body:JSON.stringify(pending.body)});
        localStorage.removeItem(key);bump("stock");bump("moves");return result;
      }catch(e){if(/stock_/.test(e.message)){localStorage.removeItem(key)}throw e}
    },
    recoverStock:async()=>{
      const key="mixora-stock-pending:"+V()+":"+session.user.tg_id,saved=localStorage.getItem(key);if(!saved)return null;
      const pending=JSON.parse(saved);
      try{const result=await rest("rpc/apply_stock",{method:"POST",body:JSON.stringify(pending.body)});localStorage.removeItem(key);bump("stock");bump("moves");return {rows:result,items:pending.body.p_items}}
      catch(e){if(/stock_/.test(e.message))localStorage.removeItem(key);throw e}
    },
    bulk:async(c,ids,o)=>{if(c==="stock"||c==="moves")throw new Error("Используйте складскую операцию");const m=MAP[c];await rest(m.table+"?"+m.key+"=in.("+ids.map(encodeURIComponent).join(",")+")",{method:"PATCH",body:JSON.stringify(m.fromDoc(null,o))});setTimeout(()=>refresh(c),150)},
    collection:c=>Object.assign(listen(c),{
      orderBy:()=>({limit:()=>listen(c)}),
      add:async o=>{if(c==="moves"||c==="stock")throw new Error("Используйте складскую операцию");const m=MAP[c];const r=await rest(m.table,{method:"POST",headers:Object.assign(H(),{Prefer:"return=representation"}),body:JSON.stringify(m.fromDoc(null,o))});bump(c);return{id:String(r[0][m.key])}}}),
    doc:p=>{const [c,id]=p.split("/");return{
      set:async o=>{
        if(c==="stock"||c==="moves")throw new Error("Используйте складскую операцию");
        if(c==="order"){await rest("orders?on_conflict=venue_id",{method:"POST",headers:Object.assign(H(),{Prefer:"resolution=merge-duplicates"}),body:JSON.stringify({venue_id:V(),items:o,updated_at:new Date().toISOString()})});bump(c);return}
        const m=MAP[c];if(m.patch){await rest(m.table+"?"+m.key+"=eq."+encodeURIComponent(id)+(m.table==="flavors"?"":"&venue_id=eq."+V()),{method:"PATCH",body:JSON.stringify(m.fromDoc(id,o))});bump(c);return}
        await rest(m.table+"?on_conflict="+(m.conflict||m.key),{method:"POST",headers:Object.assign(H(),{Prefer:"resolution=merge-duplicates"}),body:JSON.stringify(m.fromDoc(id,o))});bump(c)},
      delete:async()=>{if(c==="stock"||c==="moves")throw new Error("Журнал нельзя удалять");const m=MAP[c];await rest(m.table+"?"+m.key+"=eq."+encodeURIComponent(id)+"&venue_id=eq."+V(),{method:"DELETE"});bump(c)}}},
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
  // Распознаёт фото без обращения к диалоговой модели (ocr_only) — для команд (/перенос и т.п.), где
  // решение детерминированное и модель не нужна. Возвращает сырой текст по каждому фото (может быть {failed})
  // и ocr — кто читал (sonnet/yandex), для подписи под ответом.
  const readPhotos=async(images,signal)=>{
    const blocks=await Promise.all(images.map(imgToBlock));
    let ocr="";
    // Распознаём каждое фото отдельным запросом (ocr_only) — иначе на нескольких фото разом функция
    // Supabase упирается в свой лимит времени (150 с) и падает без ответа («Не получилось»).
    // Отдельные запросы быстрее по одному и не считаются в дневной лимит (там модель не вызывается).
    // Не прочиталось — пробуем ещё раз; не вышло и со второго раза — фото помечаем как непрочитанное,
    // а не пустым текстом: иначе дальше уверенно решают, что на фото ни одного вкуса
    const texts=await Promise.all(blocks.map(async b=>{
      let err="";
      for(let a=0;a<2;a++){
        try{const r=await callAI({system:"",messages:[{role:"user",content:[b]}],tools:[],ocr_only:true},signal,()=>{});
          if(!r.ocr){err="not_read";continue}
          ocr=r.ocr;return (r.ocr_texts||[])[0]||""}
        catch(e){if(e&&e.name==="AbortError")return {failed:"cancelled"};err=e&&e.code||"network";console.warn("photo read failed:",err)}}
      return {failed:err}}));
    return {texts,ocr}};
  // Текст команды (/перенос, /пополнить, …): читает фото, без обращения к диалоговой модели.
  // Возвращает {text, failed} — text уже в формате «Этикетка N: …», готов для matchText на клиенте.
  const readLabels=async(images,signal)=>{
    const{texts}=await readPhotos(images,signal);
    const failed=texts.filter(t=>t&&t.failed).length;
    return {text:texts.map((t,i)=>typeof t==="string"?"Фото "+(i+1)+":\n"+t:"").filter(Boolean).join("\n"),failed,total:texts.length}};
  const sample=async(turns,opts)=>{
    opts=opts||{};
    const first=turns[0]&&turns[0].role==="user"?turns[0].content:"";
    let msgs=turns.slice(2).map(t=>({role:t.role,content:t.content}));
    let ocr="",photo=null;
    if(opts.images&&opts.images.length){
      const r0=await readPhotos(opts.images,opts.signal),texts=r0.texts;ocr=r0.ocr;
      // opts.photo — приложение само сверяет текст с каталогом; сверка — наш код, может споткнуться на непредвиденном
      // тексте с фото: тогда не роняем весь запрос, а откатываемся к сырому OCR-тексту для этой картинки
      photo=texts.map((t,i)=>{if(t&&t.failed)return "[Фото "+(i+1)+" не удалось прочитать (ошибка: "+t.failed+"). Скажи человеку, что это фото не прочиталось, и попроси прислать его ещё раз. Вкусы с него не угадывай.]";
        try{return opts.photo?opts.photo(t||""):"[Фото, текст прочитан с фото]\n"+(t||"(текста на фото не нашлось)")}
        catch(e){console.warn("photo match failed:",e);return "[Фото, текст прочитан с фото]\n"+(t||"(текста на фото не нашлось)")}});
      const last=msgs[msgs.length-1];
      last.content=[...photo.map(t=>({type:"text",text:t})),{type:"text",text:String(last.content)}]}
    const tools=(opts.tools||[]).map(t=>({name:t.name,description:t.description,input_schema:t.inputSchema}));
    const byName=Object.fromEntries((opts.tools||[]).map(t=>[t.name,t]));
    let text="",src="";
    for(let step=0;step<20;step++){
      if(opts.signal&&opts.signal.aborted)throw {code:"cancelled",text};
      let r;try{r=await callAI({system:first,messages:msgs,tools},opts.signal,()=>{if(opts.onText)opts.onText({text:(text?text+"\n":"")+"ИИ занят, жду очередь…"})})}catch(e){if(e&&e.name==="AbortError")throw {code:"cancelled",text};throw Object.assign({text},e)}
      msgs.push({role:"assistant",content:r.content});if(r.model)src=r.model;if(r.ocr)ocr=r.ocr;
      // Служебные id каталога («(id aa09da7d31d5)», «id …, на складе 2») человеку не нужны — модели (особенно
      // YandexGPT) иногда переписывают их из списка с фото в ответ, вычищаем
      const part=r.content.filter(b=>b.type==="text").map(b=>b.text).join("").replace(/\s*\(id\s*[0-9a-f]{8,}\)/gi,"").replace(/\bid\s*[0-9a-f]{8,}\s*[,;]\s*/gi,"").replace(/[,;]?\s*\bid\s*[0-9a-f]{8,}/gi,"");
      if(part){text+=(text?"\n":"")+part;if(opts.onText)opts.onText({text})}
      if(r.stop_reason==="refusal")throw {code:"refused",text};
      if(r.stop_reason!=="tool_use")break;
      const results=[];
      for(const b of r.content.filter(b=>b.type==="tool_use")){
        let content,err=false;
        try{const t=byName[b.name];if(!t)throw new Error("нет такого инструмента");content=JSON.stringify(await t.execute(b.input||{}))}catch(e){err=true;content=String(e&&e.message||e)}
        results.push({type:"tool_result",tool_use_id:b.id,content,is_error:err||undefined})}
      msgs.push({role:"user",content:results})}
    // Модель закончила вызовами инструментов и ничего не сказала — просим итог словами, уже без инструментов
    if(!text&&!(opts.signal&&opts.signal.aborted)){const ask={type:"text",text:"Коротко ответь человеку словами: что увидел или нашёл и что сделал (что ждёт «Подтвердить»). Инструменты больше не вызывай."};
      const last=msgs[msgs.length-1];if(last.role==="user"&&Array.isArray(last.content))last.content.push(ask);else msgs.push({role:"user",content:[ask]});
      try{const r=await callAI({system:first,messages:msgs,tools:[]},opts.signal,()=>{});if(r.model)src=r.model;text=r.content.filter(b=>b.type==="text").map(b=>b.text).join("")}catch(e){}}
    return {text:text||"Готово.",src:src+(ocr?"+"+ocr:""),photo}};
  sample.limits=async()=>({images:{mediaTypes:["image/jpeg","image/png","image/webp"]}});
  sample.readLabels=readLabels;
  window.claude={use:async k=>{
    if(k==="db"){await readyP;return db}
    if(k==="user"){await readyP;window.__me=String(session.user.tg_id);return{isStaff:async()=>!!(session&&session.user&&session.user.venue_id),canEdit:async()=>!!(session&&session.user&&session.user.venue_id),name:session.user.name}}
    if(k==="downloads")return downloads;
    if(k==="sample"){await readyP;return sample}
    return null}};
})();
