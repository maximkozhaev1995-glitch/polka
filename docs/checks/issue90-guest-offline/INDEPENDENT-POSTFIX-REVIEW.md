# Independent review: local guest save-before-ACK fix

2026-10-31. Source template SHA-256 `9b50f7dbc1add3f954327129220304599a04ba38708e79395c0a10b59aa2a9b8`; generated guest index SHA-256 `b73d8287664dd3af7fe524718c6031b8370ba476c9dc9c2e946a22ddbaacd714`.

## Actual execution

Ran the author's 24 new client safety tests and 12 independently written probes across source and generated guest app: **36/36 passed**. Source inspection verified the tested code captures the guest ID, saves the favorite and receipt identity before acknowledgment, rolls back an unsaved in-memory insertion, checks ACK response status, bounds ACK wait and abandons stale guest-session results.

Independent cases cover second-row storage failure, preserving existing favorites, missing delivery identity, guest change during read, guest change during the first ACK of a multi-row response, and failed reads releasing the busy guard. Author cases also cover reload, duplicate receipt delivery, timeout, non-2xx ACK, lost ACK response, and distinct deliveries with identical recipe content.

Evidence:
- `independent-postfix-tests.log`, SHA-256 `9de67ee6a0d6706608a4d1c6cd45d08572312e7b0d08c1c7808d4cc3ec37d4f0`.
- `independent-client-probes.cjs`, SHA-256 `ed6a01f097201ebf397f7b138011bf373d62e83ad7b65547607edd42af4e718c`.

## Scope and unresolved risks

No blocking regression was found within this bounded **offline client** scope. Transport and storage boundaries were mocked; this is not mobile/browser/network validation, and nothing was deployed.

The server's pending-delivery state is the retry queue. A separate client queue is not required for the tested flow because stable delivery ID and guest ID persist with the favorite before ACK. Deleting an unacknowledged favorite is not server cancellation: a later pending read can save it again. That behavior is documented, not silently presented as permanent deletion.

This patch does **not** repair server-side cross-guest enumeration or UUID-only authorization. The private-receipt proposal remains a separate design and approval decision. Multi-tab concurrent storage writes and browser eviction are not solved or verified; a successful local save must not be advertised as permanent, failure-proof storage.

The two preserved legacy-risk tests describe the old baseline, not this patch. Their successful reproduction is not added to the count of post-fix safety tests.
