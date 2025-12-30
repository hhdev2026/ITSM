begin;

-- ---------------------------------------------------------------------
-- Security hardening
-- - Prevent privilege escalation via `profiles` self-update.
-- - Limit execution of SECURITY DEFINER RLS helpers to server-side roles.
-- ---------------------------------------------------------------------

-- Users should only be able to update their own non-privileged fields.
-- IMPORTANT: RLS policies alone do NOT prevent changing privileged columns like `role`.
revoke update on table public.profiles from authenticated;
revoke update on table public.profiles from anon;
grant update (full_name) on table public.profiles to authenticated;

-- RLS helper functions: don't leave them executable by every DB role.
revoke all on function public._current_profile() from public;
revoke all on function public._is_role(public.role_enum) from public;
revoke all on function public._has_role(public.role_enum[]) from public;
revoke all on function public._same_department(uuid) from public;
revoke all on function public.current_user_role() from public;
revoke all on function public.current_user_department_id() from public;

grant execute on function public._current_profile() to authenticated, service_role;
grant execute on function public._is_role(public.role_enum) to authenticated, service_role;
grant execute on function public._has_role(public.role_enum[]) to authenticated, service_role;
grant execute on function public._same_department(uuid) to authenticated, service_role;
grant execute on function public.current_user_role() to authenticated, service_role;
grant execute on function public.current_user_department_id() to authenticated, service_role;

commit;

