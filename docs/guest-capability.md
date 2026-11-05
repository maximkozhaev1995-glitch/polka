# Guest capability rollout
Status: local implementation; NOT deployed. Production unchanged.
The original anonymous guest claim is intentional; staff-only access would break the product.
The defect was anonymous enumeration of all untaken rows plus claim by a public row ID.

## Contract
New browser capability: g + 32 lowercase hexadecimal characters from crypto.getRandomValues (128 random bits).
This is a bearer secret, shared with the staff member through the QR. Never log it, put it in analytics, or publish it.
Anonymous table SELECT (including column grants) is revoked. Existing staff venue RLS/INSERT remains.
list_guest_mixes(p_gid) returns only that capability's untaken rows and never returns gid.
claim_guest_mix(p_id,p_gid) atomically matches both fields. Repeated claims return false, with no second effect.
The one-argument claim endpoint is removed. A staff login alone does not authorize guest acknowledgment.
Clients persist the mix with guestMixId before acknowledgment; failed storage does not acknowledge.
Retry/reload deduplicates by guestMixId. There is no fallback to the old unscoped API.

## Transition and recovery
Coordinate guest QR and employee clients as well as D10 employee tabs in the maintenance window.
Before SQL changes, resolve pending deliveries under the old flow and record any remaining synthetic/real cases separately in the appropriate protected operator record.
Do not run a global taken=true cleanup or delete pending rows.
The new client replaces weak legacy gid and keeps karta-gid-legacy locally; saved favorites remain.
Legacy pending rows are not automatically claimed or migrated based solely on the old weak code.
For unresolved delivery, a staff member must verify the guest/context within their venue, inspect their venue's pending record using authorized access, and arrange redelivery under the new QR. Avoid duplicate delivery if the guest already saved it.
If this reconciliation is unavailable, do not start the release. Never reopen anonymous enumeration for compatibility.
Both QR scan and Telegram startapp reject old codes with an update instruction.
If browser storage or secure randomness is unavailable, QR delivery stays disabled rather than generating a weak/transient capability.
Rollback must not restore the vulnerable SELECT/one-argument claim. Use a compatible client or hold guest delivery disabled.

## Limits and tests
Focused SQL test covers anonymous enumeration/column grants, weak/null capability, wrong capability, concurrent/repeated claim, tenant staff INSERT/SELECT and removed membership.
Client runtime tests cover legacy rotation, failed local save, lost acknowledgment, reload deduplication, full QR parsing.
This is not a server-authenticated guest account: possession of the capability authorizes access; staff who received the QR may also know it.
Existing favorites editing across multiple browser tabs is not made transactional by this patch. Use one guest-card tab during delivery; cross-tab manual editing remains a separate issue.
No real Telegram login, production keys, production orders, or hosted migration/deployment are used by these tests.

