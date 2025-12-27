begin;

-- ---------------------------------------------------------------------
-- Service Catalog: tiered taxonomy (Tipo de Ticket + Tier1..Tier4)
-- Used for guided combobox UX and reporting.
-- ---------------------------------------------------------------------

alter table public.service_catalog_items add column if not exists tier1 text;
alter table public.service_catalog_items add column if not exists tier2 text;
alter table public.service_catalog_items add column if not exists tier3 text;
alter table public.service_catalog_items add column if not exists tier4 text;

create index if not exists service_catalog_items_tier1_idx on public.service_catalog_items (tier1);
create index if not exists service_catalog_items_tier2_idx on public.service_catalog_items (tier2);
create index if not exists service_catalog_items_tier3_idx on public.service_catalog_items (tier3);
create index if not exists service_catalog_items_tier4_idx on public.service_catalog_items (tier4);

-- Prevent duplicate leaf paths when tiers are populated.
create unique index if not exists service_catalog_items_unique_tier_path
  on public.service_catalog_items (department_id, ticket_type, tier1, tier2, tier3, tier4)
  where tier1 is not null and tier2 is not null and tier3 is not null and tier4 is not null;

commit;

