# Limited PR77 rollback snapshot

Captured before production release on 2026-10-28. Original client/main: 669c9dd6c3d33dda7956920b2a14c06913d659cb. Old functions: tg-auth v32 (verify_jwt=false), ai v52 (verify_jwt=true).

This is source and access-definition preservation only. No database rows, Storage file bytes, or secret values are backed up. User explicitly authorized proceeding without a confirmed data backup. rollback-access.sql retains additive schema/receipts/overrides and widens existing movement-kind compatibility; it does not undo business operations. Restore old source and old Edge Functions with their original JWT flags as part of a coordinated rollback. New per-venue settings remain stored and must not be deleted or copied into shared catalog. Smoke-check after any rollback.
