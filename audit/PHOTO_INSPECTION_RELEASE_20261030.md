# Mixed-brand photo inspection and concise mix replies — 2026-10-30

Base: published main 2a17490 (PR87). Server preflight: live ai version 56 matched repository source except a trailing newline; verify_jwt=true. Local backup: original workspace .local-tests/live-ai-backup.ts. No auth, credentials, database schema, inventory or order persistence changes.

## Behavior
- Read-only photo inspection requests photo_mode=inspection from authenticated ai OCR. Claude gets a separate prompt to read all visible labels, including mixed and unknown brands; mutations retain the existing focused-brand OCR pipeline. Yandex fallback groups all label blocks in inspection mode.
- Client retains the per-photo raw transcriptions and lists catalog matches, unknown labels and uncertain/cropped text separately. Totals count fully readable labels, including those absent from the catalog; repeated jars remain repeated. Daily Hookah labels are not borrowed by Starline.
- Inspection clears lastPhotoIds and never constructs operations. It fails visibly on a server that does not acknowledge inspection mode. Normal OCR requests are unchanged.
- Default mix replies: short title, composition with percentages, at most one short taste sentence. No automatic numbering, prices, numeric strength, slow labels, service reports or closing offers. Requested strength/flags remain available without guessing.

## Verification
- Full npm test passed, including new tests/photo-inspection.cjs.
- Fixture is a manual transcription of the five staff-supplied photos: 10 Deus, 10 Palitra, 4 Starline + 2 Daily Hookah, 12 Darkside and 6 Satyr; total 44. It tests rendering and catalog boundaries, NOT fresh live OCR accuracy.
- Tests cover duplicate jars, unknown brands, uncertain labels excluded from count, per-photo failures, no actionable IDs from inspection, distinct Claude prompts and legacy focus-mode regression tests.
- Edge Function TypeScript stripped/module syntax and all embedded scripts passed. index.html rebuilt; git diff --check passed.
- Actual image OCR after deployment still requires a signed-in staff request; no session credentials were extracted for testing.

## Release / rollback
Deploy ai with its existing verify_jwt=true before publishing the new frontend. New optional mode preserves old clients. Reverting frontend commit and deploying the backed-up server restores previous behavior. No database rollback is involved.
