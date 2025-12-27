begin;

-- ---------------------------------------------------------------------
-- IT Assets: inventory + assignments + connectivity + alerts
-- - Designed for CSV/manual/API ingestion, geo visualization, and monitoring.
-- - PostGIS is NOT required (lat/lng stored as numeric).
-- ---------------------------------------------------------------------

do $$ begin
  create type public.asset_connectivity_status_enum as enum ('Online', 'Offline', 'Durmiente', 'Desconocido', 'Crítico');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.asset_lifecycle_status_enum as enum ('Activo', 'En reparación', 'Retirado', 'Descartado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.asset_assignment_role_enum as enum ('principal', 'secundario', 'responsable');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.asset_alert_severity_enum as enum ('info', 'warning', 'critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.asset_alert_status_enum as enum ('open', 'resolved', 'ignored');
exception when duplicate_object then null; end $$;

create sequence if not exists public.asset_tag_seq;

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,

  -- Human-friendly tracking id (global sequence). App can format: AST-000123
  asset_tag bigint not null default nextval('public.asset_tag_seq'),

  -- Identification
  name text not null,
  serial_number text,
  barcode text,
  manufacturer text,
  model text,

  -- Classification (kept as text for flexibility)
  asset_type text,
  category text,
  subcategory text,

  -- Physical location
  region text,
  comuna text,
  building text,
  floor text,
  room text,
  address text,
  latitude numeric,
  longitude numeric,

  -- Ownership / cost
  cost_center text,
  department_name text,

  -- Lifecycle
  lifecycle_status public.asset_lifecycle_status_enum not null default 'Activo',
  purchased_at date,
  installed_at date,
  warranty_expires_at date,
  eol_at date,
  license_expires_at date,

  -- Connectivity snapshot
  connectivity_status public.asset_connectivity_status_enum not null default 'Desconocido',
  last_seen_at timestamptz,
  last_ip text,
  last_mac text,
  last_hostname text,
  last_network_type text,

  -- Health / prediction (0..100)
  failure_risk_pct integer not null default 0 check (failure_risk_pct >= 0 and failure_risk_pct <= 100),

  -- Notes / metadata
  description text,
  admin_notes text,
  tags text[],
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter sequence public.asset_tag_seq owned by public.assets.asset_tag;

create unique index if not exists assets_asset_tag_uq on public.assets (asset_tag);
create unique index if not exists assets_dept_serial_uq on public.assets (department_id, serial_number) where serial_number is not null and length(trim(serial_number)) > 0;
create index if not exists assets_dept_created_idx on public.assets (department_id, created_at desc);
create index if not exists assets_dept_status_idx on public.assets (department_id, lifecycle_status, connectivity_status);
create index if not exists assets_location_idx on public.assets (department_id, region, comuna, building);
create index if not exists assets_lat_lng_idx on public.assets (department_id, latitude, longitude) where latitude is not null and longitude is not null;

drop trigger if exists t_assets_touch on public.assets;
create trigger t_assets_touch before update on public.assets
for each row execute function public._touch_updated_at();

create table if not exists public.asset_assignments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete restrict,
  role public.asset_assignment_role_enum not null default 'principal',
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists asset_assignments_asset_idx on public.asset_assignments (asset_id, assigned_at desc);
create index if not exists asset_assignments_user_idx on public.asset_assignments (user_id, assigned_at desc);
create index if not exists asset_assignments_open_idx on public.asset_assignments (asset_id) where ended_at is null;

create table if not exists public.asset_connectivity_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  status public.asset_connectivity_status_enum not null,
  occurred_at timestamptz not null default now(),
  ip text,
  mac text,
  hostname text,
  network_type text,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists asset_connectivity_events_asset_idx on public.asset_connectivity_events (asset_id, occurred_at desc);

create table if not exists public.asset_alerts (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  kind text not null,
  severity public.asset_alert_severity_enum not null default 'warning',
  status public.asset_alert_status_enum not null default 'open',
  title text not null,
  message text,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists asset_alerts_asset_idx on public.asset_alerts (asset_id, opened_at desc);
create index if not exists asset_alerts_status_idx on public.asset_alerts (status, severity, opened_at desc);

drop trigger if exists t_asset_alerts_touch on public.asset_alerts;
create trigger t_asset_alerts_touch before update on public.asset_alerts
for each row execute function public._touch_updated_at();

alter table public.assets enable row level security;
alter table public.asset_assignments enable row level security;
alter table public.asset_connectivity_events enable row level security;
alter table public.asset_alerts enable row level security;

-- Assets: visibility
drop policy if exists assets_select on public.assets;
create policy assets_select on public.assets
for select to authenticated
using (
  (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or exists (
    select 1
    from public.asset_assignments aa
    where aa.asset_id = assets.id
      and aa.user_id = auth.uid()
      and aa.ended_at is null
  )
);

-- Assets: supervisors/admin manage, agents read-only.
drop policy if exists assets_write on public.assets;
create policy assets_write on public.assets
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

-- Assignments: dept agents/supervisor/admin can read. Only supervisor/admin can change.
drop policy if exists asset_assignments_select on public.asset_assignments;
create policy asset_assignments_select on public.asset_assignments
for select to authenticated
using (
  exists (
    select 1
    from public.assets a
    where a.id = asset_assignments.asset_id
      and (
        (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(a.department_id))
        or asset_assignments.user_id = auth.uid()
      )
  )
);

drop policy if exists asset_assignments_write on public.asset_assignments;
create policy asset_assignments_write on public.asset_assignments
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and exists (select 1 from public.assets a where a.id = asset_assignments.asset_id and public._same_department(a.department_id))
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and exists (select 1 from public.assets a where a.id = asset_assignments.asset_id and public._same_department(a.department_id))
);

-- Connectivity events: dept agents/supervisor/admin can read; write via server/service or supervisor/admin.
drop policy if exists asset_connectivity_events_select on public.asset_connectivity_events;
create policy asset_connectivity_events_select on public.asset_connectivity_events
for select to authenticated
using (
  exists (
    select 1
    from public.assets a
    where a.id = asset_connectivity_events.asset_id
      and public._has_role(array['agent','supervisor','admin']::public.role_enum[])
      and public._same_department(a.department_id)
  )
);

drop policy if exists asset_connectivity_events_insert on public.asset_connectivity_events;
create policy asset_connectivity_events_insert on public.asset_connectivity_events
for insert to authenticated
with check (
  exists (
    select 1
    from public.assets a
    where a.id = asset_connectivity_events.asset_id
      and public._has_role(array['agent','supervisor','admin']::public.role_enum[])
      and public._same_department(a.department_id)
  )
);

-- Alerts: dept agents/supervisor/admin can read; supervisor/admin can update.
drop policy if exists asset_alerts_select on public.asset_alerts;
create policy asset_alerts_select on public.asset_alerts
for select to authenticated
using (
  exists (
    select 1 from public.assets a
    where a.id = asset_alerts.asset_id
      and public._has_role(array['agent','supervisor','admin']::public.role_enum[])
      and public._same_department(a.department_id)
  )
);

drop policy if exists asset_alerts_write on public.asset_alerts;
create policy asset_alerts_write on public.asset_alerts
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and exists (select 1 from public.assets a where a.id = asset_alerts.asset_id and public._same_department(a.department_id))
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and exists (select 1 from public.assets a where a.id = asset_alerts.asset_id and public._same_department(a.department_id))
);

-- ---------------------------------------------------------------------
-- RPC: bulk upsert assets (CSV/API) with validation + partial import
-- Input format: [{ name, serial_number, ... }]
-- ---------------------------------------------------------------------

create or replace function public.asset_upsert_many(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  dept_id uuid;
  idx integer := 0;
  inserted integer := 0;
  updated integer := 0;
  errors jsonb := '[]'::jsonb;

  r jsonb;
  v_name text;
  v_serial text;
  v_tag bigint;
  v_id uuid;
begin
  perform set_config('row_security', 'off', true);

  if not public._has_role(array['supervisor','admin']::public.role_enum[]) then
    raise exception 'forbidden';
  end if;

  select p.department_id into dept_id
  from public.profiles p
  where p.id = auth.uid();

  if dept_id is null then
    raise exception 'department_required';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows_must_be_array';
  end if;

  for r in select * from jsonb_array_elements(p_rows)
  loop
    idx := idx + 1;
    v_name := trim(coalesce(r->>'name', ''));
    v_serial := nullif(trim(coalesce(r->>'serial_number', '')), '');
    v_tag := nullif(trim(coalesce(r->>'asset_tag', '')), '')::bigint;

    if v_name = '' then
      errors := errors || jsonb_build_array(jsonb_build_object('row', idx, 'error', 'name_required'));
      continue;
    end if;

    begin
      v_id := null;
      if v_tag is not null then
        select a.id into v_id from public.assets a where a.asset_tag = v_tag and a.department_id = dept_id;
      elsif v_serial is not null then
        select a.id into v_id from public.assets a where a.serial_number = v_serial and a.department_id = dept_id;
      end if;

      if v_id is null then
        insert into public.assets (
          department_id,
          asset_tag,
          name,
          serial_number,
          barcode,
          manufacturer,
          model,
          asset_type,
          category,
          subcategory,
          region,
          comuna,
          building,
          floor,
          room,
          address,
          latitude,
          longitude,
          cost_center,
          department_name,
          lifecycle_status,
          purchased_at,
          installed_at,
          warranty_expires_at,
          eol_at,
          license_expires_at,
          description,
          admin_notes,
          tags,
          metadata
        )
        values (
          dept_id,
          coalesce(v_tag, nextval('public.asset_tag_seq')),
          v_name,
          v_serial,
          nullif(trim(coalesce(r->>'barcode', '')), ''),
          nullif(trim(coalesce(r->>'manufacturer', '')), ''),
          nullif(trim(coalesce(r->>'model', '')), ''),
          nullif(trim(coalesce(r->>'asset_type', '')), ''),
          nullif(trim(coalesce(r->>'category', '')), ''),
          nullif(trim(coalesce(r->>'subcategory', '')), ''),
          nullif(trim(coalesce(r->>'region', '')), ''),
          nullif(trim(coalesce(r->>'comuna', '')), ''),
          nullif(trim(coalesce(r->>'building', '')), ''),
          nullif(trim(coalesce(r->>'floor', '')), ''),
          nullif(trim(coalesce(r->>'room', '')), ''),
          nullif(trim(coalesce(r->>'address', '')), ''),
          nullif(trim(coalesce(r->>'latitude', '')), '')::numeric,
          nullif(trim(coalesce(r->>'longitude', '')), '')::numeric,
          nullif(trim(coalesce(r->>'cost_center', '')), ''),
          nullif(trim(coalesce(r->>'department_name', '')), ''),
          coalesce(nullif(trim(coalesce(r->>'lifecycle_status', '')), '')::public.asset_lifecycle_status_enum, 'Activo'::public.asset_lifecycle_status_enum),
          nullif(trim(coalesce(r->>'purchased_at', '')), '')::date,
          nullif(trim(coalesce(r->>'installed_at', '')), '')::date,
          nullif(trim(coalesce(r->>'warranty_expires_at', '')), '')::date,
          nullif(trim(coalesce(r->>'eol_at', '')), '')::date,
          nullif(trim(coalesce(r->>'license_expires_at', '')), '')::date,
          nullif(trim(coalesce(r->>'description', '')), ''),
          nullif(trim(coalesce(r->>'admin_notes', '')), ''),
          case
            when r ? 'tags' and jsonb_typeof(r->'tags') = 'array' then (select array_agg(value::text) from jsonb_array_elements_text(r->'tags') as value)
            else null
          end,
          coalesce(r->'metadata', '{}'::jsonb)
        )
        returning id into v_id;
        inserted := inserted + 1;
      else
        update public.assets
        set
          name = v_name,
          serial_number = coalesce(v_serial, serial_number),
          barcode = coalesce(nullif(trim(coalesce(r->>'barcode', '')), ''), barcode),
          manufacturer = coalesce(nullif(trim(coalesce(r->>'manufacturer', '')), ''), manufacturer),
          model = coalesce(nullif(trim(coalesce(r->>'model', '')), ''), model),
          asset_type = coalesce(nullif(trim(coalesce(r->>'asset_type', '')), ''), asset_type),
          category = coalesce(nullif(trim(coalesce(r->>'category', '')), ''), category),
          subcategory = coalesce(nullif(trim(coalesce(r->>'subcategory', '')), ''), subcategory),
          region = coalesce(nullif(trim(coalesce(r->>'region', '')), ''), region),
          comuna = coalesce(nullif(trim(coalesce(r->>'comuna', '')), ''), comuna),
          building = coalesce(nullif(trim(coalesce(r->>'building', '')), ''), building),
          floor = coalesce(nullif(trim(coalesce(r->>'floor', '')), ''), floor),
          room = coalesce(nullif(trim(coalesce(r->>'room', '')), ''), room),
          address = coalesce(nullif(trim(coalesce(r->>'address', '')), ''), address),
          latitude = coalesce(nullif(trim(coalesce(r->>'latitude', '')), '')::numeric, latitude),
          longitude = coalesce(nullif(trim(coalesce(r->>'longitude', '')), '')::numeric, longitude),
          cost_center = coalesce(nullif(trim(coalesce(r->>'cost_center', '')), ''), cost_center),
          department_name = coalesce(nullif(trim(coalesce(r->>'department_name', '')), ''), department_name),
          lifecycle_status = coalesce(nullif(trim(coalesce(r->>'lifecycle_status', '')), '')::public.asset_lifecycle_status_enum, lifecycle_status),
          purchased_at = coalesce(nullif(trim(coalesce(r->>'purchased_at', '')), '')::date, purchased_at),
          installed_at = coalesce(nullif(trim(coalesce(r->>'installed_at', '')), '')::date, installed_at),
          warranty_expires_at = coalesce(nullif(trim(coalesce(r->>'warranty_expires_at', '')), '')::date, warranty_expires_at),
          eol_at = coalesce(nullif(trim(coalesce(r->>'eol_at', '')), '')::date, eol_at),
          license_expires_at = coalesce(nullif(trim(coalesce(r->>'license_expires_at', '')), '')::date, license_expires_at),
          description = coalesce(nullif(trim(coalesce(r->>'description', '')), ''), description),
          admin_notes = coalesce(nullif(trim(coalesce(r->>'admin_notes', '')), ''), admin_notes),
          tags = case
            when r ? 'tags' and jsonb_typeof(r->'tags') = 'array' then (select array_agg(value::text) from jsonb_array_elements_text(r->'tags') as value)
            else tags
          end,
          metadata = case when r ? 'metadata' then coalesce(r->'metadata', '{}'::jsonb) else metadata end,
          updated_at = now()
        where id = v_id;
        updated := updated + 1;
      end if;
    exception when others then
      errors := errors || jsonb_build_array(jsonb_build_object('row', idx, 'error', sqlerrm));
      continue;
    end;
  end loop;

  return jsonb_build_object('inserted', inserted, 'updated', updated, 'errors', errors);
end;
$$;

revoke all on function public.asset_upsert_many(jsonb) from public;
grant execute on function public.asset_upsert_many(jsonb) to authenticated;

commit;

