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

