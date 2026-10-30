# Mixora — verified staging schema gaps and safe reconstruction checklist (2026-10-31)

## Scope and guardrails
Read-only inspection of PostgreSQL catalog metadata from production and test projects, plus staging GitHub review. No production writes, no client deployment, no `main` merge, and no staging database DDL/data edits in this checkpoint.
- Production: `wwcgvwfmlkegaqkksujo` — metadata read-only.
- Test: `qnohynnwasoyjakrrrhb` — currently ACTIVE_HEALTHY.
- Branch: `staging/mixora-isolated-20261031` — was 12 commits ahead of `main` before this report; zero commits behind.
- Restored archive: `mixora_restorecheck_1793190662565` in test database. Keep it immutable.

## Exact confirmed mismatch
| Item | Production public | Test public | Archived schema |
| --- | ---: | ---: | ---: |
| Base tables | 25 | 8 | 22 |
| SQL functions in public | 11 | 5 | not an API baseline |
| Custom public triggers | 2 | 0 | not an API baseline |
| Public RLS policies | 52 (prior audit) | 22 (prior audit) | 0 |
| venues columns | id, name, created_at | id only | id, name, created_at |

Production base tables absent from test `public` (17):
`ai_jobs`, `ai_local`, `ai_usage`, `codes`, `favorites`, `guest_mixes`, `inv_log`, `invites`, `knowledge`, `knowledge_cat`, `mixes`, `orders`, `pack_sizes`, `suppliers`, `task_log`, `tasks`, `wishes`.

Production functions absent from test `public` (6):
`ai_hit(bigint)`, `ai_take_job()`, `claim_guest_mix(uuid)`, `enforce_master_stock()`, `users_default_manager()`, `wishes_limit()`.

Production custom triggers absent from test `public` (2):
`users_default_manager` on `users` and `wishes_limit_t` on `wishes`.

Existing test `public` table columns match the names in production for the other 7 shared tables. This is **column-name comparison only**; it is not evidence of type, default, check, index, or constraint parity.

## Why the archived snapshot cannot be used directly
The 22 restored archived tables predate later application migrations. Archive `stock` lacks `revision`; archive `moves` lacks `operation_id`, `stock_revision` and `next_state`. It has no `flavor_strengths`, `flavor_packs` or `photo_corrections` tables and has **no RLS policies**. Do not expose the archive as an API schema, point clients to it, or bulk-copy its rows into the current test `public`.

## Migration divergence
Production migration history reports:
- `20261028130228_pr77_stock_uniform_staff_venue_catalog`
- `20261028135157_prevent_undo_of_undo`
- `20261029173503_pr85_photo_corrections`
- `20261029181429_bar_inventory_20261029_backup_before_photo_reconciliation`

Test has its own nine migration-history entries starting from `20261027075715_b5_isolated_test_baseline`, so migration names cannot be replayed blindly. Reconcile definitions and dependencies, not just version numbers.

## Next safe execution steps
1. Capture current test `public` schema/fixtures and compare types, defaults, PK/FK/unique/check, grants, RLS expressions, functions and triggers against production metadata. Preserve the existing archive and test-only identities.
2. Construct a reviewed schema parity migration **targeted only at the test project**, with explicit guardrails, reversible steps and safeguards for the divergent `venues` baseline. Prefer recreating in an isolated scratch schema first to validate dependencies before touching test `public`.
3. Prepare sanitized test fixtures. Use archive only as a reference/restore proof; never copy production credentials, user identities, Telegram secrets or live venue data wholesale. Map old stock/moves columns to the current revision/operation protocol.
4. Verify 25 tables, 11 functions, two triggers, corresponding RLS rules, grants, constraints, foreign keys, tenant A/B isolation and positive/negative authenticated PostgREST access. Raw SQL `SET ROLE` is not sufficient for full JWT E2E.
5. Verify test-only Telegram entrypoint and test Edge Functions, photo recognition and explicit approval, transfer and undo, orders/journal, stop-list/non-bar, concurrent operations, guest catalog build and browser flows.
6. Only after evidence is recorded request separate approval for any merge, production migration or deployment.

## Current status
**NOT READY FOR LIVE-LIKE E2E.** Source code isolation and a historical archive exist, but test `public` schema and authorization are not equivalent to production. This is an audit/checklist, **not** a claim that schema reconstruction or E2E tests have been performed.
