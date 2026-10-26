// Необязательно: снимок склада рабочего заведения ТОЛЬКО ЧТЕНИЕМ (эндпоинт database/query/read-only), чтобы
// гонять тесты на настоящих остатках. Пишет snapshot.json рядом (в git не попадает, см. .gitignore).
// Нужен SUPABASE_ACCESS_TOKEN в окружении. Потом: STAND_SNAPSHOT=1 node run.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REF = process.env.SUPABASE_REF || "wwcgvwfmlkegaqkksujo";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("нужен SUPABASE_ACCESS_TOKEN"); process.exit(1); }
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query/read-only`, {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(r.status + " " + (await r.text()));
  return r.json();
};
const stock = await q("select flavor_id, wh, bar, stop, stop_auto, slow, retired from stock where venue_id = (select id from venues order by created_at limit 1)");
const flavors = await q("select id, brand, line, name, descr, custom from flavors where custom");
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "snapshot.json"), JSON.stringify({ tables: { stock, flavors } }, null, 1));
console.log("snapshot.json: stock", stock.length, "· свои вкусы", flavors.length);
