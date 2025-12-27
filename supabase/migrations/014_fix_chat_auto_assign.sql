begin;

-- Fix: chat_auto_assign fallback referenced a CTE ("candidates") outside scope.
-- This patch is safe to run multiple times.
create or replace function public.chat_auto_assign(p_thread_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  dept uuid;
  need_skill uuid;
  chosen uuid;
begin
  perform set_config('row_security', 'off', true);

  select t.department_id, t.skill_id into dept, need_skill
  from public.chat_threads t
  where t.id = p_thread_id;

  if dept is null then
    return null;
  end if;

  with candidates as (
    select
      p.id as profile_id,
      ap.capacity,
      public._chat_open_count(p.id) as open_count
    from public.profiles p
    join public.agent_presence ap on ap.profile_id = p.id
    where p.department_id = dept
      and p.role in ('agent','supervisor')
      and ap.status = 'Disponible'
  ),
  filtered as (
    select c.profile_id, c.capacity, c.open_count
    from candidates c
    where c.open_count < c.capacity
      and (
        need_skill is null
        or exists (
          select 1 from public.agent_skills s
          where s.profile_id = c.profile_id and s.skill_id = need_skill
        )
      )
    order by c.open_count asc, c.capacity desc, c.profile_id asc
    limit 1
  )
  select f.profile_id into chosen from filtered f;

  if chosen is null and need_skill is not null then
    with candidates as (
      select
        p.id as profile_id,
        ap.capacity,
        public._chat_open_count(p.id) as open_count
      from public.profiles p
      join public.agent_presence ap on ap.profile_id = p.id
      where p.department_id = dept
        and p.role in ('agent','supervisor')
        and ap.status = 'Disponible'
    )
    select c.profile_id into chosen
    from candidates c
    where c.open_count < c.capacity
    order by c.open_count asc, c.capacity desc, c.profile_id asc
    limit 1;
  end if;

  if chosen is null then
    return null;
  end if;

  update public.chat_threads
  set assigned_agent_id = chosen,
      status = case when status = 'Cerrado' then status else 'Asignado' end,
      assigned_at = coalesce(assigned_at, now()),
      updated_at = now()
  where id = p_thread_id
    and status in ('En cola', 'Asignado')
    and assigned_agent_id is null;

  insert into public.chat_participants (thread_id, profile_id)
  values (p_thread_id, chosen)
  on conflict (thread_id, profile_id) do nothing;

  return chosen;
end;
$$;

revoke all on function public.chat_auto_assign(uuid) from public;
grant execute on function public.chat_auto_assign(uuid) to authenticated;

commit;

