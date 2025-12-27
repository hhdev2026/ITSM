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

