create table public.reference_catalog_chunks (
  dataset text not null check (dataset in ('official', 'thirdparty', 'flvr')),
  part integer not null check (part >= 0),
  total_parts integer not null check (total_parts between 1 and 512 and part < total_parts),
  content text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  primary key (dataset, part)
);
alter table public.reference_catalog_chunks enable row level security;
revoke all on table public.reference_catalog_chunks from public, anon, authenticated;
grant select on table public.reference_catalog_chunks to authenticated;
create policy staff_read_reference_catalog on public.reference_catalog_chunks
  for select to authenticated using ((select public.is_staff()));
