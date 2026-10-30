# Mixora staging checkpoint — 2026-10-31

**Status:** isolated code branch prepared; full working clone NOT yet verified. Do not merge or deploy.

## Existing resources
- GitHub branch: `staging/mixora-isolated-20261031`, copied from `main`.
- Production Supabase: `wwcgvwfmlkegaqkksujo` (read-only investigation only).
- Isolated Supabase project: `qnohynnwasoyjakrrrhb`.
- Test venue ID: `10000000-0000-0000-0000-000000000001`.
- Archived production snapshot in test-only schema `mixora_restorecheck_1793190662565`. This is an archived restore verification, not an active application database.

## Already implemented on staging branch
- Staff `app/config.js` and generated `index.html` use only the test Supabase endpoint and its public anon API key.
- Guest `karta/template.html` and generated `karta/index.html` use the same test project, public key and TEST venue.
- `tools/build_karta.py` is staging-only and offline-only. It refuses online catalog builds and preserves the previously embedded static catalog until full test catalog parity is established.
- `tests/staging-isolation.cjs` guards every relevant source/build artifact against production project and venue identifiers and verifies consistency.
- `.github/workflows/staging-isolation.yml` runs this guard for staging branch pushes.
- Isolation CI succeeded: https://github.com/maximkozhaev1995-glitch/polka/actions/runs/41142208903

## Confirmed parity gaps (read-only)
| Measure | Production public | Test public | Archived test schema |
| --- | ---: | ---: | ---: |
| flavors | 589 | 26 | 575 |
| stock | 588 | 2 | 574 |
| moves | 191 | 0 | 20 |
| venues | 1 | 2 | 1 |
| users | 3 | 4 | 3 |

- Test `public` has only 8 base tables; archived restore schema has 22; production currently has 25 base tables (information_schema).
- Staff and guest static clients are pointed at the test endpoint but full functionality will fail or differ until the test schema/data are aligned.
- Test AI Edge Function is not byte-identical to the production AI function; auth secrets and Telegram E2E not yet validated.
- Guest static catalog was previously embedded and is NOT synchronized with the test data. This does not establish a functioning guest card.
- No staging domain/Telegram entrypoint or mobile end-to-end test has been demonstrated.

## Release gates
1. Prepare a fresh, safely sanitized and internally consistent test baseline without disturbing the existing archived restore schema or test fixtures; verify counts, schema, constraints, policies, RPCs, storage and tenant boundaries.
2. Match test server function behavior with the intended application release; test Telegram auth and AI/OCR without production secrets or live inventory writes.
3. Build both clients from the intended test-only configuration, validate the embedded guest catalog, and run browser tests.
4. Test photo → recognition → inventory draft → transfer → undo, including failure, concurrent-user and off-bar/stop-list scenarios.
5. Confirm every client/server link stays in the test project. No merge into `main` or production deployment without separate explicit authorization.

This checkpoint is documentation, not evidence that the full test environment is ready.
