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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return out({ error: "not_configured" }, 503);
    const tg = tgId(req);
    if (!tg) return out({ error: "session_expired" }, 401);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const hit = await db.rpc("ai_hit", { p: tg });
    if (hit.error) return out({ error: "server_error" }, 500);
    if (Number(hit.data) > DAILY_LIMIT) return out({ error: "rate_limited" }, 429);

    const { system, messages, tools } = await req.json();
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
    if (status === 401) return out({ error: "not_configured" }, 503);
    if (status === 400) return out({ error: "bad_request", detail: String((e as Error).message).slice(0, 300) }, 400);
    return out({ error: "server_error", detail: String((e as Error).message).slice(0, 200) }, 500);
  }
});
