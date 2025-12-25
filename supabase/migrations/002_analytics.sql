begin;

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

  -- Volume: created vs closed
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

  -- MTTR (seconds)
  select avg(extract(epoch from (t.closed_at - t.created_at))) into mttr_seconds
  from public.tickets t
  where t.department_id = dept_id
    and t.status = 'Cerrado'
    and t.closed_at is not null
    and t.closed_at >= p_start and t.closed_at < p_end
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- SLA compliance
  select
    count(*) filter (where t.sla_deadline is not null) as total,
    count(*) filter (where t.sla_deadline is not null and t.closed_at <= t.sla_deadline) as ok
  into sla_total, sla_ok
  from public.tickets t
  where t.department_id = dept_id
    and t.status = 'Cerrado'
    and t.closed_at is not null
    and t.closed_at >= p_start and t.closed_at < p_end
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- Pending (snapshot) by priority
  select
    count(*) filter (where t.priority = 'Crítica') as crit,
    count(*) filter (where t.priority = 'Alta') as high,
    count(*) filter (where t.priority = 'Media') as med,
    count(*) filter (where t.priority = 'Baja') as low
  into pending_crit, pending_high, pending_med, pending_low
  from public.tickets t
  where t.department_id = dept_id
    and t.status <> 'Cerrado'
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- Workload (snapshot): open tickets assigned per agent
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
     and t.status <> 'Cerrado'
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
    'volume', jsonb_build_object('created', created_count, 'closed', closed_count),
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

commit;

