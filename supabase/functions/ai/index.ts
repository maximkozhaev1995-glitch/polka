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

async function tgId(req: Request, secret = Deno.env.get("APP_JWT_SECRET")): Promise<number | null> {
  try {
    if (!secret) return null;
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const parts = token.split(".");if (parts.length !== 3) return null;
    const decode = (part: string) => Uint8Array.from(atob(part.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    if (header.alg !== "HS256") return null;
    const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
    if (!await crypto.subtle.verify("HMAC",key,decode(parts[2]),new TextEncoder().encode(parts[0]+"."+parts[1]))) return null;
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1]))), now = Math.floor(Date.now()/1000);
    if (claims.role !== "authenticated" || claims.aud !== "authenticated" || !Number.isFinite(claims.exp) || claims.exp <= now || !Number.isFinite(claims.iat) || claims.iat > now+300) return null;
    if (!/^[0-9]{1,15}$/.test(String(claims.sub)) || claims.tg_id !== undefined && String(claims.tg_id) !== String(claims.sub)) return null;
    return Number(claims.sub);
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
    // Эндпоинт ждёт полный адрес модели gpt://<каталог>/<модель>: с коротким «yandexgpt/latest» он отвечал
    // 400 «Failed to parse model URI», и всё это время за YandexGPT тихо отвечал запасной Gemini
    const short = Deno.env.get("YANDEX_GPT_MODEL") || "yandexgpt/latest";
    const model = short.startsWith("gpt://") ? short : "gpt://" + folder + "/" + short;
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
    return fromOpenAI(j, "yandex", short);
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
// Рамка блока или строки Яндекса: вершины приходят строками, иногда без x или y (значит 0)
function ocrBox(o: any) {
  const v = (o?.boundingBox?.vertices || []) as any[];
  if (!v.length) return null;
  const xs = v.map((p) => Number(p.x) || 0), ys = v.map((p) => Number(p.y) || 0);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
// Склеивает блоки, лежащие на одной этикетке: друг под другом (по горизонтали перекрываются хотя бы наполовину
// более узкого) и почти вплотную (зазор не больше полутора строк). Две соседние банки в ряд так не склеятся —
// они стоят рядом, а не друг под другом; ряды банок разделены крышками и стенками, это обычно больше полутора строк.
// Этикетки возвращаются по порядку на фото: рядами сверху вниз, в ряду слева направо.
function labelGroups(blocks: any[], focus = false, width = 0, height = 0): string[] {
  const items = blocks.map((blk) => ({
    text: (blk.lines || []).map((l: any) => l.text).join(" ").trim(),
    box: ocrBox(blk),
  })).filter((b) => b.text);
  if (items.some((b) => !b.box)) return focus ? ["Фокус: ?"] : items.map((b) => b.text); // без координат склеивать не по чему
  const lineH = (blocks.flatMap((blk) => (blk.lines || []).map((l: any) => ocrBox(l)))
    .filter(Boolean).map((b: any) => b.y1 - b.y0).sort((a: number, b: number) => a - b));
  const unit = lineH.length ? lineH[lineH.length >> 1] : 0;
  const groups = items.map((b) => ({ texts: [b.text], ...b.box! }));
  const close = (a: any, b: any) => {
    const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const narrow = Math.min(a.x1 - a.x0, b.x1 - b.x0);
    const gap = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
    return narrow > 0 && overlap >= narrow / 2 && gap <= unit * 1.5;
  };
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < groups.length && !merged; i++) {
      for (let k = i + 1; k < groups.length; k++) {
        const a = groups[i], b = groups[k];
        if (!close(a, b)) continue;
        const top = a.y0 <= b.y0 ? a : b, bottom = top === a ? b : a; // текст сверху вниз, как на этикетке
        groups[i] = { texts: [...top.texts, ...bottom.texts], x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1) };
        groups.splice(k, 1); merged = true; break;
      }
    }
  }
  // Ряд — этикетки, у которых середина по высоте попадает в первую этикетку ряда (или наоборот:
  // склеенная этикетка выше одиночной, и середина одиночной попадает в неё)
  groups.sort((a, b) => a.y0 - b.y0);
  const mid = (g: any) => (g.y0 + g.y1) / 2, inside = (y: number, g: any) => y >= g.y0 && y <= g.y1;
  const rows: any[][] = [];
  for (const g of groups) {
    const row = rows.find((r) => inside(mid(g), r[0]) || inside(mid(r[0]), g));
    if (row) row.push(g); else rows.push([g]);
  }
  const ordered = rows.flatMap((r) => r.sort((a, b) => a.x0 - b.x0));
  if (!focus) return ordered.map((g) => g.texts.join(" "));
  if (!ordered.length) return ["Фокус: ?"];
  const area = (g: any) => Math.max(0, g.x1 - g.x0) * Math.max(0, g.y1 - g.y0);
  const maxArea = Math.max(...ordered.map(area));
  const x0 = width > 0 ? 0 : Math.min(...ordered.map((g) => g.x0)), x1 = width > 0 ? width : Math.max(...ordered.map((g) => g.x1));
  const y0 = height > 0 ? 0 : Math.min(...ordered.map((g) => g.y0)), y1 = height > 0 ? height : Math.max(...ordered.map((g) => g.y1));
  const distance = (g: any) => ((g.x0 + g.x1 - x0 - x1) / Math.max(1, x1 - x0)) ** 2 + ((g.y0 + g.y1 - y0 - y1) / Math.max(1, y1 - y0)) ** 2;
  // Small distant labels cannot win simply because there are more of them.
  const foreground = ordered.filter((g) => area(g) >= maxArea * 0.25);
  const anchor = foreground.sort((a, b) => distance(a) - distance(b) || area(b) - area(a))[0];
  return ["Фокус: " + (anchor ? anchor.texts.join(" ") : "?"), ...ordered.filter((g) => area(g) >= maxArea * 0.25).map((g) => g.texts.join(" "))];
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
      // Яндекс группирует распознанный текст по блокам, но одну этикетку нередко режет на два-три блока
      // («TRAFIMOFFS» и «Nobilis» отдельно). Склеиваем блоки одной банки по координатам (labelGroups) и отдаём
      // этикетки отдельно пронумерованными: иначе бренд с одной банки и вкус с соседней, прочитанные подряд,
      // модель (и наш собственный разбор на клиенте) может принять за одну позицию.
      const blocks = (j?.result?.textAnnotation?.blocks || []) as any[];
      const annotation = j?.result?.textAnnotation;
      const labels = labelGroups(blocks, true, Number(annotation?.width) || 0, Number(annotation?.height) || 0);
      const text = labels.length
        ? labels[0] + "\n" + labels.slice(1).map((t, i) => "Этикетка " + (i + 1) + ": " + t).join("\n")
        : "Фокус: ?";
      texts.push(text);
      return { type: "text", text: "[Фото, текст распознан Yandex Vision. Каждая строка «Этикетка N: …» — отдельная банка; бренд и вкус с разных этикеток не смешивай]\n" + (text || "(текста на фото не нашлось)") };
    }));
  }
  return texts;
}

// ===== Фото через Claude (Sonnet): читает этикетки сам, в том числе рукописные и с бликами — заметно точнее
// Yandex Vision на наших фото (тест 25.10: 55 банок из 55 против ошибок вида «шипучна вичневая», «СНАВАССО»).
// Отдаёт тот же формат «Этикетка N: …», что и yandexOcr, — сверка с каталогом на клиенте не меняется.
// Фото читается один раз отдельным запросом и дальше в переписку идёт только текст, а не картинка на каждом шаге.
const PHOTO_PROMPT = `Один снимок — один основной бренд. Сначала определи бренд крупных банок на переднем плане в центре кадра. Не выбирай бренд по числу мелких банок на фоне. Первая строка строго «Фокус: БРЕНД»; если основной бренд не читается или неоднозначен — «Фокус: ?».
Читай только банки этого бренда в основной группе. Другие бренды, дальние полки, мелкие и обрезанные банки по краям исключи полностью; их названия не перечисляй. Не подставляй бренд центральных банок для этикеток другого бренда на фоне.
Перепиши текст с фото. Ничего не додумывай: если часть надписи не читается, поставь «?» вместо неё.
Если на фото банки с табаком для кальяна (этикетки с брендом и вкусом, печатные или от руки) — по одной строке на каждую банку в формате «Этикетка N: БРЕНД ВКУС», ровно как написано на этикетке (N — номер по порядку: слева направо, сверху вниз). Банку, срезанную краем кадра так, что надпись не видна, пропусти. Две одинаковые этикетки на разных банках — две строки.
Если на фото накладная, чек или другой документ — перепиши весь текст построчно, как есть, без строк «Этикетка».
Для рукописных и сложных этикеток: сперва установи собственный бренд банки, затем название на ТОЙ ЖЕ банке. Известные подтверждённые примеры для сверки (не подставляй их без видимых подтверждений): Palitra Pear Date (OCR может ошибочно дать Pear Bate); Trofimoff's Finlandia Vanila, Bailey's, Cashmere Guava, Wintergreen (не называй Trofimoff's брендом «Слепой»); Overdose Амбровый банан (не Арбузный); World Tobacco Original / WTO / VTO Maas Dam. Если надпись на этикетке неразборчива или не совпадает с примером — оставь «?», не угадывай.
Kraken Magnum — это бренд Kraken, линейка Magnum. Опознавай код слева от слова MAGNUM НА ТОЙ ЖЕ БАНКЕ: S = Seco, L = Ligero; S07 и L07 разные коды. Подтверждённые примеры с фото: S07 Wild Strawberry, S05 Raspberry, S02 Peanut. Для других кодов аромат не придумывай. Если код или название не читается или противоречит друг другу — отмечай «?».
Не смешивай похожие бренды: Наш — Бренди; Endorphin — Бельгийские вафли (не Starline и не Bliss только по слову «вафли»). Сарма — отдельный бренд, названия с рукописных бирок читай буквально.
Сохрани строку «Фокус: …» первой. Без пояснений, только текст.`;
async function claudeReadPhotos(client: Anthropic, messages: any[]) {
  const model = Deno.env.get("PHOTO_MODEL") || "claude-sonnet-5-5";
  const texts: string[] = [];
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    m.content = await Promise.all(m.content.map(async (b: any) => {
      if (b.type !== "image") return b;
      const r = await client.messages.create({
        model, max_tokens: 2000,
        messages: [{ role: "user", content: [b, { type: "text", text: PHOTO_PROMPT }] }],
      }, { timeout: 90000, maxRetries: 0 });
      if (r.stop_reason === "refusal") { const e: any = new Error("image_rejected"); e.status = 422; throw e; }
      const text = r.content.filter((x: any) => x.type === "text").map((x: any) => x.text).join("").trim();
      texts.push(text);
      return { type: "text", text: "[Фото, текст прочитан с фото. Каждая строка «Этикетка N: …» — отдельная банка; бренд и вкус с разных этикеток не смешивай]\n" + (text || "(текста на фото не нашлось)") };
    }));
  }
  return texts;
}
// Чем читать фото: Claude, если он подключён (PHOTO_READER=yandex — принудительно Yandex Vision).
// Claude не ответил — подстраховывает Yandex Vision, как раньше.
async function readPhotos(client: Anthropic | null, messages: any[]): Promise<{ texts: string[]; by: string } | false> {
  if (client && Deno.env.get("PHOTO_READER") !== "yandex") {
    const backup = JSON.parse(JSON.stringify(messages.map((m: any) => m.content)));
    const t0 = Date.now();
    try {
      const texts = await claudeReadPhotos(client, messages);
      // След в логах функции: сколько фото, сколько строк-этикеток и за сколько — чтобы разбирать жалобы «фото не прочиталось»
      console.log("photo sonnet:", texts.map((t) => (t.match(/^Этикетка/gm) || []).length + " эт./" + t.length + " симв.").join(", "), (Date.now() - t0) + "ms");
      return { texts, by: "sonnet" };
    }
    catch (e) {
      console.log("claude photo failed:", (e as { status?: number }).status, String((e as Error).message).slice(0, 200));
      messages.forEach((m: any, i: number) => { m.content = backup[i]; });
    }
  }
  const t = await yandexOcr(messages);
  return t ? { texts: t, by: "yandex" } : false;
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
    const tg = await tgId(req);
    if (!tg) return out({ error: "session_expired" }, 401);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const member = await db.from("users").select("tg_id,venue_id").eq("tg_id",tg).maybeSingle();
    if (member.error) return out({error:"server_error"},500);
    if (!member.data?.venue_id) return out({error:"session_expired"},401);
    const { system, messages, tools, ocr_only } = await req.json();
    const hasImg = messages.some((m: any) => Array.isArray(m.content) && m.content.some((b: any) => b.type === "image"));
    // Только распознавание, без вызова модели: приложение сверяет текст с каталогом само и присылает фото
    // отдельными запросами (по одному), чтобы не упираться в лимит времени функции на нескольких фото сразу.
    // В дневной лимит не считаем — модель (Yandex/Gemini/Claude) тут не вызывается вообще.
    const claude = claudeKey ? new Anthropic(claudeApiKey ? { apiKey: claudeApiKey } : { authToken: claudeAuthToken!, baseURL: claudeBaseUrl || undefined }) : null;
    if (ocr_only) { const r = hasImg ? await readPhotos(claude, messages) : false; return out({ ocr: r ? r.by : undefined, ocr_texts: r ? r.texts : undefined }); }
    // Считаем только вопрос человека, не каждый шаг цикла инструментов: продолжение диалога внутри одного
    // вопроса всегда несёт результат инструмента (tool_result) — такие шаги не тратят дневной лимит
    const isToolStep = messages.some((m: any) => Array.isArray(m.content) && m.content.some((b: any) => b.type === "tool_result"));
    if (!isToolStep) {
      const hit = await db.rpc("ai_hit", { p: tg });
      if (hit.error) return out({ error: "server_error" }, 500);
      if (Number(hit.data) > DAILY_LIMIT) return out({ error: "rate_limited", scope: "daily" }, 429);
    }
    // Фото: картинки становятся текстом (Claude или Yandex Vision), и дальше их понимает любая модель
    const read = hasImg ? await readPhotos(claude, messages) : false;
    const ocr = read ? read.texts : false, ocrBy = read ? read.by : undefined;
    if (Deno.env.get("AI_PROVIDER") === "local" && (!hasImg || ocr)) {
      const r = await askLocal(db, String(system || ""), messages, tools || []);
      if (r) return out({ ...r, ocr: ocrBy, ocr_texts: ocr || undefined });
      if (!geminiKey && !claudeKey) return out({ error: "busy" }, 503);
    }
    // YandexGPT: платно по токенам (дёшево), без общего бесплатного лимита Gemini — Gemini остаётся запасным, если Yandex недоступен
    if (Deno.env.get("AI_PROVIDER") === "yandex") {
      const r = await askYandex(String(system || ""), messages, tools || []);
      if (r) return out({ ...r, ocr: ocrBy, ocr_texts: ocr || undefined });
      if (!geminiKey && !claudeKey) return out({ error: "busy" }, 503);
    }
    // ПК или YandexGPT не ответили — подстраховывает Claude, если он подключён (он стабильнее), иначе Gemini
    const fallbackProvider = Deno.env.get("AI_PROVIDER") === "local" || Deno.env.get("AI_PROVIDER") === "yandex";
    if (useGemini || (fallbackProvider && geminiKey && !claude)) return out({ ...(await askGemini(geminiKey!, String(system || ""), messages, tools || [])), ocr: ocrBy, ocr_texts: ocr || undefined });
    const want = Deno.env.get("AI_MODEL") || "claude-haiku-5-5";
    const model = MODELS.includes(want) ? want : "claude-haiku-5-5";

    const r = await claude!.messages.create({
      model,
      max_tokens: 2500,
      system: [{ type: "text", text: String(system || ""), cache_control: { type: "ephemeral" } }],
      messages,
      tools: Array.isArray(tools) && tools.length ? tools : undefined,
    });
    return out({ content: r.content, stop_reason: r.stop_reason, usage: r.usage, model: r.model || model, ocr: ocrBy, ocr_texts: ocr || undefined });
  } catch (e) {
    const status = (e as { status?: number }).status;
    console.error("ai error:", status, String((e as Error).message).slice(0, 300));
    if (status === 429) return out({ error: "rate_limited" }, 429);
    if (status === 503) return out({ error: "busy" }, 503);
    if (status === 401) return out({ error: "not_configured" }, 503);
    if (status === 400) return out({ error: "bad_request", detail: String((e as Error).message).slice(0, 300) }, 400);
    return out({ error: "server_error", detail: String((e as Error).message).slice(0, 200) }, 500);
  }
});
