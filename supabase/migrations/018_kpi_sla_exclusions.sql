begin;

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

commit;

