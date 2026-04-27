-- ITSM / Gestion de Ticket HP - CONTINUAR desde migracion 020
-- Usar despues del error: unsafe use of new value "Cancelado".
-- No pegues nuevamente el one-shot completo: pega este archivo.


-- ============================================================
-- 020_official_status_and_solution.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Official ticket statuses + solution types (alignment)
-- ---------------------------------------------------------------------

-- Statuses (keep legacy values for backwards compatibility, but migrate data)
do $$ begin
  alter type public.ticket_status_enum add value if not exists 'En Curso';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.ticket_status_enum add value if not exists 'En Espera';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.ticket_status_enum add value if not exists 'Planificado o Coordinado';
exception when duplicate_object then null; end $$;

-- Postgres requires newly added enum values to be committed before use.
commit;
begin;

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

commit;

-- ============================================================
-- 021_ticket_number.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Ticket tracking number (correlative)
-- - Adds a human-friendly unique number to every ticket for easy tracking.
-- - Format is handled in the app (e.g., TKT-000123).
-- ---------------------------------------------------------------------

create sequence if not exists public.ticket_number_seq;

alter table public.tickets add column if not exists ticket_number bigint;

-- Backfill existing tickets (assign in created_at order, then id)
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

-- Default for new tickets
alter sequence public.ticket_number_seq owned by public.tickets.ticket_number;
alter table public.tickets alter column ticket_number set default nextval('public.ticket_number_seq');

-- Ensure uniqueness
create unique index if not exists tickets_ticket_number_uq on public.tickets (ticket_number);

-- Set sequence to current max (so nextval continues correctly)
select setval('public.ticket_number_seq', (select coalesce(max(ticket_number), 0) from public.tickets), true);

-- Make it required once backfilled
do $$ begin
  alter table public.tickets alter column ticket_number set not null;
exception when others then
  -- If table is empty or column already has constraint, ignore.
  null;
end $$;

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

-- ============================================================
-- 022_official_sla_mda_and_ola.sql
-- ============================================================
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

-- ============================================================
-- 023_ticket_closure_codes.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Standardized closure observations (ITIL-style) for ticket closure
-- - Keeps official solution types as-is (solution_type).
-- - Adds a required closure code for status 'Cerrado' to standardize outcomes.
-- ---------------------------------------------------------------------

do $$ begin
  create type public.ticket_closure_code_enum as enum (
    'Resuelto y confirmado por el usuario',
    'Resuelto sin confirmación (usuario no responde)',
    'Resuelto por el usuario (autoservicio)',
    'Cerrado por solicitud del usuario',
    'Cerrado por duplicidad',
    'Cerrado por falta de información del solicitante',
    'Cerrado por fuera de alcance (no aplica)',
    'Cerrado por derivación a tercero'
  );
exception when duplicate_object then null; end $$;

alter table public.tickets add column if not exists closure_code public.ticket_closure_code_enum;

-- Enforce solution fields + closure code on close
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
    if new.closure_code is null then
      raise exception 'closure_code_required';
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

-- ============================================================
-- 024_assets.sql
-- ============================================================
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

-- ============================================================
-- 025_assets_rls_recursion_fix.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Fix: RLS infinite recursion between assets <-> asset_assignments policies
-- - The original policies referenced each other via subqueries, triggering:
--   "infinite recursion detected in policy for relation \"assets\"" (42P17).
-- - Solution: use SECURITY DEFINER helper to fetch asset.department_id with
--   row_security disabled, and rewrite policies to avoid cross-table RLS loops.
-- ---------------------------------------------------------------------

create or replace function public._asset_department_id(_asset_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  dept uuid;
begin
  perform set_config('row_security', 'off', true);
  select a.department_id into dept
  from public.assets a
  where a.id = _asset_id;
  return dept;
end;
$$;

revoke all on function public._asset_department_id(uuid) from public;
grant execute on function public._asset_department_id(uuid) to authenticated;

-- asset_assignments: select without joining assets (break recursion)
drop policy if exists asset_assignments_select on public.asset_assignments;
create policy asset_assignments_select on public.asset_assignments
for select to authenticated
using (
  (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(public._asset_department_id(asset_id)))
  or user_id = auth.uid()
);

drop policy if exists asset_assignments_write on public.asset_assignments;
create policy asset_assignments_write on public.asset_assignments
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(public._asset_department_id(asset_id))
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(public._asset_department_id(asset_id))
);

-- connectivity events: select/insert without joining assets
drop policy if exists asset_connectivity_events_select on public.asset_connectivity_events;
create policy asset_connectivity_events_select on public.asset_connectivity_events
for select to authenticated
using (
  public._has_role(array['agent','supervisor','admin']::public.role_enum[])
  and public._same_department(public._asset_department_id(asset_id))
);

drop policy if exists asset_connectivity_events_insert on public.asset_connectivity_events;
create policy asset_connectivity_events_insert on public.asset_connectivity_events
for insert to authenticated
with check (
  public._has_role(array['agent','supervisor','admin']::public.role_enum[])
  and public._same_department(public._asset_department_id(asset_id))
);

-- alerts: select/write without joining assets
drop policy if exists asset_alerts_select on public.asset_alerts;
create policy asset_alerts_select on public.asset_alerts
for select to authenticated
using (
  public._has_role(array['agent','supervisor','admin']::public.role_enum[])
  and public._same_department(public._asset_department_id(asset_id))
);

drop policy if exists asset_alerts_write on public.asset_alerts;
create policy asset_alerts_write on public.asset_alerts
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(public._asset_department_id(asset_id))
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(public._asset_department_id(asset_id))
);

commit;

-- ============================================================
-- 026_ticket_first_response_backfill.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Fix: "Tiempos promedio" chart missing data
-- - `kpi_timeseries` computes avg response/resolution hours from:
--     tickets.first_response_at and tickets.closed_at
-- - `first_response_at` was only set by the "first public agent comment" trigger.
-- - In practice, many tickets get handled via assignment/status updates without a
--   public comment, leaving `first_response_at` null and charts empty.
-- - Solution:
--   1) Set `first_response_at` on the first agent/supervisor/admin action
--      (status/assignee update) when it's still null.
--   2) Backfill `first_response_at` for existing tickets from earliest agent
--      action (public comment or ticket event).
-- ---------------------------------------------------------------------

create or replace function public._set_first_response_on_ticket_update()
returns trigger
language plpgsql
as $$
declare
  actor_role public.role_enum;
begin
  if old.first_response_at is not null then
    return new;
  end if;

  -- Service-role / background jobs may not have an authenticated user.
  if auth.uid() is null then
    return new;
  end if;

  select p.role into actor_role
  from public.profiles p
  where p.id = auth.uid();

  if actor_role in ('agent', 'supervisor', 'admin') then
    new.first_response_at := coalesce(new.first_response_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists t_tickets_first_response_on_update on public.tickets;
create trigger t_tickets_first_response_on_update
before update of status, assignee_id on public.tickets
for each row execute function public._set_first_response_on_ticket_update();

do $$
begin
  with agent_actions as (
    select ticket_id, min(at) as first_at
    from (
      select c.ticket_id, c.created_at as at
      from public.comments c
      join public.profiles ap on ap.id = c.author_id
      where c.is_internal = false
        and ap.role in ('agent', 'supervisor', 'admin')
      union all
      select e.ticket_id, e.created_at as at
      from public.ticket_events e
      join public.profiles ep on ep.id = e.actor_id
      where ep.role in ('agent', 'supervisor', 'admin')
    ) s
    group by ticket_id
  )
  update public.tickets t
  set first_response_at = a.first_at
  from agent_actions a
  where t.id = a.ticket_id
    and t.first_response_at is null;
exception
  when undefined_table then
    -- Fallback for DBs that don't have ticket_events.
    with agent_actions as (
      select c.ticket_id, min(c.created_at) as first_at
      from public.comments c
      join public.profiles ap on ap.id = c.author_id
      where c.is_internal = false
        and ap.role in ('agent', 'supervisor', 'admin')
      group by c.ticket_id
    )
    update public.tickets t
    set first_response_at = a.first_at
    from agent_actions a
    where t.id = a.ticket_id
      and t.first_response_at is null;
end;
$$;

commit;

-- ============================================================
-- 027_asset_sites.sql
-- ============================================================
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

-- ============================================================
-- 028_asset_picklists.sql
-- ============================================================
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
  min(nullif(trim(coalesce(a.manufacturer, '')), '')) as manufacturer,
  min(trim(a.model)) as name
from public.assets a
where a.model is not null
  and length(trim(a.model)) > 0
group by a.department_id, lower(trim(coalesce(a.manufacturer, ''))), lower(trim(a.model))
on conflict do nothing;

insert into public.asset_subcategories (department_id, asset_type, category, name)
select
  a.department_id,
  min(nullif(trim(coalesce(a.asset_type, '')), '')) as asset_type,
  min(nullif(trim(coalesce(a.category, '')), '')) as category,
  min(trim(a.subcategory)) as name
from public.assets a
where a.subcategory is not null
  and length(trim(a.subcategory)) > 0
group by a.department_id, lower(trim(coalesce(a.asset_type, ''))), lower(trim(coalesce(a.category, ''))), lower(trim(a.subcategory))
on conflict do nothing;

commit;

-- ============================================================
-- 029_remote_devices.sql
-- ============================================================
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

-- ============================================================
-- 030_chat_direct_support.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Support chat UX: allow end-users to discover support techs + start a
-- direct chat assigned to a selected agent (still 1:1 thread-backed).
-- ---------------------------------------------------------------------

-- Profiles: allow end-users to read only tech profiles in their department.
drop policy if exists profiles_select_visible on public.profiles;
create policy profiles_select_visible on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or (public.current_user_role() in ('agent','supervisor','admin') and department_id = public.current_user_department_id())
  or (public.current_user_role() = 'user' and role in ('agent','supervisor','admin') and department_id = public.current_user_department_id())
  or public.current_user_role() = 'admin'
);

-- Create a chat thread assigned to a specific agent (user-selectable contact list).
create or replace function public.chat_request_to_agent(
  p_agent_id uuid,
  p_subject text default null,
  p_category_id uuid default null,
  p_subcategory_id uuid default null,
  p_initial_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  dept uuid;
  agent_role public.role_enum;
  agent_dept uuid;
  tid uuid;
begin
  perform set_config('row_security', 'off', true);
  uid := auth.uid();
  if uid is null then raise exception 'Not authenticated'; end if;

  select p.department_id into dept from public.profiles p where p.id = uid;
  if dept is null then raise exception 'department_required'; end if;

  select p.role, p.department_id into agent_role, agent_dept
  from public.profiles p
  where p.id = p_agent_id;

  if agent_role is null then raise exception 'agent_not_found'; end if;
  if agent_dept is distinct from dept then raise exception 'forbidden'; end if;
  if agent_role not in ('agent','supervisor','admin') then raise exception 'invalid_agent'; end if;

  insert into public.chat_threads (requester_id, category_id, subcategory_id, subject, status, assigned_agent_id, assigned_at)
  values (uid, p_category_id, p_subcategory_id, nullif(p_subject,''), 'Asignado', p_agent_id, now())
  returning id into tid;

  insert into public.chat_participants (thread_id, profile_id)
  values (tid, uid)
  on conflict (thread_id, profile_id) do nothing;

  insert into public.chat_participants (thread_id, profile_id)
  values (tid, p_agent_id)
  on conflict (thread_id, profile_id) do nothing;

  if nullif(trim(coalesce(p_initial_message,'')), '') is not null then
    insert into public.chat_messages (thread_id, author_id, body)
    values (tid, uid, p_initial_message);
  end if;

  return tid;
end;
$$;

revoke all on function public.chat_request_to_agent(uuid, text, uuid, uuid, text) from public;
grant execute on function public.chat_request_to_agent(uuid, text, uuid, uuid, text) to authenticated;

commit;

-- ============================================================
-- 031_assets_mesh_node_id.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- RMM linkage for Assets
-- - Some devices may not provide a reliable serial_number.
-- - We store the RMM device/node id (or access key) to upsert/deduplicate and link remote access.
-- ---------------------------------------------------------------------

alter table public.assets add column if not exists mesh_node_id text;

create index if not exists assets_dept_mesh_node_idx on public.assets (department_id, mesh_node_id);
create unique index if not exists assets_dept_mesh_node_uq on public.assets (department_id, mesh_node_id)
where mesh_node_id is not null and length(trim(mesh_node_id)) > 0;

commit;

-- ============================================================
-- 032_chat_close_tipificaciones.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Chat: cierre con tipificación (para soporte)
-- - Guarda el motivo/resultado en chat_threads.metadata.closure
-- - Propaga la tipificación al evento "closed" para reporting/transcript
-- ---------------------------------------------------------------------

-- Replace: events + timestamps on thread changes (extend "closed" details)
create or replace function public._chat_threads_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  closure jsonb;
begin
  perform set_config('row_security', 'off', true);

  if new.assigned_agent_id is distinct from old.assigned_agent_id then
    new.assigned_at := coalesce(new.assigned_at, now());
    perform public._chat_events_insert(
      new.id,
      auth.uid(),
      'assigned',
      jsonb_build_object('from', old.assigned_agent_id, 'to', new.assigned_agent_id, 'status', new.status),
      now()
    );
  end if;

  if new.status is distinct from old.status and new.status = 'Activo' then
    new.accepted_at := coalesce(new.accepted_at, now());
    perform public._chat_events_insert(new.id, auth.uid(), 'accepted', jsonb_build_object('status', new.status), now());
  end if;

  if new.status is distinct from old.status and new.status = 'Cerrado' then
    new.closed_at := coalesce(new.closed_at, now());
    closure := nullif(coalesce(new.metadata->'closure', '{}'::jsonb), '{}'::jsonb);
    perform public._chat_events_insert(
      new.id,
      auth.uid(),
      'closed',
      jsonb_build_object('status', new.status, 'closure', closure),
      now()
    );
  end if;

  return new;
end;
$$;

-- New RPC: close with tipification (support-side)
create or replace function public.chat_close_thread_typed(
  p_thread_id uuid,
  p_code text,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  req uuid;
  ass uuid;
  me_role public.role_enum;
  clean_code text;
  clean_notes text;
begin
  perform set_config('row_security', 'off', true);
  uid := auth.uid();
  if uid is null then raise exception 'Not authenticated'; end if;

  select t.requester_id, t.assigned_agent_id into req, ass
  from public.chat_threads t
  where t.id = p_thread_id;

  if req is null then raise exception 'not_found'; end if;
  select p.role into me_role from public.profiles p where p.id = uid;

  -- Restrict: only assignee/supervisor/admin can close with a support code.
  if not (uid = ass or me_role in ('supervisor','admin')) then
    raise exception 'forbidden';
  end if;

  clean_code := lower(nullif(trim(coalesce(p_code,'')), ''));
  if clean_code is null then raise exception 'code_required'; end if;

  if clean_code not in (
    'resuelto',
    'derivado',
    'informacion_entregada',
    'no_responde',
    'fuera_de_alcance',
    'duplicado'
  ) then
    raise exception 'invalid_code';
  end if;

  clean_notes := nullif(trim(coalesce(p_notes,'')), '');

  update public.chat_threads
  set metadata = jsonb_set(
        coalesce(metadata, '{}'::jsonb),
        '{closure}',
        jsonb_build_object('code', clean_code, 'notes', clean_notes),
        true
      ),
      status = 'Cerrado',
      closed_at = coalesce(closed_at, now()),
      closed_by = uid,
      updated_at = now()
  where id = p_thread_id;
end;
$$;

revoke all on function public.chat_close_thread_typed(uuid, text, text) from public;
grant execute on function public.chat_close_thread_typed(uuid, text, text) to authenticated;

commit;

-- ============================================================
-- 033_agent_work_status.sql
-- ============================================================
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

-- ============================================================
-- 034_rmm_snapshots.sql
-- ============================================================
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

-- ============================================================
-- 035_rls_helpers_admin_global.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Fix: RLS helper recursion + admin global access
-- - Some RLS policies call helper functions that query `public.profiles`.
--   When those helpers run under RLS, Postgres can throw:
--   "query would be affected by row-level security policy for table 'profiles'".
-- - We make helpers SECURITY DEFINER + `row_security=off` so they can safely
--   read the caller's own profile without policy recursion.
-- - Also: treat role=admin as global (same_department always true for admin).
-- ---------------------------------------------------------------------

create or replace function public._current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select p.* from public.profiles p where p.id = auth.uid();
$$;

create or replace function public._is_role(_role public.role_enum)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = _role
  );
$$;

create or replace function public._has_role(_roles public.role_enum[])
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = any(_roles)
  );
$$;

create or replace function public._same_department(_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'admin'
        or p.department_id = _department_id
      )
  );
$$;

create or replace function public.current_user_role()
returns public.role_enum
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.current_user_department_id()
returns uuid
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select p.department_id from public.profiles p where p.id = auth.uid();
$$;

commit;

-- ============================================================
-- 036_security_hardening.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Security hardening
-- - Prevent privilege escalation via `profiles` self-update.
-- - Limit execution of SECURITY DEFINER RLS helpers to server-side roles.
-- ---------------------------------------------------------------------

-- Users should only be able to update their own non-privileged fields.
-- IMPORTANT: RLS policies alone do NOT prevent changing privileged columns like `role`.
revoke update on table public.profiles from authenticated;
revoke update on table public.profiles from anon;
grant update (full_name) on table public.profiles to authenticated;

-- RLS helper functions: don't leave them executable by every DB role.
revoke all on function public._current_profile() from public;
revoke all on function public._is_role(public.role_enum) from public;
revoke all on function public._has_role(public.role_enum[]) from public;
revoke all on function public._same_department(uuid) from public;
revoke all on function public.current_user_role() from public;
revoke all on function public.current_user_department_id() from public;

grant execute on function public._current_profile() to authenticated, service_role;
grant execute on function public._is_role(public.role_enum) to authenticated, service_role;
grant execute on function public._has_role(public.role_enum[]) to authenticated, service_role;
grant execute on function public._same_department(uuid) to authenticated, service_role;
grant execute on function public.current_user_role() to authenticated, service_role;
grant execute on function public.current_user_department_id() to authenticated, service_role;

commit;

-- ============================================================
-- BOOTSTRAP PRODUCCION: usuarios existentes de Supabase Auth
-- ============================================================
begin;

insert into public.departments (name, description)
values ('TI', 'Mesa de ayuda y soporte HP')
on conflict (name) do nothing;

insert into public.profiles (id, email, full_name, role, department_id)
select
  u.id,
  coalesce(u.email, ''),
  nullif(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email, 'Usuario'), ''),
  'user'::public.role_enum,
  (select d.id from public.departments d where d.name = 'TI' order by d.created_at asc limit 1)
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

update public.profiles
set department_id = coalesce(
  department_id,
  (select d.id from public.departments d where d.name = 'TI' order by d.created_at asc limit 1)
);

with first_user as (
  select u.id
  from auth.users u
  order by u.created_at asc
  limit 1
)
update public.profiles p
set role = 'admin'::public.role_enum
where p.id in (select id from first_user);

commit;
