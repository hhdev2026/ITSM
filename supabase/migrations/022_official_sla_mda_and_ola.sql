begin;

-- ---------------------------------------------------------------------
-- Official SLA/OLA presets + time basis (business vs calendar)
-- - SLA (MDA): Resp 2h, Res 8h (horas hábiles 08:00-18:00, lun-vie)
-- - OLA (operación): Resp 1h, Res 2h (nivel 1 + escalamiento nivel 2)
-- Notes:
-- - For "24 horas corridas" targets, use `time_basis='calendar'`.
-- - Service-specific overrides still live in `service_time_targets` (SLA/OLA).
-- ---------------------------------------------------------------------

do $$ begin
  create type public.time_basis_enum as enum ('business', 'calendar');
exception when duplicate_object then null; end $$;

-- Ensure default business calendar matches MDA availability (only "Horario estándar")
update public.business_calendars
set
  timezone = 'America/Santiago',
  work_start = '08:00'::time,
  work_end = '18:00'::time,
  work_days = array[1,2,3,4,5]::smallint[],
  updated_at = now()
where name = 'Horario estándar';

-- SLA: add time basis
alter table public.slas add column if not exists time_basis public.time_basis_enum not null default 'business';

-- OLA: defaults by department/priority
create table if not exists public.olas (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments (id) on delete cascade,
  priority public.ticket_priority_enum not null,
  response_time_hours integer not null check (response_time_hours >= 0),
  resolution_time_hours integer not null check (resolution_time_hours >= 0),
  time_basis public.time_basis_enum not null default 'business',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists olas_active_idx on public.olas (is_active, priority);

alter table public.olas enable row level security;

drop trigger if exists t_olas_touch on public.olas;
create trigger t_olas_touch before update on public.olas
for each row execute function public._touch_updated_at();

drop policy if exists olas_select_agents on public.olas;
create policy olas_select_agents on public.olas
for select to authenticated
using (
  public._has_role(array['agent','supervisor','admin']::public.role_enum[])
  and (department_id is null or public._same_department(department_id))
);

drop policy if exists olas_supervisor_write on public.olas;
create policy olas_supervisor_write on public.olas
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and (department_id is null or public._same_department(department_id))
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and (department_id is null or public._same_department(department_id))
);

-- Service-specific targets: allow choosing business vs calendar time basis
alter table public.service_time_targets add column if not exists time_basis public.time_basis_enum not null default 'business';

-- Store basis per computed deadline (used for pause adjustments)
alter table public.tickets add column if not exists sla_time_basis public.time_basis_enum not null default 'business';
alter table public.tickets add column if not exists response_time_basis public.time_basis_enum not null default 'business';
alter table public.tickets add column if not exists ola_time_basis public.time_basis_enum not null default 'business';
alter table public.tickets add column if not exists ola_response_time_basis public.time_basis_enum not null default 'business';

-- Solution delivery tracking (for supervisor control)
alter table public.tickets add column if not exists solution_delivered_at timestamptz;
alter table public.tickets add column if not exists solution_delivered_by uuid references public.profiles (id);

-- Helpers: add minutes using selected time basis
create or replace function public._add_minutes_with_basis(
  _basis public.time_basis_enum,
  _calendar_id uuid,
  _start timestamptz,
  _minutes integer
)
returns timestamptz
language plpgsql
stable
as $$
begin
  if _start is null then
    return null;
  end if;
  if _minutes is null or _minutes <= 0 then
    return _start;
  end if;

  if _basis = 'calendar' then
    return _start + make_interval(mins => _minutes);
  end if;

  return public.business_add_minutes(_calendar_id, _start, _minutes);
end;
$$;

-- Replace: set dept + SLA/OLA using calendars + time basis
create or replace function public._set_ticket_department_and_sla()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dept uuid;
  cal uuid;
  svc_id uuid;

  sla_res_hours integer;
  sla_resp_hours integer;
  sla_basis public.time_basis_enum := 'business';

  ola_res_hours integer;
  ola_resp_hours integer;
  ola_basis public.time_basis_enum := 'business';
begin
  select p.department_id into dept
  from public.profiles p
  where p.id = new.requester_id;

  if dept is null then
    raise exception 'Requester must have department_id set';
  end if;

  new.department_id := dept;

  cal := public._calendar_for_department(dept);
  new.business_calendar_id := cal;

  svc_id := public._ticket_service_id(new.metadata);

  -- Service SLA override
  if svc_id is not null then
    select st.response_time_hours, st.resolution_time_hours, st.time_basis
      into sla_resp_hours, sla_res_hours, sla_basis
    from public.service_time_targets st
    join public.service_catalog_items s on s.id = st.service_id
    where st.is_active = true
      and st.target = 'SLA'
      and st.service_id = svc_id
      and st.priority = new.priority
      and (s.department_id is null or s.department_id = dept)
    order by st.updated_at desc
    limit 1;

    select st.response_time_hours, st.resolution_time_hours, st.time_basis
      into ola_resp_hours, ola_res_hours, ola_basis
    from public.service_time_targets st
    join public.service_catalog_items s on s.id = st.service_id
    where st.is_active = true
      and st.target = 'OLA'
      and st.service_id = svc_id
      and st.priority = new.priority
      and (s.department_id is null or s.department_id = dept)
    order by st.updated_at desc
    limit 1;
  end if;

  -- Fallback SLA (MDA) if service SLA not defined
  if sla_res_hours is null or sla_resp_hours is null then
    select s.response_time_hours, s.resolution_time_hours, s.time_basis
      into sla_resp_hours, sla_res_hours, sla_basis
    from public.slas s
    where s.is_active = true
      and s.priority = new.priority
      and (s.department_id = dept or s.department_id is null)
    order by (s.department_id is null) asc, s.updated_at desc
    limit 1;
  end if;

  -- Fallback OLA (operación) if not defined by service
  if ola_res_hours is null or ola_resp_hours is null then
    select o.response_time_hours, o.resolution_time_hours, o.time_basis
      into ola_resp_hours, ola_res_hours, ola_basis
    from public.olas o
    where o.is_active = true
      and o.priority = new.priority
      and (o.department_id = dept or o.department_id is null)
    order by (o.department_id is null) asc, o.updated_at desc
    limit 1;
  end if;

  new.sla_response_target_minutes := case when sla_resp_hours is null then null else sla_resp_hours * 60 end;
  new.sla_resolution_target_minutes := case when sla_res_hours is null then null else sla_res_hours * 60 end;
  new.ola_response_target_minutes := case when ola_resp_hours is null then null else ola_resp_hours * 60 end;
  new.ola_resolution_target_minutes := case when ola_res_hours is null then null else ola_res_hours * 60 end;

  new.response_time_basis := coalesce(sla_basis, 'business');
  new.sla_time_basis := coalesce(sla_basis, 'business');
  new.ola_response_time_basis := coalesce(ola_basis, 'business');
  new.ola_time_basis := coalesce(ola_basis, 'business');

  if sla_resp_hours is not null then
    new.response_deadline := public._add_minutes_with_basis(new.response_time_basis, cal, new.created_at, sla_resp_hours * 60);
  end if;

  if sla_res_hours is not null then
    new.sla_deadline := public._add_minutes_with_basis(new.sla_time_basis, cal, new.created_at, sla_res_hours * 60);
  end if;

  if ola_resp_hours is not null then
    new.ola_response_deadline := public._add_minutes_with_basis(new.ola_response_time_basis, cal, new.created_at, ola_resp_hours * 60);
  end if;

  if ola_res_hours is not null then
    new.ola_deadline := public._add_minutes_with_basis(new.ola_time_basis, cal, new.created_at, ola_res_hours * 60);
  end if;

  return new;
end;
$$;

-- Replace pause adjustment: extend deadlines according to basis
create or replace function public._tickets_apply_sla_pause()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cal uuid;
  paused integer;
  base_response timestamptz;
  base_sla timestamptz;
  base_ola_resp timestamptz;
  base_ola timestamptz;
  is_pause_new boolean;
  is_pause_old boolean;
  resp_basis public.time_basis_enum;
  sla_basis public.time_basis_enum;
  ola_resp_basis public.time_basis_enum;
  ola_basis public.time_basis_enum;
begin
  if new.status is distinct from old.status then
    cal := coalesce(new.business_calendar_id, public._calendar_for_department(new.department_id));

    is_pause_new := new.status in ('Planificado o Coordinado','Planificado');
    is_pause_old := old.status in ('Planificado o Coordinado','Planificado');

    -- Enter pause
    if is_pause_new and not is_pause_old then
      new.sla_pause_started_at := coalesce(new.sla_pause_started_at, now());
      return new;
    end if;

    -- Exit pause
    if is_pause_old and not is_pause_new then
      if old.sla_pause_started_at is null then
        new.sla_pause_started_at := null;
        return new;
      end if;

      paused := public.business_minutes_between(cal, old.sla_pause_started_at, now());
      new.sla_paused_minutes := coalesce(old.sla_paused_minutes, 0) + paused;
      new.sla_pause_started_at := null;

      if paused > 0 then
        base_response := coalesce(old.response_deadline, new.response_deadline);
        base_sla := coalesce(old.sla_deadline, new.sla_deadline);
        base_ola_resp := coalesce(old.ola_response_deadline, new.ola_response_deadline);
        base_ola := coalesce(old.ola_deadline, new.ola_deadline);

        resp_basis := coalesce(old.response_time_basis, new.response_time_basis, 'business');
        sla_basis := coalesce(old.sla_time_basis, new.sla_time_basis, 'business');
        ola_resp_basis := coalesce(old.ola_response_time_basis, new.ola_response_time_basis, 'business');
        ola_basis := coalesce(old.ola_time_basis, new.ola_time_basis, 'business');

        if base_response is not null then
          new.response_deadline := public._add_minutes_with_basis(resp_basis, cal, base_response, paused);
        end if;
        if base_sla is not null then
          new.sla_deadline := public._add_minutes_with_basis(sla_basis, cal, base_sla, paused);
        end if;
        if base_ola_resp is not null then
          new.ola_response_deadline := public._add_minutes_with_basis(ola_resp_basis, cal, base_ola_resp, paused);
        end if;
        if base_ola is not null then
          new.ola_deadline := public._add_minutes_with_basis(ola_basis, cal, base_ola, paused);
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists t_tickets_sla_pause on public.tickets;
create trigger t_tickets_sla_pause
before update of status on public.tickets
for each row execute function public._tickets_apply_sla_pause();

-- Enforce solution fields on close + mark delivered
create or replace function public._set_ticket_transition_timestamps()
returns trigger
language plpgsql
as $$
begin
  -- legacy support
  if new.status = 'Planificado' and old.status is distinct from 'Planificado' then
    new.planned_at := coalesce(new.planned_at, now());
  end if;

  if new.status = 'Planificado o Coordinado' and old.status is distinct from 'Planificado o Coordinado' then
    new.planned_at := coalesce(new.planned_at, now());
  end if;

  if new.status = 'Cancelado' and old.status is distinct from 'Cancelado' then
    new.canceled_at := coalesce(new.canceled_at, now());
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  if new.status = 'Rechazado' and old.status is distinct from 'Rechazado' then
    -- legacy: treat as canceled/closed
    new.canceled_at := coalesce(new.canceled_at, now());
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  if new.status = 'Cerrado' and old.status is distinct from 'Cerrado' then
    if new.solution_type is null then
      raise exception 'solution_type_required';
    end if;

    new.closed_at := coalesce(new.closed_at, now());
    new.resolved_at := coalesce(new.resolved_at, now());
    new.solution_delivered_at := coalesce(new.solution_delivered_at, now());
    new.solution_delivered_by := coalesce(new.solution_delivered_by, auth.uid());
  end if;

  if new.status = 'Resuelto' and old.status is distinct from 'Resuelto' then
    -- legacy
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;

  return new;
end;
$$;

-- Official values seed (idempotent): SLA (MDA) and OLA defaults for each dept + global
do $$
declare
  d uuid;
  p public.ticket_priority_enum;
begin
  for d in (select id from public.departments union all select null::uuid) loop
    foreach p in array array['Crítica','Alta','Media','Baja']::public.ticket_priority_enum[] loop
      update public.slas
      set response_time_hours = 2,
          resolution_time_hours = 8,
          time_basis = 'business',
          is_active = true,
          updated_at = now()
      where priority = p
        and is_active = true
        and department_id is not distinct from d;

      if not exists (
        select 1
        from public.slas
        where priority = p
          and is_active = true
          and department_id is not distinct from d
      ) then
        insert into public.slas (department_id, priority, response_time_hours, resolution_time_hours, time_basis, is_active)
        values (d, p, 2, 8, 'business', true);
      end if;

      update public.olas
      set response_time_hours = 1,
          resolution_time_hours = 2,
          time_basis = 'business',
          is_active = true,
          updated_at = now()
      where priority = p
        and is_active = true
        and department_id is not distinct from d;

      if not exists (
        select 1
        from public.olas
        where priority = p
          and is_active = true
          and department_id is not distinct from d
      ) then
        insert into public.olas (department_id, priority, response_time_hours, resolution_time_hours, time_basis, is_active)
        values (d, p, 1, 2, 'business', true);
      end if;
    end loop;
  end loop;
end $$;

commit;

