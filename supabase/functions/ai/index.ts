// © 2026 Максим Кожаев. Все права защищены. Копирование, распространение и использование без письменного согласия автора запрещены.
// ИИ-ассистент Полки: прокси к Gemini (или Claude API, напрямую через ANTHROPIC_API_KEY либо через свой прокси
// с ANTHROPIC_BASE_URL+ANTHROPIC_AUTH_TOKEN). Ключи лежат только здесь, в приложение не попадают.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });
const DAILY_LIMIT = 300; // запросов на человека в сутки (считаются только вопросы человека, не шаги инструментов — см. ниже)
const MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5"];

function tgId(req: Request): number | null {
  try {
    const t = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return p.tg_id ? Number(p.tg_id) : null;
  } catch { return null; }
}

// ===== Gemini: переводим формат Claude (сообщения, инструменты) в формат Gemini и обратно =====
function toGeminiContents(messages: any[]) {
  const names: Record<string, string> = {};
  const contents: any[] = [];
  for (const m of messages) {
    const parts: any[] = [];
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    for (const b of blocks) {
      if (b.type === "text") parts.push({ text: b.text });
      else if (b.type === "image") parts.push({ inlineData: { mimeType: b.source.media_type, data: b.source.data } });
      else if (b.type === "tool_use") { names[b.id] = b.name; const fc: any = { functionCall: { name: b.name, args: b.input || {} } }; if (b.sig) fc.thoughtSignature = b.sig; parts.push(fc); }
      else if (b.type === "tool_result") {
        let resp: unknown; try { resp = JSON.parse(String(b.content)); } catch { resp = { result: String(b.content) }; }
        if (typeof resp !== "object" || resp === null || Array.isArray(resp)) resp = { result: resp };
        parts.push({ functionResponse: { name: names[b.tool_use_id] || "tool", response: b.is_error ? { error: String(b.content) } : resp } });
      }
    }
    if (parts.length) contents.push({ role: m.role === "assistant" ? "model" : "user", parts });
  }
  return contents;
}
async function askGemini(key: string, system: string, messages: any[], tools: any[]) {
  const first = Deno.env.get("GEMINI_MODEL");
  const models = [...new Set([first, "gemini-3.5-flash", "gemini-flash-latest", "gemini-3.5-flash-lite"].filter(Boolean))] as string[];
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: system }] },
    contents: toGeminiContents(messages),
    generationConfig: { maxOutputTokens: 2500, thinkingConfig: { thinkingLevel: Deno.env.get("GEMINI_THINKING") || "minimal" } },
  };
  if (tools.length) body.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema })) }];
  // Бесплатный уровень иногда перегружен (503) или молчит: пробуем модели по очереди, у каждой свой таймаут
  let r: Response | null = null, j: any = null, served = "";
  const tried: string[] = [];
  for (const model of models) {
    const t0 = Date.now();
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(22000),
      });
      j = await r.json();
      if (r.status === 400 && /thinking/i.test(j?.error?.message || "")) {
        const plain = { ...body, generationConfig: { maxOutputTokens: 2500 } };
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(plain),
          signal: AbortSignal.timeout(22000),
        });
        j = await r.json();
      }
      tried.push(model + ":" + r.status + ":" + (Date.now() - t0) + "ms");
      if (r.ok) { served = model; break; } // 429 и 503: у каждой модели свой лимит, пробуем следующую
    } catch { tried.push(model + ":timeout:" + (Date.now() - t0) + "ms"); r = null; }
  }
  if (!r) { const e: any = new Error("busy"); e.status = 503; throw e; }
  if (!r.ok) { const e: any = new Error(j?.error?.message || "gemini_error"); e.status = r.status === 429 ? 429 : r.status === 400 ? 400 : r.status === 503 ? 503 : 500; throw e; }
  const parts = j?.candidates?.[0]?.content?.parts || [];
  const content: any[] = [];
  let calls = 0;
  for (const p of parts) {
    if (p.text) content.push({ type: "text", text: p.text });
    if (p.functionCall) { calls++; content.push({ type: "tool_use", id: "g" + crypto.randomUUID().slice(0, 8), name: p.functionCall.name, input: p.functionCall.args || {}, sig: p.thoughtSignature }); }
  }
  const blocked = j?.promptFeedback?.blockReason || j?.candidates?.[0]?.finishReason === "SAFETY";
  console.log("gemini", tried.join(" "));
  return { content, stop_reason: blocked ? "refusal" : calls ? "tool_use" : "end_turn", usage: j?.usageMetadata, model: served, tried };
}

// ===== Компьютер Максима: Ollama (tools/local-ai), формат OpenAI =====
// Компьютер сам забирает запросы из очереди ai_jobs (опрос раз в ~20 с, отметка в ai_local) — туннель не нужен.
// Старый путь через туннель остаётся: если в ai_local записан https-адрес. Компьютер молчит — отвечает Gemini.
let localDownUntil = 0; // после сбоя минуту не ждём компьютер, сразу идём в запасной вариант
function toOpenAI(system: string, messages: any[]) {
  const res: any[] = [{ role: "system", content: system }];
  for (const m of messages) {
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    const text = blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    if (m.role === "assistant") {
      const calls = blocks.filter((b: any) => b.type === "tool_use").map((b: any) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }));
      res.push(calls.length ? { role: "assistant", content: text, tool_calls: calls } : { role: "assistant", content: text });
    } else {
      for (const b of blocks.filter((b: any) => b.type === "tool_result")) res.push({ role: "tool", tool_call_id: b.tool_use_id, content: String(b.content) });
      if (text) res.push({ role: "user", content: text });
    }
  }
  return res;
}
// Разбор ответа в формате OpenAI chat.completions (его отдают и ПК, и YandexGPT) в формат Claude-блоков
function fromOpenAI(j: any, srcPrefix: string, model: string) {
  if (j?.error) throw new Error(srcPrefix + ": " + String(j.error?.message || j.error).slice(0, 150));
  const msg = j?.choices?.[0]?.message || {};
  const content: any[] = [];
  const txt = String(msg.content || "").replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
  if (txt) content.push({ type: "text", text: txt });
  for (const c of msg.tool_calls || []) {
    let input = {}; try { input = typeof c.function.arguments === "string" ? JSON.parse(c.function.arguments) : c.function.arguments || {}; } catch { /* пустые аргументы */ }
    content.push({ type: "tool_use", id: c.id || srcPrefix[0] + crypto.randomUUID().slice(0, 8), name: c.function.name, input });
  }
  return { content, stop_reason: (msg.tool_calls || []).length ? "tool_use" : "end_turn", model: srcPrefix + ":" + model };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Кладём запрос в очередь и ждём ответ: 8 с на то, чтобы компьютер его забрал, 75 с на ответ
async function viaQueue(db: any, body: unknown) {
  await db.from("ai_jobs").delete().lt("created_at", new Date(Date.now() - 600000).toISOString());
  const ins = await db.from("ai_jobs").insert({ req: body }).select("id").single();
  if (ins.error) throw new Error("queue " + ins.error.message);
  const id = ins.data.id, t0 = Date.now();
  let taken = 0;
  while (true) {
    await sleep(400);
    const { data } = await db.from("ai_jobs").select("res,taken_at").eq("id", id).maybeSingle();
    if (data?.res) { await db.from("ai_jobs").delete().eq("id", id); return data.res; }
    if (data?.taken_at && !taken) taken = Date.now();
    if (!taken && Date.now() - t0 > 8000 || taken && Date.now() - taken > 75000) {
      await db.from("ai_jobs").delete().eq("id", id);
      throw new Error(taken ? "queue timeout" : "queue not taken");
    }
  }
}
async function askLocal(db: any, system: string, messages: any[], tools: any[]) {
  const key = Deno.env.get("LOCAL_AI_KEY");
  if (!key || Date.now() < localDownUntil) return null;
  const { data } = await db.from("ai_local").select("url,model,updated_at").eq("id", 1).maybeSingle();
  if (!data?.url) return null;
  const queue = data.url === "queue";
  if (queue && Date.now() - Date.parse(data.updated_at) > 60000) return null; // компьютер давно не спрашивал задачи — выключен
  try {
    const body: Record<string, unknown> = { model: data.model || Deno.env.get("LOCAL_AI_MODEL") || "qwen2.5:7b", messages: toOpenAI(system, messages), max_tokens: 2500 };
    if (tools.length) body.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    let j: any;
    if (queue) j = await viaQueue(db, body);
    else {
      const r = await fetch(data.url.replace(/\/+$/, "") + "/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(75000), // большой промпт на домашней видеокарте читается до минуты
      });
      if (!r.ok) throw new Error("local " + r.status);
      j = await r.json();
    }
    return fromOpenAI(j, "local", String(body.model));
  } catch (e) {
    console.log("local ai down:", String((e as Error).message).slice(0, 120));
    localDownUntil = Date.now() + 60000;
    return null;
  }
}

// ===== YandexGPT (Yandex AI Studio, эндпоинт совместим с OpenAI): текст, платно по токенам, без общего бесплатного лимита =====
// Использует те же секреты, что и Yandex OCR (YANDEX_API_KEY, YANDEX_FOLDER_ID) — отдельно ничего заводить не нужно.
let yandexDownUntil = 0;
async function askYandex(system: string, messages: any[], tools: any[]) {
  const key = Deno.env.get("YANDEX_API_KEY"), folder = Deno.env.get("YANDEX_FOLDER_ID");
  if (!key || !folder || Date.now() < yandexDownUntil) return null;
  try {
    const model = Deno.env.get("YANDEX_GPT_MODEL") || "yandexgpt/latest";
    const body: Record<string, unknown> = { model, messages: toOpenAI(system, messages), max_tokens: 2500 };
    // tool_choice у Yandex поддерживает только auto/none — нам нужен именно auto
    if (tools.length) { body.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })); body.tool_choice = "auto"; }
    const r = await fetch("https://llm.api.cloud.yandex.net/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key, "OpenAI-Project": folder },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error("yandex_gpt_" + r.status + ": " + String(j?.error?.message || j?.error || "").slice(0, 150));
    return fromOpenAI(j, "yandex", model);
  } catch (e) {
    console.log("yandex gpt down:", String((e as Error).message).slice(0, 150));
    yandexDownUntil = Date.now() + 60000;
    return null;
  }
}

// ===== Фото накладных и банок: Yandex Vision OCR. Картинку заменяем распознанным текстом =====
// Один вызов OCR с заданной моделью: "handwritten" читает и печатный, и рукописный текст (нужен для этикеток от руки),
// "page" — запасной вариант, если handwritten недоступен на аккаунте.
async function callYandexOcr(key: string, folder: string, mimeType: string, data: string, model: string) {
  const r = await fetch("https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Api-Key " + key, "x-folder-id": folder },
    body: JSON.stringify({ mimeType, languageCodes: ["ru", "en"], model, content: data }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e: any = new Error("yandex_" + model + "_" + r.status); e.status = r.status; e.body = j; throw e; }
  return j;
}
async function yandexOcr(messages: any[]) {
  const key = Deno.env.get("YANDEX_API_KEY"), folder = Deno.env.get("YANDEX_FOLDER_ID");
  if (!key || !folder) return false;
  const texts: string[] = []; // распознанный текст уходит и клиенту: на следующих шагах он подставляет его вместо картинки
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    m.content = await Promise.all(m.content.map(async (b: any) => {
      if (b.type !== "image") return b;
      const mimeType = b.source.media_type === "image/png" ? "PNG" : "JPEG";
      let j: any;
      try {
        j = await callYandexOcr(key, folder, mimeType, b.source.data, "handwritten");
      } catch (e1) {
        console.log("yandex ocr handwritten failed:", String((e1 as Error).message).slice(0, 120));
        try {
          j = await callYandexOcr(key, folder, mimeType, b.source.data, "page");
        } catch (e2) {
          console.log("yandex ocr page failed:", String((e2 as Error).message).slice(0, 120));
          const e: any = new Error("image_rejected"); e.status = 422; throw e;
        }
      }
      // Яндекс группирует распознанный текст по блокам — на фото банок обычно один блок на этикетку.
      // Отдаём их отдельно пронумерованными: иначе бренд с одной банки и вкус с соседней, прочитанные подряд,
      // модель (и наш собственный разбор на клиенте) может принять за одну позицию.
      const blocks = (j?.result?.textAnnotation?.blocks || []) as any[];
      const labels = blocks.map((blk) => (blk.lines || []).map((l: any) => l.text).join(" ").trim()).filter(Boolean);
      const text = labels.length
        ? labels.map((t, i) => "Этикетка " + (i + 1) + ": " + t).join("\n")
        : String(j?.result?.textAnnotation?.fullText || "").trim();
      texts.push(text);
      return { type: "text", text: "[Фото, текст распознан Yandex Vision. Каждая строка «Этикетка N: …» — отдельная банка; бренд и вкус с разных этикеток не смешивай]\n" + (text || "(текста на фото не нашлось)") };
    }));
  }
  return texts;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // Компьютер с локальным ИИ сообщает свой адрес (tools/local-ai/polka_ai.py)
    const localKey = Deno.env.get("LOCAL_AI_KEY");
    if (req.headers.get("x-local-key")) {
      if (!localKey || req.headers.get("x-local-key") !== localKey) return out({ error: "forbidden" }, 403);
      const { register, poll, done } = await req.json();
      const adm = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      if (poll) { // компьютер ждёт задачу до 20 с; заодно отмечается, что он на связи
        localDownUntil = 0;
        const beat = () => adm.from("ai_local").upsert({ id: 1, url: "queue", model: poll.model || null, updated_at: new Date().toISOString() });
        await beat();
        for (let t0 = Date.now(); Date.now() - t0 < 20000; await sleep(500)) {
          const { data, error } = await adm.rpc("ai_take_job");
          if (error) return out({ error: "server_error", detail: error.message }, 500);
          if (data?.length) { await beat(); return out({ job: { id: data[0].id, req: data[0].req } }); }
        }
        return out({ job: null });
      }
      if (done?.id) {
        const w = await adm.from("ai_jobs").update({ res: done.res ?? { error: "empty" } }).eq("id", done.id);
        return w.error ? out({ error: "server_error", detail: w.error.message }, 500) : out({ ok: true });
      }
      if (!register?.url || !/^https:\/\//.test(register.url)) return out({ error: "bad_request" }, 400);
      const w = await adm.from("ai_local").upsert({ id: 1, url: register.url, model: register.model || null, updated_at: new Date().toISOString() });
      if (w.error) return out({ error: "server_error", detail: w.error.message }, 500);
      localDownUntil = 0;
      return out({ ok: true });
    }
    // Claude: обычный ключ (ANTHROPIC_API_KEY) или доступ через прокси (ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN)
    const claudeApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    const claudeAuthToken = Deno.env.get("ANTHROPIC_AUTH_TOKEN");
    const claudeBaseUrl = Deno.env.get("ANTHROPIC_BASE_URL");
    const claudeKey = claudeApiKey || claudeAuthToken;
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    const useGemini = Deno.env.get("AI_PROVIDER") === "gemini" ? !!geminiKey : (!claudeKey && !!geminiKey);
    if (!claudeKey && !geminiKey) return out({ error: "not_configured" }, 503);
    const tg = tgId(req);
    if (!tg) return out({ error: "session_expired" }, 401);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { system, messages, tools, ocr_only } = await req.json();
    const hasImg = messages.some((m: any) => Array.isArray(m.content) && m.content.some((b: any) => b.type === "image"));
    // Только распознавание, без вызова модели: приложение сверяет текст с каталогом само и присылает фото
    // отдельными запросами (по одному), чтобы не упираться в лимит времени функции на нескольких фото сразу.
    // В дневной лимит не считаем — модель (Yandex/Gemini/Claude) тут не вызывается вообще.
    if (ocr_only) { const r = hasImg ? await yandexOcr(messages) : false; return out({ ocr: r ? "yandex" : undefined, ocr_texts: r || undefined }); }
    // Считаем только вопрос человека, не каждый шаг цикла инструментов: продолжение диалога внутри одного
    // вопроса всегда несёт результат инструмента (tool_result) — такие шаги не тратят дневной лимит
    const isToolStep = messages.some((m: any) => Array.isArray(m.content) && m.content.some((b: any) => b.type === "tool_result"));
    if (!isToolStep) {
      const hit = await db.rpc("ai_hit", { p: tg });
      if (hit.error) return out({ error: "server_error" }, 500);
      if (Number(hit.data) > DAILY_LIMIT) return out({ error: "rate_limited", scope: "daily" }, 429);
    }
    // Фото: если Yandex подключён — картинки становятся текстом, и дальше их понимает любая модель
    const ocr = hasImg ? await yandexOcr(messages) : false;
    if (Deno.env.get("AI_PROVIDER") === "local" && (!hasImg || ocr)) {
      const r = await askLocal(db, String(system || ""), messages, tools || []);
      if (r) return out({ ...r, ocr: ocr ? "yandex" : undefined, ocr_texts: ocr || undefined });
      if (!geminiKey && !claudeKey) return out({ error: "busy" }, 503);
    }
    // YandexGPT: платно по токенам (дёшево), без общего бесплатного лимита Gemini — Gemini остаётся запасным, если Yandex недоступен
    if (Deno.env.get("AI_PROVIDER") === "yandex") {
      const r = await askYandex(String(system || ""), messages, tools || []);
      if (r) return out({ ...r, ocr: ocr ? "yandex" : undefined, ocr_texts: ocr || undefined });
      if (!geminiKey && !claudeKey) return out({ error: "busy" }, 503);
    }
    const fallbackProvider = Deno.env.get("AI_PROVIDER") === "local" || Deno.env.get("AI_PROVIDER") === "yandex";
    if (useGemini || (fallbackProvider && geminiKey)) return out({ ...(await askGemini(geminiKey!, String(system || ""), messages, tools || [])), ocr: ocr ? "yandex" : undefined, ocr_texts: ocr || undefined });
    const want = Deno.env.get("AI_MODEL") || "claude-haiku-5-5";
    const model = MODELS.includes(want) ? want : "claude-haiku-5-5";

    const client = new Anthropic(
      claudeApiKey
        ? { apiKey: claudeApiKey }
        : { authToken: claudeAuthToken!, baseURL: claudeBaseUrl || undefined },
    );
    const r = await client.messages.create({
      model,
      max_tokens: 2500,
      system: [{ type: "text", text: String(system || ""), cache_control: { type: "ephemeral" } }],
      messages,
      tools: Array.isArray(tools) && tools.length ? tools : undefined,
    });
    return out({ content: r.content, stop_reason: r.stop_reason, usage: r.usage, ocr: ocr ? "yandex" : undefined, ocr_texts: ocr || undefined });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 429) return out({ error: "rate_limited" }, 429);
    if (status === 503) return out({ error: "busy" }, 503);
    if (status === 401) return out({ error: "not_configured" }, 503);
    if (status === 400) return out({ error: "bad_request", detail: String((e as Error).message).slice(0, 300) }, 400);
    return out({ error: "server_error", detail: String((e as Error).message).slice(0, 200) }, 500);
  }
});
