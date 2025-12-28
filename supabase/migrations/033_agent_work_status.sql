begin;

-- ---------------------------------------------------------------------
-- Agent work status (turno) + traceability
-- - Separate from chat availability (agent_presence)
-- - Stores current state + event log
-- ---------------------------------------------------------------------

do $$ begin
  create type public.agent_work_status_enum as enum ('En turno', 'Descanso', 'Almuerzo', 'Baño', 'Fin turno');
exception when duplicate_object then null; end $$;

create table if not exists public.agent_work_status (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  department_id uuid references public.departments (id) on delete cascade,
  status public.agent_work_status_enum not null default 'Fin turno',
  note text,
  updated_at timestamptz not null default now()
);

create index if not exists agent_work_status_dept_idx on public.agent_work_status (department_id, status, updated_at desc);

create table if not exists public.agent_work_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  department_id uuid references public.departments (id) on delete cascade,
  status public.agent_work_status_enum not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists agent_work_events_profile_idx on public.agent_work_events (profile_id, created_at desc);
create index if not exists agent_work_events_dept_idx on public.agent_work_events (department_id, created_at desc);

drop trigger if exists t_agent_work_status_touch on public.agent_work_status;
create trigger t_agent_work_status_touch before update on public.agent_work_status
for each row execute function public._touch_updated_at();

alter table public.agent_work_status enable row level security;
alter table public.agent_work_events enable row level security;

-- Read: self + supervisors/admin of same department
drop policy if exists agent_work_status_select on public.agent_work_status;
create policy agent_work_status_select on public.agent_work_status
for select to authenticated
using (
  profile_id = auth.uid()
  or (public._has_role(array['supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
);

drop policy if exists agent_work_events_select on public.agent_work_events;
create policy agent_work_events_select on public.agent_work_events
for select to authenticated
using (
  profile_id = auth.uid()
  or (public._has_role(array['supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
);

-- Writes are via RPC (security definer)
drop policy if exists agent_work_status_write_none on public.agent_work_status;
create policy agent_work_status_write_none on public.agent_work_status
for all to authenticated
using (false)
with check (false);

drop policy if exists agent_work_events_write_none on public.agent_work_events;
create policy agent_work_events_write_none on public.agent_work_events
for all to authenticated
using (false)
with check (false);

create or replace function public.agent_set_work_status(
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  dept uuid;
  st public.agent_work_status_enum;
  note_clean text;
begin
  perform set_config('row_security', 'off', true);
  uid := auth.uid();
  if uid is null then raise exception 'Not authenticated'; end if;

  if not public._has_role(array['agent','supervisor','admin']::public.role_enum[]) then
    raise exception 'forbidden';
  end if;

  select p.department_id into dept from public.profiles p where p.id = uid;
  if dept is null then raise exception 'department_required'; end if;

  case lower(coalesce(p_status,'')) 
    when 'en turno' then st := 'En turno'::public.agent_work_status_enum;
    when 'turno' then st := 'En turno'::public.agent_work_status_enum;
    when 'descanso' then st := 'Descanso'::public.agent_work_status_enum;
    when 'almuerzo' then st := 'Almuerzo'::public.agent_work_status_enum;
    when 'baño' then st := 'Baño'::public.agent_work_status_enum;
    when 'bano' then st := 'Baño'::public.agent_work_status_enum;
    when 'fin turno' then st := 'Fin turno'::public.agent_work_status_enum;
    when 'fin' then st := 'Fin turno'::public.agent_work_status_enum;
    else raise exception 'invalid_status';
  end case;

  note_clean := nullif(trim(coalesce(p_note,'')), '');

  insert into public.agent_work_status (profile_id, department_id, status, note, updated_at)
  values (uid, dept, st, note_clean, now())
  on conflict (profile_id)
  do update set status = excluded.status, note = excluded.note, department_id = excluded.department_id, updated_at = now();

  insert into public.agent_work_events (profile_id, department_id, status, note)
  values (uid, dept, st, note_clean);

  -- Reasonable defaults: end of shift makes chat offline, breaks mark chat away.
  if st = 'Fin turno'::public.agent_work_status_enum then
    perform public.chat_set_presence('offline', null);
  elsif st in ('Descanso'::public.agent_work_status_enum, 'Almuerzo'::public.agent_work_status_enum, 'Baño'::public.agent_work_status_enum) then
    perform public.chat_set_presence('ausente', null);
  end if;
end;
$$;

revoke all on function public.agent_set_work_status(text, text) from public;
grant execute on function public.agent_set_work_status(text, text) to authenticated;

commit;

