function mixoraStatusLabels(item){
 return [item.onBar&&'На стойке',item.stop&&'В стопе',item.slow&&'Неликвид'].filter(Boolean);
}
function mixoraBadges(labels){
 return labels.length?'<span class="mx-statuses">'+labels.map(label=>'<small class="mx-status-chip">'+label+'</small>').join('')+'</span>':'';
}

(() => {
'use strict';
const root = document.getElementById('mixora-work-menu');
const integration=true;
const connected=true;
if(integration){root.hidden=true;root.inert=true;root.style.display='none';}
const main = root.querySelector('main');
const live = root.querySelector('[data-live]');
const homeBack = root.querySelector('.wm-homeback');
const routes = {
  ai: ['ИИ-ассистент','Найти вкус, проверить остатки'],
  bar: ['Стойка','Вкусы на баре'],
  off: ['Не на стойке','Есть в запасе, нет на баре'],
  stock: ['Склад','Запасные банки'],
  stop: ['Стоп-лист','Временно недоступны'],
  order: ['Заказ','Список закупки'],
  slow: ['Неликвид','Вкусы для продвижения'],
  sup: ['Контрагенты','Поставщики и бренды'],
  journal: ['Журнал','История действий']
};
const iconPaths = {
  ai:'<path d="M11 3c.8 5.5 2.3 7.2 7 8-4.7.8-6.2 2.5-7 8-.9-5.5-2.4-7.2-7-8 4.6-.8 6.1-2.5 7-8Z"/><path d="M19 2v4m-2-2h4m-2 11v5m-2.5-2.5h5"/>',
  bar:'<path d="M3 10h18M4 17h16M5 10v10m14-10v10M6.5 5h3v5h-3zm7 1h3.5v4h-3.5z"/>',
  off:'<path d="M5 4h10v4H5zm1 4v11c0 .6.4 1 1 1h7m0-12v3m0 5h7m-3-3 3 3-3 3"/>',
  stock:'<path d="m3.5 7 8.5-4 8.5 4v10L12 21l-8.5-4Zm0 0 8.5 4 8.5-4M12 11v10m-4-16 8.5 4"/>',
  stop:'<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
  order:'<path d="M8 5H5v15h14V5h-3M9 3h6v4H9zm-1 8h8m-8 4h6"/>',
  slow:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
  sup:'<path d="M3 5h11v11H3zm11 4h4l3 4v3h-7"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  journal:'<path d="M7 3.5h12V21H7a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2Zm1 0v17M11 8h5m-5 4h5"/>',
  home:'<path d="m3 10 9-7 9 7v10h-6v-7H9v7H3z"/>',
  more:'<circle cx="4" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="20" cy="12" r="1.2"/>',
  next:'<path d="m9 5 7 7-7 7"/>',arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>'
};
function icon(id) {return '<svg aria-hidden="true" class="wm-ico" viewBox="0 0 24 24">'+iconPaths[id]+'</svg>';}
function escapeText(value) {return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function norm(value) {return String(value).toLocaleLowerCase('ru').replace(/ё/g,'е').trim();}
function heading(title, sub='') {return '<div class="wm-heading"><h1 class="wm-title">'+escapeText(title)+'</h1>'+(sub?'<p class="wm-sub">'+escapeText(sub)+'</p>':'')+'</div>';}
function action(label, attrs, primary=false) {return '<button type="button" class="wm-action'+(primary?' wm-primary':'')+'" '+attrs+'>'+escapeText(label)+'</button>';}
function back(label) {return '<button type="button" class="wm-back" data-return><span aria-hidden="true">←</span> '+escapeText(label)+'</button>';}
const items=[],suppliers=[];
const get = id=>items.find(x=>x.id===id);
const basket = new Map();
const manualRows = new Map();
let sequence=0;
const journal=[];
let journalStatus="loading";
let journalId=0;
function journalSnapshot() {
 const entries=new Map();
 for(const item of items)entries.set('item/'+item.id,JSON.stringify(item));
 for(const [id,qty] of basket)entries.set('order/'+id,JSON.stringify(qty));
 for(const [id,row] of manualRows)entries.set('manual/'+id,JSON.stringify(row));
 return entries;
}
let lastJournalState=journalSnapshot();
function log(title,desc,time=Date.now()){
 const next=journalSnapshot(),changes=[];
 for(const key of new Set([...lastJournalState.keys(),...next.keys()])){
   const before=lastJournalState.get(key),after=next.get(key);
   if(before!==after)changes.push({key,before,after});
 }
 journal.unshift({id:++journalId,time,title,desc,changes,undone:false});
 lastJournalState=next;
}
function canUndo(entry,current){
 if(integration)return false;
 if(entry.undone||!entry.changes.length)return false;
 const ids=new Set(entry.changes.map(c=>c.key.split('/')[1]));
 return entry.changes.every(c=>current.get(c.key)===c.after)&&
   !journal.some(other=>other.id>entry.id&&!other.undone&&other.changes.some(c=>ids.has(c.key.split('/')[1])));
}
function undoEntry(id){
 const entry=journal.find(row=>row.id===id);
 if(!entry||!canUndo(entry,journalSnapshot()))return;
 for(const {key,before} of entry.changes){
   const [kind,itemId]=key.split('/');
   if(kind==='item'){
     const index=items.findIndex(x=>x.id===itemId);
     if(before===undefined)items.splice(index,1);
     else items.splice(index,1,JSON.parse(before));
   }else{
     const map=kind==='order'?basket:manualRows;
     if(before===undefined)map.delete(itemId);else map.set(itemId,JSON.parse(before));
   }
 }
 entry.undone=true;lastJournalState=journalSnapshot();render();say('Действие отменено.');
}
const demoAPI = {
 request:integration?(...args)=>window.MixoraIntegrationAssistant.request(...args):null,
 cancelProposals:integration?()=>window.MixoraIntegrationAssistant.cancel():null,
 inventory:()=>items.filter(x=>!x.retired).map(x=>({...x})),
 orderQuantity:id=>basket.get(id)||manualRows.get(id)?.qty||0,
 orderRows:()=>Array.from(basket,([id,qty])=>({...get(id),qty})).concat(Array.from(manualRows.values(),x=>({...x}))),
 addToOrder(id, quantity) {
   if(integration)throw Error('Требуется подтверждение через бизнес-адаптер.');
   const x=get(id), prev=basket.get(id)||0;
   if(!x||x.retired||!Number.isInteger(quantity)||quantity<1||prev+quantity>99)return false;
   basket.set(id,prev+quantity); log(x.name,'Добавлено в заказ · '+quantity+' шт.');return true;
 },
 transferToBar(id, quantity) {
   if(integration)throw Error('Требуется подтверждение через бизнес-адаптер.');
   const x=get(id);
   if(!x||x.retired||!Number.isInteger(quantity)||quantity<1||quantity>x.qty)return false;
   const operation=x.onBar?'Взято со склада':'Перенесено на стойку';
   x.qty-=quantity;x.onBar=true;log(x.name,operation+' · '+quantity+' шт.');return true;
 }
};
const state={page:'home',id:'',phase:'',message:'',queries:{},brands:{},memory:{}};
const inventories = ['stock','bar','off','stop','slow'];
const descriptions = {
 stop:'Вкусы, временно недоступные гостю.',
 slow:'Вкусы, отмеченные для продвижения.'
};
function waves() {
 const lines=[];
 for(let i=0;i<22;i++) {
   const x=i*3.2;
   lines.push('<path d="M'+(-55+x)+' 195 C'+(19+x)+' 185 '+(20+x)+' 43 '+(106+x)+' 69 S'+(195+x)+' 110 '+(251+x)+' -18"/>');
 }
 return '<svg class="wm-awave" aria-hidden="true" viewBox="0 0 305 180" preserveAspectRatio="xMidYMid slice"><g fill="none" stroke="#78a99b" stroke-opacity=".35" stroke-width="1">'+lines.join('')+'</g></svg>';
}
function homeView() {
 return heading('Рабочее меню')+'<nav class="wm-grid" aria-label="Разделы Mixora">'+Object.entries(routes).map(([id,[title,desc]])=>{
   const isAI=id==='ai';
   return '<button type="button" data-nav="'+id+'" class="wm-tile'+(isAI?' wm-aitile':'')+'">'+(isAI?waves():'')+'<span class="wm-ticon">'+icon(id)+'</span><span'+(isAI?'':' style="margin-top:auto"')+'><strong class="wm-tn">'+title+'</strong><span class="wm-td">'+desc+'</span></span><span class="wm-tarrow">'+icon(isAI?'arrow':'next')+'</span></button>';
 }).join('')+'</nav>';
}
function eligible(x,page) {
 return ({bar:x.onBar,off:!x.onBar&&x.qty>0,stock:x.qty>0,stop:x.stop,slow:x.slow})[page];
}
function matchInventory(page) {
 const tokens=norm(state.queries[page]||'').split(/\s+/).filter(Boolean);
 return items.filter(x=>(eligible(x,page)||(page==='stock'&&x.retired))&&tokens.every(t=>norm(x.name+' '+x.brand).includes(t)));
}
function groupsByBrand(rows) {
 const groups=new Map();
 for(const item of rows){
   if(!groups.has(item.brand))groups.set(item.brand,[]);
   groups.get(item.brand).push(item);
 }
 return Array.from(groups).sort(([a],[b])=>a.localeCompare(b,'ru'));
}
const countForms=new Intl.PluralRules('ru');
function counted(n,forms) {return n+' '+(forms[countForms.select(n)]||forms.many);}
const tasteForms={one:'аромат',few:'аромата',many:'ароматов'};
const brandForms={one:'бренд',few:'бренда',many:'брендов'};
const jarForms={one:'банка',few:'банки',many:'банок'};
function row(x) {
 const qtyText=x.qty===null?'Нет складской записи':x.qty+' шт.';
 return '<button type="button" class="wm-row wm-line" data-item="'+escapeText(x.id)+'" aria-label="'+escapeText(x.brand+' · '+x.name+' '+(x.description||'')+' '+mixoraStatusLabels(x).join(', ')+', на складе '+qtyText)+'"><span class="wm-n">'+escapeText(x.name)+(x.description?'<small class="wm-flavour-note">'+escapeText(x.description)+'</small>':'')+mixoraBadges(mixoraStatusLabels(x))+(x.retired?'<small class="wm-meta">В архиве</small>':'')+'</span><strong class="wm-qty">'+qtyText+'</strong>'+icon('next')+'</button>';
}
function resultGroup(brand,rows,total=rows.length,first=true) {
 if(!first)return '<div class="wm-list">'+rows.map(row).join('')+'</div>';
 return '<section class="wm-brand-group" data-result-brand="'+escapeText(brand)+'" aria-label="'+escapeText(brand)+'"><div class="wm-group-head"><h2 class="wm-group-name">'+escapeText(brand)+'</h2><small>'+counted(total,tasteForms)+'</small></div><div class="wm-list"><div class="wm-colhead" aria-hidden="true"><span>Аромат</span><span>На складе</span><span></span></div>'+rows.map(row).join('')+'</div></section>';
}
let inventoryChunks=[], mountedChunks=new Set(), listFrame=0;
function inventoryGroups(page,groups){
 const count=groups.reduce((sum,[,rows])=>sum+rows.length,0);
 if(!['stock','bar'].includes(page)||count<=80)return groups.map(([brand,rows])=>resultGroup(brand,rows)).join('');
 for(const [brand,rows] of groups){
   for(let i=0;i<rows.length;i+=12){
     const batch=rows.slice(i,i+12);
     inventoryChunks.push({brand,rows:batch,first:i===0,total:rows.length,height:batch.length*76+(i===0?76:0)});
   }
 }
 return '<div class="wm-window">'+inventoryChunks.map(c=>'<div class="wm-chunk" style="height:'+c.height+'px"></div>').join('')+'</div>';
}
function mountChunk(index,container){
 if(mountedChunks.has(index))return;
 const chunk=inventoryChunks[index],block=container.children[index];
 block.innerHTML=resultGroup(chunk.brand,chunk.rows,chunk.total,chunk.first);
 block.style.height='auto';
 mountedChunks.add(index);
}
function updateWindow(){
 if(!inventoryChunks.length)return;
 const container=main.querySelector('.wm-window');
 if(!container)return;
 const blocks=container.children,viewport=main.getBoundingClientRect();
 function at(y){
   let lo=0,hi=blocks.length-1;
   while(lo<hi){
     const mid=Math.floor((lo+hi)/2);
     if(blocks[mid].getBoundingClientRect().bottom<=y)lo=mid+1;else hi=mid;
   }
   return lo;
 }
 const anchor=at(viewport.top),anchorTop=blocks[anchor].getBoundingClientRect().top;
 const start=at(viewport.top-main.clientHeight),end=at(viewport.bottom+main.clientHeight);
 for(const index of mountedChunks){
   if(index>=start&&index<=end)continue;
   const block=blocks[index];
   if(block.contains(document.activeElement))continue;
   inventoryChunks[index].height=block.getBoundingClientRect().height;
   block.style.height=inventoryChunks[index].height+'px';
   block.replaceChildren();
   mountedChunks.delete(index);
 }
 for(let i=start;i<=end;i++)mountChunk(i,container);
 const correction=blocks[anchor].getBoundingClientRect().top-anchorTop;
 if(Math.abs(correction)>.5)main.scrollTop+=correction;
}
function queueWindow(){
 if(!listFrame&&inventoryChunks.length)listFrame=requestAnimationFrame(()=>{listFrame=0;updateWindow();});
}
main.addEventListener('scroll',queueWindow,{passive:true});
new ResizeObserver(queueWindow).observe(main);
function resetWindow(){
 inventoryChunks=[];mountedChunks.clear();
 cancelAnimationFrame(listFrame);listFrame=0;
}
const brandMarks={
 NORA:'<path d="m2 20 8-15 4 8 3-6 6 13z"/><path d="m6.9 11 3.1 2.1 2.4-1.7"/>',
 MELLOW:'<path d="M12 15c-7 4-10-2-7-5 2-2 5-1 7 3-1-5 0-9 3-9 4 0 5 6 0 10 5-4 10-1 8 3-1 4-7 3-11-2z" fill="currentColor" stroke="none"/><path d="M11.5 15.2c-.8 2.1-.9 4.3 0 6.3"/>',
 SFERA:'<circle cx="12" cy="12" r="7.1"/><ellipse cx="12" cy="12" rx="11.2" ry="3.3" transform="rotate(-30 12 12)"/>',
 LUNO:'<path d="M17 3a9 9 0 1 0 4 14A9 9 0 0 1 17 3Z" fill="currentColor" stroke="none"/><path d="m19 3 .9 2.6L22.5 6l-2.6 1-1 2.6-.8-2.7-2.7-.9 2.6-.8z" fill="currentColor" stroke="none"/>',
 VERDE:'<path d="M5 20c6-1 12-7 15-16C10 5 3 10 5 20Z"/><path d="M3 22 16 9m-6 6v-4m1 3 4-.5"/>'
};
function brandDirectory(groups) {
 return '<div class="wm-brand-heading"><h2>Бренды</h2></div><nav class="wm-directory" aria-label="Бренды раздела">'+groups.map(([brand,rows])=>'<button type="button" class="wm-brand-entry" data-wm-brand="'+escapeText(brand)+'"><span class="wm-monogram" aria-hidden="true">'+'<svg viewBox="0 0 24 24" focusable="false">'+(Object.hasOwn(brandMarks,brand)?brandMarks[brand]:'<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/>')+'</svg>'+'</span><span><strong>'+escapeText(brand)+'</strong><small>'+counted(rows.length,tasteForms)+'</small></span>'+icon('next')+'</button>').join('')+'</nav>';
}
function itemList(page) {
 const groups=groupsByBrand(items.filter(x=>eligible(x,page)));
 const query=norm(state.queries[page]||''),brand=state.brands[page]||'';
 const empty=label=>'<div class="wm-list wm-empty">'+escapeText(label)+'</div>';
 if(query){
   const found=groupsByBrand(matchInventory(page));
   return found.length?inventoryGroups(page,found):empty('Ароматы не найдены. Попробуйте другое название или бренд.');
 }
 if(!brand) {
   const empties={bar:'На стойке пока пусто.',off:'Все ароматы с запасом уже на стойке.',stock:'Склад пуст.',stop:'Стоп-лист пуст.',slow:'Отмеченных ароматов пока нет.'};
   return groups.length?brandDirectory(groups):empty(empties[page]);
 }
 const own=groups.find(([name])=>name===brand)?.[1]||[];
 const toolbar='<div class="wm-brand-toolbar">'+action('← Все бренды','data-all-brands',true)+'</div>';
 return toolbar+(own.length?inventoryGroups(page,[[brand,own]]):'<div class="wm-group-head"><h2 class="wm-group-name">'+escapeText(brand)+'</h2></div>'+empty('В этом разделе больше нет ароматов бренда.'));
}
function inventorySummary(page) {
 const all=items.filter(x=>eligible(x,page));
 if(norm(state.queries[page]||''))return 'Поиск по всем брендам · найдено '+matchInventory(page).length;
 const brands=groupsByBrand(all).length;
 return counted(brands,brandForms)+' · '+counted(all.length,tasteForms)+(page==='stock'?' · '+counted(all.reduce((sum,x)=>sum+x.qty,0),jarForms):'');
}
function inventoryView() {
 const p=state.page;
 const title=heading(routes[p][0],inventorySummary(p));
 const header=p==='stock'&&!state.brands[p]?'<div class="wm-stock-heading">'+title+action('Добавить позицию','data-act="stock-new"',true)+'</div>':title;
 return '<div class="wm-inventory">'+header+notice()+'<label class="wm-search">'+icon('search')+'<span class="wm-sr">Поиск по всем брендам текущего раздела</span><input type="search" data-search placeholder="Найти аромат или бренд" value="'+escapeText(state.queries[p]||'')+'" autocomplete="off" enterkeyhint="search" maxlength="160"></label><div data-results>'+itemList(p)+'</div></div>';
}
function props(pairs) {
 return '<dl class="wm-props">'+pairs.map(([label,value])=>'<div><dt>'+escapeText(label)+'</dt><dd>'+escapeText(value)+'</dd></div>').join('')+'</dl>';
}
function notice() {return state.message?'<p class="wm-notice" role="status">'+escapeText(state.message)+'</p>':'';}
function archiveReason(x){
 if(!x.slow||!x.stop||x.qty!==0||x.onBar)return 'Вывести можно аромат в стоп-листе и неликвиде, когда на складе 0 шт. и он убран со стойки.';
 return '';
}
function stockSuggestions(brand){
 return items.filter(x=>x.brand===brand&&!x.retired).map(x=>'<option value="'+escapeText(x.name)+'"></option>').join('');
}
function stockNewView(){
 const brands=Array.from(new Set(items.map(x=>x.brand))).sort((a,b)=>a.localeCompare(b,'ru'));
 return back('Склад')+heading('Добавить позицию')+'<form class="wm-form" data-stock-new><label>Бренд<select class="wm-input" name="brand">'+brands.map(b=>'<option value="'+escapeText(b)+'">'+escapeText(b)+'</option>').join('')+'<option value="">Добавить новый бренд…</option></select></label><label hidden data-new-brand>Название нового бренда<input class="wm-input" name="newBrand" maxlength="80" autocomplete="off" disabled></label><label>Аромат<input name="name" class="wm-input" required maxlength="100" list="wm-stock-flavors" autocomplete="off"></label><datalist id="wm-stock-flavors">'+stockSuggestions(brands[0])+'</datalist><label>Количество банок<input name="quantity" class="wm-input" type="number" step="1" min="1" max="999" value="1" required inputmode="numeric"></label><div class="wm-controls"><button type="submit" class="wm-action wm-primary">Добавить на склад</button>'+action('Отмена','data-return')+'</div></form>';
}
function detailView() {
 if(state.page==='stock'&&state.id==='new')return stockNewView();
 const x=get(state.id),page=state.page,phase=state.phase;
 const names={move:'Перенести на стойку',take:'Взять со склада',refill:'Пополнить',del:'Удалить позицию',retire:'Вывести аромат'};
 const cancel=action('Отмена','data-act="cancel"');
 let controls='';
 if(['move','take','refill'].includes(phase)){
   const max=phase==='refill'?999:x.qty;
   controls='<form data-transfer class="wm-confirm wm-form"><h2 class="wm-h2">'+names[phase]+'</h2><label>Количество банок<input class="wm-input" type="number" data-amount name="quantity" min="1" max="'+max+'" step="1" required value="1" inputmode="numeric"></label><div class="wm-controls"><button type="submit" class="wm-action wm-primary">'+({move:'Подтвердить перенос',take:'Взять',refill:'Подтвердить пополнение'})[phase]+'</button>'+cancel+'</div></form>';
 }else if(phase==='del'||phase==='retire'){
   const explanation=phase==='del'?'Со склада будет списан весь остаток — '+x.qty+' шт. Стойка и текущий заказ сохранятся.':'Аромат перейдёт в архив. Его можно вернуть через поиск на складе. История сохранится.';
   controls='<div class="wm-confirm"><h2 class="wm-h2">'+names[phase]+'?</h2><p class="wm-sub">'+explanation+'</p><div class="wm-controls">'+action(phase==='del'?'Удалить со склада':'Подтвердить вывод','data-act="confirm-'+phase+'"')+cancel+'</div></div>';
 }else{
   const control=(label,act,primary=false)=>action(label,'data-act="'+act+'"',primary);
   if(x.retired)controls=control('Вернуть в ассортимент','restore',true);
   else if(page==='slow'){
     controls=control(names.retire,'retire',true)+control('Снять отметку неликвида','unslow');
   }else{
     if(page==='bar'||page==='off')controls+=control(x.onBar?names.take:names.move,x.onBar?'take':'move',true);
     if(page==='bar')controls+=['slow','stop'].map(key=>'<button type="button" class="wm-action wm-toggle" aria-pressed="'+!!x[key]+'" data-act="'+(x[key]?'un':'')+key+'">'+(key==='slow'?'В неликвид':'В стоп-лист')+'</button>').join('');
     if(page==='stock')controls+=control(names.move,'move',true);
     if(page==='stop'&&x.stop)controls+=control('Вернуть из стоп-листа','unstop',true);
     controls+=control('Добавить в заказ','order-one');
     if(page==='stock')controls+=control(names.refill,'refill')+control(names.del,'del');
   }
   controls='<div class="wm-controls">'+controls+'</div>';
 }
 return '<div class="wm-detail">'+back(routes[state.page][0]+' / '+(norm(state.queries[state.page]||'')?'Результаты поиска':x.brand))+heading(x.name,x.brand)+(x.description?'<p class="wm-tasting-detail">'+escapeText(x.description)+'</p>':'')+notice()+props([['На складе',x.qty===null?'Нет складской записи':x.qty+' шт.'],['На стойке',x.onBar?'Да':'Нет'],['Поставщик',x.supplier],...(page!=='bar'&&x.stop?[['Стоп-лист','В стоп-листе']]:[]),...(page!=='bar'&&x.slow?[['Неликвид','Отмечен']]:[]),...(basket.has(x.id)?[['В заказе',basket.get(x.id)+' шт.']]:[])])+controls+'</div>';
}
const orderContacts = new Map();
let recipientId='';
let sendFormat='text';
let pickerReturn='build';
const sortOrder=(rows)=>rows.slice().sort((a,b)=>(a.brand||'Без бренда').localeCompare(b.brand||'Без бренда','ru')||a.name.localeCompare(b.name,'ru'));
const orderRows=()=>sortOrder(demoAPI.orderRows().filter(row=>row.qty>0));
const orderTotal=rows=>rows.reduce((total,row)=>total+row.qty,0);
const supplierById=id=>suppliers.find(s=>s.id===id);
const positionCount=n=>counted(n,{one:'позиция',few:'позиции',many:'позиций'});
function orderScope(){
 const draft=orderRows(),recipient=supplierById(recipientId);
 if(!recipient)return {recipient,rows:draft,draft};
 const supplied=new Map(recipient.brands.map(brand=>[norm(brand),brand]));
 const rows=draft.filter(x=>supplied.has(norm(x.brand||''))).map(x=>({...x,brand:supplied.get(norm(x.brand))}));
 return {recipient,rows:sortOrder(rows),draft};
}
function scopeDescription(scope){
 const {recipient,rows,draft}=scope;
 if(!recipient)return 'Весь заказ · '+positionCount(rows.length)+' · '+orderTotal(rows)+' шт.';
 const brands=Array.from(new Set(rows.map(x=>x.brand))).join(', ');
 return 'К отправке · '+positionCount(rows.length)+(brands?' · '+brands:'')+'. Остальные позиции в общем заказе: '+(draft.length-rows.length)+'.';
}
const orderLink=(title,id,primary=false)=>action(title,'data-order-to="'+escapeText(id)+'"',primary);
function orderParent(){
 const id=state.id;
 if(state.page!=='order'||!id)return null;
 if(id==='pick')return ['order',pickerReturn];
 if(id==='manual-build'||id==='send')return ['order','build'];
 if(id.startsWith('view-'))return ['order','contacts'];
 if(id.startsWith('contact-'))return ['order','pick'];
 return ['order',''];
}
function orderQuantityControl(x) {
 const name=escapeText(x.name),id=escapeText(x.id);
 return '<span class="wm-stepper om-qty"><button type="button" class="wm-step" data-id="'+id+'" data-step="-1" aria-label="Уменьшить количество, '+name+'">−</button><input type="number" class="wm-input om-qty-input" data-order-qty="'+id+'" value="'+x.qty+'" min="0" max="99" step="1" required inputmode="numeric" aria-label="Количество, '+name+'"><button type="button" class="wm-step" data-id="'+id+'" data-step="1" '+(x.qty>=99?'disabled':'')+' aria-label="Увеличить количество, '+name+'">+</button></span>';
}
function orderView(){
 const rows=orderRows();
 const chosen=rows.map(x=>'<div class="wm-line wm-orderline"><span><span class="wm-n">'+escapeText(x.name)+'</span><span class="wm-meta">'+escapeText(x.brand||'Без бренда')+'</span></span>'+orderQuantityControl(x)+'</div>').join('');
 const recs=items.filter(x=>!x.retired&&!basket.has(x.id)&&!x.slow&&(x.qty===0||(x.qty===1&&x.onBar)));
 return heading('Заказ','К закупке · '+orderTotal(rows)+' шт.'+(recipientId?' · Контрагент — '+supplierById(recipientId).name:''))+'<div class="om-tools">'+orderLink('Добавить позицию','manual')+orderLink('Контрагенты','contacts')+'</div>'+notice()+'<div class="wm-list">'+(chosen||'<div class="wm-empty">Заказ пока пуст. Добавьте первую позицию.</div>')+'</div><div class="wm-controls"><button type="button" class="wm-action wm-primary" data-order-apply>Применить изменения</button><button type="button" class="wm-action" data-order-discard>Отменить правки</button><button type="button" class="wm-action" data-order-clear>Очистить заказ</button>'+orderLink('Сформировать заказ','build',true)+'</div>'+(recs.length?'<div class="wm-recs"><h2 class="wm-h2">Предложить к заказу</h2><div class="wm-list">'+recs.map(x=>'<div class="wm-line wm-orderline"><span><span class="wm-n">'+escapeText(x.name)+'</span><span class="wm-meta">'+escapeText(x.brand)+' · на складе '+x.qty+' шт.</span></span>'+action('Добавить','data-add="'+escapeText(x.id)+'" aria-label="Добавить в заказ, '+escapeText(x.name)+'"')+'</div>').join('')+'</div></div>':'');
}
function buildOrderView() {
 const rows=orderRows(),recipient=supplierById(recipientId);
 const groups=groupsByBrand(rows.map(x=>({...x,brand:x.brand||'Без бренда'})));
 return back('Заказ')+heading('Сформировать заказ','К закупке · '+orderTotal(rows)+' шт.')+notice()+'<div class="om-tools">'+orderLink('Добавить позицию','manual-build')+orderLink('Выбрать контрагента','pick')+'</div>'+(recipient?'<h2 class="wm-h2">'+escapeText(recipient.name)+'</h2><p class="wm-meta" data-order-scope>'+escapeText(scopeDescription(orderScope()))+'</p>':'')+
 (groups.length?'<div class="om-groups">'+groups.map(([brand,members])=>'<section class="om-group"><h2 class="wm-h2">'+escapeText(brand)+'</h2><div class="om-cards">'+members.map(x=>'<div class="om-card"><span>'+escapeText(x.name)+'</span>'+orderQuantityControl(x)+'</div>').join('')+'</div></section>').join('')+'</div><div class="wm-controls">'+orderLink('Отправить заказ поставщику','send',true)+'</div>':'<div class="wm-list wm-empty">Заказ пока пуст. Добавьте первую позицию.</div>');
}
function manualView() {
 const build=state.id==='manual-build';
 const brands=Array.from(new Set(items.filter(x=>!x.retired).map(x=>x.brand))).sort((a,b)=>a.localeCompare(b,'ru'));
 return back(build?'Сформировать заказ':'Заказ')+heading('Добавить позицию')+notice()+'<form data-manual class="wm-form"><label>Бренд<input name="brand" class="wm-input" list="wm-order-brands" autocomplete="off" maxlength="80" placeholder="Необязательно"></label><datalist id="wm-order-brands">'+brands.map(b=>'<option value="'+escapeText(b)+'">').join('')+'</datalist><label>Аромат<input name="name" class="wm-input" autocomplete="off" maxlength="100" required></label><label>Количество, шт.<input class="wm-input" name="quantity" type="number" min="1" max="99" value="1" step="1" inputmode="numeric" required></label><div class="wm-controls"><button type="submit" class="wm-action wm-primary">Добавить в заказ</button>'+action('Отмена','data-return')+'</div></form>';
}
const channelFields=[
 ['telegram','Telegram','Имя пользователя, например @username'],
 ['whatsapp','WhatsApp','Номер в международном формате'],
 ['max','MAX','Ссылка на профиль в MAX'],
 ['phone','Телефон','Номер в международном формате']
];
function contactURL(key,raw,text=''){
 const value=(raw||'').trim();
 if(!value)return '';
 if(key==='telegram'){
   const user=value.replace(/^@/,'');
   if(!/^[a-z]\w{3,31}$/i.test(user))return '';
   return 'https://t.me/'+user+(text?'?text='+encodeURIComponent(text):'');
 }
 if(key==='max'){
   try{
     const url=new URL(value);
     if(url.protocol!=='https:'||url.hostname!=='max.ru'||url.port||url.username||url.password||!/^\/(?:u\/)?[a-zA-Z0-9_-]+\/?$/.test(url.pathname))return '';
     return url.origin+url.pathname;
   }catch{return '';}
 }
 if(!/^\+?[\d\s()-]+$/.test(value))return '';
 const digits=value.replace(/\D/g,'');
 if(!/^[1-9]\d{6,14}$/.test(digits))return '';
 if(key==='whatsapp')return 'https://wa.me/'+digits+(text?'?text='+encodeURIComponent(text):'');
 return key==='phone'?'tel:+'+digits:'';
}
function contactButtons(s,text=''){
 const saved=orderContacts.get(s.id)||{};
 return channelFields.map(([key,label])=>{
   const url=contactURL(key,saved[key],text);
   if(!url)return !integration&&s.id==='orbita'?action((key==='phone'?'Телефон':label)+' · демо','data-demo-channel="'+key+'" aria-expanded="false"'):'';
   return '<a class="wm-action" target="_blank" rel="noopener noreferrer" href="'+escapeText(url)+'">'+escapeText(key==='phone'?'Позвонить':label)+'</a>';
 }).join('')+(s.id==='orbita'?'<div data-channel-preview aria-live="polite" hidden></div>':'');
}
function previewChannel(button){
 const key=button.dataset.demoChannel,label=channelFields.find(f=>f[0]===key)?.[1];
 const panel=button.parentElement.querySelector('[data-channel-preview]');
 if(!panel||!label)return;
 const open=button.getAttribute('aria-expanded')!=='true';
 for(const b of button.parentElement.querySelectorAll('[data-demo-channel]'))b.setAttribute('aria-expanded',String(b===button&&open));
 panel.hidden=!open;
 if(!open)return;
 let sample='Откроется '+(key==='phone'?'экран звонка':'чат '+label)+' с поставщиком «Орбита».';
 if(state.id==='send'&&key!=='phone'){
   sample+=sendFormat==='xlsx'?' В чат можно прикрепить файл «Заказ Mixora.xlsx».':' В чат можно вставить текст заказа.';
 }
 panel.textContent='Демопример. '+sample+' Для перехода к своему контакту укажите его в карточке контрагента.';
}
function contactForm(s){
 if(connected)return action('Изменить контакты','data-native-supplier="'+escapeText(s.id)+'"');
 const saved=orderContacts.get(s.id)||{};
 return '<details class="om-editor"><summary>Изменить контакты</summary><form data-order-contact="'+escapeText(s.id)+'" class="wm-form"><p class="wm-meta">Контакты доступны до закрытия или обновления этой страницы.</p>'+channelFields.map(([key,label,hint])=>'<label>'+label+'<input class="wm-input" name="'+key+'" maxlength="190" autocomplete="off" placeholder="'+hint+'" value="'+escapeText(saved[key]||'')+'"></label>').join('')+'<button type="submit" class="wm-action wm-primary">Сохранить контакты</button></form></details>';
}
function suppliersView() {
 const inOrder=state.page==='order',pick=inOrder&&(state.id==='pick'||state.id.startsWith('contact-'));
 const id=inOrder?state.id.replace(/^(contact|view)-/,''):state.id;
 const s=supplierById(id);
 if(s){
   const channels=contactButtons(s);
   return back(pick?'Выбрать контрагента':'Контрагенты')+heading(s.name)+notice()+(inOrder&&!pick?action('Выбрать для заказа','data-attach-recipient="'+escapeText(s.id)+'"',true):'')+'<h2 class="wm-h2">Поставляемые бренды</h2><div class="om-brand-tags">'+s.brands.map(b=>'<span>'+escapeText(b)+'</span>').join('')+'</div><h2 class="wm-h2">Контакты</h2>'+(channels?'<div class="wm-controls">'+channels+'</div>':'<p class="wm-meta">Контакты пока не добавлены.</p>')+contactForm(s)+(pick?'<div class="wm-controls">'+action('Выбрать контрагента','data-select-supplier="'+escapeText(s.id)+'"',true)+'</div>':'');
 }
 const sorted=suppliers.slice().sort((a,b)=>a.name.localeCompare(b.name,'ru'));
 return (inOrder?back(pick?(pickerReturn==='send'?'Отправка заказа':'Сформировать заказ'):'Заказ'):'')+heading(pick?'Выбрать контрагента':'Контрагенты')+(pick?'<div class="om-tools">'+action('Без контрагента','data-select-supplier=""')+'</div>':'')+'<div class="wm-list">'+sorted.map(s=>'<button type="button" class="wm-row wm-line" '+(inOrder?'data-order-to="'+escapeText((pick?'contact-':'view-')+s.id)+'"':'data-item="'+escapeText(s.id)+'"')+'><span><span class="wm-n">'+escapeText(s.name)+'</span><span class="wm-meta">'+escapeText(s.brands.join(' · '))+'</span></span><span></span>'+icon('next')+'</button>').join('')+'</div>';
}
function orderText(rows){
 const recipient=supplierById(recipientId),lines=['Заказ'+(recipient?' · '+recipient.name:'')];
 for(const [brand,members] of groupsByBrand(rows.map(x=>({...x,brand:x.brand||'Без бренда'})))){
   lines.push('',brand,...members.map(x=>x.name+' — '+x.qty+' шт.'));
 }
 lines.push('','Итого: '+orderTotal(rows)+' шт.');
 return lines.join('\n');
}
function sendOrderView(){
 const scope=orderScope(),{rows,recipient,draft}=scope;
 const header=back('Сформировать заказ')+heading('Отправка заказа',recipient?'Получатель · '+recipient.name:'Без контрагента');
 if(!draft.length)return header+'<p>Заказ пока пуст.</p>'+orderLink('Добавить позицию','manual-build');
 const choose='<div class="wm-controls">'+orderLink(recipient?'Сменить контрагента':'Выбрать контрагента','pick')+(recipient?action('Без контрагента','data-select-supplier=""'):'')+'</div>';
 const summary='<p class="wm-meta" data-order-scope>'+escapeText(scopeDescription(scope))+'</p>';
 if(!rows.length)return header+summary+'<p>В заказе пока нет позиций брендов поставщика: '+escapeText(recipient.brands.join(', '))+'.</p>'+choose;
 const text=orderText(rows),file=sendFormat==='xlsx',channels=recipient?contactButtons(recipient,file?'':text):'';
 const shareOK=navigator.share&&(!file||canShareOrderFile());
 return header+summary+choose+'<div class="om-format" role="group" aria-label="Формат заказа">'+['text','xlsx'].map(k=>action(k==='text'?'Текст':'Excel (.xlsx)','data-order-format="'+k+'" aria-pressed="'+(sendFormat===k)+'"',sendFormat===k)).join('')+'</div>'+
 (file?'<div class="wm-list om-file"><strong>Заказ Mixora.xlsx</strong><span class="wm-meta">'+counted(rows.length,{one:'позиция',few:'позиции',many:'позиций'})+' · '+orderTotal(rows)+' шт.</span></div>':'<textarea readonly class="wm-input om-preview" data-order-text aria-label="Текст заказа">'+escapeText(text)+'</textarea>')+
 '<div class="wm-controls">'+(file?action('Скачать Excel','data-order-download',true):action('Скопировать текст','data-order-copy',true))+(shareOK?action(file?'Поделиться файлом':'Поделиться текстом','data-order-share'):'')+'</div><p class="wm-meta" data-send-status role="status"></p>'+
 (recipient?'<h2 class="wm-h2">Связаться с контрагентом</h2>'+(channels?'<p class="wm-meta">'+(file?'Скачайте файл, откройте чат и прикрепите заказ.':'Скопируйте текст для вставки в чат. Подтвердите отправку в выбранном приложении.')+'</p><div class="wm-controls">'+channels+'</div>':'<p class="wm-meta">У контрагента пока нет контактов.</p>'):'');
}
function orderRouteView(){
 if(state.id==='build')return buildOrderView();
 if(state.id==='send')return sendOrderView();
 if(state.id.startsWith('manual'))return manualView();
 if(state.id)return suppliersView();
 return orderView();
}
// The workbook uses inline strings so names stay literal, including names starting with "=".
function makeOrderFile(){
 const {rows,recipient}=orderScope();
 if(!rows.length)return null;
 const table=[['Бренд','Аромат','Количество, шт.'],...rows.map(x=>[x.brand||'Без бренда',x.name,x.qty]),['','Итого',orderTotal(rows)]];
 if(recipient)table.push(['Контрагент',recipient.name]);
 const sheetData=table.map((cells,i)=>'<row r="'+(i+1)+'">'+cells.map((value,j)=>{
   const ref=String.fromCharCode(65+j)+(i+1);
   if(typeof value==='number')return '<c r="'+ref+'"><v>'+value+'</v></c>';
   const xml=escapeText(String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,''));
   return '<c r="'+ref+'" t="inlineStr"><is><t xml:space="preserve">'+xml+'</t></is></c>';
 }).join('')+'</row>').join('');
 const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 const packageRel='http://schemas.openxmlformats.org/package/2006/relationships';
 const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
 const parts=[
 ['[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
 ['_rels/.rels','<Relationships xmlns="'+packageRel+'"><Relationship Id="rId1" Type="'+rel+'/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
 ['xl/workbook.xml','<workbook xmlns="'+ns+'" xmlns:r="'+rel+'"><sheets><sheet name="Заказ" sheetId="1" r:id="rId1"/></sheets></workbook>'],
 ['xl/_rels/workbook.xml.rels','<Relationships xmlns="'+packageRel+'"><Relationship Id="rId1" Type="'+rel+'/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
 ['xl/worksheets/sheet1.xml','<worksheet xmlns="'+ns+'"><cols><col min="1" max="1" width="22" customWidth="1"/><col min="2" max="2" width="48" customWidth="1"/><col min="3" max="3" width="20" customWidth="1"/></cols><sheetData>'+sheetData+'</sheetData></worksheet>']
 ];
 return new File(zipOrderParts(parts), 'Заказ Mixora.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
// Store the five small XML entries in a ZIP without compression.
function zipOrderParts(parts){
 const encoder=new TextEncoder(),files=[],directory=[];
 let offset=0,directorySize=0;
 for(const [path,xml] of parts){
   const name=encoder.encode(path),data=encoder.encode(xml),size=data.length;
   let crc=0xffffffff;
   for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
   crc=(crc^0xffffffff)>>>0;
   const local=new Uint8Array(30),lh=new DataView(local.buffer);
   lh.setUint32(0,0x04034b50,true);lh.setUint16(4,20,true);lh.setUint16(12,33,true);
   lh.setUint32(14,crc,true);lh.setUint32(18,size,true);lh.setUint32(22,size,true);lh.setUint16(26,name.length,true);
   files.push(local,name,data);
   const central=new Uint8Array(46),ch=new DataView(central.buffer);
   ch.setUint32(0,0x02014b50,true);ch.setUint16(4,20,true);ch.setUint16(6,20,true);ch.setUint16(14,33,true);
   ch.setUint32(16,crc,true);ch.setUint32(20,size,true);ch.setUint32(24,size,true);ch.setUint16(28,name.length,true);ch.setUint32(42,offset,true);
   directory.push(central,name);directorySize+=central.length+name.length;
   offset+=local.length+name.length+size;
 }
 const end=new Uint8Array(22),eh=new DataView(end.buffer);
 eh.setUint32(0,0x06054b50,true);eh.setUint16(8,parts.length,true);eh.setUint16(10,parts.length,true);
 eh.setUint32(12,directorySize,true);eh.setUint32(16,offset,true);
 return [...files,...directory,end];
}
function canShareOrderFile(){
 try{return !!navigator.canShare?.({files:[makeOrderFile()]});}catch{return false;}
}
function downloadOrder(){
 const file=makeOrderFile();
 if(!file)return;
 const url=URL.createObjectURL(file);
 const anchor=document.createElement('a');
 anchor.href=url;anchor.download=file.name;document.body.append(anchor);anchor.click();anchor.remove();
 setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function sendOrder(button){
 const status=main.querySelector('[data-send-status]');
 const {rows}=orderScope();
 if(!status||!rows.length)return;
 if(button.hasAttribute('data-order-download')){downloadOrder();status.textContent='Откройте загрузки браузера, чтобы прикрепить файл.';return;}
 if(button.hasAttribute('data-order-copy')){
   const box=main.querySelector('[data-order-text]');
   try{await navigator.clipboard.writeText(box.value);status.textContent='Текст заказа скопирован.';return;}catch{}
   box.focus();box.select();
   try{if(document.execCommand('copy')){status.textContent='Текст заказа скопирован.';return;}}catch{}
   status.textContent='Текст выделен. Выберите «Копировать» в меню устройства.';return;
 }
 try{
   if(sendFormat==='xlsx')await navigator.share({files:[makeOrderFile()]});
   else await navigator.share({text:orderText(rows)});
 }catch(error){
   if(error.name!=='AbortError')status.textContent=sendFormat==='xlsx'?'Скачайте Excel и прикрепите его в чате.':'Скопируйте текст и вставьте его в чат.';
 }
}
function saveContactForm(form){
 const values={};
 for(const [key,label] of channelFields){
   const field=form.elements.namedItem(key);
   values[key]=field.value.trim();
   field.setCustomValidity(values[key]&&!contactURL(key,values[key])?'Проверьте поле «'+label+'».':'');
 }
 if(!form.reportValidity())return;
 orderContacts.set(form.dataset.orderContact,values);
 state.message='Контакты сохранены для этой страницы.';render();
 main.querySelector('.om-editor summary')?.focus({preventScroll:true});
}
function setOrderQuantity(id,quantity){
 const manual=manualRows.get(id),entry=manual||get(id);
 if(!entry||!Number.isInteger(quantity)||quantity<0||quantity>99)return;
 if(demoAPI.orderQuantity(id)===quantity)return;
 if(manual){if(quantity)manual.qty=quantity;else manualRows.delete(id);}
 else if(quantity)basket.set(id,quantity);else basket.delete(id);
 log(entry.name,quantity?'Количество в заказе · '+quantity+' шт.':'Удалено из заказа');
 state.message=quantity?'':entry.name+' · позиция удалена.';
 say(entry.name+' · в заказе '+quantity+' шт.');
}
function handleOrderClick(button){
 if(button.hasAttribute('data-demo-channel')){previewChannel(button);return true;}
 if(button.hasAttribute('data-order-to')){
   if(button.dataset.orderTo==='pick')pickerReturn=state.id==='send'?'send':'build';
   navigate('order',button.dataset.orderTo);return true;
 }
 if(button.hasAttribute('data-attach-recipient')){recipientId=button.dataset.attachRecipient;navigate('order');return true;}
 if(button.hasAttribute('data-select-supplier')){
   recipientId=button.dataset.selectSupplier;navigate('order',state.id==='send'?'send':pickerReturn);return true;
 }
 if(button.hasAttribute('data-order-format')){
   sendFormat=button.dataset.orderFormat;render();
   main.querySelector('[data-order-format="'+sendFormat+'"]').focus({preventScroll:true});return true;
 }
 if(button.matches('[data-order-download],[data-order-copy],[data-order-share]')){sendOrder(button);return true;}
 return false;
}
function journalView() {
 if(integration){
   const hint=journalStatus==='error'?'Не удалось обновить журнал.':journalStatus==='loading'?'Загружаем движения…':journal.length?'':'Складских движений пока нет.';
   const rows=journal.map(entry=>{
     const at=new Date(entry.time),stamp=Number.isFinite(entry.time)?at.toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
     const undo=entry.undone?'<small class="wm-meta">Отменено</small>':entry.canUndo?action('Отменить действие','data-integration-undo="'+escapeText(entry.id)+'"'):'';
     return '<div class="wm-line wm-journal"><time class="wm-time">'+escapeText(stamp)+'</time><span><span class="wm-n">'+escapeText(entry.title)+'</span><span class="wm-meta">'+escapeText(entry.desc)+'</span>'+undo+'</span></div>';
   }).join('');
   return heading('Журнал')+(hint?'<p class="wm-meta" role="status">'+hint+'</p>':'')+'<div class="wm-list">'+rows+'</div>';
 }
 const timeFormat=new Intl.DateTimeFormat('ru',{hour:'2-digit',minute:'2-digit'});
 const dateFormat=new Intl.DateTimeFormat('ru',{day:'numeric',month:'short'});
 const current=journalSnapshot();
 return heading('Журнал','Последние действия с остатками и заказом.')+'<div class="wm-list">'+journal.map(y=>'<div class="wm-line wm-journal"><time class="wm-time" title="'+escapeText(dateFormat.format(y.time))+'">'+timeFormat.format(y.time)+'</time><span><span class="wm-n">'+escapeText(y.title)+'</span><span class="wm-meta">'+escapeText(y.desc)+'</span>'+(y.undone?'<small class="wm-meta">Отменено</small>':canUndo(y,current)?action('Отменить действие','data-undo="'+y.id+'"'):'<small class="wm-meta">Сначала отмените последующее действие с этой позицией</small>')+'</span></div>').join('')+'</div>';
}
function validRoute(page,id) {
 if(page==='home'||page==='more'||Object.hasOwn(nativeRoutes,page))return !id;
 if(!Object.hasOwn(routes,page))return false;
 if(!id)return true;
 return (page==='stock'&&id==='new')||(inventories.includes(page)&&!!get(id))||(page==='order'&&(['build','send','manual','manual-build','contacts','pick'].includes(id)||
  suppliers.some(s=>id==='view-'+s.id||id==='contact-'+s.id)))||(page==='sup'&&suppliers.some(s=>s.id===id));
}
const standalone=window===window.top && (connected||document.title==='Mixora · Рабочее меню');
const loc=()=>{const match=location.hash.match(/^#mixora\/(home|ai|bar|off|stock|stop|order|slow|sup|journal|more|mixes|chk|know|inv|pack|str|wish|team)(?:\/([^/?#]+))?(?:\?([^#]*))?$/);if(match?.[2])try{match[2]=decodeURIComponent(match[2]);}catch{return null;}return match;};
function readBrandRoute(match) {
 if(!match||!inventories.includes(match[1]))return {};
 const query=new URLSearchParams(match[3]||''),brand=query.get('brand')||'';
 return {brand:items.some(x=>x.brand===brand)?brand:'',query:(query.get('q')||'').slice(0,160)};
}
function inventoryKey(page) {
 return JSON.stringify([page,state.brands[page]||'',norm(state.queries[page]||'')]);
}
function routeHash(page,id='') {
 const path='#mixora/'+page+(id?'/'+encodeURIComponent(id):'');
 if(!inventories.includes(page))return path;
 const p=new URLSearchParams();
 if(state.brands[page])p.set('brand',state.brands[page]);
 if(state.queries[page])p.set('q',state.queries[page]);
 return path+(p.size?'?'+p:'');
}
const inventoryPlaces=new Map();
const inventoryFocus=new Map();
function activeListControl(el){
 if(el.matches('[data-item]'))return {item:el.dataset.item};
 if(el.matches('[data-wm-brand]'))return {brand:el.dataset.wmBrand};
 if(el.matches('[data-act="stock-new"]'))return {selector:'[data-act="stock-new"]'};
 if(el.matches('[data-all-brands]'))return {selector:'[data-all-brands]'};
 if(el.matches('[data-search]'))return {selector:'[data-search]'};
 return null;
}
root.addEventListener('focusin',e=>{
 if(!inventories.includes(state.page)||state.id||!main.contains(e.target))return;
 const marker=activeListControl(e.target);
 if(marker)inventoryFocus.set(inventoryKey(state.page),marker);
});
function remember(id='') {
 if(state.id)return;
 const containers=[];
 for(let node=main;node&&node!==document.body;node=node.parentElement){
   if(/auto|scroll|overlay/.test(getComputedStyle(node).overflowY))containers.push({node,top:node.scrollTop});
 }
 const key=inventoryKey(state.page),control=inventoryFocus.get(key)||{};
 const selected=id||control.item||'';
 const index=Array.from(main.querySelectorAll('[data-item]')).findIndex(el=>el.dataset.item===selected);
 const place={top:window.scrollY,containers,index,id:selected,control};
 if(inventoryChunks.length){
   const blocks=main.querySelector('.wm-window').children;
   place.heights=inventoryChunks.map((chunk,i)=>[chunk.rows[0].id,mountedChunks.has(i)?blocks[i].getBoundingClientRect().height:chunk.height]);
   const button=Array.from(main.querySelectorAll('[data-item]')).find(el=>el.dataset.item===selected);
   if(button)place.itemTop=button.getBoundingClientRect().top-main.getBoundingClientRect().top;
 }
 state.memory[state.page]=place;
 if(inventories.includes(state.page))inventoryPlaces.set(key,place);
}
const dockTabs = [['home','Главная'],['bar','Стойка'],['stock','Склад'],['order','Заказ'],['more','Ещё']];
const nativeRoutes={mixes:'Альбом миксов',chk:'Чек-лист смены',know:'База знаний',inv:'Инвентаризация',pack:'Граммовка',str:'Крепость табаков',wish:'Пожелания гостей',team:'Команда'};
const extraPages = ['ai','off','stop','slow','sup','journal'];
const dock = root.querySelector('.wm-dock-inner');
dock.innerHTML = dockTabs.map(([key,label]) =>
  '<button type="button" data-dock="'+key+'">'+icon(key)+'<span>'+label+'</span></button>'
).join('');

function moreView() {
  return heading('Ещё')+'<button type="button" class="wm-theme wm-action" aria-pressed="'+(root.dataset.theme==='dark')+'" data-theme-toggle>Тёмная тема <span aria-hidden="true"></span></button>'+'<nav class="wm-extra" aria-label="Дополнительные разделы">'+extraPages.map(key =>
    '<button type="button" data-nav="'+key+'">'+icon(key)+'<span>'+escapeText(routes[key][0])+'</span>'+icon('next')+'</button>'
  ).join('')+Object.entries(nativeRoutes).map(([key,title])=>'<button type="button" data-nav="'+key+'">'+icon('more')+'<span>'+escapeText(title)+'</span>'+icon('next')+'</button>').join('')+'</nav>';
}

function render() {
 if(connected)window.dispatchEvent(new Event('mixora-interface-before-render'));
 resetWindow();
 const p=state.page;
 main.dataset.route=p;
 root.dataset.route=p;
 for(const button of dock.children) {
   const selected=button.dataset.dock===p;
   const inside=button.dataset.dock==='more' && (extraPages.includes(p)||Object.hasOwn(nativeRoutes,p));
   if(selected||inside)button.setAttribute('aria-current',selected?'page':'location');
   else button.removeAttribute('aria-current');
 }
 fitWorkspace();
 homeBack.hidden=p==='home';
 if(p==='ai') {
   main.innerHTML='<div class="wm-chat-nav"><button type="button" class="wm-back" data-chat-back>← Назад</button></div><div data-ai-host></div>';
   const host=main.querySelector('[data-ai-host]');
   host.mixora=demoAPI;
   if(connected){window.MixoraConnectedChat?.mount(host);window.dispatchEvent(new Event('mixora-interface-after-render'));return;}
   const mount=()=>{if(host.isConnected)window.mountMixoraDemoChat?.(host);};
   if(window.mountMixoraDemoChat)mount();else window.addEventListener('mixora-chat-ready',mount,{once:true});
   return;
 }
 if(p==='home')main.innerHTML=homeView();
 else if(p==='more')main.innerHTML=moreView();
 else if(Object.hasOwn(nativeRoutes,p)){
   main.innerHTML='<div data-native-host></div>';
   window.MixoraConnectedSections.mount(main.firstElementChild,p);
 }
 else if(inventories.includes(p))main.innerHTML=state.id?detailView():inventoryView();
 else if(p==='order')main.innerHTML=orderRouteView();
 else if(p==='sup')main.innerHTML=suppliersView();
 else if(p==='journal')main.innerHTML=journalView();
 updateWindow();
 if(connected)window.dispatchEvent(new Event('mixora-interface-after-render'));
}
let chatOrigin='home';
function navigate(page,id='',options={}) {
 if(connected&&state.page==='ai'&&page!=='ai')window.dispatchEvent(new Event('mixora-assistant-leave'));
 if(page==='ai'&&state.page!=='ai')chatOrigin=state.page;
 if(!validRoute(page,id))return;
 const returning=state.page===page&&!!state.id&&!id;
 if(!state.id&&(id||inventories.includes(state.page)))remember(id);
 if(!state.id&&state.page==='home')remember(page);
 if(inventories.includes(page)&&Object.hasOwn(options,'brand')){state.brands[page]=options.brand;state.queries[page]=options.query||'';}
 state.page=page;state.id=id;state.phase='';state.message=options.message||'';
 if(standalone&&!options.fromHistory) {
   try{
     const hash=routeHash(page,id);
     if(location.hash!==hash)history.pushState({mixora:true},'',hash);
   }catch{}
 }
 render();
 if(!returning&&!options.fromHistory&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
   main.animate?.([{opacity:0.82},{opacity:1}],{duration:130,easing:'ease-out'});
 }
 const isList=inventories.includes(page)&&!id;
 const mem=isList?inventoryPlaces.get(inventoryKey(page)):state.memory[page];
 if(inventoryChunks.length&&mem?.heights){
   const container=main.querySelector('.wm-window'),heights=new Map(mem.heights);
   inventoryChunks.forEach((c,i)=>{
     if(!mountedChunks.has(i)&&heights.has(c.rows[0].id)){
       c.height=heights.get(c.rows[0].id);
       container.children[i].style.height=c.height+'px';
     }
   });
   const anchor=inventoryChunks.findIndex(c=>c.rows.some(item=>item.id===mem.id));
   if(anchor>=0)mountChunk(anchor,container);
 }
 const rows=(returning||isList)?Array.from(main.querySelectorAll('[data-item]')):[];
 let last=null;
 if(mem&&(returning||isList)){
   if(mem.id)last=rows.find(el=>el.dataset.item===mem.id)||rows[Math.min(mem.index,rows.length-1)];
   if(!last&&mem.control?.brand)last=Array.from(main.querySelectorAll('[data-wm-brand]')).find(el=>el.dataset.wmBrand===mem.control.brand);
   if(!last&&mem.control?.selector)last=main.querySelector(mem.control.selector);
 }
 const tile=page==='home'&&mem?.id?main.querySelector('.wm-tile[data-nav="'+mem.id+'"]'):null;
 const brandLanding=isList&&options.brand?main.querySelector('[data-all-brands]'):null;
 (last||tile||brandLanding||main).focus({preventScroll:true});
 if((returning||tile||isList)&&mem){
   for(const saved of mem.containers)saved.node.scrollTop=saved.top;
   window.scrollTo(0,mem.top);
   if(inventoryChunks.length&&last?.dataset.item&&Number.isFinite(mem.itemTop))
     main.scrollTop+=last.getBoundingClientRect().top-main.getBoundingClientRect().top-mem.itemTop;
 }else if(standalone){main.scrollTop=0;window.scrollTo(0,0);}
 else if(main.scrollTop)main.scrollTop=0;
 else if(main.getBoundingClientRect().bottom<0)main.scrollIntoView({block:'start'});
 updateWindow();
}
function returnToList() {
 const parent=orderParent();
 if(parent){navigate(...parent);return;}
 if(!state.id)return;
 const page=state.page;
 if(standalone&&history.state?.mixoraFromList&&history.length>1) {
   history.back();return;
 }
 navigate(page);
}
function openItem(id) {
 const page=state.page;
 navigate(page,id);
 if(standalone)try{history.replaceState({mixoraFromList:true},'',location.href);}catch{}
}
function say(message) {live.textContent=message;}
function updateDetail(message,focusSelector) {
 state.message=message||'';render();
 (main.querySelector(focusSelector||'.wm-back')||main).focus({preventScroll:true});
}
root.addEventListener('input',event=>{
 const el=event.target;
 if(el.matches('[data-search]')){
   state.queries[state.page]=el.value;
   inventoryFocus.set(inventoryKey(state.page),{selector:'[data-search]'});
   if(standalone)try{history.replaceState(history.state,'',routeHash(state.page));}catch{}
   resetWindow();main.querySelector('[data-results]').innerHTML=itemList(state.page);updateWindow();
   main.querySelector('.wm-sub').textContent=inventorySummary(state.page);
   say('Найдено позиций: '+matchInventory(state.page).length);
 }
 if(el.closest('[data-manual],[data-order-contact],[data-stock-new]')&&el.setCustomValidity)el.setCustomValidity('');
});
root.addEventListener('change',event=>{
 const el=event.target;
 if(el.matches('[data-order-qty]')){
   const id=el.dataset.orderQty;
   if(!el.validity.valid){
     el.value=demoAPI.orderQuantity(id);
     let hint=main.querySelector('[data-qty-hint]');
     if(!hint){hint=document.createElement('p');hint.dataset.qtyHint='';hint.className='wm-notice';hint.setAttribute('role','status');el.closest('.wm-line,.om-card').after(hint);}
     hint.textContent='Введите целое количество от 0 до 99.';return;
   }
   main.querySelector('[data-qty-hint]')?.remove();
   const quantity=Number(el.value);
   setOrderQuantity(id,quantity);
   if(!quantity){render();(main.querySelector('[data-order-qty]')||main.querySelector('[data-order-to^="manual"]'))?.focus({preventScroll:true});}
   else{
     const summary=main.querySelector('.wm-heading .wm-sub');
     if(summary)summary.textContent='К закупке · '+orderTotal(orderRows())+' шт.';
     const scope=main.querySelector('[data-order-scope]');
     if(scope)scope.textContent=scopeDescription(orderScope());
     el.parentElement.querySelector('[data-step="1"]').disabled=quantity>=99;
   }
   return;
 }
 if(el.matches('[data-stock-new] select[name="brand"]')){
   const form=el.form;form.elements.namedItem('name').setCustomValidity('');
   const label=form.querySelector('[data-new-brand]'),field=form.elements.newBrand;
   label.hidden=!!el.value;field.disabled=!!el.value;field.required=!el.value;if(!el.value)field.focus();
   form.querySelector('datalist').innerHTML=stockSuggestions(el.value);
 }
});
root.addEventListener('click',event=>{
 const button=event.target.closest('button');
 if(!button||!root.contains(button)||button.closest('[data-ai-host]'))return;
 if(button.hasAttribute('data-theme-toggle')){
   const theme=root.dataset.theme==='dark'?'light':'dark';
   setTheme(theme);
   if(window.parent!==window)window.parent.postMessage({type:'mixora-theme-save',theme},'*');
   else try{localStorage.setItem('mixora-demo-theme',theme);}catch{}
   return;
 }
 if(button.hasAttribute('data-undo')){undoEntry(Number(button.dataset.undo));return;}
 if(handleOrderClick(button))return;
 if(button.hasAttribute('data-chat-back')){navigate(chatOrigin);return;}
 if(button.hasAttribute('data-dock')) {navigate(button.dataset.dock);return;}
 if(button.hasAttribute('data-nav')) {navigate(button.dataset.nav);return;}
 if(button.hasAttribute('data-wm-brand')){navigate(state.page,'',{brand:button.dataset.wmBrand,query:''});return;}
 if(button.hasAttribute('data-all-brands')){navigate(state.page,'',{brand:'',query:''});return;}
 if(button.hasAttribute('data-return')) {returnToList();return;}
 if(button.hasAttribute('data-item')) {openItem(button.dataset.item);return;}
 const act=button.dataset.act;
 if(act==='stock-new'&&state.page==='stock'){openItem('new');return;}
 const x=get(state.id);
 if(act==='cancel'){const previous=state.phase;state.phase='';updateDetail('','[data-act="'+previous+'"]');return;}
 if(x&&['move','take','refill','del','retire'].includes(act)){
   if(x.retired)return;
   if(['move','take','del'].includes(act)&&x.qty<1){updateDetail('На складе нет банок этого аромата.','[data-act="'+act+'"]');return;}
   if(act==='retire'&&archiveReason(x)){updateDetail(archiveReason(x),'[data-act="retire"]');return;}
   state.phase=act;updateDetail('',['del','retire'].includes(act)?'[data-act="cancel"]':'[data-amount]');return;
 }
 if(x&&act==='confirm-del'&&state.page==='stock'&&state.phase==='del'&&x.qty>0){
   const previous=x.qty;x.qty=0;state.phase='';log(x.name,'Удалено со склада · '+previous+' шт.');say(x.name+' · позиция удалена со склада.');returnToList();return;
 }
 if(x&&act==='confirm-retire'&&state.page==='slow'&&state.phase==='retire'){
   const reason=archiveReason(x);
   if(reason){state.phase='';updateDetail(reason,'[data-act="retire"]');return;}
   x.retired=true;x.stop=false;x.slow=false;state.phase='';log(x.name,'Выведен из ассортимента');say(x.name+' · аромат выведен.');returnToList();return;
 }
 if(act==='restore'&&x?.retired){
   x.retired=false;log(x.name,'Возвращён в ассортимент');updateDetail('Аромат возвращён в ассортимент.','[data-act="refill"]');return;
 }
 if(act==='order-one'&&x){
   const success=demoAPI.addToOrder(x.id,1);
   updateDetail(success?'Добавлена 1 шт. в заказ.':'В заказе уже 99 шт.','[data-act="order-one"]');return;
 }
 if(x&&!x.retired&&['stop','unstop','slow','unslow'].includes(act)){
   const key=act.endsWith('stop')?'stop':'slow',value=!act.startsWith('un');
   if(x[key]===value)return;
   const label={stop:'Добавлено в стоп-лист',unstop:'Возвращено из стоп-листа',slow:'Добавлено в неликвид',unslow:'Снята отметка неликвида'}[act];
   x[key]=value;log(x.name,label);say(label);
   if(state.page==='bar'){button.dataset.act=(value?'un':'')+key;button.setAttribute('aria-pressed',String(value));return;}
   if(!value&&state.page===key)returnToList();
   else updateDetail(label+'.','[data-act="'+(value?'un'+key:key)+'"]');
   return;
 }
 if(button.dataset.add) {
   const id=button.dataset.add;
   if(demoAPI.addToOrder(id,1)){
     state.message=get(id).name+' · добавлена 1 шт.';render();
     (Array.from(main.querySelectorAll('[data-id]')).find(node=>node.dataset.id===id)||main).focus({preventScroll:true});
   }return;
 }
 if(button.dataset.step) {
   const id=button.dataset.id,delta=Number(button.dataset.step);
   setOrderQuantity(id,demoAPI.orderQuantity(id)+delta);render();
   const target=Array.from(main.querySelectorAll('[data-step]:not(:disabled)')).find(node=>node.dataset.step===String(delta)&&node.dataset.id===id)||Array.from(main.querySelectorAll('[data-order-qty]')).find(node=>node.dataset.orderQty===id)||main.querySelector('[data-order-to^="manual"]');
   target?.focus({preventScroll:true});
 }
});
root.addEventListener('submit',event=>{
 const form=event.target;
 if(form.matches('[data-stock-new]')&&state.page==='stock'&&state.id==='new'){
   event.preventDefault();
   const raw=(form.elements.brand.value||form.elements.newBrand.value).trim();
   const brand=items.find(x=>norm(x.brand)===norm(raw))?.brand||raw;
   form.elements.newBrand.setCustomValidity(brand?'':'Введите название бренда.');
   const input=form.elements.namedItem('name'),name=input.value.trim();
   const quantity=Number(form.elements.namedItem('quantity').value);
   const supplier=suppliers.find(s=>s.brands.includes(brand));
   input.setCustomValidity(name?'':'Введите название аромата.');
   if(!form.reportValidity()||!brand||!Number.isInteger(quantity)||quantity<1||quantity>999)return;
   let x=items.find(i=>norm(i.name)===norm(name)&&i.brand===brand);
   if(x?.retired){input.setCustomValidity('Сначала верните этот аромат из архива через поиск на складе.');input.reportValidity();return;}
   if(!x){
     x={id:'stock-'+(++sequence),name,brand,qty:0,onBar:false,stop:false,slow:false,supplier:supplier?.name||'Не указан'};
     items.push(x);items.sort((a,b)=>a.name.localeCompare(b.name,'ru'));
   }
   x.qty+=quantity;log(x.name,'Приход на склад · '+quantity+' шт.');
   navigate('stock','',{brand:x.brand,query:'',message:x.name+' · на складе '+x.qty+' шт.'});return;
 }
 if(form.matches('[data-order-contact]')){event.preventDefault();saveContactForm(form);return;}
 if(form.matches('[data-transfer]')){
   event.preventDefault();
   if(!form.reportValidity())return;
   const x=get(state.id),quantity=Number(form.elements.quantity.value),phase=state.phase;
   if(!x||x.retired||!Number.isInteger(quantity)||quantity<1)return;
   if(phase==='refill'&&state.page==='stock'&&quantity<=999){
     x.qty+=quantity;log(x.name,'Пополнение склада · '+quantity+' шт.');state.phase='';updateDetail('Добавлено на склад · '+quantity+' шт.','[data-act="refill"]');return;
   }
   if(['move','take'].includes(phase)&&demoAPI.transferToBar(x.id,quantity)){
     state.phase='';updateDetail((phase==='take'?'Взято со склада':'Перенесено на стойку')+' · '+quantity+' шт.','[data-act="'+phase+'"]');return;
   }
   updateDetail('Проверьте доступный остаток.','[data-amount]');return;
 }
 if(!form.matches('[data-manual]'))return;
 event.preventDefault();
 const flavor=form.elements.namedItem('name'),brand=form.elements.namedItem('brand').value.trim();
 const name=flavor.value.trim(),quantityInput=form.elements.namedItem('quantity'),quantity=Number(quantityInput.value);
 flavor.setCustomValidity(name?'':'Введите название вкуса.');
 if(!form.reportValidity())return;
 const same=x=>norm(x.name)===norm(name)&&norm(x.brand)===norm(brand);
 const x=items.find(item=>!item.retired&&same(item)),manual=Array.from(manualRows.values()).find(same);
 const prev=x?demoAPI.orderQuantity(x.id):(manual?.qty||0);
 if(prev+quantity>99){
   quantityInput.setCustomValidity('В заказе может быть до 99 шт. одной позиции.');quantityInput.reportValidity();return;
 }
 if(x)demoAPI.addToOrder(x.id,quantity);
 else {
   if(manual)manual.qty+=quantity;
   else {const id='manual'+(++sequence),supplier=items.find(item=>norm(item.brand)===norm(brand))?.supplier;manualRows.set(id,{id,name,brand,qty:quantity,supplier});}
   log(name,'Добавлено в заказ вручную · '+quantity+' шт.');
 }
 navigate('order',state.id==='manual-build'?'build':'',{message:name+' · добавлено в заказ: '+quantity+' шт.'});
});
function setTheme(theme){
 root.dataset.theme=theme==='dark'?'dark':'light';
 document.documentElement.dataset.theme=root.dataset.theme;
 const toggle=root.querySelector('[data-theme-toggle]');
 if(toggle)toggle.setAttribute('aria-pressed',String(root.dataset.theme==='dark'));
}
try{setTheme(localStorage.getItem('mixora-demo-theme'));}catch{setTheme('light');}
let hostedHeight=0, expandedHeight=0;
function editing(){return document.activeElement?.matches('textarea, input:not([type=checkbox]):not([type=radio]):not([type=file]),select');}
window.addEventListener('message',event=>{
 if(window===window.parent || event.source!==window.parent)return;
 const payload=event.data;
 if(payload?.type==='mixora-theme-load')setTheme(payload.theme);
 if(payload?.type==='mixora-viewport' && Number.isFinite(payload.height)){
   hostedHeight=payload.height;expandedHeight=payload.expanded||0;scheduleFit();
 }
});
function settleViewport(){
 scheduleFit();
 if(window!==window.parent)window.parent.postMessage({type:'mixora-input-focus',editing:!!editing()},'*');
}
root.addEventListener('focusin',settleViewport);
root.addEventListener('focusout',()=>setTimeout(settleViewport,0));
if(window!==window.parent)window.parent.postMessage({type:'mixora-ui-ready'},'*');
// Keep the chat composer and dock inside the visible portion of the preview.
function fitWorkspace() {
  const viewport=window.visualViewport;
  const top=root.getBoundingClientRect().top;
  let bottom=viewport ? viewport.offsetTop+viewport.height : window.innerHeight;
  for(let parent=root.parentElement;parent && parent!==document.body;parent=parent.parentElement) {
    const clipping=getComputedStyle(parent).overflowY;
    if(/auto|scroll|hidden|clip|overlay/.test(clipping) && parent.clientHeight) {
      const rect=parent.getBoundingClientRect();
      bottom=Math.min(bottom,rect.top+parent.clientTop+parent.clientHeight);
    }
  }
  const room=Math.floor(Math.min(hostedHeight||Infinity,bottom-Math.max(0,top)));
  if(room<=0)return;
  root.style.setProperty('--wm-room',Math.max(120,room)+'px');
  if(!editing()&&!hostedHeight)expandedHeight=room;
  root.toggleAttribute('data-keyboard',!!editing()&&expandedHeight-room>110);
  const field=document.activeElement;
  if(editing()&&main.contains(field)&&!field.matches('[data-search]')&&state.page!=='ai'){
   const r=field.getBoundingClientRect(), m=main.getBoundingClientRect();
   const actions=field.closest('[data-transfer]')?.querySelector('.wm-controls')?.getBoundingClientRect();
   const bottom=actions&&actions.bottom-r.top<=m.height-24?actions.bottom:r.bottom;
   if(bottom>m.bottom-14)main.scrollTop+=bottom-m.bottom+14;
   else if(r.top<m.top+8)main.scrollTop+=r.top-m.top-8;
  }
}
let frame=0;
function scheduleFit(){
  if(frame)return;
  frame=requestAnimationFrame(()=>{frame=0;fitWorkspace();});
}
window.addEventListener('resize',scheduleFit);
window.addEventListener('scroll',scheduleFit,{passive:true,capture:true});
window.visualViewport?.addEventListener('resize',scheduleFit);
window.visualViewport?.addEventListener('scroll',scheduleFit);
if(typeof ResizeObserver!=='undefined') {
  const clipObserver=new ResizeObserver(scheduleFit);
  for(let parent=root.parentElement;parent && parent!==document.body;parent=parent.parentElement)
    if(/auto|scroll|hidden|clip|overlay/.test(getComputedStyle(parent).overflowY))clipObserver.observe(parent);
}
if(standalone) {
 window.addEventListener('popstate',()=>{
   const r=loc();navigate(r?.[1]||'home',r?.[2]||'',{fromHistory:true,...readBrandRoute(r)});
 });
 const r=loc();if(r&&validRoute(r[1],r[2]||'')){state.page=r[1];state.id=r[2]||'';const initial=readBrandRoute(r);if(Object.hasOwn(initial,'brand')){state.brands[r[1]]=initial.brand;state.queries[r[1]]=initial.query;}}
}
render();
if(integration){
 window.MixoraInterface={
   selection:()=>({id:state.id,phase:state.phase}),
   route:()=>({page:state.page,id:state.id,phase:state.phase}),
   navigate,
   status:message=>{state.message=message;render();},
   applySnapshot(snapshot,message=''){
     if(!Array.isArray(snapshot.inventory)||!Array.isArray(snapshot.orders)||!Array.isArray(snapshot.journal))
       throw Error('Не удалось прочитать данные приложения.');
     if(!state.id)remember();
     items.splice(0,items.length,...snapshot.inventory.map(item=>({...item,id:String(item.id)})));
     basket.clear();manualRows.clear();
     for(const entry of snapshot.orders){
       const id=String(entry.id);
       if(entry.catalogLinked===false||entry.manualKey)manualRows.set(id,{...entry,id});
       else basket.set(id,entry.qty);
     }
     if(Array.isArray(snapshot.suppliers)){
       suppliers.splice(0,suppliers.length,...snapshot.suppliers.map(s=>({...s,id:String(s.id),brands:[...(s.brands||[])]})));
       orderContacts.clear();
       for(const s of suppliers){
         const value=(s.contact||'').trim(),contacts={};
         if(/^@?[a-zA-Z][\w]{4,31}$/.test(value)||/^https:\/\/(?:t\.me|telegram\.me)\//.test(value))contacts.telegram=value;
         else if(/^https:\/\/(?:wa\.me|api\.whatsapp\.com)\//.test(value))contacts.whatsapp=value;
         else if(/^https:\/\/max\.ru\//.test(value))contacts.max=value;
         else if(/^\+?[\d\s()-]{7,25}$/.test(value))contacts.phone=value;
         orderContacts.set(s.id,contacts);
       }
       if(recipientId&&!supplierById(recipientId))recipientId='';
     }
     journalStatus=snapshot.journalReadState||"ready";
     journal.splice(0,journal.length,...snapshot.journal.map(entry=>({
       ...entry,time:new Date(entry.time||entry.at||NaN).getTime(),
       title:entry.title||get(entry.item)?.name||'Операция',desc:entry.desc||[entry.kind,entry.qty?' · '+entry.qty+' шт.':''].join(''),
       changes:[],undone:!!entry.undone
     })));
     lastJournalState=journalSnapshot();
     if(connected&&(state.page==='ai'||Object.hasOwn(nativeRoutes,state.page)))return;
     state.phase='';
     if(state.id&&!validRoute(state.page,state.id))state.id='';
     navigate(state.page,state.id,{fromHistory:true,message});
   }
 };
 window.dispatchEvent(new Event('mixora-interface-ready'));
}
})();