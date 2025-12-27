-- Service Desk (ITSM) schema for Supabase (Postgres)
-- Includes: tables, enums, triggers, RLS policies, and helper functions.

begin;

-- Extensions
create extension if not exists "pgcrypto";

-- Enums
do $$ begin
  create type public.role_enum as enum ('user', 'agent', 'supervisor', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ticket_status_enum as enum ('Nuevo', 'Asignado', 'En Progreso', 'Pendiente Info', 'Resuelto', 'Cerrado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ticket_priority_enum as enum ('Crítica', 'Alta', 'Media', 'Baja');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ticket_type_enum as enum ('Incidente', 'Requerimiento');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.problem_status_enum as enum ('Abierto', 'En Investigación', 'Mitigado', 'Cerrado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.change_status_enum as enum ('Propuesto', 'Aprobado', 'En Progreso', 'Implementado', 'Rechazado');
exception when duplicate_object then null; end $$;

-- Core tables
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role public.role_enum not null default 'user',
  department_id uuid references public.departments (id),
  points integer not null default 0,
  rank text not null default 'Bronce',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  department_id uuid not null references public.departments (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, name)
);

create table if not exists public.slas (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments (id) on delete cascade,
  priority public.ticket_priority_enum not null,
  response_time_hours integer not null check (response_time_hours >= 0),
  resolution_time_hours integer not null check (resolution_time_hours >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists slas_active_idx on public.slas (is_active, priority);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  type public.ticket_type_enum not null default 'Incidente',
  title text not null,
  description text,
  status public.ticket_status_enum not null default 'Nuevo',
  priority public.ticket_priority_enum not null default 'Media',
  category_id uuid references public.categories (id),
  requester_id uuid not null references public.profiles (id),
  assignee_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sla_deadline timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz
);

create index if not exists tickets_dept_status_idx on public.tickets (department_id, status);
create index if not exists tickets_requester_idx on public.tickets (requester_id);
create index if not exists tickets_assignee_idx on public.tickets (assignee_id);
create index if not exists tickets_created_idx on public.tickets (created_at desc);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  body text not null,
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists comments_ticket_idx on public.comments (ticket_id, created_at asc);

create table if not exists public.knowledge_base (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  title text not null,
  content text not null,
  category_id uuid references public.categories (id),
  author_id uuid references public.profiles (id),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kb_dept_published_idx on public.knowledge_base (department_id, is_published, updated_at desc);

create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  name text not null,
  trigger_condition jsonb not null default '{}'::jsonb,
  action jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workflows_active_idx on public.workflows (department_id, is_active);

-- ITSM advanced scaffolding
create table if not exists public.problems (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  title text not null,
  description text,
  status public.problem_status_enum not null default 'Abierto',
  related_ticket_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.changes (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  title text not null,
  description text,
  status public.change_status_enum not null default 'Propuesto',
  related_ticket_ids uuid[] not null default '{}'::uuid[],
  planned_start_at timestamptz,
  planned_end_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Helpers
create or replace function public._current_profile()
returns public.profiles
language sql
stable
as $$
  select p.* from public.profiles p where p.id = auth.uid();
$$;

create or replace function public._is_role(_role public.role_enum)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = _role
  );
$$;

create or replace function public._has_role(_roles public.role_enum[])
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = any(_roles)
  );
$$;

create or replace function public._same_department(_department_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.department_id = _department_id
  );
$$;

-- Triggers: timestamps
create or replace function public._touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists t_profiles_touch on public.profiles;
create trigger t_profiles_touch before update on public.profiles
for each row execute function public._touch_updated_at();

drop trigger if exists t_categories_touch on public.categories;
create trigger t_categories_touch before update on public.categories
for each row execute function public._touch_updated_at();

drop trigger if exists t_slas_touch on public.slas;
create trigger t_slas_touch before update on public.slas
for each row execute function public._touch_updated_at();

drop trigger if exists t_tickets_touch on public.tickets;
create trigger t_tickets_touch before update on public.tickets
for each row execute function public._touch_updated_at();

drop trigger if exists t_kb_touch on public.knowledge_base;
create trigger t_kb_touch before update on public.knowledge_base
for each row execute function public._touch_updated_at();

drop trigger if exists t_workflows_touch on public.workflows;
create trigger t_workflows_touch before update on public.workflows
for each row execute function public._touch_updated_at();

drop trigger if exists t_problems_touch on public.problems;
create trigger t_problems_touch before update on public.problems
for each row execute function public._touch_updated_at();

drop trigger if exists t_changes_touch on public.changes;
create trigger t_changes_touch before update on public.changes
for each row execute function public._touch_updated_at();

-- Auth hook: create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), 'user')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- SLA deadline calc + department enforcement
create or replace function public._set_ticket_department_and_sla()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dept uuid;
  res_hours integer;
begin
  select p.department_id into dept
  from public.profiles p
  where p.id = new.requester_id;

  if dept is null then
    raise exception 'Requester must have department_id set';
  end if;

  new.department_id := dept;

  select s.resolution_time_hours into res_hours
  from public.slas s
  where s.is_active = true
    and s.priority = new.priority
    and (s.department_id = dept or s.department_id is null)
  order by (s.department_id is null) asc, s.updated_at desc
  limit 1;

  if res_hours is not null then
    new.sla_deadline := new.created_at + make_interval(hours => res_hours);
  end if;

  return new;
end;
$$;

drop trigger if exists t_tickets_set_dept_sla on public.tickets;
create trigger t_tickets_set_dept_sla
before insert on public.tickets
for each row execute function public._set_ticket_department_and_sla();

-- Auto-timestamps for status transitions
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

  return new;
end;
$$;

drop trigger if exists t_tickets_transitions on public.tickets;
create trigger t_tickets_transitions
before update of status on public.tickets
for each row execute function public._set_ticket_transition_timestamps();

-- First response timestamp (first non-internal agent/supervisor/admin comment)
create or replace function public._set_first_response()
returns trigger
language plpgsql
as $$
declare
  author_role public.role_enum;
begin
  select p.role into author_role from public.profiles p where p.id = new.author_id;

  if new.is_internal = false and author_role in ('agent', 'supervisor', 'admin') then
    update public.tickets t
    set first_response_at = coalesce(first_response_at, new.created_at)
    where t.id = new.ticket_id;
  end if;

  return new;
end;
$$;

drop trigger if exists t_comments_first_response on public.comments;
create trigger t_comments_first_response
after insert on public.comments
for each row execute function public._set_first_response();

-- Gamification: award points on close (assignee)
create or replace function public._rank_for_points(_points integer)
returns text
language sql
immutable
as $$
  select case
    when _points >= 2000 then 'Diamante'
    when _points >= 1000 then 'Platino'
    when _points >= 500 then 'Oro'
    when _points >= 200 then 'Plata'
    else 'Bronce'
  end;
$$;

create or replace function public._award_points_on_ticket_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  awarded integer;
begin
  if new.status <> 'Cerrado' or old.status = 'Cerrado' then
    return new;
  end if;

  if new.assignee_id is null then
    return new;
  end if;

  awarded := case new.priority
    when 'Crítica' then 50
    when 'Alta' then 30
    when 'Media' then 20
    else 10
  end;

  update public.profiles p
  set points = p.points + awarded,
      rank = public._rank_for_points(p.points + awarded),
      updated_at = now()
  where p.id = new.assignee_id;

  return new;
end;
$$;

drop trigger if exists t_tickets_award_points on public.tickets;
create trigger t_tickets_award_points
after update of status on public.tickets
for each row execute function public._award_points_on_ticket_closed();

-- RLS
alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.slas enable row level security;
alter table public.tickets enable row level security;
alter table public.comments enable row level security;
alter table public.knowledge_base enable row level security;
alter table public.workflows enable row level security;
alter table public.problems enable row level security;
alter table public.changes enable row level security;

-- Departments
drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments
for select to authenticated
using (true);

drop policy if exists departments_admin_write on public.departments;
create policy departments_admin_write on public.departments
for all to authenticated
using (public._is_role('admin'))
with check (public._is_role('admin'));

-- Profiles
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
for select to authenticated
using (id = auth.uid());

drop policy if exists profiles_admin_select on public.profiles;
create policy profiles_admin_select on public.profiles
for select to authenticated
using (public._is_role('admin'));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
for update to authenticated
using (public._is_role('admin'))
with check (public._is_role('admin'));

-- Categories
drop policy if exists categories_select_dept on public.categories;
create policy categories_select_dept on public.categories
for select to authenticated
using (
  public._same_department(department_id)
  or public._is_role('admin')
);

drop policy if exists categories_agent_write on public.categories;
create policy categories_agent_write on public.categories
for all to authenticated
using (
  (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
)
with check (
  (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
);

-- SLAs
drop policy if exists slas_select_agents on public.slas;
create policy slas_select_agents on public.slas
for select to authenticated
using (
  public._has_role(array['agent','supervisor','admin']::public.role_enum[])
  and (department_id is null or public._same_department(department_id))
);

drop policy if exists slas_supervisor_write on public.slas;
create policy slas_supervisor_write on public.slas
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and (department_id is null or public._same_department(department_id))
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and (department_id is null or public._same_department(department_id))
);

-- Tickets
drop policy if exists tickets_insert_requester on public.tickets;
create policy tickets_insert_requester on public.tickets
for insert to authenticated
with check (
  requester_id = auth.uid()
  and public._same_department((select department_id from public.profiles where id = auth.uid()))
);

drop policy if exists tickets_select_visible on public.tickets;
create policy tickets_select_visible on public.tickets
for select to authenticated
using (
  requester_id = auth.uid()
  or (
    public._has_role(array['agent','supervisor','admin']::public.role_enum[])
    and public._same_department(department_id)
  )
  or public._is_role('admin')
);

drop policy if exists tickets_update_agents on public.tickets;
create policy tickets_update_agents on public.tickets
for update to authenticated
using (
  (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
)
with check (
  (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
);

-- Comments
drop policy if exists comments_select_visible on public.comments;
create policy comments_select_visible on public.comments
for select to authenticated
using (
  exists (
    select 1 from public.tickets t
    where t.id = comments.ticket_id
      and (
        t.requester_id = auth.uid()
        or (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(t.department_id))
        or public._is_role('admin')
      )
  )
  and (
    comments.is_internal = false
    or public._has_role(array['agent','supervisor','admin']::public.role_enum[])
  )
);

drop policy if exists comments_insert_visible on public.comments;
create policy comments_insert_visible on public.comments
for insert to authenticated
with check (
  author_id = auth.uid()
  and exists (
    select 1 from public.tickets t
    where t.id = comments.ticket_id
      and (
        t.requester_id = auth.uid()
        or (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(t.department_id))
        or public._is_role('admin')
      )
  )
  and (
    comments.is_internal = false
    or public._has_role(array['agent','supervisor','admin']::public.role_enum[])
  )
);

-- Knowledge base
drop policy if exists kb_select_visible on public.knowledge_base;
create policy kb_select_visible on public.knowledge_base
for select to authenticated
using (
  (is_published = true and public._same_department(department_id))
  or (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
);

drop policy if exists kb_agent_write on public.knowledge_base;
create policy kb_agent_write on public.knowledge_base
for all to authenticated
using (
  (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
)
with check (
  (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
);

-- Workflows (supervisor/admin only)
drop policy if exists workflows_select on public.workflows;
create policy workflows_select on public.workflows
for select to authenticated
using (
  (public._has_role(array['supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
);

drop policy if exists workflows_write on public.workflows;
create policy workflows_write on public.workflows
for all to authenticated
using (
  (public._has_role(array['supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
)
with check (
  (public._has_role(array['supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
);

-- Problems / Changes (supervisor/admin + agents read)
drop policy if exists problems_select on public.problems;
create policy problems_select on public.problems
for select to authenticated
using (
  (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
);

drop policy if exists problems_write on public.problems;
create policy problems_write on public.problems
for all to authenticated
using (
  (public._has_role(array['supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
)
with check (
  (public._has_role(array['supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
);

drop policy if exists changes_select on public.changes;
create policy changes_select on public.changes
for select to authenticated
using (
  (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
);

drop policy if exists changes_write on public.changes;
create policy changes_write on public.changes
for all to authenticated
using (
  (public._has_role(array['supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
)
with check (
  (public._has_role(array['supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
);

commit;

begin;

create or replace function public.kpi_dashboard(
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
  created_count bigint;
  closed_count bigint;
  mttr_seconds numeric;
  sla_ok bigint;
  sla_total bigint;
  fcr_ok bigint;
  fcr_total bigint;
  pending_crit bigint;
  pending_high bigint;
  pending_med bigint;
  pending_low bigint;
  workload jsonb;
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

  -- Volume: created vs closed
  select count(*) into created_count
  from public.tickets t
  where t.department_id = dept_id
    and t.created_at >= p_start and t.created_at < p_end
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  select count(*) into closed_count
  from public.tickets t
  where t.department_id = dept_id
    and t.status = 'Cerrado'
    and t.closed_at is not null
    and t.closed_at >= p_start and t.closed_at < p_end
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- MTTR (seconds)
  select avg(extract(epoch from (t.closed_at - t.created_at))) into mttr_seconds
  from public.tickets t
  where t.department_id = dept_id
    and t.status = 'Cerrado'
    and t.closed_at is not null
    and t.closed_at >= p_start and t.closed_at < p_end
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- SLA compliance
  select
    count(*) filter (where t.sla_deadline is not null) as total,
    count(*) filter (where t.sla_deadline is not null and t.closed_at <= t.sla_deadline) as ok
  into sla_total, sla_ok
  from public.tickets t
  where t.department_id = dept_id
    and t.status = 'Cerrado'
    and t.closed_at is not null
    and t.closed_at >= p_start and t.closed_at < p_end
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- Pending (snapshot) by priority
  select
    count(*) filter (where t.priority = 'Crítica') as crit,
    count(*) filter (where t.priority = 'Alta') as high,
    count(*) filter (where t.priority = 'Media') as med,
    count(*) filter (where t.priority = 'Baja') as low
  into pending_crit, pending_high, pending_med, pending_low
  from public.tickets t
  where t.department_id = dept_id
    and t.status <> 'Cerrado'
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- Workload (snapshot): open tickets assigned per agent
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into workload
  from (
    select
      p.id as agent_id,
      coalesce(p.full_name, p.email) as agent_name,
      count(t.id) as open_assigned
    from public.profiles p
    left join public.tickets t
      on t.assignee_id = p.id
     and t.department_id = dept_id
     and t.status <> 'Cerrado'
    where p.role in ('agent','supervisor')
      and p.department_id = dept_id
    group by p.id, p.full_name, p.email
    order by open_assigned desc
  ) x;

  -- FCR (approx): closed tickets where agent/supervisor made exactly 1 public comment
  select count(*) into fcr_total
  from public.tickets t
  where t.department_id = dept_id
    and t.status = 'Cerrado'
    and t.closed_at is not null
    and t.closed_at >= p_start and t.closed_at < p_end
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  select count(*) into fcr_ok
  from public.tickets t
  where t.department_id = dept_id
    and t.status = 'Cerrado'
    and t.closed_at is not null
    and t.closed_at >= p_start and t.closed_at < p_end
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id)
    and (
      select count(*)
      from public.comments c
      join public.profiles ap on ap.id = c.author_id
      where c.ticket_id = t.id
        and c.is_internal = false
        and ap.role in ('agent','supervisor','admin')
    ) = 1;

  return jsonb_build_object(
    'range', jsonb_build_object('start', p_start, 'end', p_end),
    'volume', jsonb_build_object('created', created_count, 'closed', closed_count),
    'mttr_hours', coalesce(mttr_seconds, 0) / 3600.0,
    'sla_compliance_pct', case when sla_total = 0 then null else round((sla_ok::numeric / sla_total::numeric) * 100.0, 2) end,
    'pending_by_priority', jsonb_build_object('Crítica', pending_crit, 'Alta', pending_high, 'Media', pending_med, 'Baja', pending_low),
    'workload', workload,
    'fcr_pct', case when fcr_total = 0 then null else round((fcr_ok::numeric / fcr_total::numeric) * 100.0, 2) end
  );
end;
$$;

revoke all on function public.kpi_dashboard(timestamptz, timestamptz, uuid, uuid) from public;
grant execute on function public.kpi_dashboard(timestamptz, timestamptz, uuid, uuid) to authenticated;

commit;

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
drop policy if exists profiles_select_visible on public.profiles;

create policy profiles_select_visible on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or (public.current_user_role() in ('agent','supervisor','admin') and department_id = public.current_user_department_id())
  or public.current_user_role() = 'admin'
);

commit;
begin;

create table if not exists public.subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, name)
);

create index if not exists subcategories_category_idx on public.subcategories (category_id, name);

alter table public.subcategories enable row level security;

drop trigger if exists t_subcategories_touch on public.subcategories;
create trigger t_subcategories_touch before update on public.subcategories
for each row execute function public._touch_updated_at();

drop policy if exists subcategories_select_visible on public.subcategories;
create policy subcategories_select_visible on public.subcategories
for select to authenticated
using (
  exists (
    select 1
    from public.categories c
    where c.id = subcategories.category_id
      and (public._same_department(c.department_id) or public._is_role('admin'))
  )
);

drop policy if exists subcategories_agent_write on public.subcategories;
create policy subcategories_agent_write on public.subcategories
for all to authenticated
using (
  exists (
    select 1
    from public.categories c
    where c.id = subcategories.category_id
      and (
        (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(c.department_id))
        or public._is_role('admin')
      )
  )
)
with check (
  exists (
    select 1
    from public.categories c
    where c.id = subcategories.category_id
      and (
        (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(c.department_id))
        or public._is_role('admin')
      )
  )
);

alter table public.tickets add column if not exists subcategory_id uuid references public.subcategories (id);
create index if not exists tickets_subcategory_idx on public.tickets (subcategory_id);

commit;

begin;

alter table public.tickets add column if not exists metadata jsonb not null default '{}'::jsonb;
create index if not exists tickets_metadata_gin_idx on public.tickets using gin (metadata);

commit;

begin;

do $$ begin
  create type public.service_field_type_enum as enum ('text', 'textarea', 'select', 'boolean', 'date', 'number');
exception when duplicate_object then null; end $$;

create table if not exists public.service_catalog_items (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments (id) on delete cascade,
  name text not null,
  description text,
  category_id uuid references public.categories (id),
  subcategory_id uuid references public.subcategories (id),
  ticket_type public.ticket_type_enum not null default 'Requerimiento',
  default_priority public.ticket_priority_enum not null default 'Media',
  default_impact text not null default 'Medio' check (default_impact in ('Alto','Medio','Bajo')),
  default_urgency text not null default 'Media' check (default_urgency in ('Alta','Media','Baja')),
  icon_key text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, name)
);

create index if not exists service_catalog_items_active_idx on public.service_catalog_items (is_active, department_id);

create table if not exists public.service_catalog_fields (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.service_catalog_items (id) on delete cascade,
  key text not null,
  label text not null,
  field_type public.service_field_type_enum not null,
  required boolean not null default false,
  placeholder text,
  help_text text,
  options jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_id, key)
);

create index if not exists service_catalog_fields_service_idx on public.service_catalog_fields (service_id, sort_order);

alter table public.service_catalog_items enable row level security;
alter table public.service_catalog_fields enable row level security;

drop trigger if exists t_service_catalog_items_touch on public.service_catalog_items;
create trigger t_service_catalog_items_touch before update on public.service_catalog_items
for each row execute function public._touch_updated_at();

drop trigger if exists t_service_catalog_fields_touch on public.service_catalog_fields;
create trigger t_service_catalog_fields_touch before update on public.service_catalog_fields
for each row execute function public._touch_updated_at();

drop policy if exists service_catalog_items_select_visible on public.service_catalog_items;
create policy service_catalog_items_select_visible on public.service_catalog_items
for select to authenticated
using (
  (department_id is null or public._same_department(department_id))
  or public._is_role('admin')
);

drop policy if exists service_catalog_items_write on public.service_catalog_items;
create policy service_catalog_items_write on public.service_catalog_items
for all to authenticated
using (
  (public._has_role(array['supervisor','admin']::public.role_enum[]) and (department_id is null or public._same_department(department_id)))
  or public._is_role('admin')
)
with check (
  (public._has_role(array['supervisor','admin']::public.role_enum[]) and (department_id is null or public._same_department(department_id)))
  or public._is_role('admin')
);

drop policy if exists service_catalog_fields_select_visible on public.service_catalog_fields;
create policy service_catalog_fields_select_visible on public.service_catalog_fields
for select to authenticated
using (
  exists (
    select 1
    from public.service_catalog_items s
    where s.id = service_catalog_fields.service_id
      and ((s.department_id is null or public._same_department(s.department_id)) or public._is_role('admin'))
  )
);

drop policy if exists service_catalog_fields_write on public.service_catalog_fields;
create policy service_catalog_fields_write on public.service_catalog_fields
for all to authenticated
using (
  exists (
    select 1
    from public.service_catalog_items s
    where s.id = service_catalog_fields.service_id
      and (
        (public._has_role(array['supervisor','admin']::public.role_enum[]) and (s.department_id is null or public._same_department(s.department_id)))
        or public._is_role('admin')
      )
  )
)
with check (
  exists (
    select 1
    from public.service_catalog_items s
    where s.id = service_catalog_fields.service_id
      and (
        (public._has_role(array['supervisor','admin']::public.role_enum[]) and (s.department_id is null or public._same_department(s.department_id)))
        or public._is_role('admin')
      )
  )
);

commit;

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

begin;

-- ---------------------------------------------------------------------
-- Ticket events: trazabilidad de cambios (estado/asignación/prioridad)
-- ---------------------------------------------------------------------

do $$ begin
  create type public.ticket_event_type_enum as enum (
    'created',
    'status_changed',
    'assignee_changed',
    'priority_changed',
    'approval_decided'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  event_type public.ticket_event_type_enum not null,
  from_status public.ticket_status_enum,
  to_status public.ticket_status_enum,
  from_priority public.ticket_priority_enum,
  to_priority public.ticket_priority_enum,
  from_assignee_id uuid references public.profiles (id),
  to_assignee_id uuid references public.profiles (id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ticket_events_ticket_idx on public.ticket_events (ticket_id, created_at asc);
create index if not exists ticket_events_type_idx on public.ticket_events (event_type, created_at desc);

alter table public.ticket_events enable row level security;

drop policy if exists ticket_events_select_visible on public.ticket_events;
create policy ticket_events_select_visible on public.ticket_events
for select to authenticated
using (
  exists (
    select 1
    from public.tickets t
    where t.id = ticket_events.ticket_id
      and (
        t.requester_id = auth.uid()
        or (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(t.department_id))
        or public._is_role('admin')
      )
  )
);

-- Internal inserts are done via SECURITY DEFINER triggers (row_security off).
drop policy if exists ticket_events_insert_none on public.ticket_events;
create policy ticket_events_insert_none on public.ticket_events
for insert to authenticated
with check (false);

-- Trigger helpers: insert trace events
create or replace function public._ticket_events_insert(_row public.ticket_events)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('row_security', 'off', true);
  insert into public.ticket_events (
    ticket_id,
    actor_id,
    event_type,
    from_status,
    to_status,
    from_priority,
    to_priority,
    from_assignee_id,
    to_assignee_id,
    details,
    created_at
  )
  values (
    _row.ticket_id,
    _row.actor_id,
    _row.event_type,
    _row.from_status,
    _row.to_status,
    _row.from_priority,
    _row.to_priority,
    _row.from_assignee_id,
    _row.to_assignee_id,
    coalesce(_row.details, '{}'::jsonb),
    coalesce(_row.created_at, now())
  );
end;
$$;

create or replace function public._ticket_events_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ev public.ticket_events;
begin
  ev.ticket_id := new.id;
  ev.actor_id := auth.uid();
  ev.event_type := 'created'::public.ticket_event_type_enum;
  ev.to_status := new.status;
  ev.to_priority := new.priority;
  ev.to_assignee_id := new.assignee_id;
  ev.details := jsonb_build_object('source', 'tickets.insert');
  ev.created_at := new.created_at;
  perform public._ticket_events_insert(ev);
  return new;
end;
$$;

drop trigger if exists t_ticket_events_on_insert on public.tickets;
create trigger t_ticket_events_on_insert
after insert on public.tickets
for each row execute function public._ticket_events_on_insert();

create or replace function public._ticket_events_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ev public.ticket_events;
  actor uuid;
begin
  actor := auth.uid();

  if new.status is distinct from old.status then
    ev.ticket_id := new.id;
    ev.actor_id := actor;
    ev.event_type := 'status_changed'::public.ticket_event_type_enum;
    ev.from_status := old.status;
    ev.to_status := new.status;
    ev.details := jsonb_build_object('source', 'tickets.update');
    perform public._ticket_events_insert(ev);
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    ev := null;
    ev.ticket_id := new.id;
    ev.actor_id := actor;
    ev.event_type := 'assignee_changed'::public.ticket_event_type_enum;
    ev.from_assignee_id := old.assignee_id;
    ev.to_assignee_id := new.assignee_id;
    ev.details := jsonb_build_object('source', 'tickets.update');
    perform public._ticket_events_insert(ev);
  end if;

  if new.priority is distinct from old.priority then
    ev := null;
    ev.ticket_id := new.id;
    ev.actor_id := actor;
    ev.event_type := 'priority_changed'::public.ticket_event_type_enum;
    ev.from_priority := old.priority;
    ev.to_priority := new.priority;
    ev.details := jsonb_build_object('source', 'tickets.update');
    perform public._ticket_events_insert(ev);
  end if;

  return new;
end;
$$;

drop trigger if exists t_ticket_events_on_update on public.tickets;
create trigger t_ticket_events_on_update
after update of status, assignee_id, priority on public.tickets
for each row execute function public._ticket_events_on_update();

-- Approvals decisions -> ticket_events (timeline)
create or replace function public._ticket_events_on_approval_decided()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ev public.ticket_events;
begin
  if new.status is distinct from old.status and new.status in ('approved','rejected') then
    ev.ticket_id := new.ticket_id;
    ev.actor_id := coalesce(new.decided_by, auth.uid());
    ev.event_type := 'approval_decided'::public.ticket_event_type_enum;
    ev.details := jsonb_build_object(
      'step_order', new.step_order,
      'kind', new.kind,
      'required', new.required,
      'status', new.status,
      'comment', new.decision_comment
    );
    ev.created_at := coalesce(new.decided_at, now());
    perform public._ticket_events_insert(ev);
  end if;
  return new;
end;
$$;

drop trigger if exists t_ticket_events_on_approval_decided on public.ticket_approvals;
create trigger t_ticket_events_on_approval_decided
after update of status on public.ticket_approvals
for each row execute function public._ticket_events_on_approval_decided();

-- ---------------------------------------------------------------------
-- Analytics: timeseries KPI (para dashboard tipo BI)
-- ---------------------------------------------------------------------

create or replace function public.kpi_timeseries(
  p_start timestamptz,
  p_end timestamptz,
  p_bucket text,
  p_agent_id uuid default null,
  p_category_id uuid default null
)
returns jsonb
language plpgsql
stable
as $$
declare
  dept_id uuid;
  step interval;
  bucket text;
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

  bucket := lower(coalesce(p_bucket, 'day'));
  if bucket not in ('hour','day','week','month') then
    raise exception 'invalid_bucket';
  end if;

  step := case bucket
    when 'hour' then interval '1 hour'
    when 'day' then interval '1 day'
    when 'week' then interval '1 week'
    else interval '1 month'
  end;

  return (
    with
      series as (
        select generate_series(date_trunc(bucket, p_start), date_trunc(bucket, p_end), step) as b
      ),
      created as (
        select date_trunc(bucket, t.created_at) as b, count(*)::int as created
        from public.tickets t
        where t.department_id = dept_id
          and t.created_at >= p_start and t.created_at < p_end
          and (p_agent_id is null or t.assignee_id = p_agent_id)
          and (p_category_id is null or t.category_id = p_category_id)
        group by 1
      ),
      closed as (
        select date_trunc(bucket, t.closed_at) as b, count(*)::int as closed
        from public.tickets t
        where t.department_id = dept_id
          and t.status = 'Cerrado'
          and t.closed_at is not null
          and t.closed_at >= p_start and t.closed_at < p_end
          and (p_agent_id is null or t.assignee_id = p_agent_id)
          and (p_category_id is null or t.category_id = p_category_id)
        group by 1
      ),
      response as (
        select date_trunc(bucket, t.created_at) as b,
               round(avg(extract(epoch from (t.first_response_at - t.created_at))) / 3600.0, 2) as avg_response_hours
        from public.tickets t
        where t.department_id = dept_id
          and t.created_at >= p_start and t.created_at < p_end
          and t.first_response_at is not null
          and (p_agent_id is null or t.assignee_id = p_agent_id)
          and (p_category_id is null or t.category_id = p_category_id)
        group by 1
      ),
      resolution as (
        select date_trunc(bucket, t.closed_at) as b,
               round(avg(extract(epoch from (t.closed_at - t.created_at))) / 3600.0, 2) as avg_resolution_hours
        from public.tickets t
        where t.department_id = dept_id
          and t.status = 'Cerrado'
          and t.closed_at is not null
          and t.closed_at >= p_start and t.closed_at < p_end
          and (p_agent_id is null or t.assignee_id = p_agent_id)
          and (p_category_id is null or t.category_id = p_category_id)
        group by 1
      ),
      sla as (
        select date_trunc(bucket, t.closed_at) as b,
               count(*) filter (where t.sla_deadline is not null)::int as sla_total,
               count(*) filter (where t.sla_deadline is not null and t.closed_at <= t.sla_deadline)::int as sla_ok
        from public.tickets t
        where t.department_id = dept_id
          and t.status = 'Cerrado'
          and t.closed_at is not null
          and t.closed_at >= p_start and t.closed_at < p_end
          and (p_agent_id is null or t.assignee_id = p_agent_id)
          and (p_category_id is null or t.category_id = p_category_id)
        group by 1
      )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'bucket', s.b,
          'created', coalesce(c.created, 0),
          'closed', coalesce(cl.closed, 0),
          'avg_response_hours', r.avg_response_hours,
          'avg_resolution_hours', rs.avg_resolution_hours,
          'sla_pct', case
            when coalesce(sl.sla_total, 0) = 0 then null
            else round((sl.sla_ok::numeric / sl.sla_total::numeric) * 100.0, 2)
          end
        )
        order by s.b
      ),
      '[]'::jsonb
    )
    from series s
    left join created c on c.b = s.b
    left join closed cl on cl.b = s.b
    left join response r on r.b = s.b
    left join resolution rs on rs.b = s.b
    left join sla sl on sl.b = s.b
  );
end;
$$;

revoke all on function public.kpi_timeseries(timestamptz, timestamptz, text, uuid, uuid) from public;
grant execute on function public.kpi_timeseries(timestamptz, timestamptz, text, uuid, uuid) to authenticated;

commit;

begin;

insert into public.departments (id, name, description)
values
  ('11111111-1111-1111-1111-111111111111', 'TI', 'Departamento de Tecnología')
on conflict (name) do nothing;

-- Global SLAs (department_id = null) as defaults
insert into public.slas (department_id, priority, response_time_hours, resolution_time_hours, is_active)
values
  (null, 'Crítica', 1, 4, true),
  (null, 'Alta', 2, 8, true),
  (null, 'Media', 4, 24, true),
  (null, 'Baja', 8, 72, true)
on conflict do nothing;

insert into public.categories (name, description, department_id)
values
  ('Accesos', 'Alta/baja de usuarios, permisos, MFA', '11111111-1111-1111-1111-111111111111'),
  ('Correo', 'Outlook/Exchange, buzones, listas', '11111111-1111-1111-1111-111111111111'),
  ('Red', 'WiFi, VPN, conectividad', '11111111-1111-1111-1111-111111111111'),
  ('Hardware', 'PCs, impresoras, periféricos', '11111111-1111-1111-1111-111111111111'),
  ('Software', 'Instalación/errores/licencias', '11111111-1111-1111-1111-111111111111'),
  ('Seguridad', 'Phishing, malware, incidentes', '11111111-1111-1111-1111-111111111111'),
  ('Colaboración', 'Teams/Zoom/SharePoint/OneDrive', '11111111-1111-1111-1111-111111111111'),
  ('Telefonía', 'Softphone, extensiones, voicemail', '11111111-1111-1111-1111-111111111111'),
  ('Onboarding/Offboarding', 'Altas, bajas, equipo inicial', '11111111-1111-1111-1111-111111111111'),
  ('Aplicaciones', 'ERP/CRM/apps internas', '11111111-1111-1111-1111-111111111111')
on conflict do nothing;

-- Subcategorías (casuísticas típicas)
insert into public.subcategories (category_id, name, description)
select c.id, v.name, v.description
from public.categories c
join (
  values
    ('Accesos', 'Reset de contraseña', 'Recuperación/cambio de contraseña, bloqueo, MFA'),
    ('Accesos', 'Cuenta bloqueada', 'Usuario bloqueado / demasiados intentos'),
    ('Accesos', 'Alta/Baja de usuario', 'Creación, baja, reactivación'),
    ('Accesos', 'Permisos y roles', 'Acceso a apps, carpetas, grupos'),
    ('Accesos', 'MFA / 2FA', 'Problemas con MFA, dispositivo, enrolamiento'),
    ('Accesos', 'Acceso a carpeta compartida', 'Permisos a recursos compartidos'),
    ('Correo', 'No sincroniza', 'Problemas de envío/recepción, sincronización'),
    ('Correo', 'No envía / No recibe', 'Mensajes rebotan, colas, límites'),
    ('Correo', 'Buzón compartido', 'Altas, permisos, delegación'),
    ('Correo', 'Lista de distribución', 'Crear/editar grupos, miembros'),
    ('Correo', 'Firma', 'Configuración de firma corporativa'),
    ('Red', 'VPN no conecta', 'Errores de autenticación/conectividad'),
    ('Red', 'WiFi', 'Conexión, cobertura, portal cautivo'),
    ('Red', 'LAN / Cable', 'Punto de red, switch, patch, DHCP'),
    ('Red', 'DNS / Acceso web', 'Resolución de nombres, proxy, navegación'),
    ('Hardware', 'Impresora no imprime', 'Cola, drivers, atasco, conectividad'),
    ('Hardware', 'Laptop/PC lenta', 'Rendimiento, disco, RAM'),
    ('Hardware', 'Periféricos', 'Mouse/teclado/docking/monitor'),
    ('Hardware', 'Equipo dañado', 'Golpe, pantalla rota, no enciende'),
    ('Hardware', 'Nuevo equipo', 'Solicitud de laptop/PC/accesorios'),
    ('Software', 'Instalación', 'Instalar/actualizar software'),
    ('Software', 'Error de aplicación', 'Crash, errores, licencias'),
    ('Software', 'Licencias / Activación', 'Asignación, activación, renovaciones'),
    ('Software', 'Actualización', 'Update, parches, compatibilidad'),
    ('Seguridad', 'Phishing', 'Reporte de correo sospechoso'),
    ('Seguridad', 'Malware', 'Virus, comportamiento anómalo, cuarentena'),
    ('Seguridad', 'Incidente de seguridad', 'Acceso no autorizado, fuga, alerta'),
    ('Colaboración', 'Microsoft Teams', 'Llamadas, reuniones, chat, canales'),
    ('Colaboración', 'Zoom/Meet', 'Audio/video, salas, permisos'),
    ('Colaboración', 'SharePoint/OneDrive', 'Sync, permisos, enlaces'),
    ('Telefonía', 'Softphone', 'Cliente de softphone, login, audio'),
    ('Telefonía', 'Voicemail / Desvío', 'Buzón de voz, desvíos, IVR'),
    ('Onboarding/Offboarding', 'Onboarding (alta)', 'Usuario nuevo: cuentas, accesos, equipo'),
    ('Onboarding/Offboarding', 'Offboarding (baja)', 'Baja: bloqueo, respaldos, devoluciones'),
    ('Aplicaciones', 'ERP/CRM', 'Acceso, errores, performance'),
    ('Aplicaciones', 'Apps internas', 'Portales internos, apps corporativas')
) as v(category_name, name, description) on v.category_name = c.name
where c.department_id = '11111111-1111-1111-1111-111111111111'
on conflict do nothing;

-- Example workflow: if priority = 'Crítica' then auto-assign to least loaded agent in the same department
insert into public.workflows (department_id, name, trigger_condition, action, is_active)
values (
  '11111111-1111-1111-1111-111111111111',
  'Asignación automática de tickets críticos',
  jsonb_build_object('ticket', jsonb_build_object('priority', 'Crítica')),
  jsonb_build_object('type', 'assign_least_loaded_agent'),
  true
)
on conflict do nothing;

-- Service Catalog (solicitudes / incidencias estandarizadas)
insert into public.service_catalog_items (department_id, name, description, category_id, subcategory_id, ticket_type, default_priority, default_impact, default_urgency, icon_key, is_active)
select
  '11111111-1111-1111-1111-111111111111'::uuid as department_id,
  v.name,
  v.description,
  c.id as category_id,
  sc.id as subcategory_id,
  v.ticket_type::public.ticket_type_enum,
  v.default_priority::public.ticket_priority_enum,
  v.default_impact,
  v.default_urgency,
  v.icon_key,
  true
from (
  values
    ('Reset de contraseña', 'Restablecimiento de contraseña / bloqueo / MFA.', 'Accesos', 'Reset de contraseña', 'Requerimiento', 'Alta', 'Medio', 'Alta', 'access'),
    ('Solicitud de permisos', 'Acceso a aplicación/carpeta/grupo/rol.', 'Accesos', 'Permisos y roles', 'Requerimiento', 'Media', 'Medio', 'Media', 'access'),
    ('Alta de usuario', 'Creación de cuenta y accesos iniciales.', 'Onboarding/Offboarding', 'Onboarding (alta)', 'Requerimiento', 'Media', 'Medio', 'Media', 'users'),
    ('Baja de usuario', 'Offboarding: bloqueo, respaldos, devoluciones.', 'Onboarding/Offboarding', 'Offboarding (baja)', 'Requerimiento', 'Media', 'Medio', 'Media', 'users'),
    ('Correo no sincroniza', 'Problemas de envío/recepción/sincronización.', 'Correo', 'No sincroniza', 'Incidente', 'Media', 'Alto', 'Media', 'mail'),
    ('VPN no conecta', 'Problemas de autenticación o conectividad por VPN.', 'Red', 'VPN no conecta', 'Incidente', 'Alta', 'Alto', 'Alta', 'network'),
    ('Problema WiFi', 'Conexión/cobertura/autenticación WiFi.', 'Red', 'WiFi', 'Incidente', 'Media', 'Medio', 'Media', 'network'),
    ('Impresora no imprime', 'Cola/drivers/conectividad/atasco.', 'Hardware', 'Impresora no imprime', 'Incidente', 'Media', 'Medio', 'Media', 'hardware'),
    ('Nuevo equipo', 'Solicitud de laptop/PC/accesorios.', 'Hardware', 'Nuevo equipo', 'Requerimiento', 'Baja', 'Medio', 'Baja', 'hardware'),
    ('Instalar software', 'Instalación/actualización de software.', 'Software', 'Instalación', 'Requerimiento', 'Media', 'Medio', 'Media', 'software'),
    ('Licencias / Activación', 'Asignación/activación de licencias.', 'Software', 'Licencias / Activación', 'Requerimiento', 'Media', 'Medio', 'Media', 'software'),
    ('Reporte de phishing', 'Correo sospechoso, enlace o adjunto malicioso.', 'Seguridad', 'Phishing', 'Incidente', 'Alta', 'Alto', 'Alta', 'security'),
    ('Microsoft Teams', 'Audio/video/chat/canales/reuniones.', 'Colaboración', 'Microsoft Teams', 'Incidente', 'Media', 'Medio', 'Media', 'users'),
    ('Softphone', 'Problemas de login/audio/registro.', 'Telefonía', 'Softphone', 'Incidente', 'Media', 'Medio', 'Media', 'phone'),
    ('ERP/CRM', 'Acceso/errores/performance en ERP/CRM.', 'Aplicaciones', 'ERP/CRM', 'Incidente', 'Alta', 'Alto', 'Media', 'apps')
) as v(name, description, category_name, subcategory_name, ticket_type, default_priority, default_impact, default_urgency, icon_key)
join public.categories c on c.department_id = '11111111-1111-1111-1111-111111111111'::uuid and c.name = v.category_name
left join public.subcategories sc on sc.category_id = c.id and sc.name = v.subcategory_name
on conflict do nothing;

-- Campos de formulario por servicio (metadata)
insert into public.service_catalog_fields (service_id, key, label, field_type, required, placeholder, help_text, options, sort_order)
select s.id, f.key, f.label, f.field_type::public.service_field_type_enum, f.required, f.placeholder, f.help_text, f.options::jsonb, f.sort_order
from public.service_catalog_items s
join (
  values
    ('Reset de contraseña', 'affected_user', 'Usuario afectado', 'text', true, 'usuario@empresa.com', null, null, 10),
    ('Reset de contraseña', 'mfa_issue', '¿Problema con MFA?', 'select', false, null, null, '["No","Sí"]', 20),

    ('Solicitud de permisos', 'system', 'Sistema / recurso', 'text', true, 'Ej: ERP, Carpeta X, App Y', null, null, 10),
    ('Solicitud de permisos', 'requested_role', 'Rol / permiso solicitado', 'text', true, 'Ej: Lectura, Admin, Grupo Z', null, null, 20),
    ('Solicitud de permisos', 'business_reason', 'Justificación', 'textarea', false, '¿Por qué se necesita?', null, null, 30),

    ('Alta de usuario', 'new_user_email', 'Email del nuevo usuario (si existe)', 'text', false, 'usuario@empresa.com', null, null, 10),
    ('Alta de usuario', 'start_date', 'Fecha de ingreso', 'date', true, null, null, null, 20),
    ('Alta de usuario', 'department', 'Área', 'text', true, 'Ej: Ventas', null, null, 30),

    ('Baja de usuario', 'user_email', 'Usuario a desactivar', 'text', true, 'usuario@empresa.com', null, null, 10),
    ('Baja de usuario', 'effective_date', 'Fecha efectiva', 'date', true, null, null, null, 20),
    ('Baja de usuario', 'needs_backup', '¿Requiere respaldo?', 'select', false, null, null, '["No","Sí"]', 30),

    ('Correo no sincroniza', 'client', 'Cliente', 'select', false, null, null, '["Outlook","OWA (web)","Móvil","Otro"]', 10),
    ('Correo no sincroniza', 'error_message', 'Mensaje de error', 'text', false, null, null, null, 20),

    ('VPN no conecta', 'device', 'Dispositivo', 'select', false, null, null, '["Laptop","PC","Móvil"]', 10),
    ('VPN no conecta', 'os', 'Sistema operativo', 'select', false, null, null, '["Windows","macOS","Linux","Android","iOS"]', 20),
    ('VPN no conecta', 'vpn_client', 'Cliente VPN', 'text', false, 'Ej: FortiClient/AnyConnect', null, null, 30),
    ('VPN no conecta', 'error_message', 'Mensaje de error', 'text', false, null, null, null, 40),

    ('Impresora no imprime', 'asset_tag', 'Asset tag / código', 'text', false, 'Ej: PRN-013', null, null, 10),
    ('Impresora no imprime', 'location', 'Ubicación', 'text', false, 'Ej: Piso 2', null, null, 20),
    ('Impresora no imprime', 'connection', 'Conexión', 'select', false, null, null, '["Red","USB","WiFi"]', 30),

    ('Instalar software', 'software', 'Software', 'text', true, 'Ej: Office, Visio', null, null, 10),
    ('Instalar software', 'license', 'Licencia / suscripción', 'select', false, null, null, '["Ya tengo","Necesito asignación","No sé"]', 20),

    ('Nuevo equipo', 'device_type', 'Tipo de equipo', 'select', true, null, null, '["Laptop","PC","Monitor","Docking","Otro"]', 10),
    ('Nuevo equipo', 'for_user', 'Para usuario', 'text', true, 'usuario@empresa.com', null, null, 20),
    ('Nuevo equipo', 'needed_by', 'Fecha requerida', 'date', false, null, null, null, 30),

    ('Reporte de phishing', 'sender', 'Remitente', 'text', false, 'correo@dominio.com', null, null, 10),
    ('Reporte de phishing', 'subject', 'Asunto', 'text', false, null, null, null, 20),
    ('Reporte de phishing', 'clicked', '¿Se hizo clic en el enlace?', 'select', false, null, null, '["No","Sí"]', 30),

    ('Softphone', 'extension', 'Extensión', 'text', false, 'Ej: 2031', null, null, 10),
    ('Softphone', 'issue_type', 'Tipo de problema', 'select', false, null, null, '["No registra","Sin audio","Corte","Otro"]', 20),

    ('ERP/CRM', 'system', 'Sistema', 'text', true, 'Ej: SAP / Salesforce', null, null, 10),
    ('ERP/CRM', 'module', 'Módulo / pantalla', 'text', false, null, null, null, 20),
    ('ERP/CRM', 'error_message', 'Mensaje de error', 'text', false, null, null, null, 30)
) as f(service_name, key, label, field_type, required, placeholder, help_text, options, sort_order)
  on f.service_name = s.name
on conflict do nothing;

-- Service time targets (SLA + OLA) by service and priority
insert into public.service_time_targets (service_id, target, priority, response_time_hours, resolution_time_hours, is_active)
select s.id, v.target::public.time_target_enum, v.priority::public.ticket_priority_enum, v.response_time_hours, v.resolution_time_hours, true
from public.service_catalog_items s
join (
  values
    ('Reporte de phishing', 'SLA', 'Alta', 1, 4),
    ('Reporte de phishing', 'OLA', 'Alta', 0, 2),
    ('VPN no conecta', 'SLA', 'Alta', 2, 6),
    ('VPN no conecta', 'OLA', 'Alta', 1, 4),
    ('Correo no sincroniza', 'SLA', 'Media', 4, 18),
    ('Correo no sincroniza', 'OLA', 'Media', 2, 10),
    ('Nuevo equipo', 'SLA', 'Baja', 24, 120),
    ('Nuevo equipo', 'OLA', 'Baja', 8, 72)
) as v(service_name, target, priority, response_time_hours, resolution_time_hours)
  on v.service_name = s.name
on conflict do nothing;

-- Approval steps per service (multi-level: manager + owner)
insert into public.service_catalog_approval_steps (service_id, step_order, kind, required)
select s.id, v.step_order, v.kind::public.approval_step_kind_enum, v.required
from public.service_catalog_items s
join (
  values
    ('Nuevo equipo', 10, 'requester_manager', true),
    ('Nuevo equipo', 20, 'service_owner', true),
    ('Solicitud de permisos', 10, 'requester_manager', true),
    ('Solicitud de permisos', 20, 'service_owner', false),
    ('Alta de usuario', 10, 'service_owner', true),
    ('Baja de usuario', 10, 'service_owner', true)
) as v(service_name, step_order, kind, required)
  on v.service_name = s.name
on conflict do nothing;

commit;

-- ---------------------------------------------------------------------
-- Chat (canal interno): hilos, mensajes, eventos, presencia y skills
-- ---------------------------------------------------------------------

begin;

do $$ begin
  create type public.chat_status_enum as enum ('En cola', 'Asignado', 'Activo', 'Cerrado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.agent_presence_enum as enum ('Disponible', 'Ocupado', 'Ausente', 'Offline');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.chat_event_type_enum as enum ('created', 'assigned', 'accepted', 'closed', 'message');
exception when duplicate_object then null; end $$;

create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  category_id uuid references public.categories (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.skills drop constraint if exists skills_category_id_key;
create index if not exists skills_category_idx on public.skills (category_id);

create table if not exists public.agent_skills (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  skill_id uuid not null references public.skills (id) on delete cascade,
  level integer not null default 3 check (level >= 1 and level <= 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, skill_id)
);

create index if not exists agent_skills_profile_idx on public.agent_skills (profile_id);
create index if not exists agent_skills_skill_idx on public.agent_skills (skill_id, level desc);

create table if not exists public.agent_presence (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  department_id uuid references public.departments (id) on delete cascade,
  status public.agent_presence_enum not null default 'Offline',
  capacity integer not null default 3 check (capacity >= 1 and capacity <= 20),
  updated_at timestamptz not null default now()
);

create index if not exists agent_presence_dept_status_idx on public.agent_presence (department_id, status, updated_at desc);

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  subcategory_id uuid references public.subcategories (id) on delete set null,
  skill_id uuid references public.skills (id) on delete set null,
  subject text,
  status public.chat_status_enum not null default 'En cola',
  assigned_agent_id uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz,
  accepted_at timestamptz,
  first_response_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references public.profiles (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_threads_dept_status_idx on public.chat_threads (department_id, status, created_at desc);
create index if not exists chat_threads_requester_idx on public.chat_threads (requester_id, created_at desc);
create index if not exists chat_threads_assigned_idx on public.chat_threads (assigned_agent_id, status, updated_at desc);

create table if not exists public.chat_participants (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (thread_id, profile_id)
);

create index if not exists chat_participants_thread_idx on public.chat_participants (thread_id);
create index if not exists chat_participants_profile_idx on public.chat_participants (profile_id);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_thread_idx on public.chat_messages (thread_id, created_at asc);

create table if not exists public.chat_events (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  event_type public.chat_event_type_enum not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_events_thread_idx on public.chat_events (thread_id, created_at asc);
create index if not exists chat_events_type_idx on public.chat_events (event_type, created_at desc);

drop trigger if exists t_skills_touch on public.skills;
create trigger t_skills_touch before update on public.skills for each row execute function public._touch_updated_at();

drop trigger if exists t_agent_skills_touch on public.agent_skills;
create trigger t_agent_skills_touch before update on public.agent_skills for each row execute function public._touch_updated_at();

drop trigger if exists t_agent_presence_touch on public.agent_presence;
create trigger t_agent_presence_touch before update on public.agent_presence for each row execute function public._touch_updated_at();

drop trigger if exists t_chat_threads_touch on public.chat_threads;
-- Chat threads updated_at is controlled by workflow functions/triggers; keep single source of truth.

create or replace function public._set_chat_department()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dept uuid;
begin
  select p.department_id into dept
  from public.profiles p
  where p.id = new.requester_id;

  if dept is null then
    raise exception 'Requester must have department_id set';
  end if;

  new.department_id := dept;

  if new.skill_id is null and new.category_id is not null then
    select s.id into new.skill_id
    from public.skills s
    where s.category_id = new.category_id
    limit 1;
  end if;

  return new;
end;
$$;

drop trigger if exists t_chat_threads_set_dept on public.chat_threads;
create trigger t_chat_threads_set_dept
before insert on public.chat_threads
for each row execute function public._set_chat_department();

create or replace function public._chat_events_insert(
  p_thread_id uuid,
  p_actor_id uuid,
  p_type public.chat_event_type_enum,
  p_details jsonb,
  p_created_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('row_security', 'off', true);
  insert into public.chat_events (thread_id, actor_id, event_type, details, created_at)
  values (p_thread_id, p_actor_id, p_type, coalesce(p_details, '{}'::jsonb), coalesce(p_created_at, now()));
end;
$$;

create or replace function public._chat_threads_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('row_security', 'off', true);
  perform public._chat_events_insert(new.id, auth.uid(), 'created', jsonb_build_object('status', new.status), new.created_at);
  return new;
end;
$$;

drop trigger if exists t_chat_threads_on_insert on public.chat_threads;
create trigger t_chat_threads_on_insert
after insert on public.chat_threads
for each row execute function public._chat_threads_on_insert();

create or replace function public._chat_threads_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('row_security', 'off', true);

  if new.assigned_agent_id is distinct from old.assigned_agent_id then
    new.assigned_at := coalesce(new.assigned_at, now());
    perform public._chat_events_insert(
      new.id,
      auth.uid(),
      'assigned',
      jsonb_build_object('from', old.assigned_agent_id, 'to', new.assigned_agent_id, 'status', new.status),
      now()
    );
  end if;

  if new.status is distinct from old.status and new.status = 'Activo' then
    new.accepted_at := coalesce(new.accepted_at, now());
    perform public._chat_events_insert(new.id, auth.uid(), 'accepted', jsonb_build_object('status', new.status), now());
  end if;

  if new.status is distinct from old.status and new.status = 'Cerrado' then
    new.closed_at := coalesce(new.closed_at, now());
    perform public._chat_events_insert(new.id, auth.uid(), 'closed', jsonb_build_object('status', new.status), now());
  end if;

  return new;
end;
$$;

drop trigger if exists t_chat_threads_on_update on public.chat_threads;
create trigger t_chat_threads_on_update
before update of status, assigned_agent_id on public.chat_threads
for each row execute function public._chat_threads_on_update();

create or replace function public._chat_messages_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  author_role public.role_enum;
begin
  perform set_config('row_security', 'off', true);

  select p.role into author_role
  from public.profiles p
  where p.id = new.author_id;

  if author_role in ('agent','supervisor','admin') then
    update public.chat_threads t
    set first_response_at = coalesce(t.first_response_at, new.created_at)
    where t.id = new.thread_id;
  end if;

  perform public._chat_events_insert(new.thread_id, new.author_id, 'message', jsonb_build_object('message_id', new.id), new.created_at);

  return new;
end;
$$;

drop trigger if exists t_chat_messages_on_insert on public.chat_messages;
create trigger t_chat_messages_on_insert
after insert on public.chat_messages
for each row execute function public._chat_messages_on_insert();

create or replace function public.chat_set_presence(p_status text, p_capacity integer default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  dept uuid;
  st public.agent_presence_enum;
  cap integer;
begin
  perform set_config('row_security', 'off', true);
  uid := auth.uid();
  if uid is null then raise exception 'Not authenticated'; end if;

  if not public._has_role(array['agent','supervisor','admin']::public.role_enum[]) then
    raise exception 'forbidden';
  end if;

  select p.department_id into dept from public.profiles p where p.id = uid;
  if dept is null then raise exception 'department_required'; end if;

  case lower(coalesce(p_status,'')) 
    when 'disponible' then st := 'Disponible'::public.agent_presence_enum;
    when 'ocupado' then st := 'Ocupado'::public.agent_presence_enum;
    when 'ausente' then st := 'Ausente'::public.agent_presence_enum;
    when 'offline' then st := 'Offline'::public.agent_presence_enum;
    else raise exception 'invalid_status';
  end case;

  cap := coalesce(p_capacity, 3);

  insert into public.agent_presence (profile_id, department_id, status, capacity, updated_at)
  values (uid, dept, st, cap, now())
  on conflict (profile_id)
  do update set status = excluded.status, capacity = excluded.capacity, department_id = excluded.department_id, updated_at = now();
end;
$$;

revoke all on function public.chat_set_presence(text, integer) from public;
grant execute on function public.chat_set_presence(text, integer) to authenticated;

create or replace function public._chat_open_count(p_agent_id uuid)
returns integer
language sql
stable
as $$
  select count(*)::int
  from public.chat_threads t
  where t.assigned_agent_id = p_agent_id
    and t.status in ('Asignado','Activo');
$$;

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

create or replace function public.chat_request(
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
  tid uuid;
begin
  perform set_config('row_security', 'off', true);
  uid := auth.uid();
  if uid is null then raise exception 'Not authenticated'; end if;

  insert into public.chat_threads (requester_id, category_id, subcategory_id, subject, status)
  values (uid, p_category_id, p_subcategory_id, nullif(p_subject,''), 'En cola')
  returning id into tid;

  insert into public.chat_participants (thread_id, profile_id)
  values (tid, uid)
  on conflict (thread_id, profile_id) do nothing;

  if nullif(coalesce(p_initial_message,''), '') is not null then
    insert into public.chat_messages (thread_id, author_id, body)
    values (tid, uid, p_initial_message);
  end if;

  perform public.chat_auto_assign(tid);
  return tid;
end;
$$;

revoke all on function public.chat_request(text, uuid, uuid, text) from public;
grant execute on function public.chat_request(text, uuid, uuid, text) to authenticated;

create or replace function public.chat_take_thread(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  dept uuid;
  ok boolean;
begin
  perform set_config('row_security', 'off', true);
  uid := auth.uid();
  if uid is null then raise exception 'Not authenticated'; end if;
  if not public._has_role(array['agent','supervisor','admin']::public.role_enum[]) then raise exception 'forbidden'; end if;

  select p.department_id into dept from public.profiles p where p.id = uid;
  if dept is null then raise exception 'department_required'; end if;

  update public.chat_threads t
  set assigned_agent_id = uid,
      status = 'Activo',
      assigned_at = coalesce(t.assigned_at, now()),
      accepted_at = coalesce(t.accepted_at, now()),
      updated_at = now()
  where t.id = p_thread_id
    and t.department_id = dept
    and t.status in ('En cola','Asignado')
    and (t.assigned_agent_id is null or t.assigned_agent_id = uid)
  returning true into ok;

  if ok is distinct from true then
    raise exception 'not_available';
  end if;

  insert into public.chat_participants (thread_id, profile_id)
  values (p_thread_id, uid)
  on conflict (thread_id, profile_id) do nothing;
end;
$$;

revoke all on function public.chat_take_thread(uuid) from public;
grant execute on function public.chat_take_thread(uuid) to authenticated;

create or replace function public.chat_accept_thread(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  ok boolean;
begin
  perform set_config('row_security', 'off', true);
  uid := auth.uid();
  if uid is null then raise exception 'Not authenticated'; end if;
  if not public._has_role(array['agent','supervisor','admin']::public.role_enum[]) then raise exception 'forbidden'; end if;

  update public.chat_threads t
  set status = 'Activo',
      accepted_at = coalesce(t.accepted_at, now()),
      updated_at = now()
  where t.id = p_thread_id
    and t.assigned_agent_id = uid
    and t.status = 'Asignado'
  returning true into ok;

  if ok is distinct from true then
    raise exception 'not_available';
  end if;
end;
$$;

revoke all on function public.chat_accept_thread(uuid) from public;
grant execute on function public.chat_accept_thread(uuid) to authenticated;

create or replace function public.chat_assign_thread(p_thread_id uuid, p_agent_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  dept uuid;
begin
  perform set_config('row_security', 'off', true);
  uid := auth.uid();
  if uid is null then raise exception 'Not authenticated'; end if;
  if not public._has_role(array['supervisor','admin']::public.role_enum[]) then raise exception 'forbidden'; end if;

  select p.department_id into dept from public.profiles p where p.id = uid;
  if dept is null then raise exception 'department_required'; end if;

  update public.chat_threads t
  set assigned_agent_id = p_agent_id,
      status = case when t.status = 'Cerrado' then t.status else 'Asignado' end,
      assigned_at = now(),
      accepted_at = null,
      updated_at = now()
  where t.id = p_thread_id
    and t.department_id = dept
    and t.status <> 'Cerrado';

  insert into public.chat_participants (thread_id, profile_id)
  values (p_thread_id, p_agent_id)
  on conflict (thread_id, profile_id) do nothing;
end;
$$;

revoke all on function public.chat_assign_thread(uuid, uuid) from public;
grant execute on function public.chat_assign_thread(uuid, uuid) to authenticated;

create or replace function public.chat_send_message(p_thread_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  tid uuid;
  mid uuid;
  st public.chat_status_enum;
  req uuid;
  ass uuid;
  me_role public.role_enum;
  clean text;
begin
  perform set_config('row_security', 'off', true);
  uid := auth.uid();
  if uid is null then raise exception 'Not authenticated'; end if;

  select t.id, t.status, t.requester_id, t.assigned_agent_id into tid, st, req, ass
  from public.chat_threads t
  where t.id = p_thread_id;

  if tid is null then raise exception 'not_found'; end if;
  if st = 'Cerrado' then raise exception 'closed'; end if;

  select p.role into me_role from public.profiles p where p.id = uid;

  if uid = req then
    null;
  elsif uid = ass then
    null;
  elsif me_role in ('supervisor','admin') then
    null;
  else
    raise exception 'forbidden';
  end if;

  clean := nullif(trim(coalesce(p_body,'')), '');
  if clean is null then
    raise exception 'empty_message';
  end if;

  insert into public.chat_messages (thread_id, author_id, body)
  values (tid, uid, clean)
  returning id into mid;

  return mid;
end;
$$;

revoke all on function public.chat_send_message(uuid, text) from public;
grant execute on function public.chat_send_message(uuid, text) to authenticated;

create or replace function public.chat_close_thread(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  req uuid;
  ass uuid;
  me_role public.role_enum;
begin
  perform set_config('row_security', 'off', true);
  uid := auth.uid();
  if uid is null then raise exception 'Not authenticated'; end if;

  select t.requester_id, t.assigned_agent_id into req, ass
  from public.chat_threads t
  where t.id = p_thread_id;

  if req is null then raise exception 'not_found'; end if;
  select p.role into me_role from public.profiles p where p.id = uid;

  if not (uid = req or uid = ass or me_role in ('supervisor','admin')) then
    raise exception 'forbidden';
  end if;

  update public.chat_threads
  set status = 'Cerrado',
      closed_at = coalesce(closed_at, now()),
      closed_by = uid,
      updated_at = now()
  where id = p_thread_id;
end;
$$;

revoke all on function public.chat_close_thread(uuid) from public;
grant execute on function public.chat_close_thread(uuid) to authenticated;

alter table public.skills enable row level security;
alter table public.agent_skills enable row level security;
alter table public.agent_presence enable row level security;
alter table public.chat_threads enable row level security;
alter table public.chat_participants enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_events enable row level security;

drop policy if exists skills_select_visible on public.skills;
create policy skills_select_visible on public.skills
for select to authenticated
using (
  (category_id is null or public._same_department((select c.department_id from public.categories c where c.id = skills.category_id)))
  or public._is_role('admin')
);

drop policy if exists skills_write_admin on public.skills;
create policy skills_write_admin on public.skills
for all to authenticated
using (public._has_role(array['supervisor','admin']::public.role_enum[]))
with check (public._has_role(array['supervisor','admin']::public.role_enum[]));

drop policy if exists agent_skills_select_visible on public.agent_skills;
create policy agent_skills_select_visible on public.agent_skills
for select to authenticated
using (
  profile_id = auth.uid()
  or public._has_role(array['supervisor','admin']::public.role_enum[])
);

drop policy if exists agent_skills_write_admin on public.agent_skills;
create policy agent_skills_write_admin on public.agent_skills
for all to authenticated
using (public._has_role(array['supervisor','admin']::public.role_enum[]))
with check (public._has_role(array['supervisor','admin']::public.role_enum[]));

drop policy if exists agent_presence_select_visible on public.agent_presence;
create policy agent_presence_select_visible on public.agent_presence
for select to authenticated
using (
  profile_id = auth.uid()
  or public._has_role(array['supervisor','admin']::public.role_enum[])
);

drop policy if exists agent_presence_write_self on public.agent_presence;
create policy agent_presence_write_self on public.agent_presence
for all to authenticated
using (profile_id = auth.uid())
with check (profile_id = auth.uid());

drop policy if exists chat_threads_select_visible on public.chat_threads;
create policy chat_threads_select_visible on public.chat_threads
for select to authenticated
using (
  requester_id = auth.uid()
  or (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
);

drop policy if exists chat_threads_insert_requester on public.chat_threads;
create policy chat_threads_insert_requester on public.chat_threads
for insert to authenticated
with check (requester_id = auth.uid());

drop policy if exists chat_threads_update_none on public.chat_threads;
create policy chat_threads_update_none on public.chat_threads
for update to authenticated
using (false)
with check (false);

drop policy if exists chat_participants_select_visible on public.chat_participants;
create policy chat_participants_select_visible on public.chat_participants
for select to authenticated
using (
  exists (
    select 1 from public.chat_threads t
    where t.id = chat_participants.thread_id
      and (
        t.requester_id = auth.uid()
        or (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(t.department_id))
        or public._is_role('admin')
      )
  )
);

drop policy if exists chat_participants_insert_none on public.chat_participants;
create policy chat_participants_insert_none on public.chat_participants
for insert to authenticated
with check (false);

drop policy if exists chat_participants_update_none on public.chat_participants;
create policy chat_participants_update_none on public.chat_participants
for update to authenticated
using (false)
with check (false);

drop policy if exists chat_messages_select_visible on public.chat_messages;
create policy chat_messages_select_visible on public.chat_messages
for select to authenticated
using (
  exists (
    select 1 from public.chat_threads t
    where t.id = chat_messages.thread_id
      and (
        t.requester_id = auth.uid()
        or (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(t.department_id))
        or public._is_role('admin')
      )
  )
);

drop policy if exists chat_messages_insert_none on public.chat_messages;
create policy chat_messages_insert_none on public.chat_messages
for insert to authenticated
with check (false);

drop policy if exists chat_events_select_visible on public.chat_events;
create policy chat_events_select_visible on public.chat_events
for select to authenticated
using (
  exists (
    select 1 from public.chat_threads t
    where t.id = chat_events.thread_id
      and (
        t.requester_id = auth.uid()
        or (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(t.department_id))
        or public._is_role('admin')
      )
  )
);

drop policy if exists chat_events_insert_none on public.chat_events;
create policy chat_events_insert_none on public.chat_events
for insert to authenticated
with check (false);

commit;

begin;

-- Seed: skills por categoría (TI) + presencia por defecto para agentes/supervisores.
insert into public.skills (key, name, description, category_id)
select
  lower(regexp_replace(c.name, '[^a-zA-Z0-9]+', '_', 'g')) as key,
  c.name,
  coalesce(c.description, '') as description,
  c.id as category_id
from public.categories c
where c.department_id = '11111111-1111-1111-1111-111111111111'::uuid
on conflict do nothing;

insert into public.agent_presence (profile_id, department_id, status, capacity)
select p.id, p.department_id, 'Offline'::public.agent_presence_enum, 3
from public.profiles p
where p.role in ('agent','supervisor')
  and p.department_id is not null
on conflict (profile_id) do nothing;

commit;

-- ---------------------------------------------------------------------
-- Analytics BI: KPIs y series de tiempo de chats
-- ---------------------------------------------------------------------

begin;

create or replace function public.kpi_chat_dashboard(
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
  created_count bigint;
  closed_count bigint;
  backlog_open bigint;
  active_open bigint;
  avg_take_minutes numeric;
  avg_first_response_minutes numeric;
  avg_resolution_minutes numeric;
  workload jsonb;
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

  select count(*) into created_count
  from public.chat_threads t
  where t.department_id = dept_id
    and t.created_at >= p_start and t.created_at < p_end
    and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  select count(*) into closed_count
  from public.chat_threads t
  where t.department_id = dept_id
    and t.status = 'Cerrado'
    and t.closed_at is not null
    and t.closed_at >= p_start and t.closed_at < p_end
    and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  select count(*) into backlog_open
  from public.chat_threads t
  where t.department_id = dept_id
    and t.status in ('En cola','Asignado')
    and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  select count(*) into active_open
  from public.chat_threads t
  where t.department_id = dept_id
    and t.status = 'Activo'
    and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  select avg(extract(epoch from (t.accepted_at - t.created_at)) / 60.0) into avg_take_minutes
  from public.chat_threads t
  where t.department_id = dept_id
    and t.accepted_at is not null
    and t.created_at >= p_start and t.created_at < p_end
    and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  select avg(extract(epoch from (t.first_response_at - t.created_at)) / 60.0) into avg_first_response_minutes
  from public.chat_threads t
  where t.department_id = dept_id
    and t.first_response_at is not null
    and t.created_at >= p_start and t.created_at < p_end
    and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  select avg(extract(epoch from (t.closed_at - t.created_at)) / 60.0) into avg_resolution_minutes
  from public.chat_threads t
  where t.department_id = dept_id
    and t.status = 'Cerrado'
    and t.closed_at is not null
    and t.closed_at >= p_start and t.closed_at < p_end
    and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into workload
  from (
    select
      p.id as agent_id,
      coalesce(p.full_name, p.email) as agent_name,
      count(t.id) as open_assigned
    from public.profiles p
    left join public.chat_threads t
      on t.assigned_agent_id = p.id
     and t.department_id = dept_id
     and t.status in ('Asignado','Activo')
    where p.role in ('agent','supervisor')
      and p.department_id = dept_id
    group by p.id, p.full_name, p.email
    order by open_assigned desc
    limit 20
  ) x;

  return jsonb_build_object(
    'range', jsonb_build_object('start', p_start, 'end', p_end),
    'volume', jsonb_build_object('created', created_count, 'closed', closed_count),
    'backlog_open', backlog_open,
    'active_open', active_open,
    'avg_take_minutes', round(coalesce(avg_take_minutes, 0)::numeric, 2),
    'avg_first_response_minutes', round(coalesce(avg_first_response_minutes, 0)::numeric, 2),
    'avg_resolution_minutes', round(coalesce(avg_resolution_minutes, 0)::numeric, 2),
    'workload', workload
  );
end;
$$;

revoke all on function public.kpi_chat_dashboard(timestamptz, timestamptz, uuid, uuid) from public;
grant execute on function public.kpi_chat_dashboard(timestamptz, timestamptz, uuid, uuid) to authenticated;

create or replace function public.kpi_chat_timeseries(
  p_start timestamptz,
  p_end timestamptz,
  p_bucket text,
  p_agent_id uuid default null,
  p_category_id uuid default null
)
returns jsonb
language plpgsql
stable
as $$
declare
  dept_id uuid;
  step interval;
  bucket text;
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

  bucket := lower(coalesce(p_bucket, 'day'));
  if bucket not in ('hour','day','week','month') then
    raise exception 'invalid_bucket';
  end if;

  step := case bucket
    when 'hour' then interval '1 hour'
    when 'day' then interval '1 day'
    when 'week' then interval '1 week'
    else interval '1 month'
  end;

  return (
    with
      series as (
        select generate_series(date_trunc(bucket, p_start), date_trunc(bucket, p_end), step) as b
      ),
      created as (
        select date_trunc(bucket, t.created_at) as b, count(*)::int as created
        from public.chat_threads t
        where t.department_id = dept_id
          and t.created_at >= p_start and t.created_at < p_end
          and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
          and (p_category_id is null or t.category_id = p_category_id)
        group by 1
      ),
      closed as (
        select date_trunc(bucket, t.closed_at) as b, count(*)::int as closed
        from public.chat_threads t
        where t.department_id = dept_id
          and t.status = 'Cerrado'
          and t.closed_at is not null
          and t.closed_at >= p_start and t.closed_at < p_end
          and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
          and (p_category_id is null or t.category_id = p_category_id)
        group by 1
      ),
      response as (
        select date_trunc(bucket, t.created_at) as b,
               round(avg(extract(epoch from (t.first_response_at - t.created_at)) / 60.0), 2) as avg_first_response_minutes
        from public.chat_threads t
        where t.department_id = dept_id
          and t.created_at >= p_start and t.created_at < p_end
          and t.first_response_at is not null
          and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
          and (p_category_id is null or t.category_id = p_category_id)
        group by 1
      ),
      resolution as (
        select date_trunc(bucket, t.closed_at) as b,
               round(avg(extract(epoch from (t.closed_at - t.created_at)) / 60.0), 2) as avg_resolution_minutes
        from public.chat_threads t
        where t.department_id = dept_id
          and t.status = 'Cerrado'
          and t.closed_at is not null
          and t.closed_at >= p_start and t.closed_at < p_end
          and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
          and (p_category_id is null or t.category_id = p_category_id)
        group by 1
      )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'bucket', s.b,
          'created', coalesce(c.created, 0),
          'closed', coalesce(cl.closed, 0),
          'avg_first_response_minutes', r.avg_first_response_minutes,
          'avg_resolution_minutes', rs.avg_resolution_minutes
        )
        order by s.b
      ),
      '[]'::jsonb
    )
    from series s
    left join created c on c.b = s.b
    left join closed cl on cl.b = s.b
    left join response r on r.b = s.b
    left join resolution rs on rs.b = s.b
  );
end;
$$;

revoke all on function public.kpi_chat_timeseries(timestamptz, timestamptz, text, uuid, uuid) from public;
grant execute on function public.kpi_chat_timeseries(timestamptz, timestamptz, text, uuid, uuid) to authenticated;

commit;

-- -----------------------------------------------------------------------------
-- Optional: enable Supabase Realtime (postgres_changes) for core tables.
-- This is safe to run; it only adds tables if the publication exists and the
-- table is not already included.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'Publication supabase_realtime not found; skipping realtime setup.';
    RETURN;
  END IF;

  PERFORM 1
  FROM pg_publication_rel pr
  JOIN pg_publication p ON p.oid = pr.prpubid
  JOIN pg_class c ON c.oid = pr.prrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public' AND c.relname = 'tickets';
  IF NOT FOUND THEN
    EXECUTE 'alter publication supabase_realtime add table public.tickets';
  END IF;

  PERFORM 1
  FROM pg_publication_rel pr
  JOIN pg_publication p ON p.oid = pr.prpubid
  JOIN pg_class c ON c.oid = pr.prrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public' AND c.relname = 'comments';
  IF NOT FOUND THEN
    EXECUTE 'alter publication supabase_realtime add table public.comments';
  END IF;

  PERFORM 1
  FROM pg_publication_rel pr
  JOIN pg_publication p ON p.oid = pr.prpubid
  JOIN pg_class c ON c.oid = pr.prrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public' AND c.relname = 'knowledge_base';
  IF NOT FOUND THEN
    EXECUTE 'alter publication supabase_realtime add table public.knowledge_base';
  END IF;

  PERFORM 1
  FROM pg_publication_rel pr
  JOIN pg_publication p ON p.oid = pr.prpubid
  JOIN pg_class c ON c.oid = pr.prrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public' AND c.relname = 'ticket_approvals';
  IF NOT FOUND THEN
    EXECUTE 'alter publication supabase_realtime add table public.ticket_approvals';
  END IF;

  PERFORM 1
  FROM pg_publication_rel pr
  JOIN pg_publication p ON p.oid = pr.prpubid
  JOIN pg_class c ON c.oid = pr.prrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public' AND c.relname = 'ticket_events';
  IF NOT FOUND THEN
    EXECUTE 'alter publication supabase_realtime add table public.ticket_events';
  END IF;

  PERFORM 1
  FROM pg_publication_rel pr
  JOIN pg_publication p ON p.oid = pr.prpubid
  JOIN pg_class c ON c.oid = pr.prrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public' AND c.relname = 'chat_threads';
  IF NOT FOUND THEN
    EXECUTE 'alter publication supabase_realtime add table public.chat_threads';
  END IF;

  PERFORM 1
  FROM pg_publication_rel pr
  JOIN pg_publication p ON p.oid = pr.prpubid
  JOIN pg_class c ON c.oid = pr.prrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public' AND c.relname = 'chat_messages';
  IF NOT FOUND THEN
    EXECUTE 'alter publication supabase_realtime add table public.chat_messages';
  END IF;

  PERFORM 1
  FROM pg_publication_rel pr
  JOIN pg_publication p ON p.oid = pr.prpubid
  JOIN pg_class c ON c.oid = pr.prrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public' AND c.relname = 'chat_events';
  IF NOT FOUND THEN
    EXECUTE 'alter publication supabase_realtime add table public.chat_events';
  END IF;
END $$;
