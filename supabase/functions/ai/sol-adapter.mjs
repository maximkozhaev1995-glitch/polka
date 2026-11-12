// Pure conversion boundary. No I/O, environment access, SDK initialization or deployment.
export const SOL_MODEL = 'gpt-6.1-sol';
export const SOL_PATH = '/v1/chat/completions';

function fail(code) {
  // Never include prompts, image data, tool arguments or upstream error bodies in errors.
  throw Object.assign(new Error(code), {code, status: code === 'invalid_request' ? 400 : 502});
}
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const nonempty = x => typeof x === 'string' && x.trim().length > 0;
const name = x => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(x);
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(k => !allowed.includes(k))) fail('invalid_request');
}
function jsonClone(value, code = 'invalid_request') {
  // JSON inputs only: reject undefined, non-finite numbers, cycles and coercive toJSON.
  const seen = new Set();
  function visit(x) {
    if (x === null || typeof x === 'string' || typeof x === 'boolean') return;
    if (typeof x === 'number' && Number.isFinite(x)) return;
    if (typeof x !== 'object' || seen.has(x) || (!Array.isArray(x) && Object.getPrototypeOf(x) !== Object.prototype && Object.getPrototypeOf(x) !== null)) fail(code);
    seen.add(x);
    for (const v of Array.isArray(x) ? x : Object.values(x)) visit(v);
    seen.delete(x);
  }
  visit(value);
  return JSON.parse(JSON.stringify(value));
}
function textBlock(block) {
  keys(block, ['type','text','cache_control']);
  if (block.type !== 'text' || typeof block.text !== 'string') fail('invalid_request');
  // Anthropic cache hints are provider-specific, not prompt content.
  if (block.cache_control !== undefined) {
    keys(block.cache_control, ['type','ttl']);
    if (block.cache_control.type !== 'ephemeral' || (block.cache_control.ttl !== undefined && !['5m','1h'].includes(block.cache_control.ttl))) fail('invalid_request');
  }
  return {type:'text',text:block.text};
}
function imageBlock(block) {
  keys(block, ['type','source']);
  keys(block.source, ['type','media_type','data']);
  const {type,media_type,data} = block.source;
  if (type !== 'base64' || !['image/jpeg','image/png','image/webp'].includes(media_type) || !nonempty(data) || data.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) fail('invalid_request');
  return {type:'image_url',image_url:{url:`data:${media_type};base64,${data}`}};
}

/** Build a non-streaming body for SOL_PATH. Caller owns auth, fetch, timeouts and HTTP errors.
 * Unsupported semantic fields fail closed. Image tool results are deliberately rejected:
 * chat.completions tool messages do not provide the same multimodal content contract.
 */
export function toSolRequest(input) {
  keys(input, ['system','messages','tools','max_tokens']);
  const budget = input.max_tokens ?? 2500;
  if (!Number.isSafeInteger(budget) || budget <= 0 || !Array.isArray(input.messages) || !input.messages.length) fail('invalid_request');
  const messages = [];
  if (input.system !== undefined) {
    if (typeof input.system === 'string') messages.push({role:'system',content:input.system});
    else if (Array.isArray(input.system) && input.system.length) messages.push({role:'system',content:input.system.map(textBlock)});
    else fail('invalid_request');
  }
  const pending = new Set(), used = new Set();
  for (const m of input.messages) {
    keys(m, ['role','content']);
    if (!['user','assistant'].includes(m.role)) fail('invalid_request');
    if (typeof m.content === 'string') {
      if (pending.size || !m.content.length) fail('invalid_request');
      messages.push({role:m.role,content:m.content});
      continue;
    }
    if (!Array.isArray(m.content) || !m.content.length) fail('invalid_request');
    const content = [], calls = [];
    let normalSeen = false;
    for (const b of m.content) {
      if (!object(b)) fail('invalid_request');
      if (b.type === 'tool_result') {
        keys(b, ['type','tool_use_id','content','is_error']);
        if (m.role !== 'user' || normalSeen || !pending.has(b.tool_use_id) || (b.is_error !== undefined && typeof b.is_error !== 'boolean')) fail('invalid_request');
        let result;
        if (typeof b.content === 'string') result = b.content;
        else if (Array.isArray(b.content)) result = b.content.map(textBlock);
        else fail('invalid_request');
        // Explicit error envelope prevents errors from masquerading as normal tool output.
        const text = b.is_error ? JSON.stringify({is_error:true,content:result}) : typeof result === 'string' ? result : JSON.stringify(result);
        messages.push({role:'tool',tool_call_id:b.tool_use_id,content:text});
        pending.delete(b.tool_use_id);
      } else {
        if (pending.size) fail('invalid_request');
        normalSeen = true;
        if (b.type === 'text') content.push(textBlock(b));
        else if (b.type === 'image' && m.role === 'user') content.push(imageBlock(b));
        else if (b.type === 'tool_use' && m.role === 'assistant') {
          keys(b, ['type','id','name','input']);
          if (!nonempty(b.id) || used.has(b.id) || !name(b.name) || !object(b.input)) fail('invalid_request');
          used.add(b.id);
          calls.push({id:b.id,type:'function',function:{name:b.name,arguments:JSON.stringify(jsonClone(b.input))}});
        } else fail('invalid_request');
      }
    }
    if (content.length || calls.length) messages.push({role:m.role,content:content.length ? content : null,...(calls.length ? {tool_calls:calls} : {})});
    for (const c of calls) pending.add(c.id);
  }
  if (pending.size) fail('invalid_request');
  const body = {model:SOL_MODEL,max_completion_tokens:budget,messages};
  if (input.tools !== undefined) {
    if (!Array.isArray(input.tools)) fail('invalid_request');
    const names = new Set();
    const tools = input.tools.map(t => {
      keys(t, ['name','description','input_schema']);
      if (!name(t.name) || names.has(t.name) || !object(t.input_schema) || t.input_schema.type !== 'object' || (t.description !== undefined && typeof t.description !== 'string')) fail('invalid_request');
      names.add(t.name);
      return {type:'function',function:{name:t.name,...(t.description !== undefined ? {description:t.description} : {}),parameters:jsonClone(t.input_schema)}};
    });
    if (tools.length) body.tools = tools;
  }
  return body;
}

/** Strict parser: never make truncated/malformed tool calls executable. Model aliases are
 * not accepted silently. Caller must explicitly review a future provider model change.
 */
export function fromSolResponse(payload) {
  if (!object(payload)) fail('malformed_response');
  if (payload.error != null) fail('upstream_error');
  if (typeof payload.model !== 'string') fail('malformed_response');
  if (payload.model !== SOL_MODEL) fail('model_mismatch');
  if (!Array.isArray(payload.choices) || payload.choices.length !== 1) fail('malformed_response');
  const choice = payload.choices[0];
  if (!object(choice)) fail('malformed_response');
  if (choice.finish_reason === 'length') fail('incomplete_response');
  if (!['stop','tool_calls','content_filter'].includes(choice.finish_reason)) fail('malformed_response');
  const m = choice.message;
  if (!object(m) || m.role !== 'assistant' || (m.content != null && typeof m.content !== 'string') || (m.refusal != null && typeof m.refusal !== 'string') || m.function_call != null || m.audio != null) fail('malformed_response');
  if (m.tool_calls !== undefined && !Array.isArray(m.tool_calls)) fail('malformed_response');
  const calls = m.tool_calls ?? [], content = [];
  const refusal = nonempty(m.refusal) || choice.finish_reason === 'content_filter';
  if (refusal && calls.length) fail('malformed_response');
  if (!refusal && ((choice.finish_reason === 'tool_calls') !== (calls.length > 0))) fail('malformed_response');
  if (m.content) content.push({type:'text',text:m.content});
  if (nonempty(m.refusal)) content.push({type:'text',text:m.refusal});
  const ids = new Set();
  for (const call of calls) {
    if (!object(call) || call.type !== 'function' || !nonempty(call.id) || ids.has(call.id) || !object(call.function) || !name(call.function.name) || typeof call.function.arguments !== 'string') fail('malformed_response');
    ids.add(call.id);
    let args;
    try { args = JSON.parse(call.function.arguments); } catch { fail('malformed_response'); }
    if (!object(args)) fail('malformed_response');
    content.push({type:'tool_use',id:call.id,name:call.function.name,input:jsonClone(args,'malformed_response')});
  }
  if (!content.length && !refusal) fail('malformed_response');
  const usage = {};
  for (const [key,value] of [['input_tokens',payload.usage?.prompt_tokens],['output_tokens',payload.usage?.completion_tokens],['cache_read_input_tokens',payload.usage?.prompt_tokens_details?.cached_tokens]]) {
    if (Number.isSafeInteger(value) && value >= 0) usage[key] = value;
  }
  return {content,stop_reason:refusal ? 'refusal' : calls.length ? 'tool_use' : 'end_turn',model:payload.model,usage};
}
