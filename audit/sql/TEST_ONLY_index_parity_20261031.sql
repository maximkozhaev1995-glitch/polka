-- Test-only index reconciliation, no table data changes.
DO $guard$ BEGIN
 IF to_regclass('mixora_restorecheck_1793190662565.stock') IS NULL THEN RAISE EXCEPTION 'Not isolated TEST'; END IF;
 IF to_regclass('public.guest_mixes_gid_taken_idx') IS NULL OR to_regclass('public.wishes_venue_id_created_at_idx') IS NULL OR to_regclass('public.wishes_venue_id_device_lower_lower1_idx') IS NULL THEN RAISE EXCEPTION 'Unexpected index baseline'; END IF;
END $guard$;
ALTER INDEX public.guest_mixes_gid_taken_idx RENAME TO guest_mixes_gid;
ALTER INDEX public.wishes_venue_id_created_at_idx RENAME TO wishes_venue;
ALTER INDEX public.wishes_venue_id_device_lower_lower1_idx RENAME TO wishes_one_vote;
CREATE INDEX moves_venue_id_at_idx ON public.moves (venue_id, at DESC);