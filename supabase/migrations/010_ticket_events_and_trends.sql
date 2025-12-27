begin;

-- ---------------------------------------------------------------------
-- Ticket events: trazabilidad de cambios (estado/asignación/prioridad)
-- ---------------------------------------------------------------------

do $$ begin
  create type public.ticket_event_type_enum as enum (
    'created',
    'status_changed',
    'assignee_changed',
    'priority_changed',
    'approval_decided'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  event_type public.ticket_event_type_enum not null,
  from_status public.ticket_status_enum,
  to_status public.ticket_status_enum,
  from_priority public.ticket_priority_enum,
  to_priority public.ticket_priority_enum,
  from_assignee_id uuid references public.profiles (id),
  to_assignee_id uuid references public.profiles (id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ticket_events_ticket_idx on public.ticket_events (ticket_id, created_at asc);
create index if not exists ticket_events_type_idx on public.ticket_events (event_type, created_at desc);

alter table public.ticket_events enable row level security;

drop policy if exists ticket_events_select_visible on public.ticket_events;
create policy ticket_events_select_visible on public.ticket_events
for select to authenticated
using (
  exists (
    select 1
    from public.tickets t
    where t.id = ticket_events.ticket_id
      and (
        t.requester_id = auth.uid()
        or (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(t.department_id))
        or public._is_role('admin')
      )
  )
);

-- Internal inserts are done via SECURITY DEFINER triggers (row_security off).
drop policy if exists ticket_events_insert_none on public.ticket_events;
create policy ticket_events_insert_none on public.ticket_events
for insert to authenticated
with check (false);

-- Trigger helpers: insert trace events
create or replace function public._ticket_events_insert(_row public.ticket_events)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('row_security', 'off', true);
  insert into public.ticket_events (
    ticket_id,
    actor_id,
    event_type,
    from_status,
    to_status,
    from_priority,
    to_priority,
    from_assignee_id,
    to_assignee_id,
    details,
    created_at
  )
  values (
    _row.ticket_id,
    _row.actor_id,
    _row.event_type,
    _row.from_status,
    _row.to_status,
    _row.from_priority,
    _row.to_priority,
    _row.from_assignee_id,
    _row.to_assignee_id,
    coalesce(_row.details, '{}'::jsonb),
    coalesce(_row.created_at, now())
  );
end;
$$;

create or replace function public._ticket_events_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ev public.ticket_events;
begin
  ev.ticket_id := new.id;
  ev.actor_id := auth.uid();
  ev.event_type := 'created'::public.ticket_event_type_enum;
  ev.to_status := new.status;
  ev.to_priority := new.priority;
  ev.to_assignee_id := new.assignee_id;
  ev.details := jsonb_build_object('source', 'tickets.insert');
  ev.created_at := new.created_at;
  perform public._ticket_events_insert(ev);
  return new;
end;
$$;

drop trigger if exists t_ticket_events_on_insert on public.tickets;
create trigger t_ticket_events_on_insert
after insert on public.tickets
for each row execute function public._ticket_events_on_insert();

create or replace function public._ticket_events_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ev public.ticket_events;
  actor uuid;
begin
  actor := auth.uid();

  if new.status is distinct from old.status then
    ev.ticket_id := new.id;
    ev.actor_id := actor;
    ev.event_type := 'status_changed'::public.ticket_event_type_enum;
    ev.from_status := old.status;
    ev.to_status := new.status;
    ev.details := jsonb_build_object('source', 'tickets.update');
    perform public._ticket_events_insert(ev);
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    ev := null;
    ev.ticket_id := new.id;
    ev.actor_id := actor;
    ev.event_type := 'assignee_changed'::public.ticket_event_type_enum;
    ev.from_assignee_id := old.assignee_id;
    ev.to_assignee_id := new.assignee_id;
    ev.details := jsonb_build_object('source', 'tickets.update');
    perform public._ticket_events_insert(ev);
  end if;

  if new.priority is distinct from old.priority then
    ev := null;
    ev.ticket_id := new.id;
    ev.actor_id := actor;
    ev.event_type := 'priority_changed'::public.ticket_event_type_enum;
    ev.from_priority := old.priority;
    ev.to_priority := new.priority;
    ev.details := jsonb_build_object('source', 'tickets.update');
    perform public._ticket_events_insert(ev);
  end if;

  return new;
end;
$$;

drop trigger if exists t_ticket_events_on_update on public.tickets;
create trigger t_ticket_events_on_update
after update of status, assignee_id, priority on public.tickets
for each row execute function public._ticket_events_on_update();

-- Approvals decisions -> ticket_events (timeline)
create or replace function public._ticket_events_on_approval_decided()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ev public.ticket_events;
begin
  if new.status is distinct from old.status and new.status in ('approved','rejected') then
    ev.ticket_id := new.ticket_id;
    ev.actor_id := coalesce(new.decided_by, auth.uid());
    ev.event_type := 'approval_decided'::public.ticket_event_type_enum;
    ev.details := jsonb_build_object(
      'step_order', new.step_order,
      'kind', new.kind,
      'required', new.required,
      'status', new.status,
      'comment', new.decision_comment
    );
    ev.created_at := coalesce(new.decided_at, now());
    perform public._ticket_events_insert(ev);
  end if;
  return new;
end;
$$;

drop trigger if exists t_ticket_events_on_approval_decided on public.ticket_approvals;
create trigger t_ticket_events_on_approval_decided
after update of status on public.ticket_approvals
for each row execute function public._ticket_events_on_approval_decided();

-- ---------------------------------------------------------------------
-- Analytics: timeseries KPI (para dashboard tipo BI)
-- ---------------------------------------------------------------------

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
  step interval;
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

  bucket := lower(coalesce(p_bucket, 'day'));
  if bucket not in ('hour','day','week','month') then
    raise exception 'invalid_bucket';
  end if;

  step := case bucket
    when 'hour' then interval '1 hour'
    when 'day' then interval '1 day'
    when 'week' then interval '1 week'
    else interval '1 month'
  end;

  return (
    with
      series as (
        select generate_series(date_trunc(bucket, p_start), date_trunc(bucket, p_end), step) as b
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

commit;

