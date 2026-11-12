// UI orchestration only. All reads and mutations use the original runtime.
(()=>{
 'use strict';
 const root=document.getElementById('mixora-work-menu'),ui=window.MixoraInterface,business=window.MixoraBusiness;
 const panel=document.getElementById('mixora-connected-status');
 if(!root||!ui||!business){panel.textContent='Не удалось подключить интерфейс.';return;}
 const venueLabel=root.querySelector('.wm-venue');
 const panelText=document.createElement('span'),retry=document.createElement('button');
 retry.type='button';retry.className='btn';retry.textContent='Повторить подключение';retry.hidden=true;panel.replaceChildren(panelText,retry);
 let busy=false,proposal=null,pendingStock=false,signature='',queued=null,started=false,connecting=false,orderDraft=null,latestSnapshot=null,orderBlocked=false;
 const expected=new Map();
 let draftScope=null;
 function ensureOrderScope(){
  const next=business.scope();
  if(next!==draftScope){orderDraft=null;expected.clear();draftScope=next;}
 }
 function forgetOrderDraft(){orderDraft=null;expected.clear();}
 function rememberOrderField(id){
  ensureOrderScope();
  if(expected.has(id))return;
  const current=latestSnapshot?.orders.find(row=>String(row.id)===id),manual=!!current?.manualKey;
  const before=business.orderField(id,manual);
  // The quantity shown in the list is the user's comparison point, including a stale visible row.
  const visible=current?(manual?{...before,q:current.qty}:current.qty):null;
  expected.set(id,{manual,before:visible});
 }
 const dialog=document.createElement('dialog');dialog.id='mixora-operation-dialog';
 const title=document.createElement('h2');title.textContent='Проверьте операцию';
 const summary=document.createElement('p'),error=document.createElement('p');error.setAttribute('role','alert');
 const controls=document.createElement('div');controls.className='dlg-btns';
 const button=label=>{const node=document.createElement('button');node.type='button';node.className='btn';node.textContent=label;return node;};
 const confirm=button('Подтвердить'),cancel=button('Отмена');controls.append(confirm,cancel);dialog.append(title,summary,error,controls);document.body.append(dialog);
 function message(value){panelText.textContent=value;panel.hidden=!value&&retry.hidden;}
 function editing(){return dialog.open||document.getElementById('dlg')?.open||!!root.querySelector('[data-transfer]')||root.contains(document.activeElement)&&document.activeElement.matches('input,textarea,select');}
 // Photo proposals and the visible order menu use the same unapplied row edits.
 ui.orderDraftQuantity=id=>{ensureOrderScope();return orderDraft?.[id]};
 ui.openOrderDraft=()=>{
  show(business.snapshot(),'',true);
  ui.navigate('order');
 };
 ui.acceptPhotoOrder=rows=>{
  for(const row of rows){
   if(orderDraft && orderDraft[row.id]===row.beforeDraft){delete orderDraft[row.id];expected.delete(row.id);}
  }
  if(orderDraft && Object.keys(orderDraft).length===0)orderDraft=null;
  poll();
 };
 function renderOrderDraft(snapshot){
  ensureOrderScope();latestSnapshot=snapshot;orderBlocked=!!snapshot.orderPending;if(!orderDraft)return snapshot;
  const next=JSON.parse(JSON.stringify(snapshot)),byId=new Map(next.orders.map(row=>[String(row.id),row]));
  for(const [id,quantity] of Object.entries(orderDraft)){
   if(quantity<=0){byId.delete(id);continue;}
   const row=byId.get(id)||next.inventory.find(item=>String(item.id)===id);
   if(row)byId.set(id,{...row,id,qty:quantity});
  }
  next.orders=[...byId.values()];return next;
 }
 function show(snapshot,text='',force=false){
  pendingStock=!!snapshot.pendingStock;
  if(!force&&editing()){queued=snapshot;return;}
  queued=null;
  snapshot=renderOrderDraft(snapshot);const next=JSON.stringify(snapshot);
  if(next!==signature||force){signature=next;ui.applySnapshot(snapshot,text);}
  root.hidden=false;root.inert=false;root.style.removeProperty('display');started=true;
  message(pendingStock?'Восстановите результат предыдущей операции перед новым действием.':snapshot.journalPending?'Операция подтверждена, журнал обновляется.':'');
 }
 async function connect(){
  if(connecting)return;connecting=true;retry.hidden=true;message('Подключаем каталог и остатки…');
  try{show(await business.ready(),'',true);Promise.resolve(business.venueName()).then(name=>{if(name)venueLabel.textContent=name}).catch(()=>{});}catch(e){retry.hidden=false;message(e.message+' После входа или восстановления связи нажмите «Повторить подключение».');}
  finally{connecting=false;}
 }
 retry.onclick=connect;
 function close(){if(busy)return;if(proposal)business.cancel(proposal.id);proposal=null;dialog.close();poll();}
 cancel.onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 confirm.onclick=async()=>{
  if(busy||!proposal)return;busy=true;confirm.disabled=cancel.disabled=true;error.textContent='Сохраняем…';
  try{const orderBatch=proposal.kind==='order-batch',saved=await business.confirm(proposal.id);proposal=null;if(orderBatch)forgetOrderDraft();dialog.close();show(saved,'Операция подтверждена сервером.',true);}
  catch(e){error.textContent='Сохранение не подтверждено. '+e.message;confirm.hidden=true;proposal=null;try{show(business.snapshot(),error.textContent,true);}catch(_){}poll();}
  finally{busy=false;confirm.disabled=cancel.disabled=false;}
 };
 async function prepare(intent,trigger){
  if(busy||pendingStock){message(pendingStock?'Сначала восстановите предыдущую операцию.':'Дождитесь завершения операции.');return;}
  busy=true;if(trigger)trigger.disabled=true;
  try{proposal=await business.propose({...intent,source:'ui'});summary.textContent=proposal.summary;error.textContent='';confirm.hidden=false;dialog.showModal();cancel.focus();}
  catch(e){message('Операция не подготовлена. '+e.message);}
  finally{busy=false;if(trigger)trigger.disabled=false;}
 }
 function native(kind,id){if(busy)return;try{business.native(kind,id);}catch(e){message(e.message);}}
 const stop=event=>{event.preventDefault();event.stopImmediatePropagation();};
 function orderRows(){return renderOrderDraft(latestSnapshot||business.snapshot()).orders;}
 function editOrderDraft(id,quantity){
  if(orderBlocked){message('Сначала установите результат предыдущего сохранения заказа. Новые правки не отправлены.');return;}
  if(!Number.isSafeInteger(quantity)||quantity<0||quantity>99){message('Введите целое количество от 0 до 99.');return;}
  rememberOrderField(id);
  if(!orderDraft)orderDraft={};
  orderDraft[id]=quantity;show(latestSnapshot||business.snapshot(),'Правки заказа сохранены в черновике.',true);
 }
 function applyOrderDraft(trigger){
  if(orderBlocked){message('Сначала установите результат предыдущего сохранения заказа. Повтор новой операции не выполнен.');return;}
  if(!orderDraft||!Object.keys(orderDraft).length){message('В заказе нет несохранённых изменений.');return;}
  const edits=Object.entries(orderDraft).map(([id,quantity])=>({id,quantity,...expected.get(id)}));
  prepare({kind:'order-batch',edits},trigger);
 }
 root.addEventListener('click',event=>{
  if(event.target.closest('#chat,[data-native-host]'))return;
  const target=event.target.closest('button,a');if(!target)return;
  const act=target.dataset.act,id=ui.selection().id;
  if(act==='stock-new'){stop(event);native('new');return;}
  if(target.matches('[data-order-to^=manual]')){stop(event);native('manual');return;}
  if(target.hasAttribute('data-native-supplier')){stop(event);native('supplier',target.dataset.nativeSupplier);return;}
  if(['del','retire','restore','confirm-del','confirm-retire'].includes(act)){stop(event);native(act.includes('del')?'delete':act==='restore'?'restore':'retire',id);return;}
  if(['stop','unstop','slow','unslow'].includes(act)){stop(event);prepare({kind:'flag',id,flag:act.endsWith('stop')?'stop':'slow',on:!act.startsWith('un')},target);return;}
  if(target.hasAttribute('data-integration-undo')){stop(event);prepare({kind:'undo',id:target.dataset.integrationUndo},target);return;}
  if(target.hasAttribute('data-order-apply')){stop(event);applyOrderDraft(target);return;}
  if(target.hasAttribute('data-order-discard')){stop(event);if(orderBlocked){message('Сначала установите результат предыдущего сохранения заказа. Черновик сохранён.');return;}forgetOrderDraft();show(latestSnapshot||business.snapshot(),'Несохранённые правки отменены.',true);return;}
  if(target.hasAttribute('data-order-clear')){stop(event);if(orderBlocked){message('Сначала установите результат предыдущего сохранения заказа. Очистка не отправлена.');return;}const rows=(latestSnapshot||business.snapshot()).orders;forgetOrderDraft();for(const row of rows)rememberOrderField(String(row.id));orderDraft=Object.fromEntries(rows.map(row=>[String(row.id),0]));show(latestSnapshot||business.snapshot(),'Заказ очищен в черновике. Примените изменения, чтобы сохранить.',true);return;}
  if(target.matches('[data-act=order-one],[data-add],[data-step]')){
   stop(event);const key=target.dataset.add||target.dataset.id||id;
   try{const qty=orderRows().find(x=>String(x.id)===key)?.qty||0;editOrderDraft(key,qty+Number(target.dataset.step||1));}catch(e){message(e.message);}return;
  }
 },true);
 root.addEventListener('submit',event=>{
  if(event.target.closest('#chat,[data-native-host]'))return;
  const form=event.target;stop(event);
  if(!form.matches('[data-transfer]')){message('Откройте штатную форму добавления позиции.');return;}
  if(!form.reportValidity())return;
  const {id,phase}=ui.selection(),quantity=Number(form.elements.quantity.value);
  prepare({kind:phase==='refill'?'refill':'transfer',id,quantity},form.querySelector('[type=submit]'));
 },true);
 root.addEventListener('change',event=>{
  const field=event.target;if(field.closest('#chat,[data-native-host]')||!field.matches('[data-order-qty]'))return;event.stopImmediatePropagation();
  const id=field.dataset.orderQty,quantity=Number(field.value);
  try{const current=orderRows().find(x=>String(x.id)===id)?.qty||0;
   if(Number.isSafeInteger(quantity)&&quantity>=0&&quantity<=99){if(quantity!==current)editOrderDraft(id,quantity);}else{field.value=String(current);message('Введите целое количество от 0 до 99.');}
  }catch(e){message(e.message);}
 },true);
 let syncingNative=false;
 const tabs={mixes:'mixes',chk:'chk',know:'know',inv:'inv',pack:'pack',str:'str',wish:'wish',team:'team',home:'home',stock:'wh',bar:'bar',off:'bar',stop:'stop',slow:'slow',order:'order',sup:'sup',journal:'log',more:'home',ai:'ai'};
 function route(){const page=ui.route().page,tab=tabs[page];document.body.dataset.mixoraPage=page;if(tab&&st.tab!==tab){syncingNative=true;try{go(tab)}finally{syncingNative=false}}const theme=root.dataset.theme;if(theme)document.documentElement.dataset.theme=theme;}
 ui.forwardNative=tab=>{
  if(syncingNative)return false;
  const page=({wh:'stock',log:'journal',off:'off'})[tab]||tab;
  if(!Object.hasOwn(tabs,page)||page===ui.route().page)return false;
  ui.navigate(page);return true;
 };
 window.addEventListener('mixora-interface-after-render',route);
 let scheduled=false;
 function poll(){
  if(!started){if(!connecting&&business.online())connect();return;}
  if(scheduled)return;scheduled=true;
  requestAnimationFrame(()=>{scheduled=false;try{show(business.snapshot());}catch(e){message(e.message);}});
 }
 new MutationObserver(poll).observe(document.getElementById('mixora-legacy-root'),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden']});
 for(const id of ['status','stock-recovery','order-save-problem','dlg'])new MutationObserver(poll).observe(document.getElementById(id),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden']});
 root.addEventListener('focusout',()=>requestAnimationFrame(()=>{if(queued&&!editing())show(queued);}));
 window.addEventListener('mixora-interface-after-render',()=>{if(queued&&!editing())show(queued);});
 connect();
})();
