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
