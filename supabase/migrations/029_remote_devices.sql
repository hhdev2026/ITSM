begin;

do $$ begin
  create type public.remote_protocol_enum as enum ('rdp','vnc');
exception when duplicate_object then null; end $$;

create table if not exists public.remote_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  department_id uuid not null references public.departments (id) on delete cascade,
  mesh_node_id text,
  protocol public.remote_protocol_enum not null,
  -- Encrypted payload (application-managed). Example structure:
  -- { "v": 1, "alg": "aes-256-gcm", "iv": "...", "tag": "...", "ciphertext": "..." }
  credentials jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, name)
);

create index if not exists remote_devices_department_idx on public.remote_devices (department_id);
create index if not exists remote_devices_mesh_node_idx on public.remote_devices (mesh_node_id);

drop trigger if exists t_remote_devices_touch on public.remote_devices;
create trigger t_remote_devices_touch before update on public.remote_devices
for each row execute function public._touch_updated_at();

alter table public.remote_devices enable row level security;

drop policy if exists remote_devices_select on public.remote_devices;
create policy remote_devices_select on public.remote_devices
for select to authenticated
using (
  public._has_role(array['agent','supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

drop policy if exists remote_devices_write on public.remote_devices;
create policy remote_devices_write on public.remote_devices
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

commit;

