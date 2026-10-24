# © 2026 Максим Кожаев. Все права защищены. Копирование, распространение и использование без письменного согласия автора запрещены.
# ИИ Полки на своём компьютере: Ollama за туннелем Cloudflare.
# Скрипт поднимает защищённый ключом вход к Ollama, открывает туннель и сообщает его адрес Полке.
# Пока окно открыто — ассистент отвечает с этого компьютера; закрыли окно — отвечает запасной Gemini.
# Запуск: start.bat (рядом должен лежать key.txt с ключом LOCAL_AI_KEY из секретов Supabase).
import json, os, re, subprocess, sys, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
# Под RTX 3060 Ti (8 ГБ) + 64 ГБ ОЗУ: MoE-модель, активны ~3 млрд параметров из 30 — часть слоёв в видеопамяти,
# остальное в оперативке, скорость остаётся рабочей. Своя сборка «polka» — та же модель с длинным контекстом.
BASE = os.environ.get("POLKA_AI_BASE", "qwen3:30b-a3b")
MODEL = os.environ.get("POLKA_AI_MODEL", "polka")
MODELFILE = f"FROM {BASE}\nPARAMETER num_ctx 16384\nPARAMETER temperature 0.7\nPARAMETER top_p 0.8\nPARAMETER top_k 20\n"
PORT = 8787
FUNC = "https://wwcgvwfmlkegaqkksujo.supabase.co/functions/v1/ai"
ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3Y2d2d2ZtbGtlZ2Fxa2tzdWpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1MTU3MzAsImV4cCI6MjEwODA5MTczMH0.Zrf-0ohug-BE0PPbMgUkSF9TLSOu2gxMnoxEmBtZZcY"
CF = os.path.join(HERE, "cloudflared.exe" if os.name == "nt" else "cloudflared")
CF_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"

try:
    KEY = open(os.path.join(HERE, "key.txt"), encoding="utf-8").read().strip()
except OSError:
    sys.exit("Нет файла key.txt рядом со скриптом. В нём должен быть ключ LOCAL_AI_KEY.")


class Proxy(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.send(200, b'{"ok":true}')

    def do_POST(self):
        if self.headers.get("Authorization") != "Bearer " + KEY:
            return self.send(403, b'{"error":"forbidden"}')
        if self.path != "/v1/chat/completions":
            return self.send(404, b'{"error":"not_found"}')
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        try:  # Qwen3 без «размышлений»: отвечает сразу, для стойки так быстрее
            j = json.loads(body)
            j["model"] = MODEL
            for m in j.get("messages", []):
                if m.get("role") == "system":
                    m["content"] = str(m.get("content") or "") + "\n/no_think"
                    break
            body = json.dumps(j).encode()
        except ValueError:
            pass
        t0 = time.time()
        try:
            r = urllib.request.urlopen(urllib.request.Request(OLLAMA + self.path, body, {"Content-Type": "application/json"}), timeout=120)
            data, code = r.read(), r.status
        except urllib.error.HTTPError as e:
            data, code = e.read(), e.code
        except Exception as e:
            data, code = json.dumps({"error": str(e)}).encode(), 502
        print(time.strftime("%H:%M:%S"), "запрос от Полки:", code, f"{time.time() - t0:.1f} с", flush=True)
        self.send(code, data)


def register(url):
    req = urllib.request.Request(FUNC, json.dumps({"register": {"url": url, "model": MODEL}}).encode(),
                                 {"Content-Type": "application/json", "Authorization": "Bearer " + ANON, "apikey": ANON, "x-local-key": KEY})
    try:
        urllib.request.urlopen(req, timeout=20).read()
        return True
    except Exception as e:
        print("Не удалось сообщить адрес Полке:", e, flush=True)
        return False


CUR = {}


def heartbeat():  # раз в 10 минут напоминаем адрес: после сбоя Полка минуту не обращается к компьютеру
    while True:
        time.sleep(600)
        if CUR.get("url"):
            register(CUR["url"])


def tunnel():
    if not os.path.exists(CF):
        print("Скачиваю cloudflared (один раз)…", flush=True)
        urllib.request.urlretrieve(CF_URL, CF)
    while True:
        p = subprocess.Popen([CF, "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{PORT}"],
                             stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace")
        for line in p.stderr:
            m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
            if m and CUR.get("url") != m.group(0):
                CUR["url"] = m.group(0)
                time.sleep(3)  # туннелю нужно пару секунд, чтобы начать принимать запросы
                if register(CUR["url"]):
                    print("Готово. Ассистент Полки отвечает с этого компьютера. Не закрывайте окно.", flush=True)
        CUR.pop("url", None)
        print("Туннель упал, перезапускаю…", flush=True)
        time.sleep(5)


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
    threading.Thread(target=tunnel, daemon=True).start()
    threading.Thread(target=heartbeat, daemon=True).start()
    print(f"Модель {MODEL}. Открываю туннель…", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Proxy).serve_forever()
