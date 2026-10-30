# Mixora — verified isolated staging schema restoration (2026-10-31)

**Status: SCHEMA PARITY PASS; application / security E2E NOT APPROVED.**

## Scope and hard guardrails
- Repository: `maximkozhaev1995-glitch/polka`, **only** `staging/mixora-isolated-20261031` changed.
- Production Supabase project `wwcgvwfmlkegaqkksujo`: inspected with read-only metadata queries. **No production SQL writes, Edge deployment, secret changes, GitHub main merge or live deploy**.
- Isolated test Supabase `qnohynnwasoyjakrrrhb`: DDL migrations applied only here.
- Original 22-table archive in `mixora_restorecheck_1793190662565` left intact. Its lack of RLS policies means it remains archival, not an exposed API target.
- All migrations include an explicit archive-presence check to prevent accidentally applying against production; baseline migration also checks the initial 8-table state.

## Verified structural parity (post-migration)
| `public` object | Production | Isolated test | Result |
| --- | ---: | ---: | --- |
| Base tables | 25 | 25 | PASS |
| Columns | 180 | 180 | PASS, individual column definitions compared |
| Constraints | 69 | 69 | PASS, individual names/definitions compared |
| Indexes | 35 | 35 | PASS, individual names/definitions compared |
| RLS policies | 52 | 52 | PASS, full policy records compared |
| SQL functions | 11 | 11 | PASS, full function definitions compared |
| Application triggers | 2 | 2 | PASS, definitions restored |
| Public views | 2 | 2 | Restored; security caveat below |

Every public table currently has RLS enabled. This is **schema parity**, not equality of application data or an E2E sign-off.

## Changes performed on test only
1. Used independently verified 17/17 matching archived table-column, constraint and index structures to create the 17 missing public tables **without copying a single archived/production application row**.
2. Restored 10 foreign keys, 30 missing RLS policies, six missing SQL functions, two triggers and two public views. Adjusted the preexisting test `venues` fixture schema to production's `name`, `created_at` and default ID contract; added synthetic labels to the existing two test venue rows.
3. Replaced test-only `venue_read_test` with production-equivalent `venues_own_read`. Explicitly restricted internal AI RPC execute rights. Did not grant TRUNCATE to web roles.
4. Preserved stricter photo-label validation while normalizing its redundant test constraint into the production constraint name.
5. Renamed three equivalent indexes and created the missing `moves_venue_id_at_idx`.
6. Updated the isolated PR77 SQL smoke test to supply the required synthetic venue names.

Test-only migrations applied successfully:
- `staging_20261031_restore_missing_public_baseline`
- `staging_20261031_photo_constraint_parity`
- `staging_20261031_index_parity`

All three were first tested inside rollback transactions. The first migration additionally asserted the expected 25/52/11/2/2 counts before commit.

## Data preservation verified
- Test `public` remains: 26 `flavors` rows; 2 `stock` rows; 0 `moves`; 4 `users`; 2 `venues`.
- The archival restore schema remains 22 tables.
- No live production stock or employee identities were copied into the public test application tables.
- Restored 17 missing tables initially have empty application data: real workflows still require **synthetic** fixtures.

## Executed live tests on isolated PostgreSQL 17.11
- **15/15 PR77 transaction-based checks PASSED**, after updating temporary fixture venue names. Included staff membership, atomic/idempotent `apply_stock`, stale revision rejection, stop/slow flags, catalog isolation, tenant A/B, cross-venue override rejection, anonymous ACL, guest settings. All test rows rolled back.
- **6/6 new tenant smoke checks PASSED**, covering authenticated tenant identity independent of forged venue claims, orders/suppliers/tasks/inventory-log visibility, cross-venue write denial, anonymous private-table denial, guest wishes insert, and an explicit **risk-confirmation** below. All rows rolled back.
- These are SQL `SET LOCAL ROLE` probes, **not** a successful signed employee JWT through PostgREST, a browser test, or Telegram end-to-end test.

## Security warning: anonymous owner-privilege views
Supabase security advisor reports **ERROR** on `public.public_stock` and `public.public_mixes` in production. Both are owned by a privileged role, have `security_invoker=false`, and allow anonymous SELECT.
- On the isolated test database, an anonymous session could see two synthetic `public_stock` rows belonging to **two different venues**, through the copied production view definition despite base-table RLS. This is verified cross-venue *public view visibility*.
- No production application rows were accessed in this probe. Whether cross-venue public inventory availability is acceptable depends on the guest-map disclosure contract; it must be explicitly decided and tested. Until then treat as a **release-blocking exposure risk**.
- Converting the view blindly to `security_invoker=true` may break legitimate guest catalog functionality. Design an appropriately scoped public-data interface, update the guest client, and verify positive/negative cases before a controlled production fix.
- Other advisor items: `SECURITY DEFINER` helper exposure and two mutable function search paths; review before a security sign-off.
- Supabase reference: https://supabase.com/docs/guides/observability/advisors?queryGroups=lint&lint=0010_security_definer_view

## Remaining gates — NOT verified
- **P0:** clarify/harden anonymous inventory and mixes view exposure; test effective privilege model via real HTTP/JWT.
- **P0:** production `ai` Edge Function v57 differs from test `ai` v3; the test project is not yet a backend-behavioral clone. Production has an active function named `mixora-claude-ocr-isolated-test`; do not assume its name implies that it is hosted in a separate test project. Audit callers and keys, do not delete blindly.
- **P0:** test-only Telegram bot/entry point and signed employee authentication, genuine Edge function behavior and secrets isolation. Static staging files retain a production Telegram bot reference in the flow; do not direct staff to test without verification.
- **P1:** full browser/mobile WebView runs, photo recognition from original samples, corrected learning, approval → transfer → undo, concurrent-user failure handling, order/journal paths, and Storage HTTP.
- **P1:** app data/catalog/guest-page parity: test has 26 catalog flavors vs 589 at an earlier production checkpoint; guest page's embedded catalog still needs synchronization to validated test fixtures. This report does not claim the live row count is 589 now.
- **P1:** rebuild and execute full npm/Playwright integration test suite on this final state; no claim of a newly passing full suite is made.

## Reproducible materials in this isolated branch
- `audit/sql/staging-schema-health.sql`: read-only public schema / access snapshots; successfully executed on both projects.
- `audit/sql/TEST_ONLY_restore_missing_public_baseline_20261031.sql`: guarded schema restoration.
- `audit/sql/TEST_ONLY_photo_corrections_constraint_parity_20261031.sql`: strict constraint parity.
- `audit/sql/TEST_ONLY_index_parity_20261031.sql`: index parity.
- `tests/pr77-live-core.sql`: corrected 15-check rollback smoke.
- `tests/staging-tenant-smoke.sql`: reproduced six tenant/security probes.
- Earlier read-only reports remain in `audit/STAGING_*_20261031.md` as historical checkpoints; their `8/25` status predates this migration.

**Release decision:** isolated database **schema complete**, but **NO MERGE / NO PRODUCTION DEPLOY / NO LIVE BOT ROUTING** until remaining gates and explicit authorization.
