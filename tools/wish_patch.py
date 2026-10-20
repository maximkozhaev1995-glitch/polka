# © 2026 Максим Кожаев. Все права защищены. Копирование, распространение и использование без письменного согласия автора запрещены.
# Добавляет в карту блок «Пожелания гостей». Использование: wish_patch.py ВХОД ВЫХОД real|demo
import sys
src,dst,mode=sys.argv[1:4];REAL=mode=="real"
s=open(src,encoding='utf-8').read()
if "wishBlock" in s: open(dst,'w',encoding='utf-8').write(s);sys.exit()
a='''$("#list").innerHTML='<p class="empty">Такого вкуса сейчас нет. Спроси мастера, он подберёт похожий.</p>';return}'''
assert a in s
s=s.replace(a,'''$("#list").innerHTML=(window.wishBlock?wishBlock(true):'<p class="empty">Такого вкуса сейчас нет.</p>');window.bindWish&&bindWish();return}''')
b='''  $("#list").innerHTML=h;
  const bb=$("#b-back");'''
assert b in s
s=s.replace(b,'''  $("#list").innerHTML=h+(st.brand||!window.wishBlock?"":wishBlock(false));window.bindWish&&bindWish();
  const bb=$("#b-back");''')
css='''<style>
.wish{margin:18px 0;padding:16px;border:1px solid var(--line);border-radius:18px;background:var(--surface);display:grid;gap:10px}
.wish h3{margin:0;font-size:17px}.wish p{margin:0;color:var(--muted);font-size:14px}
.wrow{display:flex;align-items:center;gap:10px;justify-content:space-between;border-top:1px solid var(--line);padding-top:10px}
.wrow span{min-width:0;font-size:15px}.wrow small{color:var(--muted);display:block;font-size:12px}
.wbtn{flex:none;min-height:44px;padding:0 14px;border-radius:999px;border:1.5px solid var(--ember);background:transparent;color:var(--ember-text);font:600 14px var(--body,inherit);cursor:pointer}
.wbtn.on{background:var(--ember);color:#fff}
.wfree{display:grid;grid-template-columns:1fr 1fr;gap:8px}.wfree input{min-width:0;min-height:44px;border:1px solid var(--line-ctl);border-radius:12px;padding:0 12px;font-size:16px;background:var(--bg);color:var(--fg)}
.wfree .wbtn{grid-column:1/-1}
.wmsg{color:var(--ember-text);font-size:14px}
'''
if not REAL: css+='''.wmgr{position:fixed;left:max(12px,env(safe-area-inset-left,0px));bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:60;min-height:36px;padding:0 12px;border-radius:999px;border:1px solid var(--line-ctl);background:var(--surface);color:var(--muted);font-size:12px;cursor:pointer}
.wover{position:fixed;inset:0;z-index:80;background:var(--bg);overflow:auto;padding:16px max(16px,env(safe-area-inset-right)) 40px max(16px,env(safe-area-inset-left))}
.wover h2{margin:0 0 4px}.wover .wrow b{font-size:20px;min-width:34px;text-align:center}
'''
css+='</style>'
js='''<script>
(function(){
var REAL=%s,K="polka_wishes_v1";
function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}function lsSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}
var dev=lsGet("polka_dev");if(!dev||dev.length<8){dev=Array.from(crypto.getRandomValues(new Uint8Array(12))).map(function(n){return n.toString(36).padStart(2,"0")}).join("");lsSet("polka_dev",dev)}
var mine={};try{mine=JSON.parse(lsGet(K)||"{}")}catch(e){}
function key(b,f){return (b+"|"+f).toLowerCase().replace(/\\s+/g," ").trim()}
function lab(x){return (x.l?x.l+" ":"")+x.n}
function found(){var q=(st.q||"").toLowerCase().split(/\\s+/).filter(Boolean);if(!q.length)return[];var on=new Set(DATA.map(function(x){return x.id}));
 return ALL.filter(function(x){return !on.has(x.id)&&q.every(function(t){return (x.b+" "+lab(x)).toLowerCase().indexOf(t)>=0})}).slice(0,6)}
function send(b,f,fid){var k=key(b,f);if(mine[k])return Promise.resolve("ok");
 function done(){mine[k]=1;lsSet(K,JSON.stringify(mine));return "ok"}
 if(!REAL)return Promise.resolve(done());
 var C=window.POLKA_CONFIG;return fetch(C.url+"/rest/v1/wishes",{method:"POST",headers:{apikey:C.anon,Authorization:"Bearer "+C.anon,"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify({venue_id:C.venue,flavor_id:fid||null,brand:b.slice(0,60),flavor:f.slice(0,60),device:dev})})
  .then(function(r){if(r.status===201||r.status===409)return done();return r.text().then(function(t){return t.indexOf("wish_limit")>=0?"limit":"err"})}).catch(function(){return "err"})}
window.wishBlock=function(empty){var f=found(),h='<section class="wish"><h3>'+(empty?"Такого вкуса сейчас нет за стойкой":"Не нашли свой вкус?")+'</h3>';
 h+='<p>Оставьте пожелание, его увидит заведение. Это не заказ и не обещание.</p>';
 f.forEach(function(x){var on=mine[key(x.b,lab(x))];h+='<div class="wrow"><span>'+esc(x.b+" "+lab(x))+'<small>нет на стойке</small></span><button type="button" class="wbtn'+(on?" on":"")+'" data-wk="'+esc(x.id)+'"'+(on?" disabled":"")+'>'+(on?"Вы просили ✓":"Хочу, чтобы был")+'</button></div>'});
 h+='<div class="wfree"><input id="wbr" maxlength="60" placeholder="Бренд" autocomplete="off" aria-label="Бренд"><input id="wfl" maxlength="60" placeholder="Вкус" autocomplete="off" aria-label="Вкус"><button type="button" class="wbtn" id="wsend">Отправить пожелание</button></div><div class="wmsg" id="wmsg" role="status"></div></section>';return h};
function msg(t){var m=document.getElementById("wmsg");if(m)m.textContent=t}
window.bindWish=function(){document.querySelectorAll("[data-wk]").forEach(function(b){b.onclick=function(){var x=ALL.find(function(y){return y.id===b.dataset.wk});if(!x)return;b.disabled=true;
  send(x.b,lab(x),x.id).then(function(r){if(r==="ok"){b.classList.add("on");b.textContent="Вы просили ✓"}else{b.disabled=false;msg(r==="limit"?"На сегодня хватит пожеланий, попробуйте завтра.":"Не получилось отправить. Попробуйте позже.")}})}});
 var s=document.getElementById("wsend");if(s)s.onclick=function(){var b=document.getElementById("wbr").value.trim(),f=document.getElementById("wfl").value.trim();
  if(!b||!f){msg("Напишите и бренд, и вкус.");return}s.disabled=true;
  send(b,f,null).then(function(r){s.disabled=false;if(r==="ok"){document.getElementById("wbr").value="";document.getElementById("wfl").value="";msg("Спасибо, пожелание принято.")}else msg(r==="limit"?"На сегодня хватит пожеланий, попробуйте завтра.":"Не получилось отправить. Попробуйте позже.")})}};
'''%("true" if REAL else "false")
if not REAL:
    js+='''var SEED={"Darkside Supernova":14,"Tangiers Birquq Lemon-Lime":11,"Sebero Mint":9,"Black Burn Cola":8,"Musthave Raspberry":6,"Deus Pear":5};
var btn=document.createElement("button");btn.className="wmgr";btn.type="button";btn.textContent="Демо: вид управляющего";document.body.appendChild(btn);
btn.onclick=function(){var o=document.createElement("div");o.className="wover";var done={};
 function draw(){var all={};Object.keys(SEED).forEach(function(k){all[k]=SEED[k]});Object.keys(mine).forEach(function(k){all[k]=(all[k]||0)+1});
  var rows=Object.keys(all).sort(function(a,b){return all[b]-all[a]});
  o.innerHTML='<button type="button" class="wbtn" id="wx">← Назад</button><h2>Пожелания гостей</h2><p style="color:var(--muted);margin:0 0 12px">Что гости просят чаще всего. Это основа для следующего заказа.</p>'+rows.map(function(k){var d=done[k];return'<div class="wrow"><b>'+all[k]+'</b><span style="flex:1">'+esc(k.replace("|"," "))+'<small>'+(d?"в заказе":"новое")+'</small></span><button type="button" class="wbtn'+(d?" on":"")+'" data-d="'+esc(k)+'">'+(d?"В заказе ✓":"В заказ")+'</button></div>'}).join("");
  o.querySelector("#wx").onclick=function(){o.remove()};o.querySelectorAll("[data-d]").forEach(function(b){b.onclick=function(){var k=b.dataset.d;done[k]=!done[k];draw()}})}
 draw();document.body.appendChild(o)};
'''
js+="})();\n</script>"
s=s+css+js
if not REAL: s=s.replace('<title>Полка Misty Wood</title>','<title>Полка Пожелания</title>',1)
open(dst,'w',encoding='utf-8').write(s)
