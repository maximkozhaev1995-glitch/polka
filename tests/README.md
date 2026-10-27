# Локальные регрессии без сети и production

Из корня репозитория:

```
node tests/matching.cjs
node tests/actions.cjs
```

Требуется Node 18+. Дополнительных пакетов и ключей не нужно.
Matching исполняет реальные функции из src/stoika.html и использует случаи audit/ai-stand/match.mjs.
Actions исполняет реальные функции предложений/команд/диалога из исходника; база, модель и DOM — заглушки. Это не браузерный тест и не настоящий Claude API.
Браузерный стенд и инструкции: audit/ai-stand/README.md.
