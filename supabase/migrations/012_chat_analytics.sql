begin;

create or replace function public.kpi_chat_dashboard(
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
  backlog_open bigint;
  active_open bigint;
  avg_take_minutes numeric;
  avg_first_response_minutes numeric;
  avg_resolution_minutes numeric;
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

  select count(*) into created_count
  from public.chat_threads t
  where t.department_id = dept_id
    and t.created_at >= p_start and t.created_at < p_end
    and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  select count(*) into closed_count
  from public.chat_threads t
  where t.department_id = dept_id
    and t.status = 'Cerrado'
    and t.closed_at is not null
    and t.closed_at >= p_start and t.closed_at < p_end
    and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  select count(*) into backlog_open
  from public.chat_threads t
  where t.department_id = dept_id
    and t.status in ('En cola','Asignado')
    and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  select count(*) into active_open
  from public.chat_threads t
  where t.department_id = dept_id
    and t.status = 'Activo'
    and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- avg take time (minutes): accepted_at - created_at
  select avg(extract(epoch from (t.accepted_at - t.created_at)) / 60.0) into avg_take_minutes
  from public.chat_threads t
  where t.department_id = dept_id
    and t.accepted_at is not null
    and t.created_at >= p_start and t.created_at < p_end
    and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- avg first response (minutes): first_response_at - created_at
  select avg(extract(epoch from (t.first_response_at - t.created_at)) / 60.0) into avg_first_response_minutes
  from public.chat_threads t
  where t.department_id = dept_id
    and t.first_response_at is not null
    and t.created_at >= p_start and t.created_at < p_end
    and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- avg resolution (minutes): closed_at - created_at
  select avg(extract(epoch from (t.closed_at - t.created_at)) / 60.0) into avg_resolution_minutes
  from public.chat_threads t
  where t.department_id = dept_id
    and t.status = 'Cerrado'
    and t.closed_at is not null
    and t.closed_at >= p_start and t.closed_at < p_end
    and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- Workload snapshot: open chats assigned per agent
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into workload
  from (
    select
      p.id as agent_id,
      coalesce(p.full_name, p.email) as agent_name,
      count(t.id) as open_assigned
    from public.profiles p
    left join public.chat_threads t
      on t.assigned_agent_id = p.id
     and t.department_id = dept_id
     and t.status in ('Asignado','Activo')
    where p.role in ('agent','supervisor')
      and p.department_id = dept_id
    group by p.id, p.full_name, p.email
    order by open_assigned desc
    limit 20
  ) x;

  return jsonb_build_object(
    'range', jsonb_build_object('start', p_start, 'end', p_end),
    'volume', jsonb_build_object('created', created_count, 'closed', closed_count),
    'backlog_open', backlog_open,
    'active_open', active_open,
    'avg_take_minutes', round(coalesce(avg_take_minutes, 0)::numeric, 2),
    'avg_first_response_minutes', round(coalesce(avg_first_response_minutes, 0)::numeric, 2),
    'avg_resolution_minutes', round(coalesce(avg_resolution_minutes, 0)::numeric, 2),
    'workload', workload
  );
end;
$$;

revoke all on function public.kpi_chat_dashboard(timestamptz, timestamptz, uuid, uuid) from public;
grant execute on function public.kpi_chat_dashboard(timestamptz, timestamptz, uuid, uuid) to authenticated;

create or replace function public.kpi_chat_timeseries(
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
        from public.chat_threads t
        where t.department_id = dept_id
          and t.created_at >= p_start and t.created_at < p_end
          and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
          and (p_category_id is null or t.category_id = p_category_id)
        group by 1
      ),
      closed as (
        select date_trunc(bucket, t.closed_at) as b, count(*)::int as closed
        from public.chat_threads t
        where t.department_id = dept_id
          and t.status = 'Cerrado'
          and t.closed_at is not null
          and t.closed_at >= p_start and t.closed_at < p_end
          and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
          and (p_category_id is null or t.category_id = p_category_id)
        group by 1
      ),
      response as (
        select date_trunc(bucket, t.created_at) as b,
               round(avg(extract(epoch from (t.first_response_at - t.created_at)) / 60.0), 2) as avg_first_response_minutes
        from public.chat_threads t
        where t.department_id = dept_id
          and t.created_at >= p_start and t.created_at < p_end
          and t.first_response_at is not null
          and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
          and (p_category_id is null or t.category_id = p_category_id)
        group by 1
      ),
      resolution as (
        select date_trunc(bucket, t.closed_at) as b,
               round(avg(extract(epoch from (t.closed_at - t.created_at)) / 60.0), 2) as avg_resolution_minutes
        from public.chat_threads t
        where t.department_id = dept_id
          and t.status = 'Cerrado'
          and t.closed_at is not null
          and t.closed_at >= p_start and t.closed_at < p_end
          and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
          and (p_category_id is null or t.category_id = p_category_id)
        group by 1
      )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'bucket', s.b,
          'created', coalesce(c.created, 0),
          'closed', coalesce(cl.closed, 0),
          'avg_first_response_minutes', r.avg_first_response_minutes,
          'avg_resolution_minutes', rs.avg_resolution_minutes
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
  );
end;
$$;

revoke all on function public.kpi_chat_timeseries(timestamptz, timestamptz, text, uuid, uuid) from public;
grant execute on function public.kpi_chat_timeseries(timestamptz, timestamptz, text, uuid, uuid) to authenticated;

commit;

