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

B5 audit regressions:

```
node tests/b5-client.cjs
python3 tests/b5-database.py
```

The client runner executes the actual commit function and adapter in a VM with mocked
DOM, storage and network; it is not a browser/PostgREST integration test.
It checks mandatory audit #6 (UI half), #7, uncertain-response recovery,
snapshot races, draft edits, scoped pending, legacy pending rejection, UUID compare-delete,
and all nine legacy write entry points. Web Locks is mocked; real multi-tab browser
validation remains outstanding.

The database runner requires **separate owner permission**, psycopg 3, and a disposable
empty database named `mixora_b5_test*`. It exits 2 without permission/configuration;
that is NOT a passing SQL run. Set `B5_ALLOW_TEST_DATABASE=YES` and
`B5_TEST_DATABASE_URL` only after permission. It installs a minimal synthetic fixture,
then exercises mandatory #1–#6, direct write denial and venue isolation, including
real concurrent sessions. Do not use any production connection or credentials.
The synthetic fixture does not establish compatibility with the missing production
baseline, old stock triggers, PostgREST grants, JWT identity or inherited roles.


After owner approval on 2026-10-28, the GitHub workflow also runs a disposable
PostgreSQL 16 service on runner loopback. It uses only synthetic fixture data,
never Supabase credentials. The native suite installs the known legacy stock
trigger before applying the proposal, and includes the automatic/manual stop case.

Embedded SQL fallback (PostgreSQL 18 WASM; does NOT prove concurrent sessions):

```
npm ci --prefix tests/b5-wasm
node tests/b5-wasm/run.mjs
```

Dependencies are pinned in that test directory. Nine embedded SQL groups cover
serial behavior, grants and legacy trigger compatibility. Native concurrency
must pass the separate PostgreSQL CI job; WASM results are not a substitute.
