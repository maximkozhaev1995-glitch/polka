# © 2026 Максим Кожаев. Все права защищены. Копирование, распространение и использование без письменного согласия автора запрещены.
# ИИ Полки на своём компьютере: Ollama + очередь запросов в Supabase.
# Компьютер сам спрашивает у Полки новые запросы (как мессенджер), отвечает моделью и отправляет ответ обратно.
# Туннель и входящие подключения не нужны, поэтому работает и через VPN.
# Пока окно открыто — ассистент отвечает с этого компьютера; закрыли окно — через минуту отвечает запасной Gemini.
# Запуск: start.bat (рядом должен лежать key.txt с ключом LOCAL_AI_KEY из секретов Supabase).
import json, os, re, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
# Под RTX 3060 Ti (8 ГБ) + 64 ГБ ОЗУ: MoE-модель, активны ~3 млрд параметров из 30 — часть слоёв в видеопамяти,
# остальное в оперативке, скорость остаётся рабочей. Своя сборка «polka» — та же модель с длинным контекстом.
BASE = os.environ.get("POLKA_AI_BASE", "qwen3:30b-a3b")
MODEL = os.environ.get("POLKA_AI_MODEL", "polka")
MODELFILE = f"FROM {BASE}\nPARAMETER num_ctx 16384\nPARAMETER temperature 0.7\nPARAMETER top_p 0.8\nPARAMETER top_k 20\n"
FUNC = "https://wwcgvwfmlkegaqkksujo.supabase.co/functions/v1/ai"
ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3Y2d2d2ZtbGtlZ2Fxa2tzdWpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1MTU3MzAsImV4cCI6MjEwODA5MTczMH0.Zrf-0ohug-BE0PPbMgUkSF9TLSOu2gxMnoxEmBtZZcY"
try:
    KEY = open(os.path.join(HERE, "key.txt"), encoding="utf-8").read().strip()
except OSError:
    sys.exit("Нет файла key.txt рядом со скриптом. В нём должен быть ключ LOCAL_AI_KEY.")


def chat(req):
    """Запрос в формате OpenAI → родной /api/chat Ollama с think=false (Qwen3 без «размышлений») → ответ в формате OpenAI."""
    msgs = []
    for m in req.get("messages", []):
        m = dict(m)
        for c in m.get("tool_calls") or []:
            a = c["function"].get("arguments")
            c["function"]["arguments"] = json.loads(a) if isinstance(a, str) and a else (a or {})
        msgs.append(m)
    # Qwen3 на части версий Ollama игнорирует think=false; /no_think в последнем сообщении пользователя выключает размышления в самой модели
    for m in reversed(msgs):
        if m.get("role") == "user" and isinstance(m.get("content"), str):
            m["content"] += " /no_think"
            break
    body = {"model": MODEL, "messages": msgs, "stream": False, "think": False,
            "options": {"num_predict": int(req.get("max_tokens") or 2500)}}
    if req.get("tools"):
        body["tools"] = req["tools"]
    r = urllib.request.urlopen(urllib.request.Request(OLLAMA + "/api/chat", json.dumps(body).encode(), {"Content-Type": "application/json"}), timeout=120)
    msg = json.load(r).get("message", {})
    calls = [{"id": "c%d_%d" % (int(time.time() * 1000), i), "type": "function",
              "function": {"name": c["function"]["name"], "arguments": json.dumps(c["function"].get("arguments") or {}, ensure_ascii=False)}}
             for i, c in enumerate(msg.get("tool_calls") or [])]
    text = re.sub(r"(?s)<think>.*?</think>", "", msg.get("content") or "")
    text = text.split("</think>")[-1].strip()  # размышления без открывающего тега
    out = {"role": "assistant", "content": text}
    if calls:
        out["tool_calls"] = calls
    return {"choices": [{"message": out, "finish_reason": "tool_calls" if calls else "stop"}]}


def call(body, timeout):
    req = urllib.request.Request(FUNC, json.dumps(body, ensure_ascii=False).encode(),
                                 {"Content-Type": "application/json", "Authorization": "Bearer " + ANON, "apikey": ANON, "x-local-key": KEY})
    return json.load(urllib.request.urlopen(req, timeout=timeout))


def serve():
    online = None
    while True:
        try:
            job = call({"poll": {"model": MODEL}}, 40).get("job")
        except Exception as e:
            if online is not False:
                print("Нет связи с Полкой:", e, "— пробую снова…", flush=True)
            online = False
            time.sleep(5)
            continue
        if not online:
            print("Готово. Ассистент Полки отвечает с этого компьютера. Не закрывайте окно.", flush=True)
            online = True
        if not job:
            continue
        t0 = time.time()
        try:
            res, mark = chat(job["req"]), "ок"
        except Exception as e:
            res, mark = {"error": str(e)}, "ошибка: " + str(e)[:80]
        print(time.strftime("%H:%M:%S"), "запрос от Полки:", mark, f"{time.time() - t0:.1f} с", flush=True)
        try:
            call({"done": {"id": job["id"], "res": res}}, 30)
        except Exception as e:
            print("Не удалось отправить ответ:", e, flush=True)


def check_ollama():
    try:
        tags = json.load(urllib.request.urlopen(OLLAMA + "/api/tags", timeout=5))
    except Exception:
        sys.exit("Ollama не запущена. Откройте Ollama и запустите start.bat ещё раз.")
    names = [m.get("name", "") for m in tags.get("models", [])]
    if not any(n.split(":")[0] == MODEL for n in names):
        if BASE not in names:
            print(f"Скачиваю модель {BASE} (один раз, около 19 ГБ)…", flush=True)
            subprocess.run(["ollama", "pull", BASE], check=True)
        mf = os.path.join(HERE, "Modelfile")
        open(mf, "w", encoding="utf-8").write(MODELFILE)
        subprocess.run(["ollama", "create", MODEL, "-f", mf], check=True)


if __name__ == "__main__":
    check_ollama()
    print(f"Модель {MODEL}. Подключаюсь к Полке…", flush=True)
    serve()
