// ТОЛЬКО для самопроверки стенда (что журнал, инструменты, черновик и отчёт собираются), это НЕ тест ИИ:
// изображает Claude Messages API с заранее известным ответом — сначала вызывает find_items, потом отвечает текстом.
// Запуск: node selftest-fake-model.mjs, а функцию ai — с ANTHROPIC_BASE_URL=http://127.0.0.1:8799 ANTHROPIC_AUTH_TOKEN=selftest
import http from "node:http";

http.createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    const b = JSON.parse(raw || "{}");
    const last = b.messages?.[b.messages.length - 1];
    const gotResult = Array.isArray(last?.content) && last.content.some((x) => x.type === "tool_result");
    const words = String(typeof b.messages?.[0]?.content === "string" ? b.messages[0].content : "").split(/\s+/).slice(-2).join(" ");
    const content = gotResult || !b.tools?.length
      ? [{ type: "text", text: "САМОПРОВЕРКА СТЕНДА: результат инструмента получен." }]
      : [{ type: "tool_use", id: "toolu_selftest" + Date.now(), name: "find_items", input: { query: words } }];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "msg_selftest", type: "message", role: "assistant", model: "selftest-fake", content,
      stop_reason: gotResult || !b.tools?.length ? "end_turn" : "tool_use", usage: { input_tokens: 0, output_tokens: 0 } }));
  });
}).listen(8799, "127.0.0.1", () => console.log("fake model on :8799 (selftest only)"));
