# AI photo attachment visibility and incomplete-name lookup

Base: current main 6d8ad811aa3724bf2f0049167b0e507e4ca86553.
Branch: codex/mixora-ai-photo-preview. Separate from incompatible PR75.

## Changes

- Main AI chat and section helper show a thumbnail and filename for each selected
  photo. A photo can be opened at full size or removed individually before sending.
- Sent photos remain visible in the current chat. The helper preserves them during
  response redraws. New-dialog resets release the associated local object URLs.
- Binary photos/object URLs are not persisted to localStorage; previews last for
  the current open dialog, not browser reloads. The existing text history persists.
- Uncertain OCR text now searches close catalog spellings within its own read brand
  and photo focus. At most one differing/missing letter is accepted as a suggestion
  for names of at least six letters. Cropped short fragments, multiple unreadable
  letters and other-brand background jars do not become matches.
- The owner's DEUS BLACK AFGAN? example offers Deus Black Afgano (Perfume).
  Suggestions are separate from found/jars, never inventory actions or invented
  new catalog entries. Equally close names remain alternatives for clarification.
- No stock RPC, role/permissions, manual stop-list behavior, navigation, Supabase
  schema or server function was changed. No production API/model call, merge or
  deployment was performed.

## Local checks

- Complete npm test passed: matching27 and1144 catalog cases; actions20; SQL19;
  stock client12; catalog client checks; inline/shim syntax; uniform access16;
  cryptographic8; slow compatibility; existing photo/geometry16.
- Added eight catalog suggestion groups, including the owner's transcription,
  one-letter OCR errors, ambiguous alternatives and photo/brand isolation.
- Added eight real-browser groups at mobile390px, including shorter600px viewport:
  decoded previews, large-image viewer, per-file removal, sent photos, both dialog
  resets, object URL cleanup, storage privacy, and unchanged synthetic stock/draft.
- Browser used locally: isolated Chromium138 with Playwright1.64.1. External
  requests were blocked; fake OCR text was injected. This is not real OCR, iOS
  Safari or Telegram WebView validation. A local screenshot using the supplied jar
  photo was inspected; pending image and composer were visible.
- index.html rebuilt with build_app.py. package dependencies/lockfile unchanged;
  package.json only adds the new regression commands.

## CI and manual release check

A PR-only workflow runs the full suite, checks exact index regeneration and runs
mobile browser tests using its installed Chromium. Native iOS/Telegram selection,
keyboard and photo decoding still need device verification before release.
CI evidence will be recorded after the branch run completes.
