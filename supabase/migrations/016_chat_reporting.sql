begin;

-- ---------------------------------------------------------------------
-- Chat reporting: breakdowns + tops for admin/supervisor dashboards
-- ---------------------------------------------------------------------

create or replace function public.kpi_chat_report(
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

  return jsonb_build_object(
    'range', jsonb_build_object('start', p_start, 'end', p_end),

    'top_requesters',
    (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      from (
        select
          t.requester_id,
          coalesce(p.full_name, p.email) as requester_name,
          count(*)::int as created_count
        from public.chat_threads t
        join public.profiles p on p.id = t.requester_id
        where t.department_id = dept_id
          and t.created_at >= p_start and t.created_at < p_end
          and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
          and (p_category_id is null or t.category_id = p_category_id)
        group by t.requester_id, p.full_name, p.email
        order by created_count desc, requester_name asc
        limit 10
      ) x
    ),

    'top_agents',
    (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      from (
        select
          t.assigned_agent_id as agent_id,
          coalesce(a.full_name, a.email) as agent_name,
          count(*)::int as closed_count,
          round(avg(extract(epoch from (t.accepted_at - t.created_at)) / 60.0)::numeric, 2) as avg_take_minutes,
          round(avg(extract(epoch from (t.first_response_at - t.created_at)) / 60.0)::numeric, 2) as avg_first_response_minutes,
          round(avg(extract(epoch from (t.closed_at - t.created_at)) / 60.0)::numeric, 2) as avg_resolution_minutes
        from public.chat_threads t
        join public.profiles a on a.id = t.assigned_agent_id
        where t.department_id = dept_id
          and t.status = 'Cerrado'
          and t.closed_at is not null
          and t.closed_at >= p_start and t.closed_at < p_end
          and t.assigned_agent_id is not null
          and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
          and (p_category_id is null or t.category_id = p_category_id)
        group by t.assigned_agent_id, a.full_name, a.email
        order by closed_count desc, avg_resolution_minutes asc nulls last, agent_name asc
        limit 10
      ) x
    ),

    'by_category',
    (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      from (
        select
          t.category_id,
          coalesce(c.name, 'Sin categoría') as category_name,
          count(*)::int as created_count,
          count(*) filter (where t.status = 'Cerrado' and t.closed_at is not null)::int as closed_count,
          round(avg(extract(epoch from (t.closed_at - t.created_at)) / 60.0)::numeric, 2) as avg_resolution_minutes
        from public.chat_threads t
        left join public.categories c on c.id = t.category_id
        where t.department_id = dept_id
          and t.created_at >= p_start and t.created_at < p_end
          and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
          and (p_category_id is null or t.category_id = p_category_id)
        group by t.category_id, c.name
        order by created_count desc, category_name asc
        limit 12
      ) x
    ),

    'by_subcategory',
    (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      from (
        select
          t.subcategory_id,
          coalesce(sc.name, 'Sin subcategoría') as subcategory_name,
          count(*)::int as created_count,
          count(*) filter (where t.status = 'Cerrado' and t.closed_at is not null)::int as closed_count
        from public.chat_threads t
        left join public.subcategories sc on sc.id = t.subcategory_id
        where t.department_id = dept_id
          and t.created_at >= p_start and t.created_at < p_end
          and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
          and (p_category_id is null or t.category_id = p_category_id)
        group by t.subcategory_id, sc.name
        order by created_count desc, subcategory_name asc
        limit 12
      ) x
    )
  );
end;
$$;

revoke all on function public.kpi_chat_report(timestamptz, timestamptz, uuid, uuid) from public;
grant execute on function public.kpi_chat_report(timestamptz, timestamptz, uuid, uuid) to authenticated;

commit;

