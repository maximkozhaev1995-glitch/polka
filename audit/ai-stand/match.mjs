// Регрессионный тест сверки распознанного текста с каталогом (matchText из src/stoika.html) — без модели и без сети.
// Проверяет ровно тот код, который превращает «Этикетка N: …» или текст команды в список вкусов для ассистента и команд.
// Запуск: node match.mjs (стенд server.mjs должен быть запущен). Код выхода 1 — есть ошибки.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAND = process.env.STAND_URL || "http://127.0.0.1:" + (process.env.STAND_PORT || 8787);

// text — как приходит с фото или из команды; want — что должно найтись («Бренд|Вкус» или «Бренд|Линейка|Вкус»,
// повтор = несколько банок); amb — сколько строк должно уйти в «неоднозначно» (линейка/фасовка не различима)
const M = [
  { id: "m-01", text: "Этикетка 1: DARKSIDE SUPERNOVA", want: ["Darkside|Supernova"] },
  { id: "m-02", text: "Этикетка 1: SEBERO COLA\nЭтикетка 2: PALITRA COLA", want: ["Sebero|Cola", "Palitra|Cola"] },
  { id: "m-03", text: "Этикетка 1: COLA", want: [], note: "бренд не прочитан, Cola у трёх брендов — не угадывать" },
  { id: "m-04", text: "Этикетка 1: KRAKEN RASPBERRY", want: [], amb: 1, note: "две линейки Kraken с Raspberry — без линейки не угадывать" },
  { id: "m-05", text: "Этикетка 1: KRAKEN STRONG LIGERO RASPBERRY", want: ["Kraken|Strong Ligero|Raspberry"] },
  { id: "m-06", text: "Этикетка 1: TANGIERS LEMONGRASS", want: [], amb: 1, note: "Tangiers Lemongrass в двух фасовках (без линейки и «100 г»)" },
  { id: "m-07", text: "Этикетка 1: Darkside Barvy Orange\nЭтикетка 2: Darkside Barvy Orange", want: ["Darkside|Barvy Orange", "Darkside|Barvy Orange"], note: "две банки одного вкуса" },
  { id: "m-08", text: "Этикетка 1: BARVYORANGE", want: ["Darkside|Barvy Orange"], note: "слитно и без бренда (типичная ошибка OCR)" },
  { id: "m-09", text: "Этикетка 1: DARKSIDE SUPERNOV?", want: ["Darkside|Supernova"], note: "обрезано краем кадра" },
  { id: "m-10", text: "Этикетка 1: TRAFIMOFFS Nobilis", want: ["Trofimoff's|Nobilis"], note: "опечатка бренда с этикетки" },
  { id: "m-11", text: "Этикетка 1: Sebero Orange", want: ["Sebero|Orange"], note: "если OCR сам прочитал «Sebero Orange», сверка честно находит Sebero Orange" },
  { id: "m-12", text: "Этикетка 1: MUSTHAVE PINKMAN\nЭтикетка 2: DARKSIDE GRAPE\nЭтикетка 3: SEBERO GRAPE", want: ["Musthave|Pinkman", "Darkside|Grape", "Sebero|Grape"] },
  { id: "m-13", text: "Этикетка 1: Сарма черника", want: ["Сарма|360|Черника"] },
  { id: "m-14", text: "Этикетка 1: Black Burn Overdose\nЭтикетка 2: Overdose Kashmir Peach", want: ["Black Burn|Overdose", "Overdose|Kashmir Peach"], note: "Overdose — и бренд, и название вкуса Black Burn" },
  { id: "m-15", text: "Этикетка 1: DEUS COLA", want: ["Deus|Cola"] },
  { id: "m-16", text: "Этикетка 1: PINACOLADA", want: ["Black Burn|Pina Colada"], note: "слитное «Pina Colada»; «cola» внутри слова — не Cola" },
  { id: "m-17", text: "Sebero Grape\nDarkside Supernova", want: ["Sebero|Grape", "Darkside|Supernova"], note: "текст команды в две строки — бренд одной строки не переносится на другую" },
  // Добавлено в этапе 1
  { id: "m-18", text: "Этикетка 1: KRAKEN LIGERO RASPBERRY", want: ["Kraken|Strong Ligero|Raspberry"], note: "линейка прочитана частично" },
  { id: "m-19", text: "Этикетка 1: KRAKEN MEDIUM SECO WILD STRAWBERRY", want: ["Kraken|Medium Seco|Wild Strawberry"] },
  { id: "m-20", text: "Этикетка 1: TANGIERS LEMONGRASS 100 г", want: ["Tangiers|100 г|Lemongrass"], note: "фасовка указана" },
  { id: "m-21", text: "Этикетка 1: PALITRA PINACOLADA", want: [], note: "бренд есть, но «cola» внутри слова — не Palitra Cola" },
  { id: "m-22", text: "Sebero Grape, Darkside Supernova; Musthave Pinkman", want: ["Sebero|Grape", "Darkside|Supernova", "Musthave|Pinkman"], note: "список через запятую и точку с запятой" },
  { id: "m-23", text: "Sebero Grape 3\nDarkside Supernova 2 шт", want: ["Sebero|Grape", "Darkside|Supernova"], note: "строки с количеством" },
  { id: "m-24", text: "Kraken Raspberry", want: [], amb: 1, note: "команда без линейки — неоднозначно" },
  { id: "m-25", text: "Этикетка 1: SPACELYCHEE", want: ["Darkside|Space Lychee"], note: "слитно, другой вкус" },
  { id: "m-26", text: "Этикетка 1: Darkside Orange", want: [], note: "у Darkside нет просто Orange — не подменять Sebero Orange" },
  { id: "m-27", text: "Darkside Grape\nTangiers Grape", want: ["Darkside|Grape", "Tangiers|Grape"], note: "одно название, разные бренды на разных строках" },
];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(() => { window.Telegram = { WebApp: { initData: "stand", initDataUnsafe: {}, ready() {}, expand() {} } }; });
await page.route(/telegram\.org|fonts\.(googleapis|gstatic)/, (r) => r.abort());
await fetch(STAND + "/__reset", { method: "POST", body: "{}" });
await page.goto(STAND + "/");
await page.waitForFunction(() => typeof DATA !== "undefined" && typeof matchText === "function");
const { out, sweep } = await page.evaluate((M) => {
  const key = (x) => x.b + "|" + (x.l ? x.l + "|" : "") + x.n;
  const out = M.map((c) => {
    const m = matchText(c.text);
    const got = m.found.flatMap((f) => Array(f.jars || 1).fill(key(byId[f.id])));
    return { ...c, got, miss: m.not_found_lines, ambN: (m.ambiguous || []).length };
  });
  // Весь каталог: этикетка «Бренд Линейка Вкус» должна находить ровно этот вкус. Исключение: вкус без линейки,
  // у которого есть двойник с линейкой/фасовкой (Tangiers Wintergreen и Wintergreen 100 г) — по этикетке без
  // фасовки их не различить, правильный ответ «неоднозначно»
  // Дважды: как этикетка с фото и как строка команды («/перенос Бренд Линейка Вкус»)
  const sweep = DATA.flatMap((x) => ["Этикетка 1: ", ""].map((pre) => [x, pre])).map(([x, pre]) => {
    const m = matchText(pre + x.b + " " + (x.l ? x.l + " " : "") + x.n);
    const ids = m.found.map((f) => f.id);
    if (!ids.length && !x.l && (m.ambiguous || []).some((a) => a.options.some((o) => o.id === x.id))) return null;
    return ids.length === 1 && ids[0] === x.id ? null : { want: (pre ? "этикетка " : "команда ") + key(x), got: ids.map((i) => key(byId[i])), amb: (m.ambiguous || []).length };
  }).filter(Boolean);
  return { out, sweep };
}, M);
await browser.close();
let ok = 0;
const lines = out.map((c) => {
  const pass = JSON.stringify([...c.got].sort()) === JSON.stringify([...c.want].sort()) && (c.amb === undefined || c.ambN === c.amb);
  if (pass) ok++;
  return `| ${c.id} | ${c.text.replace(/\n/g, " / ")} | ${c.want.join(", ") || "—"}${c.amb ? " (неоднозначно)" : ""} | ${c.got.join(", ") || "—"}${c.ambN ? " (неоднозначно: " + c.ambN + ")" : ""} | ${c.miss.join(", ") || ""} | ${pass ? "✓" : "✗"} | ${c.note || ""} |`;
});
const md = `# Сверка текста с каталогом (matchText)\n\nСлучаи: верно ${ok} из ${out.length}\n\nВесь каталог (этикетка «Бренд Линейка Вкус» → ровно этот вкус): ошибок ${sweep.length}\n\n` +
  `| Тест | Текст | Ожидается | Нашлось | Не нашлось | | Заметка |\n|---|---|---|---|---|---|---|\n${lines.join("\n")}\n` +
  (sweep.length ? "\n## Каталог: не нашёлся ровно сам\n\n" + sweep.map((s) => `- ${s.want} → ${s.got.join(", ") || "ничего"}${s.amb ? " (неоднозначно)" : ""}`).join("\n") + "\n" : "");
fs.mkdirSync(path.join(HERE, "results"), { recursive: true });
fs.writeFileSync(path.join(HERE, "results", "match.md"), md);
console.log(md);
process.exit(ok === out.length && !sweep.length ? 0 : 1);
