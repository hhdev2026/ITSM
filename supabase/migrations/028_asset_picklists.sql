begin;

-- ---------------------------------------------------------------------
-- Asset picklists (subcategorías, marcas, modelos)
-- - Purpose: reduce typos by selecting from curated/learned options.
-- - Scoping: per department.
-- - Seeding: auto-learn distinct values from existing `assets` rows.
-- ---------------------------------------------------------------------

create table if not exists public.asset_subcategories (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  asset_type text,
  category text,
  name text not null,
  name_norm text generated always as (lower(trim(name))) stored,
  asset_type_norm text generated always as (lower(trim(coalesce(asset_type, '')))) stored,
  category_norm text generated always as (lower(trim(coalesce(category, '')))) stored,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, asset_type_norm, category_norm, name_norm)
);

create index if not exists asset_subcategories_dept_idx on public.asset_subcategories (department_id, name);

drop trigger if exists t_asset_subcategories_touch on public.asset_subcategories;
create trigger t_asset_subcategories_touch before update on public.asset_subcategories
for each row execute function public._touch_updated_at();

alter table public.asset_subcategories enable row level security;

drop policy if exists asset_subcategories_select on public.asset_subcategories;
create policy asset_subcategories_select on public.asset_subcategories
for select to authenticated
using (
  public._has_role(array['agent','supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

drop policy if exists asset_subcategories_write on public.asset_subcategories;
create policy asset_subcategories_write on public.asset_subcategories
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

create table if not exists public.asset_manufacturers (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  name text not null,
  name_norm text generated always as (lower(trim(name))) stored,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, name_norm)
);

create index if not exists asset_manufacturers_dept_idx on public.asset_manufacturers (department_id, name);

drop trigger if exists t_asset_manufacturers_touch on public.asset_manufacturers;
create trigger t_asset_manufacturers_touch before update on public.asset_manufacturers
for each row execute function public._touch_updated_at();

alter table public.asset_manufacturers enable row level security;

drop policy if exists asset_manufacturers_select on public.asset_manufacturers;
create policy asset_manufacturers_select on public.asset_manufacturers
for select to authenticated
using (
  public._has_role(array['agent','supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

drop policy if exists asset_manufacturers_write on public.asset_manufacturers;
create policy asset_manufacturers_write on public.asset_manufacturers
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

create table if not exists public.asset_models (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  manufacturer text,
  name text not null,
  manufacturer_norm text generated always as (lower(trim(coalesce(manufacturer, '')))) stored,
  name_norm text generated always as (lower(trim(name))) stored,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, manufacturer_norm, name_norm)
);

create index if not exists asset_models_dept_idx on public.asset_models (department_id, manufacturer, name);

drop trigger if exists t_asset_models_touch on public.asset_models;
create trigger t_asset_models_touch before update on public.asset_models
for each row execute function public._touch_updated_at();

alter table public.asset_models enable row level security;

drop policy if exists asset_models_select on public.asset_models;
create policy asset_models_select on public.asset_models
for select to authenticated
using (
  public._has_role(array['agent','supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

drop policy if exists asset_models_write on public.asset_models;
create policy asset_models_write on public.asset_models
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

-- Seed from existing assets (best-effort).
insert into public.asset_manufacturers (department_id, name)
select
  a.department_id,
  min(trim(a.manufacturer)) as name
from public.assets a
where a.manufacturer is not null
  and length(trim(a.manufacturer)) > 0
group by a.department_id, lower(trim(a.manufacturer))
on conflict do nothing;

insert into public.asset_models (department_id, manufacturer, name)
select
  a.department_id,
  nullif(trim(coalesce(a.manufacturer, '')), '') as manufacturer,
  min(trim(a.model)) as name
from public.assets a
where a.model is not null
  and length(trim(a.model)) > 0
group by a.department_id, lower(trim(coalesce(a.manufacturer, ''))), lower(trim(a.model))
on conflict do nothing;

insert into public.asset_subcategories (department_id, asset_type, category, name)
select
  a.department_id,
  nullif(trim(coalesce(a.asset_type, '')), '') as asset_type,
  nullif(trim(coalesce(a.category, '')), '') as category,
  min(trim(a.subcategory)) as name
from public.assets a
where a.subcategory is not null
  and length(trim(a.subcategory)) > 0
group by a.department_id, lower(trim(coalesce(a.asset_type, ''))), lower(trim(coalesce(a.category, ''))), lower(trim(a.subcategory))
on conflict do nothing;

commit;

