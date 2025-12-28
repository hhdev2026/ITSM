begin;

-- ---------------------------------------------------------------------
-- Asset sites (locales/sucursales) for location matching
-- - Stores known locations per department (no PostGIS required).
-- - Assets can optionally reference a site via `assets.site_id`.
-- ---------------------------------------------------------------------

create table if not exists public.asset_sites (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  name text not null,
  region text,
  comuna text,
  address text,
  latitude numeric,
  longitude numeric,
  radius_m integer not null default 250 check (radius_m > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, name)
);

create index if not exists asset_sites_dept_idx on public.asset_sites (department_id, name);
create index if not exists asset_sites_lat_lng_idx on public.asset_sites (department_id, latitude, longitude) where latitude is not null and longitude is not null;

drop trigger if exists t_asset_sites_touch on public.asset_sites;
create trigger t_asset_sites_touch before update on public.asset_sites
for each row execute function public._touch_updated_at();

alter table public.asset_sites enable row level security;

drop policy if exists asset_sites_select on public.asset_sites;
create policy asset_sites_select on public.asset_sites
for select to authenticated
using (
  public._has_role(array['agent','supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

drop policy if exists asset_sites_write on public.asset_sites;
create policy asset_sites_write on public.asset_sites
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

alter table public.assets add column if not exists site_id uuid references public.asset_sites (id) on delete set null;
create index if not exists assets_site_idx on public.assets (site_id);

commit;

