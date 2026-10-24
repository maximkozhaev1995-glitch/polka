// © 2026 Максим Кожаев. Все права защищены. Копирование, распространение и использование без письменного согласия автора запрещены.
// ИИ-ассистент Полки: прокси к Gemini (или Claude API). Ключ лежит только здесь (секрет ANTHROPIC_API_KEY), в приложение не попадает.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });
const DAILY_LIMIT = 75; // запросов на человека в сутки
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

// ===== Компьютер Максима: Ollama за туннелем (tools/local-ai), формат OpenAI =====
// Адрес туннеля компьютер сам записывает в ai_local при запуске. Если компьютер не отвечает — отвечает Gemini.
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
async function askLocal(db: any, system: string, messages: any[], tools: any[]) {
  const key = Deno.env.get("LOCAL_AI_KEY");
  if (!key || Date.now() < localDownUntil) return null;
  const { data } = await db.from("ai_local").select("url,model").eq("id", 1).maybeSingle();
  if (!data?.url) return null;
  try {
    const body: Record<string, unknown> = { model: data.model || Deno.env.get("LOCAL_AI_MODEL") || "qwen2.5:7b", messages: toOpenAI(system, messages), max_tokens: 2500 };
    if (tools.length) body.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    const r = await fetch(data.url.replace(/\/+$/, "") + "/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(75000), // большой промпт на домашней видеокарте читается до минуты
    });
    if (!r.ok) throw new Error("local " + r.status);
    const msg = (await r.json())?.choices?.[0]?.message || {};
    const content: any[] = [];
    const txt = String(msg.content || "").replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
    if (txt) content.push({ type: "text", text: txt });
    for (const c of msg.tool_calls || []) {
      let input = {}; try { input = typeof c.function.arguments === "string" ? JSON.parse(c.function.arguments) : c.function.arguments || {}; } catch { /* пустые аргументы */ }
      content.push({ type: "tool_use", id: c.id || "l" + crypto.randomUUID().slice(0, 8), name: c.function.name, input });
    }
    return { content, stop_reason: (msg.tool_calls || []).length ? "tool_use" : "end_turn", model: "local:" + body.model };
  } catch (e) {
    console.log("local ai down:", String((e as Error).message).slice(0, 120));
    localDownUntil = Date.now() + 60000;
    return null;
  }
}

// ===== Фото накладных и банок: Yandex Vision OCR. Картинку заменяем распознанным текстом =====
async function yandexOcr(messages: any[]) {
  const key = Deno.env.get("YANDEX_API_KEY"), folder = Deno.env.get("YANDEX_FOLDER_ID");
  if (!key || !folder) return false;
  const texts: string[] = []; // распознанный текст уходит и клиенту: на следующих шагах он подставляет его вместо картинки
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    m.content = await Promise.all(m.content.map(async (b: any) => {
      if (b.type !== "image") return b;
      const r = await fetch("https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Api-Key " + key, "x-folder-id": folder },
        body: JSON.stringify({ mimeType: b.source.media_type === "image/png" ? "PNG" : "JPEG", languageCodes: ["ru", "en"], model: "page", content: b.source.data }),
        signal: AbortSignal.timeout(30000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { console.log("yandex ocr", r.status, JSON.stringify(j).slice(0, 200)); const e: any = new Error("image_rejected"); e.status = 422; throw e; }
      const text = String(j?.result?.textAnnotation?.fullText || "").trim();
      texts.push(text);
      return { type: "text", text: "[Фото, текст распознан Yandex Vision. Этикетки и строки могут быть разорваны, собирай бренд и вкус по смыслу]\n" + (text || "(текста на фото не нашлось)") };
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
      const { register } = await req.json();
      if (!register?.url || !/^https:\/\//.test(register.url)) return out({ error: "bad_request" }, 400);
      const adm = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const w = await adm.from("ai_local").upsert({ id: 1, url: register.url, model: register.model || null, updated_at: new Date().toISOString() });
      if (w.error) return out({ error: "server_error", detail: w.error.message }, 500);
      localDownUntil = 0;
      return out({ ok: true });
    }
    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    const useGemini = Deno.env.get("AI_PROVIDER") === "gemini" ? !!geminiKey : (!claudeKey && !!geminiKey);
    if (!claudeKey && !geminiKey) return out({ error: "not_configured" }, 503);
    const tg = tgId(req);
    if (!tg) return out({ error: "session_expired" }, 401);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const hit = await db.rpc("ai_hit", { p: tg });
    if (hit.error) return out({ error: "server_error" }, 500);
    if (Number(hit.data) > DAILY_LIMIT) return out({ error: "rate_limited", scope: "daily" }, 429);

    const { system, messages, tools } = await req.json();
    const hasImg = messages.some((m: any) => Array.isArray(m.content) && m.content.some((b: any) => b.type === "image"));
    // Фото: если Yandex подключён — картинки становятся текстом, и дальше их понимает любая модель
    const ocr = hasImg ? await yandexOcr(messages) : false;
    if (Deno.env.get("AI_PROVIDER") === "local" && (!hasImg || ocr)) {
      const r = await askLocal(db, String(system || ""), messages, tools || []);
      if (r) return out({ ...r, ocr: ocr ? "yandex" : undefined, ocr_texts: ocr || undefined });
      if (!geminiKey && !claudeKey) return out({ error: "busy" }, 503);
    }
    if (useGemini || (Deno.env.get("AI_PROVIDER") === "local" && geminiKey)) return out({ ...(await askGemini(geminiKey!, String(system || ""), messages, tools || [])), ocr: ocr ? "yandex" : undefined, ocr_texts: ocr || undefined });
    const key = claudeKey!;
    const want = Deno.env.get("AI_MODEL") || "claude-haiku-5-5";
    const model = MODELS.includes(want) ? want : "claude-haiku-5-5";

    const client = new Anthropic({ apiKey: key });
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
