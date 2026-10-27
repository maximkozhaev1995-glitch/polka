// Сверка распознанного текста с каталогом (matchText из src/stoika.html) — без модели и без сети.
// Проверяет ровно тот код, который превращает «Этикетка N: …» в список вкусов для ассистента и команд.
// Запуск: node match.mjs (стенд server.mjs должен быть запущен)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAND = process.env.STAND_URL || "http://127.0.0.1:" + (process.env.STAND_PORT || 8787);

// text — как приходит с фото; want — что должно найтись («Бренд|Вкус», повтор = несколько банок); ambiguous — ничего не угадывать
// cand — кандидаты на уточнение (m.ambiguous, «Бренд|Вкус»): возможное название, которое НЕ попадает в подтверждённые
const M = [
  { id: "m-01", text: "Этикетка 1: DARKSIDE SUPERNOVA", want: ["Darkside|Supernova"] },
  { id: "m-02", text: "Этикетка 1: SEBERO COLA\nЭтикетка 2: PALITRA COLA", want: ["Sebero|Cola", "Palitra|Cola"] },
  { id: "m-03", text: "Этикетка 1: COLA", want: [], note: "бренд не прочитан, Cola у трёх брендов — не угадывать" },
  { id: "m-04", text: "Этикетка 1: KRAKEN RASPBERRY", want: [], note: "две линейки Kraken с Raspberry — без линейки не угадывать" },
  { id: "m-05", text: "Этикетка 1: KRAKEN STRONG LIGERO RASPBERRY", want: ["Kraken|Strong Ligero|Raspberry"] },
  { id: "m-06", text: "Этикетка 1: TANGIERS LEMONGRASS", want: [], note: "Tangiers Lemongrass в двух фасовках (без линейки и «100 г»)" },
  { id: "m-07", text: "Этикетка 1: Darkside Barvy Orange\nЭтикетка 2: Darkside Barvy Orange", want: ["Darkside|Barvy Orange", "Darkside|Barvy Orange"], note: "две банки одного вкуса" },
  { id: "m-08", text: "Этикетка 1: BARVYORANGE", want: [], cand: ["Darkside|Barvy Orange"], note: "слитно и без бренда (типичная ошибка OCR) — только кандидат, не подтверждённое (правка m-16)" },
  { id: "m-08b", text: "Этикетка 1: DARKSIDE BARVYORANGE", want: ["Darkside|Barvy Orange"], cand: [], note: "слитно, но бренд прочитан — подтверждено" },
  { id: "m-09", text: "Этикетка 1: DARKSIDE SUPERNOV?", want: ["Darkside|Supernova"], note: "обрезано краем кадра" },
  { id: "m-10", text: "Этикетка 1: TRAFIMOFFS Nobilis", want: ["Trofimoff's|Nobilis"], note: "опечатка бренда с этикетки" },
  { id: "m-11", text: "Этикетка 1: Sebero Orange", want: ["Sebero|Orange"], note: "если OCR сам прочитал «Sebero Orange», сверка честно находит Sebero Orange — ошибка тогда в OCR" },
  { id: "m-12", text: "Этикетка 1: MUSTHAVE PINKMAN\nЭтикетка 2: DARKSIDE GRAPE\nЭтикетка 3: SEBERO GRAPE", want: ["Musthave|Pinkman", "Darkside|Grape", "Sebero|Grape"] },
  { id: "m-13", text: "Этикетка 1: Сарма черника", want: ["Сарма|360|Черника"] },
  { id: "m-14", text: "Этикетка 1: Black Burn Overdose\nЭтикетка 2: Overdose Kashmir Peach", want: ["Black Burn|Overdose", "Overdose|Kashmir Peach"], note: "Overdose — и бренд, и название вкуса Black Burn; на разных этикетках не путаются" },
  { id: "m-16", text: "Этикетка 1: PINACOLADA", want: [], cand: ["Black Burn|Pina Colada"], note: "«cola» внутри слова — не должна находиться Cola; Pina Colada без бренда — только кандидат" },
  { id: "m-16b", text: "Этикетка 1: BLACK BURN PINACOLADA", want: ["Black Burn|Pina Colada"], cand: [], note: "слитно, бренд прочитан — подтверждено" },
  { id: "m-16c", text: "Этикетка 1: SEBERO PINACOLADA", want: [], cand: [], note: "у Sebero нет Pina Colada — чужой бренд не подставляем" },
  { id: "m-16d", text: "/пополнить PINACOLADA 5", want: [], cand: ["Black Burn|Pina Colada"], note: "текст команды без «Этикетка» — тоже только кандидат" },
  { id: "m-17", text: "/перенос Sebero Grape\nDarkside Supernova", want: ["Sebero|Grape", "Darkside|Supernova"], note: "текст команды в две строки (без «Этикетка»)" },
  { id: "m-15", text: "Этикетка 1: DEUS COLA", want: ["Deus|Cola"] },
];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(() => { window.Telegram = { WebApp: { initData: "stand", initDataUnsafe: {}, ready() {}, expand() {} } }; });
await page.route(/telegram\.org|fonts\.(googleapis|gstatic)/, (r) => r.abort());
await fetch(STAND + "/__reset", { method: "POST", body: "{}" });
await page.goto(STAND + "/");
await page.waitForFunction(() => typeof DATA !== "undefined" && typeof matchText === "function");
const out = await page.evaluate((M) => {
  const key = (x) => x.b + "|" + (x.l ? x.l + "|" : "") + x.n;
  return M.map((c) => {
    const m = matchText(c.text);
    const got = m.found.flatMap((f) => Array(f.jars || 1).fill(key(byId[f.id])));
    return { ...c, got, miss: m.not_found_lines, amb: m.found.filter((f) => f.ambiguous).map((f) => key(byId[f.id])), cands: (m.ambiguous || []).map((a) => a.brand + "|" + a.name) };
  });
}, M);
await browser.close();
let ok = 0;
const lines = out.map((c) => {
  const pass = JSON.stringify([...c.got].sort()) === JSON.stringify([...c.want].sort())
    && (!c.cand || JSON.stringify([...c.cands].sort()) === JSON.stringify([...c.cand].sort()));
  if (pass) ok++;
  return `| ${c.id} | ${c.text.replace(/\n/g, " / ")} | ${c.want.join(", ") || "—"} | ${c.got.join(", ") || "—"} | ${c.miss.join(", ") || ""} | ${c.cands.join(", ") || ""} | ${pass ? "✓" : "✗"} | ${c.note || ""} |`;
});
const md = `# Сверка текста с каталогом (matchText)\n\nВерно: ${ok} из ${out.length}\n\n| Тест | Текст | Ожидается | Нашлось | Не нашлось | Уточнить | | Заметка |\n|---|---|---|---|---|---|---|---|\n${lines.join("\n")}\n`;
fs.mkdirSync(path.join(HERE, "results"), { recursive: true });
fs.writeFileSync(path.join(HERE, "results", "match.md"), md);
console.log(md);
