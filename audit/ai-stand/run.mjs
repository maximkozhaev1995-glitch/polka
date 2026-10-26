// Прогон сценариев ассистента через настоящее приложение (src/stoika.html + app/shim.js) в браузере и настоящую
// функцию ai (запущенную локально, с реальными ключами моделей). База — стенд в памяти (server.mjs), рабочая не трогается.
// Для каждого теста сохраняется: запрос, модель, вызовы инструментов с аргументами и результатами, длительность,
// записи в «базу», черновик, заказ, ответ и автоматическая оценка по проверкам из cases.mjs.
//   node run.mjs                 — все сценарии без фото
//   node run.mjs bar-01 amb-01   — только выбранные
//   PHOTOS=1 PHOTOS_DIR=... node run.mjs   — плюс сценарии с фото
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { BASE, CASES, CMD_CASES, PHOTO_CASES } from "./cases.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAND = process.env.STAND_URL || "http://127.0.0.1:" + (process.env.STAND_PORT || 8787);
const VENUE = "00000000-0000-4000-8000-000000000001";
const PHOTOS_DIR = process.env.PHOTOS_DIR || "/mnt/project-files/uploads/hearth";
const TIMEOUT = Number(process.env.CASE_TIMEOUT_MS || 240000);

const post = (p, b) => fetch(STAND + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b ?? {}) }).then((r) => r.json());
const getState = () => fetch(STAND + "/__state").then((r) => r.json());

function resolver(DATA) {
  return (key) => {
    const p = key.split("|");
    const [b, l, n] = p.length === 3 ? p : [p[0], null, p[1]];
    let c = DATA.filter((x) => x.b === b && x.n === n && (l === null || x.l === l));
    if (c.length > 1 && l === null) c = c.filter((x) => !x.l);
    if (c.length !== 1) throw new Error("в каталоге не найдено однозначно: " + key + " (" + c.length + ")");
    return c[0].id;
  };
}

function seedStock(DATA, id, cs) {
  let rows;
  const snap = path.join(HERE, "snapshot.json");
  if (process.env.STAND_SNAPSHOT && fs.existsSync(snap)) rows = JSON.parse(fs.readFileSync(snap, "utf8")).tables.stock;
  else rows = DATA.map((x) => ({ venue_id: VENUE, flavor_id: x.id, wh: BASE.whDefault, bar: BASE.barFromCatalog ? !!x.bar : false, stop: false, stop_auto: false, slow: false, retired: false }));
  rows = rows.map((r) => ({ ...r, venue_id: VENUE }));
  for (const [k, v] of Object.entries(cs.stock || {})) {
    const fid = id(k), r = rows.find((x) => x.flavor_id === fid);
    if (r) Object.assign(r, v); else rows.push({ venue_id: VENUE, flavor_id: fid, wh: 0, stop: false, stop_auto: false, slow: false, retired: false, ...v });
  }
  return rows;
}

// Журнал вызовов функции ai → шаги: модель, вызовы инструментов, их результаты (из следующего запроса), время
function traceOf(aiLog) {
  const steps = [];
  aiLog.forEach((e, i) => {
    const res = e.res || {};
    if (e.req?.ocr_only) { steps.push({ type: "ocr", ms: e.ms, status: e.status, by: res.ocr, texts: res.ocr_texts, fault: e.fault }); return; }
    const calls = (res.content || []).filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input }));
    const text = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const next = aiLog.slice(i + 1).find((x) => !x.req?.ocr_only);
    const lastUser = next?.req?.messages?.[next.req.messages.length - 1];
    const results = Array.isArray(lastUser?.content) ? lastUser.content.filter((b) => b.type === "tool_result") : [];
    calls.forEach((c) => { const r = results.find((x) => x.tool_use_id === c.id); if (r) { c.result = String(r.content).slice(0, 1500); if (r.is_error) c.error = true; } });
    steps.push({ type: "model", ms: e.ms, status: e.status, model: res.model, stop: res.stop_reason, usage: res.usage, error: res.error, fault: e.fault,
      tools_offered: (e.req?.tools || []).map((t) => t.name), system_chars: String(e.req?.system || "").length, calls, text });
  });
  return steps;
}

function check(cs, ctx, id) {
  const out = [];
  const add = (name, pass, detail) => out.push({ name, pass, detail });
  const called = new Set(ctx.trace.flatMap((s) => (s.calls || []).map((c) => c.name)));
  for (const t of cs.tools || []) add("вызван " + t, called.has(t), [...called].join(", ") || "инструменты не вызывались");
  for (const t of cs.noTools || []) add("не вызван " + t, !called.has(t), called.has(t) ? "вызван" : "");
  if (cs.draftEmpty) add("черновик пуст", Object.keys(ctx.draft).length === 0, JSON.stringify(ctx.draft));
  if (cs.draft) {
    const want = Object.fromEntries(Object.entries(cs.draft).map(([k, v]) => [id(k), { ...v, key: k }]));
    for (const [fid, v] of Object.entries(want)) {
      const got = ctx.draft[fid] || {};
      const ok = (v.d === undefined || got.d === v.d) && (v.bar === undefined || got.bar === v.bar);
      add("черновик " + v.key + " " + JSON.stringify({ d: v.d, bar: v.bar }), ok, JSON.stringify(got));
    }
    const extra = Object.keys(ctx.draft).filter((k) => !want[k]);
    add("в черновике нет лишнего", !extra.length, extra.map((k) => ctx.name(k)).join(", "));
  }
  for (const k of cs.orderHas || []) add("в заказе " + k, !!ctx.order[id(k)], "");
  for (const k of cs.orderNot || []) add("не в заказе " + k, !ctx.order[id(k)], "");
  for (const t of cs.noWrites || []) { const w = ctx.writes.filter((x) => x.table === t); add("нет записи в " + t + " без «Подтвердить»", !w.length, w.map((x) => x.method + " " + JSON.stringify(x.body).slice(0, 160)).join(" | ")); }
  for (const r of cs.says || []) add("в ответе " + r, r.test(ctx.answer), "");
  for (const r of cs.notSays || []) add("в ответе нет " + r, !r.test(ctx.answer), (ctx.answer.match(r) || [""])[0]);
  if (ctx.expectedPhoto) {
    const { want, got } = ctx.expectedPhoto, w = [...want], g = [...got];
    let tp = 0; for (const x of g) { const j = w.indexOf(x); if (j >= 0) { tp++; w.splice(j, 1); } }
    add("фото: найдено верно " + tp + " из " + want.length + " (лишних " + (g.length - tp) + ")", tp === want.length && g.length === tp, "пропущено: " + w.map(ctx.name).join(", "));
  }
  return out;
}

async function main() {
  const only = process.argv.slice(2);
  let cases = process.env.CMD_ONLY ? CMD_CASES : [...CMD_CASES, ...CASES, ...(process.env.PHOTOS ? PHOTO_CASES : [])];
  if (only.length) cases = cases.filter((c) => only.includes(c.id));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(HERE, "results", stamp);
  fs.mkdirSync(dir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  // Вход как из Telegram Mini App: стенд принимает любой initData (см. server.mjs)
  await page.addInitScript(() => { window.Telegram = { WebApp: { initData: "stand", initDataUnsafe: {}, ready() {}, expand() {} } }; });
  await page.route(/telegram\.org|fonts\.(googleapis|gstatic)/, (r) => r.abort());
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));

  await post("/__reset", {});
  await page.goto(STAND + "/");
  await page.waitForFunction(() => typeof DATA !== "undefined" && DATA.length > 0);
  const DATA = await page.evaluate(() => DATA.map((x) => ({ id: x.id, b: x.b, l: x.l || "", n: x.n, bar: !!x.bar })));
  const id = resolver(DATA), name = (fid) => { const x = DATA.find((y) => y.id === fid); return x ? x.b + " " + (x.l ? x.l + " " : "") + x.n : fid; };

  const results = [];
  for (const cs of cases) {
    const t0 = Date.now();
    let r = { id: cs.id, group: cs.group, ask: cs.ask, note: cs.note };
    try {
      await post("/__reset", { tables: { stock: seedStock(DATA, id, cs) }, user: cs.user });
      await post("/__fault", cs.fault || []);
      await page.evaluate(() => localStorage.clear());
      await page.goto(STAND + "/");
      await page.waitForFunction(() => !document.querySelector("#login") && typeof stockLoaded !== "undefined" && stockLoaded && typeof sampleFn !== "undefined" && !!sampleFn, null, { timeout: 30000 });
      if (cs.photos) {
        const files = cs.photos.map((p) => {
          const f = fs.readdirSync(PHOTOS_DIR).find((x) => x.startsWith(p));
          if (!f) throw new Error("нет фото " + p + " в " + PHOTOS_DIR);
          return { name: f + ".jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(path.join(PHOTOS_DIR, f)) };
        });
        await page.setInputFiles("#ai-photo", files);
      }
      await page.evaluate((t) => { document.querySelector("#ai-in").value = t; }, cs.ask);
      const tSend = Date.now();
      await page.evaluate(() => document.querySelector("#ai-send").click());
      await page.waitForFunction(() => aiCtl === null && !document.querySelector("#ai-log .msg.assistant.wait"), null, { timeout: TIMEOUT });
      await page.waitForTimeout(800); // сохранение заказа идёт с задержкой 500 мс (saveOrder)
      const ms = Date.now() - tSend;
      const ui = await page.evaluate(() => {
        const m = [...document.querySelectorAll("#ai-log .msg.assistant")].pop();
        return { answer: m ? m.innerText : "", src: m?.querySelector(".msrc")?.textContent || "", draft: JSON.parse(JSON.stringify(draft)), order: JSON.parse(JSON.stringify(orderQ)) };
      });
      const st = await getState();
      const trace = traceOf(st.aiLog);
      let expectedPhoto = null;
      if (cs.photos) {
        const exp = cs.photos.map((p) => { const f = fs.readdirSync(PHOTOS_DIR).find((x) => x.startsWith(p)); const e = path.join(PHOTOS_DIR, f + ".expected.txt"); return fs.existsSync(e) ? e : null; });
        const ocrTexts = trace.filter((s) => s.type === "ocr").flatMap((s) => s.texts || []);
        const matched = await page.evaluate((ts) => ts.map((t) => { const m = matchText(t); return { found: m.found.map((x) => ({ id: x.id, jars: x.jars })), miss: m.not_found_lines }; }), ocrTexts);
        r.photo = { ocr: ocrTexts, matched: matched.map((m) => ({ found: m.found.map((x) => name(x.id) + (x.jars > 1 ? " ×" + x.jars : "")), miss: m.miss })) };
        if (exp.every(Boolean)) expectedPhoto = {
          want: exp.flatMap((e) => fs.readFileSync(e, "utf8").split(/\n/).map((s) => s.trim()).filter(Boolean).map(id)),
          got: matched.flatMap((m) => m.found.flatMap((x) => Array(x.jars).fill(x.id))),
        };
      }
      const ctx = { ...ui, trace, writes: st.writes, expectedPhoto, name };
      r = { ...r, ms, model: [...new Set(trace.filter((s) => s.model).map((s) => s.model))].join(", "), src: ui.src, answer: ui.answer,
        draft: Object.fromEntries(Object.entries(ui.draft).map(([k, v]) => [name(k), v])),
        order: Object.fromEntries(Object.entries(ui.order).map(([k, v]) => [name(k), v])),
        writes: st.writes, trace, ...r.photo ? { photo: r.photo } : {} };
      r.checks = check(cs, ctx, id);
      r.auto = r.checks.length ? (r.checks.every((c) => c.pass) ? "PASS" : "FAIL") : "—";
    } catch (e) { r.auto = "ERROR"; r.error = String(e.message || e); }
    r.total_ms = Date.now() - t0;
    r.page_errors = errors.splice(0);
    results.push(r);
    console.log(r.auto.padEnd(5), cs.id.padEnd(8), (r.model || "").padEnd(28), String(r.ms || "").padStart(6) + " ms", r.error || "");
  }
  await browser.close();
  fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(dir, "report.md"), report(results));
  console.log("\nрезультаты:", dir);
}

function report(rs) {
  const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const calls = (r) => (r.trace || []).flatMap((s) => (s.calls || []).map((c) => c.name + "(" + JSON.stringify(c.input) + ")" + (c.error ? " ✗" : ""))).join("; ");
  let md = "# Прогон ассистента на стенде\n\nДата: " + new Date().toISOString() + "\n\n";
  md += "| Тест | Группа | Запрос | Модель | Инструменты | Время | Авто | Вручную |\n|---|---|---|---|---|---|---|---|\n";
  for (const r of rs) md += `| ${r.id} | ${esc(r.group)} | ${esc(r.ask)} | ${esc(r.model)} | ${esc(calls(r)).slice(0, 300)} | ${r.ms ?? ""} мс | ${r.auto} |  |\n`;
  for (const r of rs) {
    md += `\n## ${r.id} · ${r.group}\n\n**Запрос:** ${r.ask}\n\n` + (r.note ? `**Что проверяем:** ${r.note}\n\n` : "");
    if (r.error) { md += "**Ошибка стенда:** " + r.error + "\n"; continue; }
    md += `**Модель:** ${r.model || "—"} · ${r.src || ""} · ${r.ms} мс\n\n**Ответ:**\n\n> ${String(r.answer).replace(/\n/g, "\n> ")}\n\n`;
    md += "**Шаги:**\n\n" + (r.trace || []).map((s, i) => `${i + 1}. ${s.type === "ocr" ? "фото (" + (s.by || "не прочитано") + ")" : (s.model || "сбой " + (s.fault ? JSON.stringify(s.fault) : s.status))} — ${s.ms} мс` +
      (s.calls || []).map((c) => `\n   - \`${c.name}\` ${JSON.stringify(c.input)} → ${c.error ? "ОШИБКА " : ""}${String(c.result || "").slice(0, 300)}`).join("")).join("\n") + "\n\n";
    if (Object.keys(r.draft || {}).length) md += "**Черновик:** " + JSON.stringify(r.draft) + "\n\n";
    if (Object.keys(r.order || {}).length) md += "**Заказ:** " + JSON.stringify(r.order) + "\n\n";
    if ((r.writes || []).length) md += "**Записи в базу (стенд):** " + r.writes.map((w) => w.method + " " + w.table).join(", ") + "\n\n";
    if (r.photo) md += "**Фото:** найдено — " + r.photo.matched.map((m) => m.found.join(", ")).join(" / ") + "; не нашлось — " + r.photo.matched.map((m) => m.miss.join(", ")).join(" / ") + "\n\n";
    md += "**Проверки:**\n" + (r.checks || []).map((c) => `- ${c.pass ? "✓" : "✗"} ${c.name}${c.detail && !c.pass ? " — " + c.detail : ""}`).join("\n") + "\n";
    if (r.page_errors?.length) md += "\n**Ошибки JS на странице:** " + r.page_errors.join("; ") + "\n";
  }
  return md;
}

main().catch((e) => { console.error(e); process.exit(1); });
