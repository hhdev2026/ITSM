begin;

create or replace function public.current_user_role()
returns public.role_enum
language sql
stable
security definer
set search_path = public
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.current_user_department_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.department_id from public.profiles p where p.id = auth.uid();
$$;

drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_admin_select on public.profiles;

create policy profiles_select_visible on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or (public.current_user_role() in ('agent','supervisor','admin') and department_id = public.current_user_department_id())
  or public.current_user_role() = 'admin'
);

commit;

