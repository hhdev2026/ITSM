begin;

alter table public.tickets add column if not exists metadata jsonb not null default '{}'::jsonb;
create index if not exists tickets_metadata_gin_idx on public.tickets using gin (metadata);

commit;

