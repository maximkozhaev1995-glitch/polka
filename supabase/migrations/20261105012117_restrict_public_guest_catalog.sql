begin;

-- Keep the guest card response shape and existing grants. The public projection
-- intentionally exposes published content without the employee display name.
create or replace view public.public_mixes with (security_barrier = true) as
select id, venue_id, title, kind, note, tags, parts, null::text as by_name, created_at
from public.mixes
where in_karta and not hidden;

alter view public.public_stock set (security_barrier = true);

commit;
