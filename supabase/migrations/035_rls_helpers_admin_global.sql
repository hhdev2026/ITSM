begin;

-- ---------------------------------------------------------------------
-- Fix: RLS helper recursion + admin global access
-- - Some RLS policies call helper functions that query `public.profiles`.
--   When those helpers run under RLS, Postgres can throw:
--   "query would be affected by row-level security policy for table 'profiles'".
-- - We make helpers SECURITY DEFINER + `row_security=off` so they can safely
--   read the caller's own profile without policy recursion.
-- - Also: treat role=admin as global (same_department always true for admin).
-- ---------------------------------------------------------------------

create or replace function public._current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select p.* from public.profiles p where p.id = auth.uid();
$$;

create or replace function public._is_role(_role public.role_enum)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = _role
  );
$$;

create or replace function public._has_role(_roles public.role_enum[])
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = any(_roles)
  );
$$;

create or replace function public._same_department(_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'admin'
        or p.department_id = _department_id
      )
  );
$$;

create or replace function public.current_user_role()
returns public.role_enum
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.current_user_department_id()
returns uuid
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select p.department_id from public.profiles p where p.id = auth.uid();
$$;

commit;

