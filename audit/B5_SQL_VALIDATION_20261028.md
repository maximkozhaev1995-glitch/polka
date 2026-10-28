# B5 SQL validation follow-up — 2026-10-28

Owner explicitly authorized an isolated local PostgreSQL test database.
No production Supabase access, SQL, merge or deployment was performed.
Starting head: `709af0c40d314b53158e4746628ee3c1eab1d5f0`.

## Confirmed local execution

Native PostgreSQL cannot start in this executor: it runs as uid 0 in a single-UID
namespace, cannot switch to a database OS user, and has no Docker. No OS permission
restrictions were bypassed. Packages were extracted into scratch; no PostgreSQL
system service or production connection was started.

PGlite 0.5.13 (PostgreSQL 18.6 WASM) ran the actual proposal SQL against a synthetic
in-memory schema. Nine SQL groups passed: NULL permissions/array elements/role,
first receipt, NULL bar and required comparison, serial UUID replay and mismatches,
canonical payload order, full batch/key rollback, serial stale employee conflict
and fresh retry, table+column ACL/private schema/anon denial, venue/input isolation,
and compatibility with the known legacy stock trigger.

WASM is single-connection. Its serial checks are not proof of concurrency.
Native PostgreSQL 16 tests are added as a separate GitHub Actions job with an
isolated disposable service bound to runner loopback. The fixture is shared with
the WASM runner. Initial native run for `d5f5c9093154cefe933b4e375b934c9fff5ebcf4` passed all 8 tests:
https://github.com/maximkozhaev1995-glitch/polka/actions/runs/40760566844
It used PostgreSQL 16.15 and real independent connections. The subsequent NULL-bar
trigger regression below is an additional change; its native run must also pass.

## Reproduced and fixed defect

The original `enforce_master_stock` trigger rejects automatic stop removal on
receipt by a master with `perms=['add']`, raising P0001 (no unstop permission).
A test reproduced this against the actual legacy trigger text from migrations_003.
The proposal now updates that trigger function: authorized automatic transition
`old.stop_auto=true`, positive new stock and `new.stop_auto=false` is allowed;
manual stop removal still needs `unstop`. NULL permission elements are removed,
errors use SQLSTATE 42501, search_path is empty and trigger EXECUTE is revoked.
The proposal does not disable the trigger or grant direct table DML.

An added master-with-add-only regression also reproduced a false Bar forbidden:
legacy raw NULL -> false normalization was treated as an actual bar transition.
The updated trigger compares coalesce(new.bar,false) with coalesce(old.bar,false),
aligning its semantic comparison with the RPC. The WASM regression now passes;
the same regression is included in the native suite. SQL/lock/job timeouts bound
CI hangs; the container image is pinned to the digest observed in the successful run.

## Limits and verdict

CHANGES REQUESTED. This synthetic fixture includes the known trigger and independent
column grants, but not the complete production schema, inherited roles, other
privileged APIs, PostgREST/JWT authentication or real browser locks. Safe server
compensation is still absent, and legacy stock/flag/inventory/catalog operations
remain closed. No claim of release readiness is made.

The previous B5_AUDIT_20261028.md is historical evidence for head 709af0c; this
follow-up supersedes its statement that no SQL was executed at all.


## Final native evidence — 16fb2482146ea9ca818692fd7034bed5d8837d19

https://github.com/maximkozhaev1995-glitch/polka/actions/runs/40760995002
Both build-consistency and database-regressions succeeded. Native PostgreSQL
16.15: **9 tests, OK**, including real parallel same-UUID idempotency, competing
employees, row-lock waiting for permission revocation and flavor venue transfer,
legacy auto-stop and NULL-bar compatibility, table/column grants and isolation.
Test service was stopped and removed by the workflow. No Supabase was used.

Client suite: 13 PASS groups; actions 20 PASS; matching 27/27 plus 1144 cases.
The build job verified exact index.html rebuild equality. All seven mandatory
audit checks now have passing evidence on the synthetic baseline (UI side uses VM).
Complete production baseline, real PostgREST/JWT, native browser Web Locks and
compensating undo remain outside this proof. Verdict: CHANGES REQUESTED.

Native logs: test_1_null_permissions, test_2_first_receipt, test_3_null_bar,
test_4_idempotency, test_5_atomic_rollback, test_6_concurrent_employees,
test_access_and_isolation, test_concurrent_revocation_and_flavor_transfer,
test_legacy_trigger_automatic_stop — all OK (9 tests in 1.067 s).
