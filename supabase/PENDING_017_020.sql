-- Consolidated pending migrations (017..021)
-- Prerequisite: base schema + service catalog + approvals already applied (migrations <= 016).
-- If this is a fresh DB, run `supabase/ONE_SHOT.sql` instead.

-- ---------------------------------------------------------------------
-- 017_sla_business_hours.sql
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- SLA v2: horas hábiles (calendarios) + pausas (Planificado) + exclusiones
-- Nota sobre retroactividad:
-- - Por defecto, los cambios de configuración NO son retroactivos porque los
--   deadlines se calculan y almacenan al crear el ticket.
-- - Este despliegue recalcula SOLO tickets abiertos para alinearlos al nuevo
--   motor de horas hábiles (histórico cerrado queda intacto).
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Phase 0: enum values (must be committed before use)
-- ---------------------------------------------------------------------

begin;

do $$ begin
  alter type public.ticket_status_enum add value if not exists 'Planificado';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.ticket_status_enum add value if not exists 'Cancelado';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.ticket_status_enum add value if not exists 'En Curso';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.ticket_status_enum add value if not exists 'En Espera';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.ticket_status_enum add value if not exists 'Planificado o Coordinado';
exception when duplicate_object then null; end $$;

commit;

begin;

-- Ticket statuses handled in Phase 0 (do not re-add inside this transaction)

-- ---------------------------------------------------------------------
-- Business calendars (por departamento) + feriados
-- ---------------------------------------------------------------------

create table if not exists public.business_calendars (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments (id) on delete cascade,
  name text not null,
  timezone text not null default 'America/Santiago',
  work_start time not null default '08:00',
  work_end time not null default '18:00',
  work_days smallint[] not null default array[1,2,3,4,5], -- ISO DOW: 1..7 (lun..dom)
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, name)
);

create index if not exists business_calendars_dept_active_idx on public.business_calendars (department_id, is_active);

create table if not exists public.business_holidays (
  calendar_id uuid not null references public.business_calendars (id) on delete cascade,
  holiday_date date not null,
  name text,
  -- Permite excepciones: si is_working=true, ese día se considera hábil aunque sea fin de semana.
  is_working boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (calendar_id, holiday_date)
);

create index if not exists business_holidays_date_idx on public.business_holidays (holiday_date);

alter table public.business_calendars enable row level security;
alter table public.business_holidays enable row level security;

drop trigger if exists t_business_calendars_touch on public.business_calendars;
create trigger t_business_calendars_touch before update on public.business_calendars
for each row execute function public._touch_updated_at();

-- Calendars: select para usuarios del depto, write supervisor/admin.
drop policy if exists business_calendars_select on public.business_calendars;
create policy business_calendars_select on public.business_calendars
for select to authenticated
using (
  (department_id is null or public._same_department(department_id))
  or public._is_role('admin')
);

drop policy if exists business_calendars_write on public.business_calendars;
create policy business_calendars_write on public.business_calendars
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and (department_id is null or public._same_department(department_id))
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and (department_id is null or public._same_department(department_id))
);

drop policy if exists business_holidays_select on public.business_holidays;
create policy business_holidays_select on public.business_holidays
for select to authenticated
using (
  exists (
    select 1
    from public.business_calendars c
    where c.id = business_holidays.calendar_id
      and ((c.department_id is null or public._same_department(c.department_id)) or public._is_role('admin'))
  )
);

drop policy if exists business_holidays_write on public.business_holidays;
create policy business_holidays_write on public.business_holidays
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and exists (
    select 1
    from public.business_calendars c
    where c.id = business_holidays.calendar_id
      and (c.department_id is null or public._same_department(c.department_id))
  )
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and exists (
    select 1
    from public.business_calendars c
    where c.id = business_holidays.calendar_id
      and (c.department_id is null or public._same_department(c.department_id))
  )
);

-- Departments: default calendar
alter table public.departments add column if not exists business_calendar_id uuid references public.business_calendars (id);
create index if not exists departments_business_calendar_idx on public.departments (business_calendar_id);

-- Create/assign a default calendar per department (if missing)
do $$
declare
  d record;
  cid uuid;
begin
  for d in select id, name from public.departments loop
    if (select business_calendar_id from public.departments where id = d.id) is null then
      insert into public.business_calendars (department_id, name)
      values (d.id, 'Horario estándar')
      returning id into cid;
      update public.departments set business_calendar_id = cid where id = d.id;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Business time functions
-- ---------------------------------------------------------------------

create or replace function public._calendar_for_department(_dept uuid)
returns uuid
language sql
stable
as $$
  select d.business_calendar_id
  from public.departments d
  where d.id = _dept;
$$;

create or replace function public._business_is_working_day(_calendar_id uuid, _day date)
returns boolean
language plpgsql
stable
as $$
declare
  c public.business_calendars;
  hol public.business_holidays;
  dow smallint;
begin
  select * into c from public.business_calendars where id = _calendar_id;
  if c.id is null then
    return false;
  end if;

  select * into hol
  from public.business_holidays h
  where h.calendar_id = _calendar_id
    and h.holiday_date = _day;

  if hol.calendar_id is not null then
    return hol.is_working;
  end if;

  dow := extract(isodow from _day)::smallint; -- 1..7
  return dow = any(c.work_days);
end;
$$;

create or replace function public.business_minutes_between(
  _calendar_id uuid,
  _start timestamptz,
  _end timestamptz
)
returns integer
language plpgsql
stable
as $$
declare
  c public.business_calendars;
  tz text;
  start_ts timestamptz;
  end_ts timestamptz;
  start_day date;
  end_day date;
  cur_day date;
  day_start timestamptz;
  day_end timestamptz;
  overlap_start timestamptz;
  overlap_end timestamptz;
  total_minutes integer := 0;
begin
  if _calendar_id is null or _start is null or _end is null then
    return 0;
  end if;
  if _end <= _start then
    return 0;
  end if;

  select * into c from public.business_calendars where id = _calendar_id;
  if c.id is null then
    return 0;
  end if;

  tz := c.timezone;
  start_ts := _start;
  end_ts := _end;

  start_day := (start_ts at time zone tz)::date;
  end_day := (end_ts at time zone tz)::date;

  cur_day := start_day;
  while cur_day <= end_day loop
    if public._business_is_working_day(_calendar_id, cur_day) then
      day_start := ((cur_day::timestamp + c.work_start) at time zone tz);
      day_end := ((cur_day::timestamp + c.work_end) at time zone tz);

      if day_end > day_start then
        overlap_start := greatest(start_ts, day_start);
        overlap_end := least(end_ts, day_end);
        if overlap_end > overlap_start then
          total_minutes := total_minutes + floor(extract(epoch from (overlap_end - overlap_start)) / 60.0)::int;
        end if;
      end if;
    end if;
    cur_day := cur_day + 1;
  end loop;

  return greatest(total_minutes, 0);
end;
$$;

create or replace function public.business_add_minutes(
  _calendar_id uuid,
  _start timestamptz,
  _minutes integer
)
returns timestamptz
language plpgsql
stable
as $$
declare
  c public.business_calendars;
  tz text;
  remaining integer;
  cur_ts timestamptz;
  cur_day date;
  day_start timestamptz;
  day_end timestamptz;
  avail integer;
begin
  if _calendar_id is null or _start is null then
    return null;
  end if;
  if _minutes is null or _minutes <= 0 then
    return _start;
  end if;

  select * into c from public.business_calendars where id = _calendar_id;
  if c.id is null then
    return _start + make_interval(mins => _minutes);
  end if;

  tz := c.timezone;
  remaining := _minutes;
  cur_ts := _start;

  loop
    cur_day := (cur_ts at time zone tz)::date;

    if not public._business_is_working_day(_calendar_id, cur_day) then
      cur_ts := (((cur_day + 1)::timestamp + c.work_start) at time zone tz);
      continue;
    end if;

    day_start := ((cur_day::timestamp + c.work_start) at time zone tz);
    day_end := ((cur_day::timestamp + c.work_end) at time zone tz);

    if day_end <= day_start then
      cur_ts := (((cur_day + 1)::timestamp + c.work_start) at time zone tz);
      continue;
    end if;

    if cur_ts < day_start then
      cur_ts := day_start;
    end if;

    if cur_ts >= day_end then
      cur_ts := (((cur_day + 1)::timestamp + c.work_start) at time zone tz);
      continue;
    end if;

    avail := floor(extract(epoch from (day_end - cur_ts)) / 60.0)::int;
    if remaining <= avail then
      return cur_ts + make_interval(mins => remaining);
    end if;

    remaining := remaining - avail;
    cur_ts := (((cur_day + 1)::timestamp + c.work_start) at time zone tz);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Tickets: fields for SLA targets, calendar snapshot, pauses and exclusions
-- ---------------------------------------------------------------------

alter table public.tickets add column if not exists business_calendar_id uuid references public.business_calendars (id);
create index if not exists tickets_calendar_idx on public.tickets (business_calendar_id);

alter table public.tickets add column if not exists sla_response_target_minutes integer;
alter table public.tickets add column if not exists sla_resolution_target_minutes integer;
alter table public.tickets add column if not exists ola_response_target_minutes integer;
alter table public.tickets add column if not exists ola_resolution_target_minutes integer;

alter table public.tickets add column if not exists sla_pause_started_at timestamptz;
alter table public.tickets add column if not exists sla_paused_minutes integer not null default 0;

alter table public.tickets add column if not exists planned_at timestamptz;
alter table public.tickets add column if not exists planned_for_at timestamptz;

alter table public.tickets add column if not exists canceled_at timestamptz;
alter table public.tickets add column if not exists canceled_reason text;

alter table public.tickets add column if not exists sla_excluded boolean not null default false;
alter table public.tickets add column if not exists sla_exclusion_reason text;
alter table public.tickets add column if not exists sla_excluded_by uuid references public.profiles (id);
alter table public.tickets add column if not exists sla_excluded_at timestamptz;

-- Update ticket transition timestamps: mark rejected/cancelled/planificado
create or replace function public._set_ticket_transition_timestamps()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'Resuelto' and old.status is distinct from 'Resuelto' then
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;

  if new.status = 'Cerrado' and old.status is distinct from 'Cerrado' then
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  if new.status = 'Rechazado' and old.status is distinct from 'Rechazado' then
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  if new.status = 'Planificado' and old.status is distinct from 'Planificado' then
    new.planned_at := coalesce(new.planned_at, now());
  end if;

  if new.status = 'Cancelado' and old.status is distinct from 'Cancelado' then
    new.canceled_at := coalesce(new.canceled_at, now());
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  return new;
end;
$$;

-- Replace: SLA/OLA calc using business calendars (hours hábiles)
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
  res_hours integer;
  resp_hours integer;
  ola_res_hours integer;
  ola_resp_hours integer;
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
    select st.response_time_hours, st.resolution_time_hours
      into resp_hours, res_hours
    from public.service_time_targets st
    join public.service_catalog_items s on s.id = st.service_id
    where st.is_active = true
      and st.target = 'SLA'
      and st.service_id = svc_id
      and st.priority = new.priority
      and (s.department_id is null or s.department_id = dept)
    order by st.updated_at desc
    limit 1;

    select st.response_time_hours, st.resolution_time_hours
      into ola_resp_hours, ola_res_hours
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

  -- Fallback to department/global SLA if service SLA not defined
  if res_hours is null or resp_hours is null then
    select s.response_time_hours, s.resolution_time_hours
      into resp_hours, res_hours
    from public.slas s
    where s.is_active = true
      and s.priority = new.priority
      and (s.department_id = dept or s.department_id is null)
    order by (s.department_id is null) asc, s.updated_at desc
    limit 1;
  end if;

  new.sla_response_target_minutes := case when resp_hours is null then null else resp_hours * 60 end;
  new.sla_resolution_target_minutes := case when res_hours is null then null else res_hours * 60 end;
  new.ola_response_target_minutes := case when ola_resp_hours is null then null else ola_resp_hours * 60 end;
  new.ola_resolution_target_minutes := case when ola_res_hours is null then null else ola_res_hours * 60 end;

  if resp_hours is not null then
    new.response_deadline := public.business_add_minutes(cal, new.created_at, resp_hours * 60);
  end if;

  if res_hours is not null then
    new.sla_deadline := public.business_add_minutes(cal, new.created_at, res_hours * 60);
  end if;

  if ola_resp_hours is not null then
    new.ola_response_deadline := public.business_add_minutes(cal, new.created_at, ola_resp_hours * 60);
  end if;

  if ola_res_hours is not null then
    new.ola_deadline := public.business_add_minutes(cal, new.created_at, ola_res_hours * 60);
  end if;

  return new;
end;
$$;

-- Pause/resume SLA when status=Planificado (detiene el contador en horas hábiles)
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
begin
  if new.status is distinct from old.status then
    cal := coalesce(new.business_calendar_id, public._calendar_for_department(new.department_id));

    -- Enter pause
    if new.status = 'Planificado' and old.status is distinct from 'Planificado' then
      new.sla_pause_started_at := coalesce(new.sla_pause_started_at, now());
      return new;
    end if;

    -- Exit pause
    if old.status = 'Planificado' and new.status is distinct from 'Planificado' then
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

        if base_response is not null then
          new.response_deadline := public.business_add_minutes(cal, base_response, paused);
        end if;
        if base_sla is not null then
          new.sla_deadline := public.business_add_minutes(cal, base_sla, paused);
        end if;
        if base_ola_resp is not null then
          new.ola_response_deadline := public.business_add_minutes(cal, base_ola_resp, paused);
        end if;
        if base_ola is not null then
          new.ola_deadline := public.business_add_minutes(cal, base_ola, paused);
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

-- ---------------------------------------------------------------------
-- SLA exclusion helper (para justificar y excluir del conteo)
-- ---------------------------------------------------------------------

create or replace function public.ticket_set_sla_exclusion(
  p_ticket_id uuid,
  p_excluded boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tickets;
begin
  if not public._has_role(array['agent','supervisor','admin']::public.role_enum[]) then
    raise exception 'forbidden';
  end if;

  select * into t from public.tickets where id = p_ticket_id;
  if t.id is null then
    raise exception 'not_found';
  end if;

  if not (public._same_department(t.department_id) or public._is_role('admin')) then
    raise exception 'forbidden';
  end if;

  update public.tickets
  set
    sla_excluded = coalesce(p_excluded, false),
    sla_exclusion_reason = case when coalesce(p_excluded, false) then nullif(p_reason, '') else null end,
    sla_excluded_by = case when coalesce(p_excluded, false) then auth.uid() else null end,
    sla_excluded_at = case when coalesce(p_excluded, false) then now() else null end
  where id = p_ticket_id;
end;
$$;

revoke all on function public.ticket_set_sla_exclusion(uuid, boolean, text) from public;
grant execute on function public.ticket_set_sla_exclusion(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- Live SLA metrics view (semaforo/termómetro) para UI y export
-- ---------------------------------------------------------------------

create or replace view public.tickets_sla_live as
with base as (
  select
    t.*,
    coalesce(t.business_calendar_id, public._calendar_for_department(t.department_id)) as cal_id
  from public.tickets t
),
calc as (
  select
    b.*,
    case
      when b.response_deadline is null then null
      else public.business_minutes_between(b.cal_id, now(), b.response_deadline)
    end as response_remaining_minutes_raw,
    case
      when b.sla_deadline is null then null
      else public.business_minutes_between(b.cal_id, now(), b.sla_deadline)
    end as sla_remaining_minutes_raw
  from base b
)
select
  c.*,
  greatest(coalesce(c.response_remaining_minutes_raw, 0), 0) as response_remaining_minutes,
  greatest(coalesce(c.sla_remaining_minutes_raw, 0), 0) as sla_remaining_minutes,
  case
    when c.sla_excluded then 'excluded'
    when c.status in ('Cerrado','Cancelado','Rechazado') then 'closed'
    when c.sla_deadline is null or c.sla_resolution_target_minutes is null or c.sla_resolution_target_minutes = 0 then null
    when c.sla_remaining_minutes_raw <= 0 then 'red'
    when (greatest(c.sla_remaining_minutes_raw, 0)::numeric / c.sla_resolution_target_minutes::numeric) <= 0.2 then 'yellow'
    else 'green'
  end as sla_traffic_light,
  case
    when c.sla_deadline is null or c.sla_resolution_target_minutes is null or c.sla_resolution_target_minutes = 0 then null
    else round((1 - (greatest(c.sla_remaining_minutes_raw, 0)::numeric / c.sla_resolution_target_minutes::numeric)) * 100.0, 2)
  end as sla_pct_used,
  case
    when c.sla_excluded then 'excluded'
    when c.status in ('Cerrado','Cancelado','Rechazado') then 'closed'
    when c.response_deadline is null or c.sla_response_target_minutes is null or c.sla_response_target_minutes = 0 then null
    when c.response_remaining_minutes_raw <= 0 then 'red'
    when (greatest(c.response_remaining_minutes_raw, 0)::numeric / c.sla_response_target_minutes::numeric) <= 0.2 then 'yellow'
    else 'green'
  end as response_traffic_light,
  case
    when c.response_deadline is null or c.sla_response_target_minutes is null or c.sla_response_target_minutes = 0 then null
    else round((1 - (greatest(c.response_remaining_minutes_raw, 0)::numeric / c.sla_response_target_minutes::numeric)) * 100.0, 2)
  end as response_pct_used
from calc c;

revoke all on table public.tickets_sla_live from public;
grant select on table public.tickets_sla_live to authenticated;

-- ---------------------------------------------------------------------
-- Backfill: compute business deadlines for tickets abiertos
-- ---------------------------------------------------------------------

create or replace function public._recalc_ticket_deadlines(_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tickets;
  dept uuid;
  cal uuid;
  svc_id uuid;
  res_hours integer;
  resp_hours integer;
  ola_res_hours integer;
  ola_resp_hours integer;
begin
  perform set_config('row_security', 'off', true);
  select * into t from public.tickets where id = _ticket_id;
  if t.id is null then
    return;
  end if;

  dept := t.department_id;
  cal := coalesce(t.business_calendar_id, public._calendar_for_department(dept));
  svc_id := public._ticket_service_id(t.metadata);

  if svc_id is not null then
    select st.response_time_hours, st.resolution_time_hours
      into resp_hours, res_hours
    from public.service_time_targets st
    join public.service_catalog_items s on s.id = st.service_id
    where st.is_active = true
      and st.target = 'SLA'
      and st.service_id = svc_id
      and st.priority = t.priority
      and (s.department_id is null or s.department_id = dept)
    order by st.updated_at desc
    limit 1;

    select st.response_time_hours, st.resolution_time_hours
      into ola_resp_hours, ola_res_hours
    from public.service_time_targets st
    join public.service_catalog_items s on s.id = st.service_id
    where st.is_active = true
      and st.target = 'OLA'
      and st.service_id = svc_id
      and st.priority = t.priority
      and (s.department_id is null or s.department_id = dept)
    order by st.updated_at desc
    limit 1;
  end if;

  if res_hours is null or resp_hours is null then
    select s.response_time_hours, s.resolution_time_hours
      into resp_hours, res_hours
    from public.slas s
    where s.is_active = true
      and s.priority = t.priority
      and (s.department_id = dept or s.department_id is null)
    order by (s.department_id is null) asc, s.updated_at desc
    limit 1;
  end if;

  update public.tickets
  set
    business_calendar_id = cal,
    sla_response_target_minutes = case when resp_hours is null then sla_response_target_minutes else resp_hours * 60 end,
    sla_resolution_target_minutes = case when res_hours is null then sla_resolution_target_minutes else res_hours * 60 end,
    ola_response_target_minutes = case when ola_resp_hours is null then ola_response_target_minutes else ola_resp_hours * 60 end,
    ola_resolution_target_minutes = case when ola_res_hours is null then ola_resolution_target_minutes else ola_res_hours * 60 end,
    response_deadline = case when resp_hours is null then response_deadline else public.business_add_minutes(cal, t.created_at, resp_hours * 60) end,
    sla_deadline = case when res_hours is null then sla_deadline else public.business_add_minutes(cal, t.created_at, res_hours * 60) end,
    ola_response_deadline = case when ola_resp_hours is null then ola_response_deadline else public.business_add_minutes(cal, t.created_at, ola_resp_hours * 60) end,
    ola_deadline = case when ola_res_hours is null then ola_deadline else public.business_add_minutes(cal, t.created_at, ola_res_hours * 60) end
  where id = _ticket_id;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select id
    from public.tickets
    where status not in ('Cerrado','Rechazado','Cancelado')
  loop
    perform public._recalc_ticket_deadlines(r.id);
  end loop;
end $$;



-- ---------------------------------------------------------------------
-- 018_kpi_sla_exclusions.sql
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- KPI updates: excluir tickets fuera de SLA (justificados) y estados terminales
-- ---------------------------------------------------------------------

create or replace function public.kpi_dashboard(
  p_start timestamptz,
  p_end timestamptz,
  p_agent_id uuid default null,
  p_category_id uuid default null
)
returns jsonb
language plpgsql
stable
as $$
declare
  dept_id uuid;
  created_count bigint;
  closed_count bigint;
  canceled_count bigint;
  mttr_seconds numeric;
  sla_ok bigint;
  sla_total bigint;
  fcr_ok bigint;
  fcr_total bigint;
  pending_crit bigint;
  pending_high bigint;
  pending_med bigint;
  pending_low bigint;
  workload jsonb;
begin
  if not public._has_role(array['supervisor','admin']::public.role_enum[]) then
    raise exception 'forbidden';
  end if;

  select p.department_id into dept_id
  from public.profiles p
  where p.id = auth.uid();

  if dept_id is null then
    raise exception 'department_required';
  end if;

  -- Volume: created vs closed vs canceled
  select count(*) into created_count
  from public.tickets t
  where t.department_id = dept_id
    and t.created_at >= p_start and t.created_at < p_end
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  select count(*) into closed_count
  from public.tickets t
  where t.department_id = dept_id
    and t.status = 'Cerrado'
    and t.closed_at is not null
    and t.closed_at >= p_start and t.closed_at < p_end
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  select count(*) into canceled_count
  from public.tickets t
  where t.department_id = dept_id
    and t.status = 'Cancelado'
    and t.canceled_at is not null
    and t.canceled_at >= p_start and t.canceled_at < p_end
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- MTTR (seconds) - solo cerrados
  select avg(extract(epoch from (t.closed_at - t.created_at))) into mttr_seconds
  from public.tickets t
  where t.department_id = dept_id
    and t.status = 'Cerrado'
    and t.closed_at is not null
    and t.closed_at >= p_start and t.closed_at < p_end
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- SLA compliance (excluye justificadas fuera de SLA)
  select
    count(*) filter (where t.sla_deadline is not null) as total,
    count(*) filter (where t.sla_deadline is not null and t.closed_at <= t.sla_deadline) as ok
  into sla_total, sla_ok
  from public.tickets t
  where t.department_id = dept_id
    and t.status = 'Cerrado'
    and t.closed_at is not null
    and coalesce(t.sla_excluded, false) = false
    and t.closed_at >= p_start and t.closed_at < p_end
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- Pending (snapshot) by priority (excluye terminales)
  select
    count(*) filter (where t.priority = 'Crítica') as crit,
    count(*) filter (where t.priority = 'Alta') as high,
    count(*) filter (where t.priority = 'Media') as med,
    count(*) filter (where t.priority = 'Baja') as low
  into pending_crit, pending_high, pending_med, pending_low
  from public.tickets t
  where t.department_id = dept_id
    and t.status not in ('Cerrado','Rechazado','Cancelado')
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- Workload (snapshot): open tickets assigned per agent (excluye terminales)
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into workload
  from (
    select
      p.id as agent_id,
      coalesce(p.full_name, p.email) as agent_name,
      count(t.id) as open_assigned
    from public.profiles p
    left join public.tickets t
      on t.assignee_id = p.id
     and t.department_id = dept_id
     and t.status not in ('Cerrado','Rechazado','Cancelado')
    where p.role in ('agent','supervisor')
      and p.department_id = dept_id
    group by p.id, p.full_name, p.email
    order by open_assigned desc
  ) x;

  -- FCR (approx): closed tickets where agent/supervisor made exactly 1 public comment
  select count(*) into fcr_total
  from public.tickets t
  where t.department_id = dept_id
    and t.status = 'Cerrado'
    and t.closed_at is not null
    and t.closed_at >= p_start and t.closed_at < p_end
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  select count(*) into fcr_ok
  from public.tickets t
  where t.department_id = dept_id
    and t.status = 'Cerrado'
    and t.closed_at is not null
    and t.closed_at >= p_start and t.closed_at < p_end
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id)
    and (
      select count(*)
      from public.comments c
      join public.profiles ap on ap.id = c.author_id
      where c.ticket_id = t.id
        and c.is_internal = false
        and ap.role in ('agent','supervisor','admin')
    ) = 1;

  return jsonb_build_object(
    'range', jsonb_build_object('start', p_start, 'end', p_end),
    'volume', jsonb_build_object('created', created_count, 'closed', closed_count, 'canceled', canceled_count),
    'mttr_hours', coalesce(mttr_seconds, 0) / 3600.0,
    'sla_compliance_pct', case when sla_total = 0 then null else round((sla_ok::numeric / sla_total::numeric) * 100.0, 2) end,
    'pending_by_priority', jsonb_build_object('Crítica', pending_crit, 'Alta', pending_high, 'Media', pending_med, 'Baja', pending_low),
    'workload', workload,
    'fcr_pct', case when fcr_total = 0 then null else round((fcr_ok::numeric / fcr_total::numeric) * 100.0, 2) end
  );
end;
$$;

revoke all on function public.kpi_dashboard(timestamptz, timestamptz, uuid, uuid) from public;
grant execute on function public.kpi_dashboard(timestamptz, timestamptz, uuid, uuid) to authenticated;

create or replace function public.kpi_timeseries(
  p_start timestamptz,
  p_end timestamptz,
  p_bucket text,
  p_agent_id uuid default null,
  p_category_id uuid default null
)
returns jsonb
language plpgsql
stable
as $$
declare
  dept_id uuid;
  bucket text;
begin
  if not public._has_role(array['supervisor','admin']::public.role_enum[]) then
    raise exception 'forbidden';
  end if;

  select p.department_id into dept_id
  from public.profiles p
  where p.id = auth.uid();

  if dept_id is null then
    raise exception 'department_required';
  end if;

  bucket := case
    when p_bucket in ('hour','day','week','month') then p_bucket
    else 'day'
  end;

  return (
    with series as (
      select generate_series(
        date_trunc(bucket, p_start),
        date_trunc(bucket, p_end),
        ('1 ' || bucket)::interval
      ) as b
    ),
    created as (
      select date_trunc(bucket, t.created_at) as b, count(*)::int as created
      from public.tickets t
      where t.department_id = dept_id
        and t.created_at >= p_start and t.created_at < p_end
        and (p_agent_id is null or t.assignee_id = p_agent_id)
        and (p_category_id is null or t.category_id = p_category_id)
      group by 1
    ),
    closed as (
      select date_trunc(bucket, t.closed_at) as b, count(*)::int as closed
      from public.tickets t
      where t.department_id = dept_id
        and t.status = 'Cerrado'
        and t.closed_at is not null
        and t.closed_at >= p_start and t.closed_at < p_end
        and (p_agent_id is null or t.assignee_id = p_agent_id)
        and (p_category_id is null or t.category_id = p_category_id)
      group by 1
    ),
    response as (
      select date_trunc(bucket, t.created_at) as b,
             round(avg(extract(epoch from (t.first_response_at - t.created_at))) / 3600.0, 2) as avg_response_hours
      from public.tickets t
      where t.department_id = dept_id
        and t.created_at >= p_start and t.created_at < p_end
        and t.first_response_at is not null
        and (p_agent_id is null or t.assignee_id = p_agent_id)
        and (p_category_id is null or t.category_id = p_category_id)
      group by 1
    ),
    resolution as (
      select date_trunc(bucket, t.closed_at) as b,
             round(avg(extract(epoch from (t.closed_at - t.created_at))) / 3600.0, 2) as avg_resolution_hours
      from public.tickets t
      where t.department_id = dept_id
        and t.status = 'Cerrado'
        and t.closed_at is not null
        and t.closed_at >= p_start and t.closed_at < p_end
        and (p_agent_id is null or t.assignee_id = p_agent_id)
        and (p_category_id is null or t.category_id = p_category_id)
      group by 1
    ),
    sla as (
      select date_trunc(bucket, t.closed_at) as b,
             count(*) filter (where t.sla_deadline is not null)::int as sla_total,
             count(*) filter (where t.sla_deadline is not null and t.closed_at <= t.sla_deadline)::int as sla_ok
      from public.tickets t
      where t.department_id = dept_id
        and t.status = 'Cerrado'
        and t.closed_at is not null
        and coalesce(t.sla_excluded, false) = false
        and t.closed_at >= p_start and t.closed_at < p_end
        and (p_agent_id is null or t.assignee_id = p_agent_id)
        and (p_category_id is null or t.category_id = p_category_id)
      group by 1
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'bucket', s.b,
          'created', coalesce(c.created, 0),
          'closed', coalesce(cl.closed, 0),
          'avg_response_hours', r.avg_response_hours,
          'avg_resolution_hours', rs.avg_resolution_hours,
          'sla_pct', case
            when coalesce(sl.sla_total, 0) = 0 then null
            else round((sl.sla_ok::numeric / sl.sla_total::numeric) * 100.0, 2)
          end
        )
        order by s.b
      ),
      '[]'::jsonb
    )
    from series s
    left join created c on c.b = s.b
    left join closed cl on cl.b = s.b
    left join response r on r.b = s.b
    left join resolution rs on rs.b = s.b
    left join sla sl on sl.b = s.b
  );
end;
$$;

revoke all on function public.kpi_timeseries(timestamptz, timestamptz, text, uuid, uuid) from public;
grant execute on function public.kpi_timeseries(timestamptz, timestamptz, text, uuid, uuid) to authenticated;



-- ---------------------------------------------------------------------
-- 019_service_catalog_tiers.sql
-- ---------------------------------------------------------------------

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



-- ---------------------------------------------------------------------
-- 020_official_status_and_solution.sql
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Official ticket statuses + solution types (alignment)
-- ---------------------------------------------------------------------

-- Statuses (keep legacy values for backwards compatibility, but migrate data)
-- Statuses handled in Phase 0 (must be committed before use)

-- Default status -> En Curso
alter table public.tickets alter column status set default 'En Curso';

-- Solution type
do $$ begin
  create type public.ticket_solution_type_enum as enum ('Instrucción al usuario', 'Soporte Remoto', 'Soporte Terreno', 'Implementación');
exception when duplicate_object then null; end $$;

alter table public.tickets add column if not exists solution_type public.ticket_solution_type_enum;
alter table public.tickets add column if not exists solution_notes text;

-- Data migration: map legacy statuses to official ones
update public.tickets
set status = 'En Curso'
where status in ('Nuevo','Asignado','En Progreso','Resuelto');

update public.tickets
set status = 'En Espera'
where status in ('Pendiente Info','Pendiente Aprobación');

update public.tickets
set status = 'Planificado o Coordinado'
where status = 'Planificado';

update public.tickets
set
  status = 'Cancelado',
  canceled_reason = coalesce(canceled_reason, 'Rechazado'),
  canceled_at = coalesce(canceled_at, closed_at, now()),
  closed_at = coalesce(closed_at, now())
where status = 'Rechazado';

-- Update ticket transition timestamps for official statuses
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
    new.closed_at := coalesce(new.closed_at, now());
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;

  if new.status = 'Resuelto' and old.status is distinct from 'Resuelto' then
    -- legacy
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;

  return new;
end;
$$;

-- SLA pause: pause when Planificado o Coordinado (and legacy Planificado)
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

        if base_response is not null then
          new.response_deadline := public.business_add_minutes(cal, base_response, paused);
        end if;
        if base_sla is not null then
          new.sla_deadline := public.business_add_minutes(cal, base_sla, paused);
        end if;
        if base_ola_resp is not null then
          new.ola_response_deadline := public.business_add_minutes(cal, base_ola_resp, paused);
        end if;
        if base_ola is not null then
          new.ola_deadline := public.business_add_minutes(cal, base_ola, paused);
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

-- Replace: approval gate to use En Espera instead of Pendiente Aprobación
create or replace function public._set_ticket_approval_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  svc_id uuid;
  needs boolean;
begin
  svc_id := public._ticket_service_id(new.metadata);
  if svc_id is null then
    return new;
  end if;

  select exists (
    select 1 from public.service_catalog_approval_steps s
    where s.service_id = svc_id
  ) into needs;

  if needs and new.status in ('En Curso','Nuevo') then
    new.status := 'En Espera';
  end if;

  return new;
end;
$$;

-- Replace: approval_decide status transitions aligned to official statuses
create or replace function public.approval_decide(p_ticket_id uuid, p_action text, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  act text;
  target public.approval_status_enum;
  approval_id uuid;
  pending_required integer;
begin
  perform set_config('row_security', 'off', true);

  uid := auth.uid();
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  act := lower(coalesce(p_action, ''));
  if act not in ('approve','reject') then
    raise exception 'Invalid action';
  end if;

  target := case when act = 'approve' then 'approved'::public.approval_status_enum else 'rejected'::public.approval_status_enum end;

  -- Find a pending approval for this user (either explicit or by role)
  select ta.id into approval_id
  from public.ticket_approvals ta
  join public.tickets t on t.id = ta.ticket_id
  join public.profiles me on me.id = uid
  where ta.ticket_id = p_ticket_id
    and ta.status = 'pending'
    and (
      ta.approver_profile_id = uid
      or (ta.approver_profile_id is null and ta.approver_role is not null and me.role = ta.approver_role and me.department_id = t.department_id)
    )
  order by ta.step_order asc
  limit 1;

  if approval_id is null then
    raise exception 'No pending approval for current user';
  end if;

  update public.ticket_approvals
  set status = target,
      decided_by = uid,
      decided_at = now(),
      decision_comment = p_comment
  where id = approval_id;

  if target = 'rejected' then
    update public.tickets
    set
      status = 'Cancelado',
      canceled_reason = coalesce(nullif(p_comment, ''), canceled_reason, 'Rechazado'),
      canceled_at = coalesce(canceled_at, now()),
      closed_at = coalesce(closed_at, now())
    where id = p_ticket_id;
    return;
  end if;

  select count(*) into pending_required
  from public.ticket_approvals ta
  where ta.ticket_id = p_ticket_id
    and ta.required = true
    and ta.status = 'pending';

  if pending_required = 0 then
    update public.tickets
    set status = 'En Curso'
    where id = p_ticket_id
      and status in ('En Espera','Pendiente Aprobación');
  end if;
end;
$$;

revoke all on function public.approval_decide(uuid, text, text) from public;
grant execute on function public.approval_decide(uuid, text, text) to authenticated;

-- Update view: treat En Espera and Planificado o Coordinado as active states, and close states as Cerrado/Cancelado
-- NOTE: we must drop the view first because it was previously created using `t.*`,
-- and new columns added to `public.tickets` would otherwise cause column renames (42P16).
drop view if exists public.tickets_sla_live;

create or replace view public.tickets_sla_live as
with base as (
  select
    t.*,
    coalesce(t.business_calendar_id, public._calendar_for_department(t.department_id)) as cal_id
  from public.tickets t
),
calc as (
  select
    b.*,
    case
      when b.response_deadline is null then null
      else public.business_minutes_between(b.cal_id, now(), b.response_deadline)
    end as response_remaining_minutes_raw,
    case
      when b.sla_deadline is null then null
      else public.business_minutes_between(b.cal_id, now(), b.sla_deadline)
    end as sla_remaining_minutes_raw
  from base b
)
select
  c.*,
  greatest(coalesce(c.response_remaining_minutes_raw, 0), 0) as response_remaining_minutes,
  greatest(coalesce(c.sla_remaining_minutes_raw, 0), 0) as sla_remaining_minutes,
  case
    when c.sla_excluded then 'excluded'
    when c.status in ('Cerrado','Cancelado','Rechazado') then 'closed'
    when c.sla_deadline is null or c.sla_resolution_target_minutes is null or c.sla_resolution_target_minutes = 0 then null
    when c.sla_remaining_minutes_raw <= 0 then 'red'
    when (greatest(c.sla_remaining_minutes_raw, 0)::numeric / c.sla_resolution_target_minutes::numeric) <= 0.2 then 'yellow'
    else 'green'
  end as sla_traffic_light,
  case
    when c.sla_deadline is null or c.sla_resolution_target_minutes is null or c.sla_resolution_target_minutes = 0 then null
    else round((1 - (greatest(c.sla_remaining_minutes_raw, 0)::numeric / c.sla_resolution_target_minutes::numeric)) * 100.0, 2)
  end as sla_pct_used,
  case
    when c.sla_excluded then 'excluded'
    when c.status in ('Cerrado','Cancelado','Rechazado') then 'closed'
    when c.response_deadline is null or c.sla_response_target_minutes is null or c.sla_response_target_minutes = 0 then null
    when c.response_remaining_minutes_raw <= 0 then 'red'
    when (greatest(c.response_remaining_minutes_raw, 0)::numeric / c.sla_response_target_minutes::numeric) <= 0.2 then 'yellow'
    else 'green'
  end as response_traffic_light,
  case
    when c.response_deadline is null or c.sla_response_target_minutes is null or c.sla_response_target_minutes = 0 then null
    else round((1 - (greatest(c.response_remaining_minutes_raw, 0)::numeric / c.sla_response_target_minutes::numeric)) * 100.0, 2)
  end as response_pct_used
from calc c;

revoke all on table public.tickets_sla_live from public;
grant select on table public.tickets_sla_live to authenticated;

-- ---------------------------------------------------------------------
-- 021_ticket_number.sql
-- ---------------------------------------------------------------------

-- Ticket tracking number (correlative)
create sequence if not exists public.ticket_number_seq;

alter table public.tickets add column if not exists ticket_number bigint;

do $$
declare
  offset_val bigint;
begin
  select coalesce(max(ticket_number), 0) into offset_val from public.tickets;

  with ordered as (
    select id, row_number() over (order by created_at asc, id asc) as rn
    from public.tickets
    where ticket_number is null
  )
  update public.tickets t
  set ticket_number = offset_val + ordered.rn
  from ordered
  where t.id = ordered.id;
end $$;

alter sequence public.ticket_number_seq owned by public.tickets.ticket_number;
alter table public.tickets alter column ticket_number set default nextval('public.ticket_number_seq');
create unique index if not exists tickets_ticket_number_uq on public.tickets (ticket_number);
select setval('public.ticket_number_seq', (select coalesce(max(ticket_number), 0) from public.tickets), true);

do $$ begin
  alter table public.tickets alter column ticket_number set not null;
exception when others then null; end $$;

-- Refresh live view so it exposes the new column (the view uses t.*)
drop view if exists public.tickets_sla_live;

create or replace view public.tickets_sla_live as
with base as (
  select
    t.*,
    coalesce(t.business_calendar_id, public._calendar_for_department(t.department_id)) as cal_id
  from public.tickets t
),
calc as (
  select
    b.*,
    case
      when b.response_deadline is null then null
      else public.business_minutes_between(b.cal_id, now(), b.response_deadline)
    end as response_remaining_minutes_raw,
    case
      when b.sla_deadline is null then null
      else public.business_minutes_between(b.cal_id, now(), b.sla_deadline)
    end as sla_remaining_minutes_raw
  from base b
)
select
  c.*,
  greatest(coalesce(c.response_remaining_minutes_raw, 0), 0) as response_remaining_minutes,
  greatest(coalesce(c.sla_remaining_minutes_raw, 0), 0) as sla_remaining_minutes,
  case
    when c.sla_excluded then 'excluded'
    when c.status in ('Cerrado','Cancelado','Rechazado') then 'closed'
    when c.sla_deadline is null or c.sla_resolution_target_minutes is null or c.sla_resolution_target_minutes = 0 then null
    when c.sla_remaining_minutes_raw <= 0 then 'red'
    when (greatest(c.sla_remaining_minutes_raw, 0)::numeric / c.sla_resolution_target_minutes::numeric) <= 0.2 then 'yellow'
    else 'green'
  end as sla_traffic_light,
  case
    when c.sla_deadline is null or c.sla_resolution_target_minutes is null or c.sla_resolution_target_minutes = 0 then null
    else round((1 - (greatest(c.sla_remaining_minutes_raw, 0)::numeric / c.sla_resolution_target_minutes::numeric)) * 100.0, 2)
  end as sla_pct_used,
  case
    when c.sla_excluded then 'excluded'
    when c.status in ('Cerrado','Cancelado','Rechazado') then 'closed'
    when c.response_deadline is null or c.sla_response_target_minutes is null or c.sla_response_target_minutes = 0 then null
    when c.response_remaining_minutes_raw <= 0 then 'red'
    when (greatest(c.response_remaining_minutes_raw, 0)::numeric / c.sla_response_target_minutes::numeric) <= 0.2 then 'yellow'
    else 'green'
  end as response_traffic_light,
  case
    when c.response_deadline is null or c.sla_response_target_minutes is null or c.sla_response_target_minutes = 0 then null
    else round((1 - (greatest(c.response_remaining_minutes_raw, 0)::numeric / c.sla_response_target_minutes::numeric)) * 100.0, 2)
  end as response_pct_used
from calc c;

revoke all on table public.tickets_sla_live from public;
grant select on table public.tickets_sla_live to authenticated;



commit;
