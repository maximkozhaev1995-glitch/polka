# Telegram session binding

The migration 20261105020000_bind_telegram_sessions.sql changes the authentication contract. Deploy the database, tg-auth, ai and the rebuilt client together during a controlled authentication transition. The stage tg-auth must remain prebound-only unless invitation signup is explicitly enabled with ALLOW_INVITE_SIGNUP=true.

Each member receives a random membership_epoch. It changes when the membership is inserted again or moves to a different Telegram ID or venue. Name edits keep the epoch. Client updates cannot select an old epoch. SQL authorization and AI compare the signed JWT epoch to live membership, so removal followed by readdition does not reactivate previous tokens.

Verified Telegram signatures bind to a single server session. Initial login requires auth_date within five minutes and strictly after the migration cutoff. Proofs issued before that cutoff require a fresh Telegram login. The server stores a digest of the verified signature, its Telegram identity and membership epoch. Session refresh sends the same Widget or Mini App payload plus session_token. The JWT must have a valid signature and match the proof's session ID and live epoch. A token from another session of the same account cannot refresh it. A proof without its token cannot mint a second session.

Access JWTs last at most twelve hours. Refresh never extends the absolute deadline of auth_date plus twenty-four hours. An expired access JWT can still prove possession for refresh until that absolute deadline. This allows recovery from an interrupted connection without permitting an old Telegram signature alone to extend access. Once the deadline passes, both a new Telegram signature and a new login are required.

The client keeps the token and its proof identifier in sessionStorage scoped by backend URL. It coalesces refresh calls. On rejection it clears that state and restores the login wall while retaining existing application drafts. A new Widget signature does not inherit a token associated with another proof. A lost initial login response requires a fresh Telegram signature if the bound JWT never reached the client. No business action is submitted automatically by this flow.

Legacy JWTs lack the epoch and are rejected after migration. Existing clients must reauthenticate through the updated client and Edge. Prebound employees continue to sign in without an invitation. Existing one-time invitation creation remains available only when ALLOW_INVITE_SIGNUP is explicitly true. Member creation, invitation redemption and signature binding share a transaction.

Keep consumed proof records after deleting members. Do not cascade them with users. A future cleanup procedure may remove records only after their Telegram signature can no longer pass the twenty-four-hour verification window and after checking the cutover policy. This patch adds no scheduled cleanup.

A Telegram signature remains a bearer credential before its first successful use. If it is stolen before that use, the first successful binder may win. The patch protects reuse after binding and invalidates pre-cutover signatures. Possession of a current session JWT also remains a credential. Restricting first use to a particular browser would require an additional challenge protocol, which Telegram Login Widget does not provide here.

Local checks use synthetic HMAC keys, the actual Edge handler and loopback PostgreSQL. HTTP gateway, managed function deployment, actual Telegram Widget callback and the hosted client's storage behavior must be checked on the isolated stage before release. Preserve the stage prebound-only configuration, versioned source and rollback evidence when coordinating that test.

Rollback must retain the epoch check in SQL and AI. Restoring legacy authorization would reactivate vulnerable sessions. Prefer a compatible forward repair. Any reverse migration requires a new explicit authentication transition and must preserve consumed signature records.
