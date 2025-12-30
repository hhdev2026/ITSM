begin;

-- ---------------------------------------------------------------------
-- RMM snapshots (provider-agnostic)
-- - Stores latest device inventory/telemetry snapshots per asset.
-- - Designed to grow: add new `kind` values without schema changes.
-- ---------------------------------------------------------------------

create table if not exists public.rmm_snapshots (
  id uuid primary key default gen_random_uuid(),
  provider text not null, -- e.g. 'netlock'
  kind text not null,     -- e.g. 'device', 'hardware', 'apps_installed'
  asset_id uuid not null references public.assets (id) on delete cascade,

  -- Provider device key (e.g. access_key). Kept redundant for convenience.
  device_key text,

  -- Timestamp of the upstream snapshot (best-effort).
  source_ts timestamptz,

  payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists rmm_snapshots_uq on public.rmm_snapshots (provider, kind, asset_id);
create index if not exists rmm_snapshots_asset_idx on public.rmm_snapshots (asset_id, updated_at desc);
create index if not exists rmm_snapshots_device_key_idx on public.rmm_snapshots (provider, device_key);

drop trigger if exists t_rmm_snapshots_touch on public.rmm_snapshots;
create trigger t_rmm_snapshots_touch before update on public.rmm_snapshots
for each row execute function public._touch_updated_at();

create table if not exists public.rmm_sync_state (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  kind text not null,
  last_run_at timestamptz,
  last_cursor jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists rmm_sync_state_uq on public.rmm_sync_state (provider, kind);

drop trigger if exists t_rmm_sync_state_touch on public.rmm_sync_state;
create trigger t_rmm_sync_state_touch before update on public.rmm_sync_state
for each row execute function public._touch_updated_at();

alter table public.rmm_snapshots enable row level security;
alter table public.rmm_sync_state enable row level security;

-- Snapshots: same visibility model as assets (assigned user OR dept agent/supervisor/admin).
drop policy if exists rmm_snapshots_select on public.rmm_snapshots;
create policy rmm_snapshots_select on public.rmm_snapshots
for select to authenticated
using (
  exists (
    select 1
    from public.assets a
    where a.id = rmm_snapshots.asset_id
      and (
        (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(a.department_id))
        or exists (
          select 1
          from public.asset_assignments aa
          where aa.asset_id = a.id
            and aa.user_id = auth.uid()
            and aa.ended_at is null
        )
      )
  )
);

-- Writes: allow only admin via SQL policies (service role bypasses RLS anyway).
drop policy if exists rmm_snapshots_write_admin on public.rmm_snapshots;
create policy rmm_snapshots_write_admin on public.rmm_snapshots
for all to authenticated
using (public._has_role(array['admin']::public.role_enum[]))
with check (public._has_role(array['admin']::public.role_enum[]));

drop policy if exists rmm_sync_state_admin on public.rmm_sync_state;
create policy rmm_sync_state_admin on public.rmm_sync_state
for all to authenticated
using (public._has_role(array['admin']::public.role_enum[]))
with check (public._has_role(array['admin']::public.role_enum[]));

commit;
