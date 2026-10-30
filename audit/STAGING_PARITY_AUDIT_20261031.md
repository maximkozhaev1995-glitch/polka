# Mixora — staging parity audit (2026-10-31)

**Scope:** read-only inspection of production DB metadata and test DB metadata/data counts; static GitHub staging branch inspection. **Not a full security or E2E sign-off.**

## Identity and isolation
- GitHub staging branch: `staging/mixora-isolated-20261031`, ahead of `main` by 10 commits at inspection; no merge or production deployment performed.
- Production Supabase project: `wwcgvwfmlkegaqkksujo` (read-only metadata inspection).
- Test Supabase project: `qnohynnwasoyjakrrrhb`.
- Staging app config and generated staff + guest pages target only the test Supabase URL and test anon key. Guest page has test venue `10000000-0000-0000-0000-000000000001`.
- Offline guest page builder refuses network catalog refresh. **Embedded guest catalog is not validated against test DB.**
- Frontend still configures `PolkaHookahbot` and guest QR opens that Telegram bot; a separate staging Telegram entrypoint has **not** been verified.

## Production vs test schema parity (verified by read-only SQL)
| Check | Production `public` | Test `public` | Archived test schema |
|---|---:|---:|---:|
| Base tables | 25 | 8 | 22 |
| `flavors` rows | 589 (prior checkpoint) | 26 | 575 |
| `stock` rows | 588 (prior checkpoint) | 2 | 574 |
| `moves` rows | 191 (prior checkpoint) | 0 | 20 |
| `venues` rows | 1 (prior checkpoint) | 2 | 1 |
| `users` rows | 3 (prior checkpoint) | 4 | 3 |
| `public` SQL functions | 11 | 5 | N/A |
| `public` RLS policies | 52 | 22 | N/A |
| `public` triggers | 2 | 0 | N/A |

The archived schema is `mixora_restorecheck_1793190662565`. All 22 archived tables have RLS enabled, but **the archive has 0 RLS policies**; it is NOT an exposed working API replacement for `public`. Never directly point the client at this schema or expose it through PostgREST.

17 production base tables are missing from test `public`, notably `orders`, `suppliers`, `wishes`, `mixes`, `ai_jobs`, `ai_usage`, `inv_log`, `tasks`. Test `public` also lacks 6 production SQL functions and both production triggers, with 30 fewer RLS policies. The test app cannot be considered functionally equivalent to production.

Test `public` has isolated test fixtures and distinct schema revision fields on `stock` and `moves`; copying archive rows without an explicit migration and mapping plan would be unsafe for test consistency.

## Test backend status
- Test Edge Functions `tg-auth` and `ai` exist and are active; test `tg-auth` uses `verify_jwt=false` (custom Telegram verification must be checked end to end), test `ai` has `verify_jwt=true`.
- A prior checkpoint recorded test AI function code mismatch vs production. No end-to-end authentication, photo OCR, inventory mutation, tenant isolation or Telegram mobile proof has been established in this audit.

## Release blockers (all OPEN)
1. **P0** Rebuild a safe, internally consistent, API-accessible test database (25-table target, functions, triggers, RLS, fixtures), while preserving the archived restore schema and current test fixtures. No unreviewed bulk overwrite of `public`.
2. **P0** Validate venue-scoped access control with role/JWT and negative A/B tenant-isolation tests; archived snapshot RLS policy count is zero.
3. **P0** Validate a TEST-only Telegram entrypoint, auth configuration and Edge Function behavior. Prevent inadvertent production bot flows or production stock writes.
4. **P1** Regenerate guest catalog from approved test fixtures, preserving correct flavor identities, and run offline static guards + browser regressions.
5. **P1** Test: photo → proposed matches → user approval → transfer → undo, stop-list/non-bar/slow movers, concurrency, failures, idempotency, order and journal paths. Document all pass/fail evidence.
6. **P0** No staging deployment, `main` merge or production write until separately authorized after gates pass.

## What was done
- Only connector reads against project databases and repository files, plus this audit document on the isolated staging branch.
- No changes to production database, live venue inventory or `main`.

**Status: staging NOT READY; next phase is controlled parity reconstruction on the isolated test project, with test fixtures and explicit post-migration verification.**
