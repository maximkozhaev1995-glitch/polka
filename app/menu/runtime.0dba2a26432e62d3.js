// Classic adapter: shares the original lexical runtime, never a second database client.
(()=>{
 'use strict';
 if(window.MIXORA_CONNECTED_UI!==true||window.POLKA_CONFIG?.url!=='https://wwcgvwfmlkegaqkksujo.supabase.co')throw Error('Рабочая база Mixora не подключена.');
 const copy=value=>JSON.parse(JSON.stringify(value));
 const fail=message=>{throw Error(message);};
 const status=()=>document.querySelector('#status')?.textContent||'';
 function dataReady(){
  if(!staffReady||!db||!(db.actionScope?.()||db.stockScope?.()))fail('Войдите в Mixora через Telegram.');
  aiEnsureDataReady();
  return {source:'production',ready:true};
 }
 const compensation=move=>String(move.reason||'').match(/^Отмена операции\s+([0-9a-f-]{36})/i)?.[1];
 let pending=null,working=null;const journalTargets=new Set();
 function snapshot(){
  const data=dataReady(),undone=new Set(moves.map(compensation).filter(Boolean));
  return {
   data,
   inventory:DATA.map(item=>{const value=aiItem(item);return{id:String(item.id),brand:value.brand,name:value.name,line:value.line||'',description:value.desc||'',qty:value.wh,onBar:value.onBar,stop:value.stop,slow:value.slow,stockKnown:value.stockKnown!==false,retired:flag(item,'retired'),revision:stock[item.id]?.revision??null,supplier:supOf(item.b)?.name||'Не указан'};}),
   orders:orderRows().map(row=>row.x?{id:String(row.x.id),qty:row.q,brand:row.b,name:row.n,line:row.l,catalogLinked:true}:{id:String(row.mk),manualKey:String(row.mk),qty:row.q,brand:row.b,name:row.n,catalogLinked:false,source:'manual'}),
   suppliers:sups.map(s=>({id:String(s.id),name:s.name||'',contact:s.contact||'',brands:[...(s.brands||[])],ctype:s.ctype||'kalyan'})),
   journalReadState,
   journal:moves.filter(move=>!compensation(move)).map(move=>({...copy(move),title:byId[move.item]?nm(byId[move.item]):String(move.item),desc:actText(move),operationId:move.operationId,canUndo:canUndoMove(move)&&!undone.has(move.operationId),undone:undone.has(move.operationId)})),
   pendingStock:!!db.hasPendingStock?.(),orderPending:typeof oDirty!=='undefined'&&!!oDirty,orderProblem:!document.querySelector('#order-save-problem')?.hidden,
   journalPending:[...journalTargets].some(id=>!moves.some(move=>move.item===id&&move.revision===stock[id]?.revision)),status:status()
  };
 }
 async function ready(){
  const until=Date.now()+15000;
  while(true){try{return snapshot();}catch(error){if(Date.now()>until)throw error;await new Promise(resolve=>setTimeout(resolve,30));}}
 }
 function guard(){dataReady();if(busy||working)fail('Дождитесь завершения операции.');if(db.hasPendingStock?.())fail('Сначала восстановите результат предыдущей операции.');}
 async function journalSettled(ids){
  const until=Date.now()+8000;
  while(!ids.every(id=>moves.some(move=>move.item===id&&move.revision===stock[id]?.revision))){if(Date.now()>until)return false;await new Promise(resolve=>setTimeout(resolve,30));}
  return true;
 }
 async function propose(intent){
  await ready();guard();cancelAiProposals();pending=null;
  const {kind,id,quantity,source}=intent;
  if(source!=='ui')fail('Требуется действие пользователя.');
  if(!['transfer','refill','order','manual-order','order-batch','flag','undo'].includes(kind))fail('Неизвестная операция.');
  if(kind==='order-batch'){
   if(!Array.isArray(intent.edits)||!intent.edits.length)fail('Проверьте правки заказа.');
   const before=orderSnapshot(),desired=copy(before),seen=new Set();
   for(const edit of intent.edits){
     const id=String(edit.id||''),qty=edit.quantity,map=edit.manual?'m':'q';
     if(!id||seen.has(id)||!Number.isInteger(qty)||qty<0||qty>99)fail('Проверьте количество в заказе.');
     seen.add(id);
     const old=orderValue(before,map,id);
     if(orderJSON(old)!==orderJSON(edit.before))fail('Позиция изменилась после начала редактирования. Сверьте текущий заказ и начните правку заново.');
     if(edit.manual?!old:!byId[id])fail('Позиция больше не найдена.');
     if(!qty)delete desired[map][id];else desired[map][id]=edit.manual?{...old,q:qty}:qty;
   }
   const scope=copy(orderScope||db.orderScope()),actionScope=db.actionScope?.()||db.stockScope?.();
   const names=intent.edits.map(edit=>{const name=edit.manual?before.m[edit.id]?.n:nm(byId[edit.id]);return name+' — '+edit.quantity+' шт.'});
   pending={id:crypto.randomUUID(),intent:copy(intent),target:null,proposal:{list:[],draft:{},ask:true},before,orderScope:scope,actionScope,desired,
     summary:'Изменения заказа: '+names.join(', ')};
   return{id:pending.id,kind,summary:pending.summary,items:intent.edits,source};
  }
  if(['transfer','refill','order','manual-order'].includes(kind)&&(!Number.isSafeInteger(quantity)||quantity<(kind.endsWith('order')?0:1)||quantity>(kind.endsWith('order')?99:kind==='refill'?999:Number.MAX_SAFE_INTEGER)))fail('Проверьте количество.');
  const proposal={list:[],draft:{},ask:true};let target=id,move,result,before,name;
  if(kind==='manual-order'){
   if(!Object.hasOwn(orderM,id))fail('Ручная позиция больше не найдена.');
   before=copy(orderM[id]);name=[before.b,before.n].filter(Boolean).join(' ');
  }else{
   if(kind==='undo'){move=moves.find(value=>value.id===id);if(!move||!canUndoMove(move))fail('Отмена больше недоступна.');target=move.item;}
   const item=byId[target];if(!item)fail('Позиция отсутствует в текущем каталоге.');
   if(!aiStockKnown(item))fail('Остаток этой позиции не подтверждён.');
   const tools=aiProposalTools(proposal);
   if(kind==='transfer'||kind==='refill')result=tools.find(tool=>tool.name==='stage_stock').execute({id,delta:kind==='transfer'?-quantity:quantity,...(kind==='transfer'?{toBar:true}:{})});
   if(kind==='order')result=tools.find(tool=>tool.name==='set_order').execute({id,qty:quantity});
   if(kind==='flag')result=tools.find(tool=>tool.name==='set_flag').execute({id,flag:intent.flag,on:intent.on});
   before=copy(stock[target]??null);name=nm(item);
  }
  const labels={transfer:'Перенос на стойку',refill:'Пополнение',order:'Количество в заказе','manual-order':'Ручная позиция заказа',flag:intent.on?'Поставить отметку':'Снять отметку',undo:'Отменить действие'};
  pending={id:crypto.randomUUID(),intent:copy(intent),target,proposal,before,move,actionScope:db.actionScope?.()||db.stockScope?.(),summary:labels[kind]+' · '+name+(Number.isInteger(quantity)?' · '+quantity+' шт.':''),result};
  return{id:pending.id,summary:pending.summary,items:[{id:target,name,before:before?.wh??before?.q??null,quantity:quantity??null}],source};
 }
 async function apply(current){
  dataReady();const manual=current.intent.kind==='manual-order';
  if(current.intent.kind==='order-batch'){
   if(orderJSON(db.orderScope())!==orderJSON(current.orderScope)||orderJSON(orderScope)!==orderJSON(current.orderScope)||(db.actionScope?.()||db.stockScope?.())!==current.actionScope)fail('Сессия заказа изменилась. Подготовьте изменения заново.');
   if(orderJSON(orderSnapshot())!==orderJSON(current.before))fail('Заказ изменился после просмотра. Подготовьте изменения заново.');
   displayOrder(current.desired);const version=markOrderDirty();await flushOrder(version);
   for(const edit of current.intent.edits){
     const map=edit.manual?'m':'q';
     if(orderJSON(orderValue(orderBase,map,edit.id))!==orderJSON(orderValue(current.desired,map,edit.id)))fail('Сохранение заказа не подтверждено.');
   }
   return snapshot();
  }
  if((db.actionScope?.()||db.stockScope?.())!==current.actionScope)fail('Сессия изменилась. Проверьте операцию заново.');
  if(JSON.stringify((manual?orderM[current.target]:stock[current.target])??null)!==JSON.stringify(current.before))fail('Данные изменились после просмотра. Подготовьте операцию заново.');
  if(current.proposal.stock){
   if(Object.keys(draft).length)fail('Сначала завершите прежний черновик.');
   draft=copy(current.proposal.draft);Object.keys(draft).forEach(id=>cmdDraftIds.add(id));saveDraft();openReview();await commit();
   if(Object.keys(draft).length)fail(status()||'Сохранение склада не подтверждено.');
  }else if(current.intent.kind==='undo'){
   await undoMove(current.move.id);if(document.querySelector('#status')?.classList.contains('err'))fail(status());
  }else if(manual){
   renderManual();const input=[...document.querySelectorAll('#omanual input[data-m]')].find(node=>node.dataset.m===current.target);
   if(!input)fail('Не удалось открыть ручную позицию.');
   input.value=String(current.intent.quantity);input.dispatchEvent(new Event('change',{bubbles:true}));
   const version=orderVer;await flushOrder(version);
   const saved=orderBase.m[current.target],quantity=current.intent.quantity;
   if(quantity?saved?.q!==quantity:!!saved)fail('Сохранение ручной позиции не подтверждено.');
  }else await aiCommitProposal(current.proposal.list);
  if(!['order','manual-order'].includes(current.intent.kind)){journalTargets.add(current.target);await journalSettled([current.target]);}
  return snapshot();
 }
 function confirm(id){
  if(working)return working.id===id?working.promise:Promise.reject(Error('Дождитесь завершения операции.'));
  try{guard();if(!pending||pending.id!==id)fail('Предложение больше не доступно.');}catch(error){return Promise.reject(error);}
  const current=pending;pending=null;const promise=apply(current).finally(()=>{working=null;});working={id,promise};return promise;
 }
 function cancel(id){if(pending?.id===id)pending=null;}
 async function recover(){
  dataReady();if(working||busy)fail('Дождитесь завершения операции.');
  const handler=document.querySelector('#stock-recover')?.onclick;if(!handler)fail('Восстановление недоступно.');
  const saved=JSON.parse(localStorage.getItem('mixora-stock-pending:'+db.stockScope())||'null');
  const outcome=await handler();
  if(outcome?.status==='not-found')return{...snapshot(),recovery:'not-found'};
  if(outcome?.status!=='recovered'||!outcome.receipt||db.hasPendingStock())fail(outcome?.message||status()||'Результат не подтверждён.');
  if(saved){saved.body.p_items.forEach(item=>journalTargets.add(item.id));await journalSettled(saved.body.p_items.map(item=>item.id));}
  return{...snapshot(),recovery:'recovered'};
 }
 function native(kind,id){
  guard();
  if(kind==='new')return openNew();
  if(kind==='manual')return addManual();
  if(kind==='supplier'){const supplier=id?sups.find(item=>String(item.id)===id):null;if(id&&!supplier)fail('Контрагент больше не найден.');return editSup(supplier);}
  const item=byId[id];if(!item)fail('Позиция не найдена.');
  if(kind==='delete')return askDelPos(item);
  if(kind==='retire')return askRetire(item);
  if(kind==='restore')return unretire(item);
  fail('Эта форма недоступна.');
 }
 const parking=document.createElement('div');parking.id='mixora-chat-parking';parking.hidden=true;document.body.append(parking);
 const chat=document.getElementById('chat');if(chat)parking.append(chat);
 for(const id of ['dlg','dlg-scrim','stock-recovery','order-save-problem','status','hsh','hsh-scrim','toast','tray','otray']){const node=document.getElementById(id);if(node)document.body.append(node);}
 window.MixoraConnectedChat={park(){if(chat&&chat.parentElement!==parking)parking.append(chat);},mount(host){if(chat){host.append(chat);if(st.tab!=='ai')go('ai');}}};
 const legacy=document.getElementById('mixora-legacy-root'),nativeView=legacy.querySelector('.wrap');
 window.MixoraConnectedSections={
  park(){if(nativeView.parentElement!==legacy)legacy.prepend(nativeView)},
  mount(host,tab){host.append(nativeView);if(st.tab!==tab)go(tab)}
 };
 window.addEventListener('mixora-interface-before-render',()=>{window.MixoraConnectedChat.park();window.MixoraConnectedSections.park()});
 window.MixoraBusiness=Object.freeze({ready,snapshot,propose,confirm,cancel,recover,native,scope:()=>db?.actionScope?.()||db?.stockScope?.(),online:()=>!!staffReady&&!!stockLoaded&&!!orderLoaded&&!!db?.actionScope?.(),orderField:(id,manual)=>copy(orderValue(orderSnapshot(),manual?'m':'q',id)),venueName:()=>db?.venueName?.(),async refresh(){await ready();await journalSettled([...journalTargets]);return snapshot();}});
})();
