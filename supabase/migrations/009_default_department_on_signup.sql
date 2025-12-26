begin;

-- Ensure new signups get a default department_id so Service Catalog and ticket creation work.
-- Preference order:
--  1) department named 'TI' (seed default)
--  2) oldest department by created_at
create or replace function public._default_department_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    (select d.id from public.departments d where d.name = 'TI' order by d.created_at asc limit 1),
    (select d.id from public.departments d order by d.created_at asc limit 1)
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dept uuid;
begin
  dept := public._default_department_id();

  insert into public.profiles (id, email, full_name, role, department_id)
  values (
    new.id,
    new.email,
    nullif(coalesce(new.raw_user_meta_data->>'full_name', ''), ''),
    'user',
    dept
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Backfill existing profiles without department_id (safe fallback to default).
update public.profiles
set department_id = public._default_department_id()
where department_id is null;

commit;

