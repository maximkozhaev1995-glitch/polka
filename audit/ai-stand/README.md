# Стенд для тестов ИИ-ассистента Mixora

Гоняет **настоящее приложение** (`src/stoika.html` + `app/shim.js`) в браузере и **настоящую функцию**
`supabase/functions/ai` (запущенную локально через Deno, с реальными ключами моделей). Рабочая база Supabase
не используется: вместо неё `server.mjs` — маленький PostgREST в памяти. Все «записи» остаются в памяти стенда
и попадают в журнал, по которому тест проверяет, что без «Подтвердить» ничего не записалось.

```
браузер (Playwright) ── приложение как есть ──► server.mjs :8787 ──► /rest/v1/*  база в памяти + журнал записей
                                                     │
                                                     └──► /functions/v1/ai ──► функция ai (Deno) :8000 ──► Claude / Gemini / YandexGPT
                                                                               (SUPABASE_URL = стенд)
```

## Что нужно

- Node 18+ и Playwright с Chromium (`npm i playwright && npx playwright install chromium`, если ещё нет).
- Deno 2 (`npm i deno` даёт `node_modules/.bin/deno`).
- Ключи моделей **в переменных окружения** (в файлы и в git не класть). Достаточно ключей для того провайдера,
  который тестируем — это те же переменные, что у функции в Supabase:
  - Claude: `ANTHROPIC_API_KEY` (или `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL`), `AI_MODEL` (например `claude-sonnet-5-5`)
  - Gemini: `GEMINI_API_KEY`, `AI_PROVIDER=gemini`
  - YandexGPT и Yandex Vision: `YANDEX_API_KEY`, `YANDEX_FOLDER_ID`, `AI_PROVIDER=yandex`

## Запуск

```bash
cd audit/ai-stand
node server.mjs &                                   # стенд :8787
SUPABASE_URL=http://127.0.0.1:8787 SUPABASE_SERVICE_ROLE_KEY=stand \
AI_PROVIDER=claude AI_MODEL=claude-sonnet-5-5 ANTHROPIC_API_KEY=... \
  deno run --allow-net --allow-env ../../supabase/functions/ai/index.ts &   # функция ai :8000

node match.mjs               # сверка текста с каталогом (без модели) → results/match.md
CMD_ONLY=1 node run.mjs      # команды /перенос, /найти… (без модели)
node run.mjs                 # все сценарии с моделью → results/<время>/report.md и results.json
node run.mjs amb-01 wr-03    # выборочно
PHOTOS=1 PHOTOS_DIR=/путь/к/фото node run.mjs ph-01   # с фото; эталон — <фото>.expected.txt рядом
```

Сравнение моделей: перезапустить функцию ai с другим `AI_PROVIDER`/`AI_MODEL` и прогнать те же сценарии.
Переключение при сбое: `AI_PROVIDER=yandex` с заведомо неверным `YANDEX_API_KEY` — функция должна уйти в Claude.

## Что сохраняется по каждому тесту

Запрос, модель (по ответу функции), каждый шаг: вызовы инструментов с аргументами и результатами, время шага,
сбои; итоговый ответ, черновик склада, заказ, записи в базу стенда, автоматические проверки (PASS/FAIL) и пустая
колонка «Вручную» для оценки по смыслу. Сценарии и проверки — в `cases.mjs`.

## Безопасность

- В рабочую базу стенд не пишет. `snapshot.mjs` (необязательный) только читает склад через read-only эндпоинт.
- Токен входа стенда неподписанный и годится только для стенда (функция ai локально не проверяет подпись —
  в Supabase это делает шлюз, см. отчёт аудита).
- `selftest-fake-model.mjs` — только самопроверка стенда (изображает модель заранее известным ответом),
  результаты с моделью `selftest-fake` — не тест ИИ.
