// Тестовый стенд ИИ-ассистента Mixora: локальный сервер, который заменяет Supabase для приложения.
// - отдаёт приложение, собранное из src/stoika.html + app/shim.js (как build_app.py), но с адресом этого сервера;
// - /functions/v1/tg-auth — тестовый вход (без Telegram), выдаёт неподписанный токен с tg_id;
// - /rest/v1/* — маленький PostgREST в памяти: все записи остаются здесь и в журнале writes, рабочая база не трогается;
// - /functions/v1/ai — пересылает в ЛОКАЛЬНО запущенную функцию supabase/functions/ai (Deno), с журналом и
//   внедрением сбоев (для проверки повторов и переключения моделей).
// Запуск: node server.mjs  (порт STAND_PORT, по умолчанию 8787; функция ai — AI_UPSTREAM, по умолчанию http://127.0.0.1:8000)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const PORT = Number(process.env.STAND_PORT || 8787);
const AI_UPSTREAM = process.env.AI_UPSTREAM || "http://127.0.0.1:8000";
const VENUE = "00000000-0000-4000-8000-000000000001";

// ===== состояние «базы» в памяти =====
let db, writes, aiLog, faults, user;
function reset(seed = {}) {
  db = {
    stock: [], moves: [], orders: [], flavors: [], pack_sizes: [], wishes: [], users: [], invites: [], suppliers: [],
    mixes: [], inv_log: [], tasks: [], task_log: [], knowledge_cat: [], knowledge: [], guest_mixes: [], ai_usage: [],
  };
  for (const [t, rows] of Object.entries(seed.tables || {})) db[t] = JSON.parse(JSON.stringify(rows));
  user = Object.assign({ tg_id: 1001, venue_id: VENUE, name: "Тест-стенд", role: "manager", perms: [] }, seed.user || {});
  db.users = [user];
  writes = []; aiLog = []; faults = [];
}
reset(fs.existsSync(path.join(HERE, "snapshot.json")) ? JSON.parse(fs.readFileSync(path.join(HERE, "snapshot.json"), "utf8")) : {});

// ===== приложение =====
function appHtml() {
  const s0 = fs.readFileSync(path.join(ROOT, "src/stoika.html"), "utf8");
  const shim = fs.readFileSync(path.join(ROOT, "app/shim.js"), "utf8");
  const cfg = `window.POLKA_CONFIG={url:"http://127.0.0.1:${PORT}",anon:"stand-anon",tgBot:"stand"};`;
  const i = s0.indexOf("<script>");
  // Шрифты из интернета стенду не нужны — убираем, чтобы прогон не зависел от сети
  return (s0.slice(0, i) + "<script>" + cfg + "</script>\n<script>" + shim + "</script>\n" + s0.slice(i))
    .replace(/<link[^>]+fonts\.googleapis[^>]*>/g, "");
}

// ===== мини-PostgREST =====
const KEYS = { stock: ["venue_id", "flavor_id"], orders: ["venue_id"], flavors: ["id"], users: ["tg_id"], invites: ["code"], pack_sizes: ["brand"] };
function parseFilters(q) {
  const f = [];
  for (const [k, v] of q) {
    if (["select", "order", "limit", "on_conflict", "offset"].includes(k)) continue;
    let m;
    if ((m = v.match(/^eq\.(.*)$/))) f.push((r) => String(r[k]) === m[1]);
    else if ((m = v.match(/^in\.\((.*)\)$/))) { const set = m[1].split(",").map(decodeURIComponent); f.push((r) => set.includes(String(r[k]))); }
    else if (v === "is.null") f.push((r) => r[k] === null || r[k] === undefined);
    else if (v === "not.is.null") f.push((r) => r[k] !== null && r[k] !== undefined);
    else f.push(() => true);
  }
  return (r) => f.every((fn) => fn(r));
}
let seq = 1;
function defaults(table, row) {
  const r = { ...row };
  if (["moves", "mixes", "suppliers", "inv_log", "tasks", "task_log", "knowledge_cat", "knowledge", "wishes", "guest_mixes"].includes(table) && r.id === undefined)
    r.id = table === "mixes" || table === "suppliers" ? "00000000-0000-4000-9000-" + String(seq++).padStart(12, "0") : seq++;
  if (r.created_at === undefined && table !== "stock") r.created_at = new Date().toISOString();
  if (table === "stock") r.bar = r.bar === undefined ? undefined : r.bar;
  return r;
}
function rest(method, table, q, body, prefer) {
  if (!db[table]) db[table] = [];
  const rows = db[table], match = parseFilters(q);
  if (method === "GET") {
    let out = rows.filter(match);
    const ord = q.get("order");
    if (ord) { const [c, dir] = ord.split("."); out = out.slice().sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (dir === "desc" ? -1 : 1)); }
    if (q.get("limit")) out = out.slice(0, Number(q.get("limit")));
    return [200, out];
  }
  writes.push({ at: new Date().toISOString(), method, table, query: q.toString(), body });
  if (method === "POST") {
    const list = Array.isArray(body) ? body : [body];
    const upsert = /merge-duplicates/.test(prefer || ""), conflict = (q.get("on_conflict") || "").split(",").filter(Boolean);
    const keys = conflict.length ? conflict : KEYS[table] || ["id"];
    const res = [];
    for (const b of list) {
      const ex = upsert ? rows.find((r) => keys.every((k) => String(r[k]) === String(b[k]))) : null;
      if (ex) { Object.assign(ex, b); res.push(ex); } else { const r = defaults(table, b); rows.push(r); res.push(r); }
    }
    return [201, /return=representation/.test(prefer || "") ? res : null];
  }
  if (method === "PATCH") { const hit = rows.filter(match); hit.forEach((r) => Object.assign(r, body)); return [200, null]; }
  if (method === "DELETE") { db[table] = rows.filter((r) => !match(r)); return [200, null]; }
  return [405, { message: "method" }];
}

// ===== сервер =====
const send = (res, code, obj, type = "application/json") => {
  res.writeHead(code, { "Content-Type": type + "; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" });
  res.end(obj === null || obj === undefined ? "" : typeof obj === "string" ? obj : JSON.stringify(obj));
};
const readBody = (req) => new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c).toString("utf8"))); });
const b64u = (s) => Buffer.from(s).toString("base64url");

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (req.method === "OPTIONS") return send(res, 204, null);
  const raw = await readBody(req);
  let body = null; try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
  try {
    if (u.pathname === "/" || u.pathname === "/index.html") return send(res, 200, appHtml(), "text/html");
    if (u.pathname.startsWith("/img/")) { const p = path.join(ROOT, u.pathname); return fs.existsSync(p) ? (res.writeHead(200), res.end(fs.readFileSync(p))) : send(res, 404, {}); }
    // Управление стендом (только для run.mjs)
    if (u.pathname === "/__reset") { reset(body || {}); return send(res, 200, { ok: true, venue: VENUE }); }
    if (u.pathname === "/__state") return send(res, 200, { db, writes, aiLog, user });
    if (u.pathname === "/__fault") { faults = Array.isArray(body) ? body : []; return send(res, 200, { ok: true }); }
    if (u.pathname === "/functions/v1/tg-auth") {
      // Как настоящая tg-auth, только без проверки Telegram: стенд локальный, токен никуда, кроме стенда, не годится
      const token = b64u('{"alg":"none","typ":"JWT"}') + "." + b64u(JSON.stringify({ role: "authenticated", tg_id: user.tg_id, exp: Math.floor(Date.now() / 1000) + 43200 })) + ".stand";
      return send(res, 200, { token, user });
    }
    if (u.pathname === "/functions/v1/ai") {
      const t0 = Date.now(), entry = { at: new Date().toISOString(), req: body };
      aiLog.push(entry);
      const f = faults.shift();
      if (f) { entry.fault = f; entry.ms = Date.now() - t0; entry.status = f.status; entry.res = f.body || { error: f.error || "busy" }; return send(res, f.status || 503, entry.res); }
      const r = await fetch(AI_UPSTREAM, { method: "POST", headers: { "Content-Type": "application/json", Authorization: req.headers.authorization || "" }, body: raw });
      const txt = await r.text();
      entry.ms = Date.now() - t0; entry.status = r.status; try { entry.res = JSON.parse(txt); } catch { entry.res = txt; }
      res.writeHead(r.status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); return res.end(txt);
    }
    // Нужно самой функции ai (SUPABASE_URL указывает сюда): счётчик лимита и ПК-очередь
    if (u.pathname === "/rest/v1/rpc/ai_hit") { const n = (db.ai_usage[0]?.n || 0) + 1; db.ai_usage = [{ tg_id: body?.p, n }]; return send(res, 200, n); }
    if (u.pathname.startsWith("/rest/v1/rpc/")) return send(res, 200, []);
    if (u.pathname.startsWith("/rest/v1/")) {
      const table = u.pathname.slice(9);
      const [code, out] = rest(req.method, table, u.searchParams, body, req.headers.prefer);
      return send(res, code, out);
    }
    if (u.pathname.startsWith("/storage/")) return send(res, 200, {});
    send(res, 404, { message: "stand: " + u.pathname });
  } catch (e) { send(res, 500, { message: String(e?.message || e) }); }
}).listen(PORT, "127.0.0.1", () => console.log("stand on http://127.0.0.1:" + PORT + " → ai " + AI_UPSTREAM));
