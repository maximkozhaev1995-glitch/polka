# Response to Gemini static review of head 709af0c

All five findings were accepted and addressed in source and tests. The attached
review was static only; its statement that no SQL tests ran is historical.

| Finding | Change | Verification |
| --- | --- | --- |
| HIGH-1 P0001/constraint errors strand pending | Clear pending for P0001, known 40001/40P01, SQLSTATE classes 22/23/42; preserve gateway/connection uncertainty | Actual commit function VM tests exercise P0001, 23502, 23503, 22012, 42601 and corrected retry |
| HIGH-2 legacy automatic stop trigger conflict | Update legacy guard in proposal; permit automatic stop transition, retain manual unstop authorization | Reproduced legacy P0001; WASM test PASS; native CI first run PASS |
| MEDIUM-1 authorization/catalog row races | FOR SHARE on users and flavors; SHARE on flavors also protects non-key venue_id changes | Native test holds revocation/venue-transfer update, observes RPC lock wait in pg_stat_activity, commits blocker, expects 42501/22023 and unchanged stock/moves |
| MEDIUM-2 loose JSON contract | Require bar and expected_bar together; reject unknown item keys | Native and WASM tests cover both missing counterpart directions and extra keys |
| LOW-1 queued cross-tab clicks | Web Locks ifAvailable:true; occupied lock returns explicit status without calling commitLocked | VM lock callback(null) test confirms zero requests/pending writes |

A further trigger mismatch was found during execution: add-only master on raw
NULL bar failed with Bar forbidden even when logical bar=false was unchanged.
The legacy guard now compares coalesced booleans, with native/WASM regression.

`index.html` rebuilt by build_app.py. Local client suite: 13 PASS groups; actions:
20 PASS; matching: 27/27 + 1144 sweep; embedded SQL: 9 PASS groups. Native PostgreSQL
16.15 first run: 8/8 PASS at d5f5c909 (run 40760566844). The expanded final native
suite must be checked against its new commit before claiming those extra races pass.

Verdict remains CHANGES REQUESTED: compensation RPC and closed legacy features are
not implemented; complete baseline, real JWT/PostgREST and native browser lock
behavior remain unverified. SQL's fixed row order reduces lock-order inversions,
but does not prove all deadlocks impossible across other database transactions.
