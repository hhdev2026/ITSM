begin;

-- Ticket statuses for approval flow
do $$ begin
  alter type public.ticket_status_enum add value if not exists 'Pendiente Aprobación';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.ticket_status_enum add value if not exists 'Rechazado';
exception when duplicate_object then null; end $$;

-- Ticket deadlines (SLA/OLA)
alter table public.tickets add column if not exists response_deadline timestamptz;
alter table public.tickets add column if not exists ola_response_deadline timestamptz;
alter table public.tickets add column if not exists ola_deadline timestamptz;

-- Service-specific SLA/OLA overrides
do $$ begin
  create type public.time_target_enum as enum ('SLA', 'OLA');
exception when duplicate_object then null; end $$;

create table if not exists public.service_time_targets (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.service_catalog_items (id) on delete cascade,
  target public.time_target_enum not null,
  priority public.ticket_priority_enum not null,
  response_time_hours integer not null check (response_time_hours >= 0),
  resolution_time_hours integer not null check (resolution_time_hours >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_id, target, priority)
);

create index if not exists service_time_targets_lookup_idx on public.service_time_targets (service_id, target, priority, is_active);

alter table public.service_time_targets enable row level security;

drop trigger if exists t_service_time_targets_touch on public.service_time_targets;
create trigger t_service_time_targets_touch before update on public.service_time_targets
for each row execute function public._touch_updated_at();

drop policy if exists service_time_targets_select on public.service_time_targets;
create policy service_time_targets_select on public.service_time_targets
for select to authenticated
using (
  exists (
    select 1
    from public.service_catalog_items s
    where s.id = service_time_targets.service_id
      and (s.department_id is null or public._same_department(s.department_id))
  )
);

drop policy if exists service_time_targets_write on public.service_time_targets;
create policy service_time_targets_write on public.service_time_targets
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and exists (
    select 1
    from public.service_catalog_items s
    where s.id = service_time_targets.service_id
      and (s.department_id is null or public._same_department(s.department_id))
  )
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and exists (
    select 1
    from public.service_catalog_items s
    where s.id = service_time_targets.service_id
      and (s.department_id is null or public._same_department(s.department_id))
  )
);

-- Profiles manager relationship (for manager approvals)
alter table public.profiles add column if not exists manager_id uuid references public.profiles (id);
create index if not exists profiles_manager_idx on public.profiles (manager_id);

-- Service owner (for owner approvals)
alter table public.service_catalog_items add column if not exists owner_id uuid references public.profiles (id);
create index if not exists service_catalog_items_owner_idx on public.service_catalog_items (owner_id);

-- Approval workflow
do $$ begin
  create type public.approval_step_kind_enum as enum ('requester_manager', 'service_owner', 'specific_user', 'role');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.approval_status_enum as enum ('pending', 'approved', 'rejected', 'skipped');
exception when duplicate_object then null; end $$;

create table if not exists public.service_catalog_approval_steps (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.service_catalog_items (id) on delete cascade,
  step_order integer not null check (step_order >= 1),
  kind public.approval_step_kind_enum not null,
  approver_profile_id uuid references public.profiles (id),
  approver_role public.role_enum,
  required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_id, step_order)
);

create index if not exists service_catalog_approval_steps_service_idx on public.service_catalog_approval_steps (service_id, step_order);

create table if not exists public.ticket_approvals (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  step_order integer not null check (step_order >= 1),
  kind public.approval_step_kind_enum not null,
  required boolean not null default true,
  approver_profile_id uuid references public.profiles (id),
  approver_role public.role_enum,
  status public.approval_status_enum not null default 'pending',
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ticket_approvals_ticket_idx on public.ticket_approvals (ticket_id, step_order);
create index if not exists ticket_approvals_pending_assignee_idx on public.ticket_approvals (status, approver_profile_id);

alter table public.service_catalog_approval_steps enable row level security;
alter table public.ticket_approvals enable row level security;

drop trigger if exists t_service_catalog_approval_steps_touch on public.service_catalog_approval_steps;
create trigger t_service_catalog_approval_steps_touch before update on public.service_catalog_approval_steps
for each row execute function public._touch_updated_at();

drop trigger if exists t_ticket_approvals_touch on public.ticket_approvals;
create trigger t_ticket_approvals_touch before update on public.ticket_approvals
for each row execute function public._touch_updated_at();

drop policy if exists service_catalog_approval_steps_select on public.service_catalog_approval_steps;
create policy service_catalog_approval_steps_select on public.service_catalog_approval_steps
for select to authenticated
using (
  exists (
    select 1 from public.service_catalog_items s
    where s.id = service_catalog_approval_steps.service_id
      and (s.department_id is null or public._same_department(s.department_id))
  )
);

drop policy if exists service_catalog_approval_steps_write on public.service_catalog_approval_steps;
create policy service_catalog_approval_steps_write on public.service_catalog_approval_steps
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and exists (
    select 1 from public.service_catalog_items s
    where s.id = service_catalog_approval_steps.service_id
      and (s.department_id is null or public._same_department(s.department_id))
  )
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and exists (
    select 1 from public.service_catalog_items s
    where s.id = service_catalog_approval_steps.service_id
      and (s.department_id is null or public._same_department(s.department_id))
  )
);

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
);

-- Helpers
create or replace function public._ticket_service_id(_metadata jsonb)
returns uuid
language plpgsql
stable
as $$
declare
  raw text;
  id uuid;
begin
  if _metadata is null then
    return null;
  end if;
  raw := _metadata #>> '{service_catalog,service_id}';
  if raw is null or raw = '' then
    return null;
  end if;
  begin
    id := raw::uuid;
    return id;
  exception when others then
    return null;
  end;
end;
$$;

create or replace function public._fallback_supervisor(_dept uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where p.department_id = _dept
    and p.role in ('supervisor','admin')
  order by case when p.role = 'admin' then 2 else 1 end, p.created_at asc
  limit 1;
$$;

-- Updated ticket transition timestamps: mark rejected as closed
create or replace function public._set_ticket_transition_timestamps()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'Resuelto' and old.status is distinct from 'Resuelto' then
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;

  if new.status = 'Cerrado' and old.status is distinct from 'Cerrado' then
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  if new.status = 'Rechazado' and old.status is distinct from 'Rechazado' then
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  return new;
end;
$$;

-- Replace: SLA/OLA deadline calc + department enforcement with service overrides
create or replace function public._set_ticket_department_and_sla()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dept uuid;
  svc_id uuid;
  res_hours integer;
  resp_hours integer;
  ola_res_hours integer;
  ola_resp_hours integer;
begin
  select p.department_id into dept
  from public.profiles p
  where p.id = new.requester_id;

  if dept is null then
    raise exception 'Requester must have department_id set';
  end if;

  new.department_id := dept;

  svc_id := public._ticket_service_id(new.metadata);

  -- Service SLA override
  if svc_id is not null then
    select st.response_time_hours, st.resolution_time_hours
      into resp_hours, res_hours
    from public.service_time_targets st
    join public.service_catalog_items s on s.id = st.service_id
    where st.is_active = true
      and st.target = 'SLA'
      and st.service_id = svc_id
      and st.priority = new.priority
      and (s.department_id is null or s.department_id = dept)
    order by st.updated_at desc
    limit 1;

    select st.response_time_hours, st.resolution_time_hours
      into ola_resp_hours, ola_res_hours
    from public.service_time_targets st
    join public.service_catalog_items s on s.id = st.service_id
    where st.is_active = true
      and st.target = 'OLA'
      and st.service_id = svc_id
      and st.priority = new.priority
      and (s.department_id is null or s.department_id = dept)
    order by st.updated_at desc
    limit 1;
  end if;

  -- Fallback to department/global SLA if service SLA not defined
  if res_hours is null or resp_hours is null then
    select s.response_time_hours, s.resolution_time_hours
      into resp_hours, res_hours
    from public.slas s
    where s.is_active = true
      and s.priority = new.priority
      and (s.department_id = dept or s.department_id is null)
    order by (s.department_id is null) asc, s.updated_at desc
    limit 1;
  end if;

  if resp_hours is not null then
    new.response_deadline := new.created_at + make_interval(hours => resp_hours);
  end if;

  if res_hours is not null then
    new.sla_deadline := new.created_at + make_interval(hours => res_hours);
  end if;

  if ola_resp_hours is not null then
    new.ola_response_deadline := new.created_at + make_interval(hours => ola_resp_hours);
  end if;

  if ola_res_hours is not null then
    new.ola_deadline := new.created_at + make_interval(hours => ola_res_hours);
  end if;

  return new;
end;
$$;

-- Ticket approval gate (set status to pending approval)
create or replace function public._set_ticket_approval_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  svc_id uuid;
  needs boolean;
begin
  svc_id := public._ticket_service_id(new.metadata);
  if svc_id is null then
    return new;
  end if;

  select exists (
    select 1 from public.service_catalog_approval_steps s
    where s.service_id = svc_id
  ) into needs;

  if needs and new.status = 'Nuevo' then
    new.status := 'Pendiente Aprobación';
  end if;

  return new;
end;
$$;

drop trigger if exists t_tickets_approval_gate on public.tickets;
create trigger t_tickets_approval_gate
before insert on public.tickets
for each row execute function public._set_ticket_approval_gate();

-- Create ticket approvals after insert
create or replace function public._create_ticket_approvals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  svc_id uuid;
  dept uuid;
  owner uuid;
  manager uuid;
  fallback uuid;
  step record;
  approver uuid;
  approver_role public.role_enum;
begin
  perform set_config('row_security', 'off', true);

  svc_id := public._ticket_service_id(new.metadata);
  if svc_id is null then
    return new;
  end if;

  select department_id into dept from public.tickets where id = new.id;
  fallback := public._fallback_supervisor(dept);

  select owner_id into owner from public.service_catalog_items where id = svc_id;
  select manager_id into manager from public.profiles where id = new.requester_id;

  for step in
    select * from public.service_catalog_approval_steps s
    where s.service_id = svc_id
    order by s.step_order asc
  loop
    approver := null;
    approver_role := null;

    if step.kind = 'requester_manager' then
      approver := coalesce(manager, fallback);
    elsif step.kind = 'service_owner' then
      approver := coalesce(owner, fallback);
    elsif step.kind = 'specific_user' then
      approver := coalesce(step.approver_profile_id, fallback);
    elsif step.kind = 'role' then
      approver_role := step.approver_role;
      if approver_role is null then
        approver := fallback;
      end if;
    end if;

    insert into public.ticket_approvals (ticket_id, step_order, kind, required, approver_profile_id, approver_role)
    values (new.id, step.step_order, step.kind, step.required, approver, approver_role);
  end loop;

  return new;
end;
$$;

drop trigger if exists t_tickets_create_approvals on public.tickets;
create trigger t_tickets_create_approvals
after insert on public.tickets
for each row execute function public._create_ticket_approvals();

-- Approve/reject function (RPC)
create or replace function public.approval_decide(p_ticket_id uuid, p_action text, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  act text;
  target public.approval_status_enum;
  approval_id uuid;
  pending_required integer;
begin
  perform set_config('row_security', 'off', true);

  uid := auth.uid();
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  act := lower(coalesce(p_action, ''));
  if act not in ('approve','reject') then
    raise exception 'Invalid action';
  end if;

  target := case when act = 'approve' then 'approved'::public.approval_status_enum else 'rejected'::public.approval_status_enum end;

  -- Find a pending approval for this user (either explicit or by role)
  select ta.id into approval_id
  from public.ticket_approvals ta
  join public.tickets t on t.id = ta.ticket_id
  join public.profiles me on me.id = uid
  where ta.ticket_id = p_ticket_id
    and ta.status = 'pending'
    and (
      ta.approver_profile_id = uid
      or (ta.approver_profile_id is null and ta.approver_role is not null and me.role = ta.approver_role and me.department_id = t.department_id)
    )
  order by ta.step_order asc
  limit 1;

  if approval_id is null then
    raise exception 'No pending approval for current user';
  end if;

  update public.ticket_approvals
  set status = target,
      decided_by = uid,
      decided_at = now(),
      decision_comment = p_comment
  where id = approval_id;

  if target = 'rejected' then
    update public.tickets
    set status = 'Rechazado',
        closed_at = coalesce(closed_at, now())
    where id = p_ticket_id;
    return;
  end if;

  select count(*) into pending_required
  from public.ticket_approvals ta
  where ta.ticket_id = p_ticket_id
    and ta.required = true
    and ta.status = 'pending';

  if pending_required = 0 then
    update public.tickets
    set status = 'Nuevo'
    where id = p_ticket_id
      and status = 'Pendiente Aprobación';
  end if;
end;
$$;

revoke all on function public.approval_decide(uuid, text, text) from public;
grant execute on function public.approval_decide(uuid, text, text) to authenticated;

commit;
