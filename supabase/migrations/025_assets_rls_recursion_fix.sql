begin;

-- ---------------------------------------------------------------------
-- Fix: RLS infinite recursion between assets <-> asset_assignments policies
-- - The original policies referenced each other via subqueries, triggering:
--   "infinite recursion detected in policy for relation \"assets\"" (42P17).
-- - Solution: use SECURITY DEFINER helper to fetch asset.department_id with
--   row_security disabled, and rewrite policies to avoid cross-table RLS loops.
-- ---------------------------------------------------------------------

create or replace function public._asset_department_id(_asset_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  dept uuid;
begin
  perform set_config('row_security', 'off', true);
  select a.department_id into dept
  from public.assets a
  where a.id = _asset_id;
  return dept;
end;
$$;

revoke all on function public._asset_department_id(uuid) from public;
grant execute on function public._asset_department_id(uuid) to authenticated;

-- asset_assignments: select without joining assets (break recursion)
drop policy if exists asset_assignments_select on public.asset_assignments;
create policy asset_assignments_select on public.asset_assignments
for select to authenticated
using (
  (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(public._asset_department_id(asset_id)))
  or user_id = auth.uid()
);

drop policy if exists asset_assignments_write on public.asset_assignments;
create policy asset_assignments_write on public.asset_assignments
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(public._asset_department_id(asset_id))
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(public._asset_department_id(asset_id))
);

-- connectivity events: select/insert without joining assets
drop policy if exists asset_connectivity_events_select on public.asset_connectivity_events;
create policy asset_connectivity_events_select on public.asset_connectivity_events
for select to authenticated
using (
  public._has_role(array['agent','supervisor','admin']::public.role_enum[])
  and public._same_department(public._asset_department_id(asset_id))
);

drop policy if exists asset_connectivity_events_insert on public.asset_connectivity_events;
create policy asset_connectivity_events_insert on public.asset_connectivity_events
for insert to authenticated
with check (
  public._has_role(array['agent','supervisor','admin']::public.role_enum[])
  and public._same_department(public._asset_department_id(asset_id))
);

-- alerts: select/write without joining assets
drop policy if exists asset_alerts_select on public.asset_alerts;
create policy asset_alerts_select on public.asset_alerts
for select to authenticated
using (
  public._has_role(array['agent','supervisor','admin']::public.role_enum[])
  and public._same_department(public._asset_department_id(asset_id))
);

drop policy if exists asset_alerts_write on public.asset_alerts;
create policy asset_alerts_write on public.asset_alerts
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(public._asset_department_id(asset_id))
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(public._asset_department_id(asset_id))
);

commit;

