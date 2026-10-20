# Полка

Склад и табачная карта для кальянной, с ИИ. Telegram Mini App.

- `index.html` собирается скриптом `build_app.py` из `src/stoika.html` и `app/` (слой базы `app/shim.js`, настройки `app/config.js`).
- `supabase/`: функция входа через Telegram (`functions/tg-auth`) и доработки схемы (`migrations_*.sql`).
- Бот: @PolkaHookahbot.
