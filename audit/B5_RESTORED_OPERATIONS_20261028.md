# Restored warehouse operations — 2026-10-28

Starting HEAD: 5188569faed3eec555beea1f07910b4914ac7fce.
Proposal only. No production Supabase, deployment, merge or main modification.

## Implementation

- Explicit stock_action RPC restores quick take, receipt, finish, flags, retirement,
  write-off, manager inventory and catalog + initial stock creation.
- Server derives actor/venue, locks authorization/catalog rows and sorted stock,
  validates revision and permissions, commits movements and inventory summary together.
- Durable actor-scoped UUID replay covers all restored UI paths. Version-3 envelope
  shares the original pending key: older clients fail closed rather than bypassing
  an unresolved new request. The same non-queued Web Lock covers both RPCs.
- Revision sequence and full private before-images permit manager-only compensation
  of a whole operation, with unique reversal marker. Any intervening stock change,
  including ABA, rejects the entire undo. Original movements remain. Compensation
  cannot itself be undone. New catalog records are retained and retired on undo.
- Inventory compensation appends negative summary totals; missing package weights
  are explicitly marked as partial. Invoker-rights movement view exposes whether
  an original was compensated, even outside the client's 400-row window.
- Direct stock/movement and inventory-summary DML stays revoked, including column
  grants. AI flags use the same explicit RPC instead of generic snapshots.

## Independent review corrections

Fixed NULL flag restoration, implicit master write-off, partial weight reporting,
soft catalog undo semantics, and stale generated index. Regression tests cover each.
Legacy partial restore now aborts before destructive work when a B5 ledger exists.
A coordinated full database backup (public data + private ledger + sequences) is
required for database rollback. Reverting git commits is not a database rollback.
No database change was applied, so current production needs no rollback.

## Validation

Local: existing client 13 groups; restored client 7 groups; actions 20;
matching 27/27 and 1144 catalog cases; actual SQL in PGlite 14 groups.
Native CI passed on final code SHA 4c0fd4ddbf3002263ec4f6acf78ea8e15988235e: 19 tests in 2.223s, PostgreSQL 16.15. Native suite covers
parallel action replay/conflicts, double undo, atomic undo failure, inventory and
catalog transaction tests, ACL checks and independent-review regressions.

## Remaining release gates

Complete baseline CREATE definitions and real inherited privileges/other privileged
RPCs are absent from the repository. This fixture cannot prove those properties.
Real JWT/PostgREST and browser Web Locks integration remains untested. Database
backup/restore rehearsal requires an isolated copy of the complete baseline; legacy
partial snapshots are intentionally rejected. Do not apply the proposal to a real
Supabase project without separate approval and these checks. Independent code review: APPROVED, no remaining confirmed code blockers.
Release verdict: CHANGES REQUESTED until these integration gates are satisfied.

## Final evidence and commits

- ac7e557f643a4ed59476f4596f60fba3b6b4d41f — restored transactional operations and compensation.
- b8a9f1de2d0271644097bf243dcfa851f164e3ac — no-op/movement semantics and catalog cascade guards.
- 4c0fd4ddbf3002263ec4f6acf78ea8e15988235e — automatic stop clearing requires an authorized receipt.

Final CI: https://github.com/maximkozhaev1995-glitch/polka/actions/runs/40764772535
Both build-consistency (job123085835392) and database-regressions (job123085834986)
succeeded. Logs were retrieved and checked, including 19 native test names, OK,
and disposal of the PostgreSQL container. All 13 existing + 7 restored client
groups passed; actions20, matching27/27 and catalog1144/0 failures. The committed
index exactly matches build_app.py output. SQL-only last commit does not change it.

Independent review was repeated after each correction. Final review confirmed
no-op authorization, effective movement classification, negative-only explicit
write-off, and receipt-only auto-stop clearing. The latter was reproduced as an
empty-patch permission bypass against an inconsistent legacy row; new native and
WASM tests assert unchanged full row/revision/history on rejection and a successful
add-only receipt. Review also confirmed NULL undo, soft catalog retirement and
partial weight reporting corrections. Final reviewer verdict: APPROVED for reviewed
code, conditional on native CI; that CI subsequently passed as linked above.

Catalog direct INSERT/DELETE/key/venue UPDATE are also revoked to prevent cascades
from bypassing stock RPCs. Existing strength/pack_g editors retain column UPDATE
under existing RLS. Complete inherited grants/policies still require baseline audit.

## Rollback boundary

All changes are reversible git commits on the PR branch; the earlier backup branch
backup/pr75-before-audit-20261028-f65acda remains available. No database migration
was applied outside disposable tests. Before any later application, take and verify
a coordinated full backup including public data, mixora_internal ledger/effects/
reversals and sequences. A partial legacy data snapshot is not a supported rollback
for this schema and now fails before TRUNCATE. An isolated full-baseline restore
rehearsal remains a release gate; do not reset only stock while retaining old receipts.


## Production compatibility supersedes synthetic release assumptions — 2026-10-29

[B5_PRODUCTION_COMPATIBILITY_20261029.md](B5_PRODUCTION_COMPATIBILITY_20261029.md)
records the authorized read-only catalog audit. Released PR77 uses apply_stock,
uniform venue staff, an independent stop-list and venue-owned catalog settings.
PR75's alternative protocol is incompatible with that baseline; the new SQL guard
rejects it before mutation. Earlier passing tests and APPROVED code review concern
the synthetic baseline only and do not approve this overlay or production release.
