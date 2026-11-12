/* Staff-only reference sources, never inventory. Ported from the 2026-11-02 private
 * reference reader/search contracts. No persistence, canonical mapping or writes. */
(function(root){'use strict';
 const counts=Object.freeze({official:2459,thirdparty:304,flvr:708});
 const norm=s=>String(s??'').replace(/№/g,' ').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/ё/g,'е').replace(/[’'`]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const words=s=>norm(s).split(/\s+/).filter(Boolean).map(x=>/^\d+$/.test(x)?x.replace(/^0+(?=\d)/,''):x);
 const safeURL=s=>{try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null}catch{return null}};
 const required=s=>typeof s==='string'&&s.trim().length>0;
 const strings=a=>Array.isArray(a)?a.filter(x=>typeof x==='string'):[];
 const fields=(x,keys)=>Object.fromEntries(keys.map(k=>[k,x[k]==null?null:String(x[k])]));
 function record(x,kind){
  if(!x||typeof x!=='object'||Array.isArray(x))throw Error('reference_record_invalid');
  if(kind==='flvr'){
   if(![x.source_id,x.source_brand,x.source_name,x.snapshot_id].every(required)||x.source_kind!=='FLVR_reference')throw Error('reference_record_invalid');
   return {...fields(x,['source_kind','source_id','source_brand_id','source_brand','source_line_id','source_line','source_name','observed_at','snapshot_id','source_archival_status']),source_url:safeURL(x.source_url),field_statuses:Object.fromEntries(Object.entries(x.field_statuses||{}).filter(([,v])=>typeof v==='string'))};
  }
  if(![x.ref_id,x.name,x.brand,x.bucket,x.product_type].every(required))throw Error('reference_record_invalid');
  // Explicit whitelist: source IDs/unknown fields cannot become inventory IDs.
  return {...fields(x,['ref_id','reference_record_key','source_id_original','source_id_kind','brand','name','full_name','line','line_grade','product_type','type_grade','bucket','lifecycle','profile_note','profile_grade','profile_caveat','source_authority','review_date']),
   source_constraints:Object.fromEntries(Object.entries(x.source_constraints||{}).filter(([k,v])=>['notes','conflicts','join_caution','observed_line_labels','source_reported_line','source_independence','join_status','automatic_join_authorized','all_profile_details_two_source_confirmed'].includes(k)&&(v===null||typeof v==='string'||typeof v==='boolean'||Array.isArray(v)&&v.every(t=>typeof t==='string')))),
   pack_original:Array.isArray(x.pack_original)?strings(x.pack_original):typeof x.pack_original==='string'||typeof x.pack_original==='number'?x.pack_original:null,
   structural_code:typeof x.structural_code==='string'||typeof x.structural_code==='number'?x.structural_code:null,count_as_flavor_name:x.count_as_flavor_name===true,
   source_url:safeURL(x.source_url),source_urls:strings(x.source_urls).map(safeURL).filter(Boolean),verified_aliases:strings(x.verified_aliases),held_pair_ids:strings(x.held_pair_ids),
   field_grades:Object.fromEntries(Object.entries(x.field_grades||{}).filter(([k,v])=>['identity','name','line','profile','product_type','lifecycle'].includes(k)&&typeof v==='string'))};
 }
 function bounded(candidate){
  let shortened=false;
  const identity=new Set(['source_id','ref_id','source_id_original','reference_record_key','snapshot_id']);
  function copy(value,key){
   if(typeof value==='string'&&!identity.has(key)&&value.length>800){shortened=true;return Array.from(value).slice(0,800).join('')+'…'}
   if(Array.isArray(value)){if(value.length>30)shortened=true;return value.slice(0,30).map(x=>copy(x,key))}
   if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,copy(v,k)]));return value;
  }
  const result=copy(candidate);if(shortened)result.text_truncated=true;return result;
 }
 function create(options){
  function scope(){let value;try{value=options.scope()}catch{}if(!value)throw Error('reference_session_required');return value}
  async function search(kind,input={}){
   if(!Object.hasOwn(counts,kind))throw Error('reference_dataset_invalid');
   if(!input||typeof input!=='object'||typeof input.query!=='string'||input.query.length>512||input.brand!=null&&(typeof input.brand!=='string'||input.brand.length>160))throw Error('reference_query_invalid');
   const identity=scope(),same=()=>{if(scope()!==identity)throw Error('reference_scope_changed')};
   // No cache: each request reauthorizes and verifies a fresh complete response.
   const rows=await options.read(kind);same();
   if(!Array.isArray(rows)||!rows.length||rows.length>512)throw Error('reference_parts_invalid');
   const sorted=[...rows].sort((a,b)=>a.part-b.part),n=sorted.length,sha=sorted[0]?.sha256;
   if(!/^[0-9a-f]{64}$/.test(sha)||sorted.some((r,i)=>!r||r.dataset!==kind||r.part!==i||r.total_parts!==n||r.sha256!==sha||typeof r.content!=='string'||r.content.length>65536))throw Error('reference_parts_invalid');
   const text=sorted.map(r=>r.content).join(''),bytes=new TextEncoder().encode(text);
   if(bytes.length>16*1024*1024)throw Error('reference_size_invalid');
   const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');same();
   if(digest!==sha)throw Error('reference_digest_mismatch');
   let asset;try{asset=JSON.parse(text)}catch{throw Error('reference_payload_invalid')}
   if(!asset||asset.schema_version!==1||asset.record_count!==counts[kind]||!Array.isArray(asset.records)||asset.records.length!==counts[kind])throw Error('reference_count_mismatch');
   if(kind!=='flvr'&&(asset.provider!==(kind==='official'?'saved_brand_sources':'saved_thirdparty_sources')||asset.snapshot!=='coordinator-20261102-final'))throw Error('reference_snapshot_invalid');
   if(kind==='flvr'&&asset.coverage!=='accepted_partial_snapshot_not_complete_source_catalogue')throw Error('reference_snapshot_invalid');
   const records=asset.records.map(x=>record(x,kind));
   if(new Set(records.map(x=>kind==='flvr'?x.source_id:x.ref_id)).size!==records.length)throw Error('reference_identity_duplicate');
   const flvr=kind==='flvr',sourceKind=flvr?'FLVR_reference':kind+'_reference';
   const brandOf=x=>flvr?x.source_brand:x.brand,nameOf=x=>flvr?x.source_name:x.name;
   const query=norm(input.query).replace(/^tangiers(?=\d+(?:\s|$))/,'tangiers '),terms=words(query),brand=norm(input.brand),raw=Number(input.limit),limit=Number.isFinite(raw)?Math.max(1,Math.min(50,Math.floor(raw)||20)):20;
   const result={status:'not_found',source_kind:sourceKind,provider:asset.provider||null,snapshot:asset.snapshot||null,read_only:true,coverage:asset.coverage??null,snapshot_records:records.length,total:0,candidates:[],truncated:false,ambiguous:false,
    note:'Сохранённые справочные записи, не число ароматов и не склад. source_id/ref_id не являются складским ID или подтверждённым артикулом поставщика. Соответствия не подтверждены; неполная выборка не доказывает отсутствие вкуса. Дата проверки не является датой загрузки.'};
   const finish=()=>{same();if(new TextEncoder().encode(JSON.stringify(result)).length>16000)throw Error('reference_result_size_invalid');return result};
   if(brand&&!records.some(x=>norm(brandOf(x))===brand)){result.status='unknown_brand';return finish()}
   if(!terms.length){result.status='empty_query';return finish()}
   const matches=records.filter(x=>{
    const aliases=x.verified_aliases||[],nameWords=words([nameOf(x),...aliases].join(' ')),all=words([brandOf(x),nameOf(x),flvr?x.source_line:x.line,x.full_name,...aliases].join(' '));
    return (!brand||norm(brandOf(x))===brand)&&terms.every(t=>/^\d+$/.test(t)?nameWords.includes(t):all.some(w=>w.includes(t)));
   });
   const groups=new Map();for(const x of matches){const key=norm(brandOf(x))+'|'+norm(nameOf(x));groups.set(key,(groups.get(key)||0)+1)}
   result.total=matches.length;result.status=matches.length?'candidates':'not_found';result.truncated=matches.length>limit;result.ambiguous=[...groups.values()].some(n=>n>1);
   result.candidates=matches.slice(0,limit).map(x=>bounded({...x,source_kind:sourceKind,actionable:false,requires_catalogue_mapping:true,ambiguous:groups.get(norm(brandOf(x))+'|'+norm(nameOf(x)))>1}));
   while(result.candidates.length&&new TextEncoder().encode(JSON.stringify(result)).length>16000){result.candidates.pop();result.truncated=true}
   return finish();
  }
  return Object.freeze({search});
 }
 // Keep only source identifiers (not records) across turns to prevent coincidental
 // string equality from turning a reference into warehouse authority.
 let guardIdentity=null,sourceIds=new Set();
 function scopedIds(db){let scope;try{scope=db?.referenceScope?.()}catch{}
  if(!scope||scope!==guardIdentity){sourceIds.clear();guardIdentity=scope||null}return sourceIds;
 }
 function needsCatalogueLookup(id,db){return scopedIds(db).has(String(id))}
 function confirmCatalogueRows(rows,db){const ids=scopedIds(db);for(const x of rows||[])if(typeof x.id==='string')ids.delete(x.id)}
 function tools(getDb){
  if(root.POLKA_CONFIG?.referenceCatalogEnabled !== true)return [];
  return [['official','search_official_reference','2459 записей источников брендов'],['thirdparty','search_thirdparty_reference','304 сторонних записи, не подтверждены производителем'],['flvr','search_reference','708 карточек FLVR, неполная выборка']].map(([kind,name,label])=>({
   name,description:'Read-only поиск сохранённого справочника: '+label+'. Отдельно от рабочего каталога и остатков. query — название, бренд, линейка или номер в названии. Возвращает происхождение и оговорки источника. ref_id/source_id НЕ складской id и НЕ подтверждённый артикул поставщика; нельзя использовать в set_order/stage_stock/set_flag, выбирать SKU, объединять или менять линейку. Для заказа используй только точные id из find_items. При unavailable не утверждай отсутствие вкуса.',
   inputSchema:{type:'object',properties:{query:{type:'string'},brand:{type:'string'},limit:{type:'integer',minimum:1,maximum:50}},required:['query']},
   async execute(input){try{const db=getDb(),scope=db?.referenceScope?.();if(!scope)throw Error('reference_session_required');const result=await create({scope:()=>db?.referenceScope?.(),read:k=>db.referenceChunks(k)}).search(kind,input);if(db?.referenceScope?.()!==scope)throw Error('reference_scope_changed');const ids=scopedIds(db);for(const x of result.candidates)for(const key of ['ref_id','source_id','source_id_original','reference_record_key'])if(x[key]!=null)ids.add(String(x[key]));return result}catch{return {status:'unavailable',source_kind:kind+'_reference',read_only:true,total:null,candidates:[],note:'Справочник недоступен. Это не означает отсутствие вкуса. Рабочий каталог и заказ проверяются отдельно через find_items.'}}}
  }));
 }
 root.MixoraReadOnlyReferences=Object.freeze({create,tools,needsCatalogueLookup,confirmCatalogueRows});
})(globalThis);
