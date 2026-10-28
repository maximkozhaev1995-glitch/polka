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
matching 27/27 and 1144 catalog cases; actual SQL in PGlite 13 groups.
Native CI result will be recorded after the branch run finishes. Native suite adds
parallel action replay/conflicts, double undo, atomic undo failure, inventory and
catalog transaction tests, ACL checks and independent-review regressions.

## Remaining release gates

Complete baseline CREATE definitions and real inherited privileges/other privileged
RPCs are absent from the repository. This fixture cannot prove those properties.
Real JWT/PostgREST and browser Web Locks integration remains untested. Database
backup/restore rehearsal requires an isolated copy of the complete baseline; legacy
partial snapshots are intentionally rejected. Do not apply the proposal to a real
Supabase project without separate approval and these checks. Verdict pending CI;
release remains CHANGES REQUESTED until these integration gates are satisfied.
