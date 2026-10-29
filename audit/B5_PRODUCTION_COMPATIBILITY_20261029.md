# PR75 versus the released production protocol — 2026-10-29

## Verdict

**CHANGES REQUESTED. PR75 is not a compatible upgrade of the released PR74/77
schema or interface. Do not apply its proposal or deploy its client over that
release.** The prior APPROVED code review concerned PR75's synthetic baseline;
it did not establish compatibility with the subsequently inspected live baseline.

The owner authorized reading production schema and access settings. Only SELECTs
against PostgreSQL catalogs and the security advisor were used. No production
business rows, credentials or JWT secrets were retrieved. No migration, business
RPC, DML, deployment or merge was executed against production. The separate
Supabase test project was not modified either.

## Current release contract, not a vulnerability

PR77 is merged and its description confirms uniform permissions for all staff of
a venue. Both legacy role labels are intentionally accepted by deployed apply_stock.
The lack of old per-master permission checks is therefore **not itself an access
control defect**. The initial interpretation before reading the current release
was incorrect; this report supersedes it. Changing production back to granular
roles or a manager-only users policy would regress the approved product contract.

Production PostgreSQL is 17.11. me_tg validates numeric Telegram sub, authenticated
claim role and optional matching tg_id; venue is resolved from the users table.
The inspected anon/authenticated roles do not bypass RLS or inherit each other.
SQL claim simulation below is not a valid signed employee JWT/PostgREST session.

Source release: PR77 head cd7493fd377b11f38281eb19afbed2725d9b1b44.
https://github.com/maximkozhaev1995-glitch/polka/pull/77
Its app/shim.js uses apply_stock and flavor_strengths / flavor_packs, not PR75's
commitStockBatch / stockAction and direct shared-catalog setting updates.

## Confirmed incompatibilities

1. **Conflicting revision owners.** Production stock.revision and moves.stock_revision
   are integer. apply_stock increments revision itself and returns cur.revision+1.
   PR75 installs a global sequence trigger, leaves an existing integer column as-is
   and does not seed that sequence from existing revisions. On the reconstructed
   baseline, old apply_stock returned revision9 while stock stored2; the next request
   with revision9 failed stock_stale_revision. This also invalidates old undo receipts.
2. **Two independent write/receipt protocols.** Both public.apply_stock and
   mixora_private.apply_stock retain authenticated EXECUTE after a forced overlay.
   They do not record PR75's private effects/reversal ledger; replacing only a client
   or adding the new trigger is not a coordinated migration of outstanding requests.
3. **Uniform staff regresses.** The new stock_action rejects the legacy master label
   with empty perms even though the released RPC intentionally accepts that staff
   member. New manager-only undo/inventory/catalog paths share this incompatibility.
4. **Stop-list regresses.** A new PR75 receipt clears stop/stop_auto. The released
   behavior keeps the stop-list independent and requires an explicit separate action.
5. **Venue configuration regresses.** Production uses per-venue flavor_packs and
   flavor_strengths. PR75's old adapter edits flavors directly; restrictive RLS allows
   no shared row to be updated. Its inventory uses the global pack_g default: the
   synthetic case computed100g instead of the venue's150g. Grams inventory is outside
   the current Lite pilot, but this remains an implemented-feature incompatibility.
6. **Release lineage differs.** PR75 is an alternative based on PR73, not a tested
   continuation of the released apply_stock branch. Its older interface/settings
   cannot be treated as the current production source merely because its own CI is green.

## Concrete guard added in PR75

The proposal now detects either existing apply_stock signature and raises 0A000
before creating mixora_internal, changing ACLs or installing revision triggers.
The test asserts unchanged synthetic stock and absence of the new ledger schema.
This prevents accidental incompatible application; it does not implement a protocol
migration, and it was never executed on production.

A test-only guard bypass is confined to a fresh in-memory engine or a new disposable
runner-loopback database. It demonstrates the above failures. A green incompatibility
probe means the problem was reproduced and the guard worked, **not release approval**.

## Scope of evidence

A catalog-only fixture contains eight relevant public table definitions, constraints,
RLS policies, selected helpers/triggers, the deployed legacy RPC and private receipt
structure, application ACLs and public default privileges. It contains no real rows.
The captured function definitions and version-column types were rechecked read-only
at 2026-10-29 01:27:42 UTC / 04:27:42 Moscow and matched the saved fingerprints.

Ten embedded PostgreSQL probes pass: baseline uniform staff, venue RLS, atomic guard,
existing version/sequence mismatch, callable legacy entry points, wrong returned
revision/retry, new role denial, stop clearing, ignored venue weight, incompatible
catalog editor. Fourteen earlier embedded SQL groups also pass on the synthetic
PR75 baseline. Native CI results will be appended after verification.

The native compatibility runner creates/drops only its own random database on
127.0.0.1/localhost with the mixora_b5_test prefix. It refuses a remote hostname.
Production catalog capture is not a full application backup, managed Supabase
baseline, all-schema audit, real JWT or browser/Telegram verification.

Security advisor notices about intentionally public guest views, helper function
EXECUTE and private receipts without client policies were observed. They were not
blindly changed: each requires the actual intended access contract. References:
https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view
https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable

## Next implementation boundary

Further stock improvements should be ported onto the released apply_stock protocol,
keeping equal venue staff rights, independent stop-list and venue-owned settings.
A migration must reconcile both receipt formats, existing versions, pending client
requests and compensation history; it requires a coordinated rollback rehearsal.
PR75 remains Draft and is not ready to merge. No production permission is requested
for writing or applying anything as part of this read-only audit.
