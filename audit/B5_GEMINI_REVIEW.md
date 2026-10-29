# Задание Gemini: независимое ревью Draft PR #75 Mixora

Репозиторий: https://github.com/maximkozhaev1995-glitch/polka
PR: https://github.com/maximkozhaev1995-glitch/polka/pull/75
Ветка: `codex/mixora-b5-atomic-proposal`.
Исходный SHA: `f65acdaed70a53a9b619600dd734566e6ec6829e`.
Коммит исправлений: `e559ab4484d969431709be46f6eaa2be0b2b8b9a`.
Дополнительный коммит содержит тесты и отчёт — возьми актуальный HEAD и запиши его SHA.

Твоя задача — независимое ревью, без изменений БД, merge и deploy.
Не считай прохождение моков доказательством транзакций PostgreSQL.

Изучи:
- `supabase/b5_atomic_stock_PROPOSAL.sql`
- `app/shim.js`
- `src/stoika.html`, `index.html`, `build_app.py`
- `supabase/migrations_003.sql` и прочие доступные миграции
- `tests/b5-client.cjs`, `tests/b5-database.py`
- `audit/B5_AUDIT_20261028.md`

Проверь независимо:
1. Права master при perms=NULL, ARRAY[NULL], NULL role; проверки venue и me_tg.
2. Полноту запрета прямой записи stock/moves: адаптер, table/column/inherited grants,
   RLS, definer функции, старые триггеры. Какие обходы ещё возможны?
3. Блокировки строк, новые stock rows, два сотрудника, deadlock/serialization,
   повтор/параллельный одинаковый operation_id, другой payload/actor, rollback всего батча.
4. Строгость JSON-валидации, expected_wh/bar, NULL, допустимые kind и ограничения moves.
5. Потерянный ответ, snapshot до ответа, повтор исходного UUID, изменение draft,
   reload, две вкладки и смена аккаунта. Найди риск повторного списания.
6. Безопасность отмены. Сейчас опасная отмена явно закрыта; компенсационный RPC
   не реализован. Не принимай восстановление старого prev/удаление журнала как решение.
7. Закрытые функции: быстрые операции, finish, инвентаризация, метки, создание вкуса,
   retire и undo. Подтверди, что нет частичных побочных записей/ложного успеха.
8. Достаточность семи обязательных проверок и воспроизводимость сборки.

Разрешены только локальные тесты без БД:
`node tests/b5-client.cjs`, `node tests/actions.cjs`, `node tests/matching.cjs`.
SQL tests НЕ запускались: владелец отдельно должен разрешить изолированную БД.
Минимальный fixture не доказывает совместимость production baseline.

Формат ответа: SHA; findings по важности с file:line, конкретным сценарием обхода,
исправлением и тестом; что реально проверено; ограничения; APPROVED либо
CHANGES REQUESTED. Не придумывай результаты SQL/browser тестов.
