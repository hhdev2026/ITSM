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

