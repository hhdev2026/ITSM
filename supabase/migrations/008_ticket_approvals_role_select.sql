begin;

-- Allow role-based approvers to read their pending approvals (approver_profile_id is null + approver_role matches).
drop policy if exists ticket_approvals_select_visible on public.ticket_approvals;
create policy ticket_approvals_select_visible on public.ticket_approvals
for select to authenticated
using (
  exists (
    select 1
    from public.tickets t
    where t.id = ticket_approvals.ticket_id
      and (
        t.requester_id = auth.uid()
        or (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(t.department_id))
        or public._is_role('admin')
      )
  )
  or ticket_approvals.approver_profile_id = auth.uid()
  or exists (
    select 1
    from public.tickets t
    join public.profiles me on me.id = auth.uid()
    where t.id = ticket_approvals.ticket_id
      and ticket_approvals.approver_profile_id is null
      and ticket_approvals.approver_role is not null
      and me.role = ticket_approvals.approver_role
      and me.department_id = t.department_id
  )
);

commit;

