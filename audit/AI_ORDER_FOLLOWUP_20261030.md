# AI order read follow-up — 2026-10-30

Base: main e17a5f9124aed90d601466b5b296908ff70839b2 (after PR86).

## Problem and change
The order screen exports both catalog orderQ and manual orderM rows. The AI search, snapshot count and order helper previously read only catalog orderQ. A staff comparison reported 33 exported rows versus 27 in the AI answer, including an omitted Sebero Honey melon row. The production storage for those six rows was not inspected.

This change uses orderRows() for AI order reads, snapshot counts and helper context. Manual rows retain their entered name and quantity and have no invented catalog ID. The order search preserves catalog alias matching, supports offset pagination and reports hasMore. Main and section assistant instructions require paging and prohibit passing manual rows to set_order. No persistence or confirmation logic changes.

## Validation
- Full npm test passed on Windows Node 24.22.1, including catalog, matching, action confirmation, local PGlite RLS/RPC, auth and existing photo regressions.
- tests/ai-order-read.cjs: catalog and manual rows, brand/name/alias filters, quantities, zero exclusion, missing catalog ID, no read mutation, offsets, empty matches and 102-row paging without duplicates.
- Rebuilt index.html using the same transformation as build_app.py via Node (Python execution unavailable in this environment).
- git diff --check passed.
- No live model call, authenticated browser validation, production database write or deployment performed for this PR.

## Separate follow-up work
- Staff photo test: two Daily Hookah labels absent from the final reply. The live OCR transcript is unavailable; the failing stage is not established. Old-branch matching observations must not be assumed to describe current main after PR86.
- User-editable persistent brand/name synonyms and main-name corrections are agreed but not implemented by this PR.
- Existing manual Honey melon is not automatically merged or relinked to catalog Дыня.
- Original local branch includes older uncommitted UI/order synchronization work. It is preserved and not bundled here.

## Mix recommendation context follow-up
AI item results, the main bar snapshot and slow-section helper now carry validated saved strength (integer 1–10; otherwise unknown). Snapshot and helper carry slow and authoritative inStop state. Prompt rules require a confirmed eligible slow ingredient in each requested slow-stock mix, allow complementary normal ingredients, and require an explicit insufficiency statement when saved component strength is missing. Brand reputation and flavor sweetness/body may not be used to invent mix strength. This is data wiring plus prompt guidance, not a deterministic validator of free-form model recipes.

Validation: full npm test passed again, including tests/ai-mix-context.cjs (known/missing/invalid/boundary strength, slow/automatic stop, warehouse-only exclusion and prompt wiring). No live model response was evaluated in this change.

## Audit fixes
- Removed the stock-loaded UI predicate from orderRows(): a loaded order is readable even if the stock subscription is pending or unavailable. Quantity > 0 remains the membership criterion.
- find_items(where: order) is a read-only full-order source even during a photo request; photoTools no longer filters its already paginated results or rewrites its totals. PHOTO_RULES explicitly distinguish order rows from recognition evidence. All mutation tools still require every ID to be recognized in the current photo.
- Added regressions: stockLoaded=false with catalog plus manual rows; 102-row photo-wrapped traversal with consistent totals, final-page state and no lost manual row; off-photo/mixed-ID writes still rejected for all three mutation tools.
- Full npm test and git diff --check passed after audit fixes. No live model/browser or production writes performed.
