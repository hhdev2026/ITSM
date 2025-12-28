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

