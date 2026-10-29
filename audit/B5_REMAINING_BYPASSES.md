# B5: verified remaining write bypasses (2026-10-27)

This is an audit artifact, not a claim that B5 is safe to merge.

Review of `src/stoika.html` on the B5 branch found **11** direct `db.doc("stock/"+... ).set(...)` call sites and **6** direct `db.collection("moves").add(...)` call sites. Examples:

- Quick transfer to bar: writes stock then movement separately; if movement insert fails, stock is already decremented.
- Inventory reconciliation: loops over flavors and separately writes stock and movements; catches and ignores individual failures, so a batch may be partially committed.
- Final stock consumption (`fin`): separate stock and movement writes.
- `putDoc` helper and its undo callback: separate writes; undo restores stock and deletes a movement in separate requests.
- `askUndo`: restores stock and deletes one or more historical movements separately.
- Adding a custom flavor: creates flavor, stock and movement independently.
- AI flags: `db.setStockBatch` writes stock rows but is not the same as the B5 stock+movement RPC.
- Other direct stock flag toggles remain.

**Blocking requirements before deployment:**
1. Migrate every inventory-changing route to a server transaction; use explicit idempotency keys for retries.
2. Design a transactional undo RPC referencing original movement IDs, with permission checks and protection against concurrent later movements; do not delete audit history.
3. Make inventory reconciliation an all-or-nothing batch including `inv_log`, or explicitly split into independently confirmed transactions with accurate status.
4. Distinguish stock quantity operations from flag-only updates; flags need proper role authorization and should not invent quantity movements.
5. Rebuild `index.html` from current sources; verify no legacy write paths remain in shipped bundle.
6. Only after client migration, restrict direct `stock`/`moves` writes in production RLS; do this as a separately approved deployment after tests, not now.
7. Test new stock rows, null permissions, concurrent requests, stale expected values, duplicate operation IDs, partial-batch failure, retry after timeout, and venue isolation on an isolated test database.

**Status:** NOT READY TO MERGE. No production database changes.
