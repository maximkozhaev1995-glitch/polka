// ИИ-ассистент Полки: прокси к Claude API. Ключ лежит только здесь (секрет ANTHROPIC_API_KEY), в приложение не попадает.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });
const DAILY_LIMIT = 150; // запросов на человека в сутки
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
    generationConfig: { maxOutputTokens: 2500 },
  };
  if (tools.length) body.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema })) }];
  // Бесплатный уровень иногда перегружен (503) или молчит: пробуем модели по очереди, у каждой свой таймаут
  let r: Response | null = null, j: any = null;
  for (const model of models) {
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(22000),
      });
      j = await r.json();
      if (r.ok || r.status === 429) break;
    } catch { r = null; }
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
  return { content, stop_reason: blocked ? "refusal" : calls ? "tool_use" : "end_turn", usage: j?.usageMetadata };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    const useGemini = Deno.env.get("AI_PROVIDER") === "gemini" ? !!geminiKey : (!claudeKey && !!geminiKey);
    if (!claudeKey && !geminiKey) return out({ error: "not_configured" }, 503);
    const tg = tgId(req);
    if (!tg) return out({ error: "session_expired" }, 401);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const hit = await db.rpc("ai_hit", { p: tg });
    if (hit.error) return out({ error: "server_error" }, 500);
    if (Number(hit.data) > DAILY_LIMIT) return out({ error: "rate_limited" }, 429);

    const { system, messages, tools } = await req.json();
    if (useGemini) return out(await askGemini(geminiKey!, String(system || ""), messages, tools || []));
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
    return out({ content: r.content, stop_reason: r.stop_reason, usage: r.usage });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 429) return out({ error: "rate_limited" }, 429);
    if (status === 503) return out({ error: "busy" }, 503);
    if (status === 401) return out({ error: "not_configured" }, 503);
    if (status === 400) return out({ error: "bad_request", detail: String((e as Error).message).slice(0, 300) }, 400);
    return out({ error: "server_error", detail: String((e as Error).message).slice(0, 200) }, 500);
  }
});
