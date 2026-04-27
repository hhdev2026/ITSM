-- ITSM / Gestion de Ticket HP - Setup completo Supabase
-- Ejecutar una sola vez en Supabase SQL Editor.


-- ============================================================
-- 001_init.sql
-- ============================================================
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

-- ============================================================
-- 002_analytics.sql
-- ============================================================
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

-- ============================================================
-- 003_profiles_rls.sql
-- ============================================================
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

-- ============================================================
-- 004_subcategories.sql
-- ============================================================
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

-- ============================================================
-- 005_ticket_metadata.sql
-- ============================================================
begin;

alter table public.tickets add column if not exists metadata jsonb not null default '{}'::jsonb;
create index if not exists tickets_metadata_gin_idx on public.tickets using gin (metadata);

commit;

-- ============================================================
-- 006_service_catalog.sql
-- ============================================================
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

-- ============================================================
-- 007_approvals_and_service_targets.sql
-- ============================================================
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

-- ============================================================
-- 008_ticket_approvals_role_select.sql
-- ============================================================
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

-- ============================================================
-- 009_default_department_on_signup.sql
-- ============================================================
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

-- ============================================================
-- 010_ticket_events_and_trends.sql
-- ============================================================
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

-- ============================================================
-- 011_chat_channels.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Chat (canal interno): hilos, mensajes, eventos, presencia y skills
-- ---------------------------------------------------------------------

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

-- Allow multiple skills per category (drop accidental unique, if present)
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

-- Touch updated_at
drop trigger if exists t_skills_touch on public.skills;
create trigger t_skills_touch before update on public.skills for each row execute function public._touch_updated_at();

drop trigger if exists t_agent_skills_touch on public.agent_skills;
create trigger t_agent_skills_touch before update on public.agent_skills for each row execute function public._touch_updated_at();

drop trigger if exists t_agent_presence_touch on public.agent_presence;
create trigger t_agent_presence_touch before update on public.agent_presence for each row execute function public._touch_updated_at();

drop trigger if exists t_chat_threads_touch on public.chat_threads;
-- Chat threads updated_at is controlled by workflow functions/triggers; keep single source of truth.

-- Department enforcement (chat thread inherits requester's department)
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

-- Events + timestamps on thread changes
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

-- First response timestamp: first message from agent/supervisor/admin
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

-- ---------------------------------------------------------------------
-- RPCs (operación de chat)
-- ---------------------------------------------------------------------

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
  agent uuid;
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

  agent := public.chat_auto_assign(tid);
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

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

alter table public.skills enable row level security;
alter table public.agent_skills enable row level security;
alter table public.agent_presence enable row level security;
alter table public.chat_threads enable row level security;
alter table public.chat_participants enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_events enable row level security;

-- Skills
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

-- Agent skills
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

-- Presence (self manage + supervisors/admin)
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

-- Threads: requester sees own, agents/supervisors see dept, admin all
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

-- Participants: read if can read thread; writes denied (handled by SECURITY DEFINER)
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

-- Messages: read if can read thread; writes denied (handled by SECURITY DEFINER)
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

-- Events: read if can read thread; writes denied
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

-- ============================================================
-- 012_chat_analytics.sql
-- ============================================================
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

  -- avg take time (minutes): accepted_at - created_at
  select avg(extract(epoch from (t.accepted_at - t.created_at)) / 60.0) into avg_take_minutes
  from public.chat_threads t
  where t.department_id = dept_id
    and t.accepted_at is not null
    and t.created_at >= p_start and t.created_at < p_end
    and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- avg first response (minutes): first_response_at - created_at
  select avg(extract(epoch from (t.first_response_at - t.created_at)) / 60.0) into avg_first_response_minutes
  from public.chat_threads t
  where t.department_id = dept_id
    and t.first_response_at is not null
    and t.created_at >= p_start and t.created_at < p_end
    and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- avg resolution (minutes): closed_at - created_at
  select avg(extract(epoch from (t.closed_at - t.created_at)) / 60.0) into avg_resolution_minutes
  from public.chat_threads t
  where t.department_id = dept_id
    and t.status = 'Cerrado'
    and t.closed_at is not null
    and t.closed_at >= p_start and t.closed_at < p_end
    and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- Workload snapshot: open chats assigned per agent
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

-- ============================================================
-- 013_tasks.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Tasks: bandeja de tareas operativas (por ticket/chat/general)
-- ---------------------------------------------------------------------

do $$ begin
  create type public.task_status_enum as enum ('Pendiente', 'En curso', 'Completada', 'Cancelada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_kind_enum as enum ('ticket', 'chat', 'approval', 'general');
exception when duplicate_object then null; end $$;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments (id) on delete cascade,
  kind public.task_kind_enum not null default 'general',
  title text not null,
  description text,
  ticket_id uuid references public.tickets (id) on delete set null,
  chat_thread_id uuid references public.chat_threads (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  assignee_id uuid not null references public.profiles (id) on delete cascade,
  status public.task_status_enum not null default 'Pendiente',
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists tasks_assignee_status_idx on public.tasks (assignee_id, status, due_at nulls last, created_at desc);
create index if not exists tasks_dept_status_idx on public.tasks (department_id, status, due_at nulls last);
create index if not exists tasks_ticket_idx on public.tasks (ticket_id);
create index if not exists tasks_chat_idx on public.tasks (chat_thread_id);

alter table public.tasks enable row level security;

drop trigger if exists t_tasks_touch on public.tasks;
create trigger t_tasks_touch before update on public.tasks
for each row execute function public._touch_updated_at();

create or replace function public._tasks_set_dept_and_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dept uuid;
begin
  perform set_config('row_security', 'off', true);

  if new.department_id is null then
    select p.department_id into dept
    from public.profiles p
    where p.id = new.assignee_id;
    if dept is null then
      raise exception 'assignee_department_required';
    end if;
    new.department_id := dept;
  end if;

  if tg_op = 'UPDATE' then
    if new.status = 'Completada' and old.status is distinct from 'Completada' then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
    if new.status <> 'Completada' and old.status = 'Completada' then
      new.completed_at := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists t_tasks_set_dept_completed on public.tasks;
create trigger t_tasks_set_dept_completed
before insert or update of status, assignee_id, department_id on public.tasks
for each row execute function public._tasks_set_dept_and_completed();

-- RLS: read for assignee + dept agents + admin
drop policy if exists tasks_select_visible on public.tasks;
create policy tasks_select_visible on public.tasks
for select to authenticated
using (
  assignee_id = auth.uid()
  or (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
);

-- Insert: allow self tasks or supervisor/admin in dept
drop policy if exists tasks_insert_visible on public.tasks;
create policy tasks_insert_visible on public.tasks
for insert to authenticated
with check (
  (assignee_id = auth.uid())
  or (
    public._has_role(array['supervisor','admin']::public.role_enum[])
    and public._same_department((select department_id from public.profiles where id = assignee_id))
  )
  or public._is_role('admin')
);

-- Update: assignee or supervisor/admin in dept
drop policy if exists tasks_update_visible on public.tasks;
create policy tasks_update_visible on public.tasks
for update to authenticated
using (
  assignee_id = auth.uid()
  or (
    public._has_role(array['supervisor','admin']::public.role_enum[])
    and public._same_department(department_id)
  )
  or public._is_role('admin')
)
with check (
  assignee_id = auth.uid()
  or (
    public._has_role(array['supervisor','admin']::public.role_enum[])
    and public._same_department(department_id)
  )
  or public._is_role('admin')
);

commit;

-- ============================================================
-- 014_fix_chat_auto_assign.sql
-- ============================================================
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

-- ============================================================
-- 015_service_catalog_user_friendly.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Service Catalog UX: user-friendly names/descriptions + keywords
-- (para que el solicitante vea "problemas" y TI vea el servicio interno)
-- ---------------------------------------------------------------------

alter table public.service_catalog_items add column if not exists user_name text;
alter table public.service_catalog_items add column if not exists user_description text;
alter table public.service_catalog_items add column if not exists keywords text[] not null default '{}'::text[];

create index if not exists service_catalog_items_keywords_gin_idx on public.service_catalog_items using gin (keywords);

-- Backfill (solo si no hay valores definidos)
update public.service_catalog_items
set
  user_name = 'No puedo iniciar sesión / olvidé mi contraseña',
  user_description = 'Recupera el acceso a tu cuenta (restablecer contraseña, bloqueo, MFA).',
  keywords = array['contraseña','password','login','inicio de sesión','bloqueado','mfa','2fa','reset','cuenta bloqueada']
where name = 'Reset de contraseña'
  and (user_name is null or user_name = '')
  and (keywords = '{}'::text[]);

update public.service_catalog_items
set
  user_name = 'Necesito acceso a una aplicación o carpeta',
  user_description = 'Solicita permisos, roles o acceso a recursos.',
  keywords = array['permisos','acceso','roles','carpeta','grupo','app','aplicación','shared','sharepoint']
where name = 'Solicitud de permisos'
  and (user_name is null or user_name = '')
  and (keywords = '{}'::text[]);

update public.service_catalog_items
set
  user_name = 'Crear cuenta de usuario (Onboarding)',
  user_description = 'Alta de usuario y accesos iniciales para un nuevo ingreso.',
  keywords = array['alta','crear usuario','onboarding','nuevo ingreso','cuenta nueva','accesos']
where name = 'Alta de usuario'
  and (user_name is null or user_name = '')
  and (keywords = '{}'::text[]);

update public.service_catalog_items
set
  user_name = 'Desactivar cuenta (Offboarding)',
  user_description = 'Baja de usuario: bloqueo, respaldos y cierre de accesos.',
  keywords = array['baja','offboarding','desactivar','bloquear','retiro','salida','respaldo']
where name = 'Baja de usuario'
  and (user_name is null or user_name = '')
  and (keywords = '{}'::text[]);

update public.service_catalog_items
set
  user_name = 'No puedo enviar o recibir correos',
  user_description = 'Problemas de correo (envío/recepción/sincronización).',
  keywords = array['correo','mail','outlook','no llegan','no envía','no recibe','sincroniza','buzón','owa']
where name = 'Correo no sincroniza'
  and (user_name is null or user_name = '')
  and (keywords = '{}'::text[]);

update public.service_catalog_items
set
  user_name = 'No puedo conectarme por VPN',
  user_description = 'Acceso remoto: VPN no conecta o falla autenticación.',
  keywords = array['vpn','remoto','acceso remoto','anyconnect','forticlient','conexión','no conecta']
where name = 'VPN no conecta'
  and (user_name is null or user_name = '')
  and (keywords = '{}'::text[]);

update public.service_catalog_items
set
  user_name = 'No tengo internet / Wi‑Fi no funciona',
  user_description = 'Conectividad: Wi‑Fi / red / navegación.',
  keywords = array['internet','wifi','wi-fi','red','no navega','sin conexión','lan','cable','dns']
where name = 'Problema WiFi'
  and (user_name is null or user_name = '')
  and (keywords = '{}'::text[]);

update public.service_catalog_items
set
  user_name = 'La impresora no imprime',
  user_description = 'Problemas de impresión, cola, drivers o conectividad.',
  keywords = array['impresora','imprimir','cola','driver','atasco','tinta','scanner']
where name = 'Impresora no imprime'
  and (user_name is null or user_name = '')
  and (keywords = '{}'::text[]);

update public.service_catalog_items
set
  user_name = 'Necesito un nuevo equipo (PC/Laptop)',
  user_description = 'Solicitud de equipo o accesorios (laptop/pc/monitor/docking).',
  keywords = array['equipo','laptop','notebook','pc','computador','monitor','docking','accesorios','nuevo equipo']
where name = 'Nuevo equipo'
  and (user_name is null or user_name = '')
  and (keywords = '{}'::text[]);

update public.service_catalog_items
set
  user_name = 'Instalar o actualizar software',
  user_description = 'Instalación/actualización de aplicaciones.',
  keywords = array['instalar','software','actualizar','programa','aplicación','setup','error instalación']
where name = 'Instalar software'
  and (user_name is null or user_name = '')
  and (keywords = '{}'::text[]);

update public.service_catalog_items
set
  user_name = 'Licencias / activación de software',
  user_description = 'Solicita asignación o activación de licencias.',
  keywords = array['licencia','activar','activación','suscripción','office','visio','project','serial']
where name = 'Licencias / Activación'
  and (user_name is null or user_name = '')
  and (keywords = '{}'::text[]);

update public.service_catalog_items
set
  user_name = 'Reportar correo sospechoso (phishing)',
  user_description = 'Reporte de seguridad: phishing, enlaces o adjuntos sospechosos.',
  keywords = array['phishing','correo sospechoso','seguridad','malware','virus','enlace','adjunto','fraude']
where name = 'Reporte de phishing'
  and (user_name is null or user_name = '')
  and (keywords = '{}'::text[]);

update public.service_catalog_items
set
  user_name = 'Problemas con Microsoft Teams',
  user_description = 'Reuniones, llamadas, audio/video, chat o canales.',
  keywords = array['teams','audio','video','reunión','llamada','micrófono','cámara','pantalla']
where name = 'Microsoft Teams'
  and (user_name is null or user_name = '')
  and (keywords = '{}'::text[]);

update public.service_catalog_items
set
  user_name = 'Problemas con telefonía / softphone',
  user_description = 'Softphone: login, registro, audio, extensión.',
  keywords = array['softphone','telefonía','extensión','llamadas','no registra','sin audio','voicemail']
where name = 'Softphone'
  and (user_name is null or user_name = '')
  and (keywords = '{}'::text[]);

update public.service_catalog_items
set
  user_name = 'Problemas con aplicaciones (ERP/CRM)',
  user_description = 'Acceso o errores en aplicaciones corporativas (ERP/CRM).',
  keywords = array['erp','crm','sap','salesforce','aplicación','error','acceso','lento']
where name = 'ERP/CRM'
  and (user_name is null or user_name = '')
  and (keywords = '{}'::text[]);

commit;

-- ============================================================
-- 016_chat_reporting.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Chat reporting: breakdowns + tops for admin/supervisor dashboards
-- ---------------------------------------------------------------------

create or replace function public.kpi_chat_report(
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

  return jsonb_build_object(
    'range', jsonb_build_object('start', p_start, 'end', p_end),

    'top_requesters',
    (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      from (
        select
          t.requester_id,
          coalesce(p.full_name, p.email) as requester_name,
          count(*)::int as created_count
        from public.chat_threads t
        join public.profiles p on p.id = t.requester_id
        where t.department_id = dept_id
          and t.created_at >= p_start and t.created_at < p_end
          and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
          and (p_category_id is null or t.category_id = p_category_id)
        group by t.requester_id, p.full_name, p.email
        order by created_count desc, requester_name asc
        limit 10
      ) x
    ),

    'top_agents',
    (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      from (
        select
          t.assigned_agent_id as agent_id,
          coalesce(a.full_name, a.email) as agent_name,
          count(*)::int as closed_count,
          round(avg(extract(epoch from (t.accepted_at - t.created_at)) / 60.0)::numeric, 2) as avg_take_minutes,
          round(avg(extract(epoch from (t.first_response_at - t.created_at)) / 60.0)::numeric, 2) as avg_first_response_minutes,
          round(avg(extract(epoch from (t.closed_at - t.created_at)) / 60.0)::numeric, 2) as avg_resolution_minutes
        from public.chat_threads t
        join public.profiles a on a.id = t.assigned_agent_id
        where t.department_id = dept_id
          and t.status = 'Cerrado'
          and t.closed_at is not null
          and t.closed_at >= p_start and t.closed_at < p_end
          and t.assigned_agent_id is not null
          and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
          and (p_category_id is null or t.category_id = p_category_id)
        group by t.assigned_agent_id, a.full_name, a.email
        order by closed_count desc, avg_resolution_minutes asc nulls last, agent_name asc
        limit 10
      ) x
    ),

    'by_category',
    (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      from (
        select
          t.category_id,
          coalesce(c.name, 'Sin categoría') as category_name,
          count(*)::int as created_count,
          count(*) filter (where t.status = 'Cerrado' and t.closed_at is not null)::int as closed_count,
          round(avg(extract(epoch from (t.closed_at - t.created_at)) / 60.0)::numeric, 2) as avg_resolution_minutes
        from public.chat_threads t
        left join public.categories c on c.id = t.category_id
        where t.department_id = dept_id
          and t.created_at >= p_start and t.created_at < p_end
          and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
          and (p_category_id is null or t.category_id = p_category_id)
        group by t.category_id, c.name
        order by created_count desc, category_name asc
        limit 12
      ) x
    ),

    'by_subcategory',
    (
      select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      from (
        select
          t.subcategory_id,
          coalesce(sc.name, 'Sin subcategoría') as subcategory_name,
          count(*)::int as created_count,
          count(*) filter (where t.status = 'Cerrado' and t.closed_at is not null)::int as closed_count
        from public.chat_threads t
        left join public.subcategories sc on sc.id = t.subcategory_id
        where t.department_id = dept_id
          and t.created_at >= p_start and t.created_at < p_end
          and (p_agent_id is null or t.assigned_agent_id = p_agent_id)
          and (p_category_id is null or t.category_id = p_category_id)
        group by t.subcategory_id, sc.name
        order by created_count desc, subcategory_name asc
        limit 12
      ) x
    )
  );
end;
$$;

revoke all on function public.kpi_chat_report(timestamptz, timestamptz, uuid, uuid) from public;
grant execute on function public.kpi_chat_report(timestamptz, timestamptz, uuid, uuid) to authenticated;

commit;

-- ============================================================
-- 017_sla_business_hours.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- SLA v2: horas hábiles (calendarios) + pausas (Planificado) + exclusiones
-- Nota sobre retroactividad:
-- - Por defecto, los cambios de configuración NO son retroactivos porque los
--   deadlines se calculan y almacenan al crear el ticket.
-- - Este despliegue recalcula SOLO tickets abiertos para alinearlos al nuevo
--   motor de horas hábiles (histórico cerrado queda intacto).
-- ---------------------------------------------------------------------

-- Ticket statuses: Planificado/Cancelado
do $$ begin
  alter type public.ticket_status_enum add value if not exists 'Planificado';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.ticket_status_enum add value if not exists 'Cancelado';
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Business calendars (por departamento) + feriados
-- ---------------------------------------------------------------------

create table if not exists public.business_calendars (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments (id) on delete cascade,
  name text not null,
  timezone text not null default 'America/Santiago',
  work_start time not null default '08:00',
  work_end time not null default '18:00',
  work_days smallint[] not null default array[1,2,3,4,5], -- ISO DOW: 1..7 (lun..dom)
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, name)
);

create index if not exists business_calendars_dept_active_idx on public.business_calendars (department_id, is_active);

create table if not exists public.business_holidays (
  calendar_id uuid not null references public.business_calendars (id) on delete cascade,
  holiday_date date not null,
  name text,
  -- Permite excepciones: si is_working=true, ese día se considera hábil aunque sea fin de semana.
  is_working boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (calendar_id, holiday_date)
);

create index if not exists business_holidays_date_idx on public.business_holidays (holiday_date);

alter table public.business_calendars enable row level security;
alter table public.business_holidays enable row level security;

drop trigger if exists t_business_calendars_touch on public.business_calendars;
create trigger t_business_calendars_touch before update on public.business_calendars
for each row execute function public._touch_updated_at();

-- Calendars: select para usuarios del depto, write supervisor/admin.
drop policy if exists business_calendars_select on public.business_calendars;
create policy business_calendars_select on public.business_calendars
for select to authenticated
using (
  (department_id is null or public._same_department(department_id))
  or public._is_role('admin')
);

drop policy if exists business_calendars_write on public.business_calendars;
create policy business_calendars_write on public.business_calendars
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and (department_id is null or public._same_department(department_id))
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and (department_id is null or public._same_department(department_id))
);

drop policy if exists business_holidays_select on public.business_holidays;
create policy business_holidays_select on public.business_holidays
for select to authenticated
using (
  exists (
    select 1
    from public.business_calendars c
    where c.id = business_holidays.calendar_id
      and ((c.department_id is null or public._same_department(c.department_id)) or public._is_role('admin'))
  )
);

drop policy if exists business_holidays_write on public.business_holidays;
create policy business_holidays_write on public.business_holidays
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and exists (
    select 1
    from public.business_calendars c
    where c.id = business_holidays.calendar_id
      and (c.department_id is null or public._same_department(c.department_id))
  )
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and exists (
    select 1
    from public.business_calendars c
    where c.id = business_holidays.calendar_id
      and (c.department_id is null or public._same_department(c.department_id))
  )
);

-- Departments: default calendar
alter table public.departments add column if not exists business_calendar_id uuid references public.business_calendars (id);
create index if not exists departments_business_calendar_idx on public.departments (business_calendar_id);

-- Create/assign a default calendar per department (if missing)
do $$
declare
  d record;
  cid uuid;
begin
  for d in select id, name from public.departments loop
    if (select business_calendar_id from public.departments where id = d.id) is null then
      insert into public.business_calendars (department_id, name)
      values (d.id, 'Horario estándar')
      returning id into cid;
      update public.departments set business_calendar_id = cid where id = d.id;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Business time functions
-- ---------------------------------------------------------------------

create or replace function public._calendar_for_department(_dept uuid)
returns uuid
language sql
stable
as $$
  select d.business_calendar_id
  from public.departments d
  where d.id = _dept;
$$;

create or replace function public._business_is_working_day(_calendar_id uuid, _day date)
returns boolean
language plpgsql
stable
as $$
declare
  c public.business_calendars;
  hol public.business_holidays;
  dow smallint;
begin
  select * into c from public.business_calendars where id = _calendar_id;
  if c.id is null then
    return false;
  end if;

  select * into hol
  from public.business_holidays h
  where h.calendar_id = _calendar_id
    and h.holiday_date = _day;

  if hol.calendar_id is not null then
    return hol.is_working;
  end if;

  dow := extract(isodow from _day)::smallint; -- 1..7
  return dow = any(c.work_days);
end;
$$;

create or replace function public.business_minutes_between(
  _calendar_id uuid,
  _start timestamptz,
  _end timestamptz
)
returns integer
language plpgsql
stable
as $$
declare
  c public.business_calendars;
  tz text;
  start_ts timestamptz;
  end_ts timestamptz;
  start_day date;
  end_day date;
  cur_day date;
  day_start timestamptz;
  day_end timestamptz;
  overlap_start timestamptz;
  overlap_end timestamptz;
  total_minutes integer := 0;
begin
  if _calendar_id is null or _start is null or _end is null then
    return 0;
  end if;
  if _end <= _start then
    return 0;
  end if;

  select * into c from public.business_calendars where id = _calendar_id;
  if c.id is null then
    return 0;
  end if;

  tz := c.timezone;
  start_ts := _start;
  end_ts := _end;

  start_day := (start_ts at time zone tz)::date;
  end_day := (end_ts at time zone tz)::date;

  cur_day := start_day;
  while cur_day <= end_day loop
    if public._business_is_working_day(_calendar_id, cur_day) then
      day_start := ((cur_day::timestamp + c.work_start) at time zone tz);
      day_end := ((cur_day::timestamp + c.work_end) at time zone tz);

      if day_end > day_start then
        overlap_start := greatest(start_ts, day_start);
        overlap_end := least(end_ts, day_end);
        if overlap_end > overlap_start then
          total_minutes := total_minutes + floor(extract(epoch from (overlap_end - overlap_start)) / 60.0)::int;
        end if;
      end if;
    end if;
    cur_day := cur_day + 1;
  end loop;

  return greatest(total_minutes, 0);
end;
$$;

create or replace function public.business_add_minutes(
  _calendar_id uuid,
  _start timestamptz,
  _minutes integer
)
returns timestamptz
language plpgsql
stable
as $$
declare
  c public.business_calendars;
  tz text;
  remaining integer;
  cur_ts timestamptz;
  cur_day date;
  day_start timestamptz;
  day_end timestamptz;
  avail integer;
begin
  if _calendar_id is null or _start is null then
    return null;
  end if;
  if _minutes is null or _minutes <= 0 then
    return _start;
  end if;

  select * into c from public.business_calendars where id = _calendar_id;
  if c.id is null then
    return _start + make_interval(mins => _minutes);
  end if;

  tz := c.timezone;
  remaining := _minutes;
  cur_ts := _start;

  loop
    cur_day := (cur_ts at time zone tz)::date;

    if not public._business_is_working_day(_calendar_id, cur_day) then
      cur_ts := (((cur_day + 1)::timestamp + c.work_start) at time zone tz);
      continue;
    end if;

    day_start := ((cur_day::timestamp + c.work_start) at time zone tz);
    day_end := ((cur_day::timestamp + c.work_end) at time zone tz);

    if day_end <= day_start then
      cur_ts := (((cur_day + 1)::timestamp + c.work_start) at time zone tz);
      continue;
    end if;

    if cur_ts < day_start then
      cur_ts := day_start;
    end if;

    if cur_ts >= day_end then
      cur_ts := (((cur_day + 1)::timestamp + c.work_start) at time zone tz);
      continue;
    end if;

    avail := floor(extract(epoch from (day_end - cur_ts)) / 60.0)::int;
    if remaining <= avail then
      return cur_ts + make_interval(mins => remaining);
    end if;

    remaining := remaining - avail;
    cur_ts := (((cur_day + 1)::timestamp + c.work_start) at time zone tz);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Tickets: fields for SLA targets, calendar snapshot, pauses and exclusions
-- ---------------------------------------------------------------------

alter table public.tickets add column if not exists business_calendar_id uuid references public.business_calendars (id);
create index if not exists tickets_calendar_idx on public.tickets (business_calendar_id);

alter table public.tickets add column if not exists sla_response_target_minutes integer;
alter table public.tickets add column if not exists sla_resolution_target_minutes integer;
alter table public.tickets add column if not exists ola_response_target_minutes integer;
alter table public.tickets add column if not exists ola_resolution_target_minutes integer;

alter table public.tickets add column if not exists sla_pause_started_at timestamptz;
alter table public.tickets add column if not exists sla_paused_minutes integer not null default 0;

alter table public.tickets add column if not exists planned_at timestamptz;
alter table public.tickets add column if not exists planned_for_at timestamptz;

alter table public.tickets add column if not exists canceled_at timestamptz;
alter table public.tickets add column if not exists canceled_reason text;

alter table public.tickets add column if not exists sla_excluded boolean not null default false;
alter table public.tickets add column if not exists sla_exclusion_reason text;
alter table public.tickets add column if not exists sla_excluded_by uuid references public.profiles (id);
alter table public.tickets add column if not exists sla_excluded_at timestamptz;

-- Update ticket transition timestamps: mark rejected/cancelled/planificado
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

  if new.status = 'Planificado' and old.status is distinct from 'Planificado' then
    new.planned_at := coalesce(new.planned_at, now());
  end if;

  if new.status = 'Cancelado' and old.status is distinct from 'Cancelado' then
    new.canceled_at := coalesce(new.canceled_at, now());
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  return new;
end;
$$;

-- Replace: SLA/OLA calc using business calendars (hours hábiles)
create or replace function public._set_ticket_department_and_sla()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dept uuid;
  cal uuid;
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

  cal := public._calendar_for_department(dept);
  new.business_calendar_id := cal;

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

  new.sla_response_target_minutes := case when resp_hours is null then null else resp_hours * 60 end;
  new.sla_resolution_target_minutes := case when res_hours is null then null else res_hours * 60 end;
  new.ola_response_target_minutes := case when ola_resp_hours is null then null else ola_resp_hours * 60 end;
  new.ola_resolution_target_minutes := case when ola_res_hours is null then null else ola_res_hours * 60 end;

  if resp_hours is not null then
    new.response_deadline := public.business_add_minutes(cal, new.created_at, resp_hours * 60);
  end if;

  if res_hours is not null then
    new.sla_deadline := public.business_add_minutes(cal, new.created_at, res_hours * 60);
  end if;

  if ola_resp_hours is not null then
    new.ola_response_deadline := public.business_add_minutes(cal, new.created_at, ola_resp_hours * 60);
  end if;

  if ola_res_hours is not null then
    new.ola_deadline := public.business_add_minutes(cal, new.created_at, ola_res_hours * 60);
  end if;

  return new;
end;
$$;

-- Pause/resume SLA when status=Planificado (detiene el contador en horas hábiles)
create or replace function public._tickets_apply_sla_pause()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cal uuid;
  paused integer;
  base_response timestamptz;
  base_sla timestamptz;
  base_ola_resp timestamptz;
  base_ola timestamptz;
begin
  if new.status is distinct from old.status then
    cal := coalesce(new.business_calendar_id, public._calendar_for_department(new.department_id));

    -- Enter pause
    if new.status = 'Planificado' and old.status is distinct from 'Planificado' then
      new.sla_pause_started_at := coalesce(new.sla_pause_started_at, now());
      return new;
    end if;

    -- Exit pause
    if old.status = 'Planificado' and new.status is distinct from 'Planificado' then
      if old.sla_pause_started_at is null then
        new.sla_pause_started_at := null;
        return new;
      end if;

      paused := public.business_minutes_between(cal, old.sla_pause_started_at, now());
      new.sla_paused_minutes := coalesce(old.sla_paused_minutes, 0) + paused;
      new.sla_pause_started_at := null;

      if paused > 0 then
        base_response := coalesce(old.response_deadline, new.response_deadline);
        base_sla := coalesce(old.sla_deadline, new.sla_deadline);
        base_ola_resp := coalesce(old.ola_response_deadline, new.ola_response_deadline);
        base_ola := coalesce(old.ola_deadline, new.ola_deadline);

        if base_response is not null then
          new.response_deadline := public.business_add_minutes(cal, base_response, paused);
        end if;
        if base_sla is not null then
          new.sla_deadline := public.business_add_minutes(cal, base_sla, paused);
        end if;
        if base_ola_resp is not null then
          new.ola_response_deadline := public.business_add_minutes(cal, base_ola_resp, paused);
        end if;
        if base_ola is not null then
          new.ola_deadline := public.business_add_minutes(cal, base_ola, paused);
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists t_tickets_sla_pause on public.tickets;
create trigger t_tickets_sla_pause
before update of status on public.tickets
for each row execute function public._tickets_apply_sla_pause();

-- ---------------------------------------------------------------------
-- SLA exclusion helper (para justificar y excluir del conteo)
-- ---------------------------------------------------------------------

create or replace function public.ticket_set_sla_exclusion(
  p_ticket_id uuid,
  p_excluded boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tickets;
begin
  if not public._has_role(array['agent','supervisor','admin']::public.role_enum[]) then
    raise exception 'forbidden';
  end if;

  select * into t from public.tickets where id = p_ticket_id;
  if t.id is null then
    raise exception 'not_found';
  end if;

  if not (public._same_department(t.department_id) or public._is_role('admin')) then
    raise exception 'forbidden';
  end if;

  update public.tickets
  set
    sla_excluded = coalesce(p_excluded, false),
    sla_exclusion_reason = case when coalesce(p_excluded, false) then nullif(p_reason, '') else null end,
    sla_excluded_by = case when coalesce(p_excluded, false) then auth.uid() else null end,
    sla_excluded_at = case when coalesce(p_excluded, false) then now() else null end
  where id = p_ticket_id;
end;
$$;

revoke all on function public.ticket_set_sla_exclusion(uuid, boolean, text) from public;
grant execute on function public.ticket_set_sla_exclusion(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- Live SLA metrics view (semaforo/termómetro) para UI y export
-- ---------------------------------------------------------------------

create or replace view public.tickets_sla_live as
with base as (
  select
    t.*,
    coalesce(t.business_calendar_id, public._calendar_for_department(t.department_id)) as cal_id
  from public.tickets t
),
calc as (
  select
    b.*,
    case
      when b.response_deadline is null then null
      else public.business_minutes_between(b.cal_id, now(), b.response_deadline)
    end as response_remaining_minutes_raw,
    case
      when b.sla_deadline is null then null
      else public.business_minutes_between(b.cal_id, now(), b.sla_deadline)
    end as sla_remaining_minutes_raw
  from base b
)
select
  c.*,
  greatest(coalesce(c.response_remaining_minutes_raw, 0), 0) as response_remaining_minutes,
  greatest(coalesce(c.sla_remaining_minutes_raw, 0), 0) as sla_remaining_minutes,
  case
    when c.sla_excluded then 'excluded'
    when c.status in ('Cerrado','Cancelado','Rechazado') then 'closed'
    when c.sla_deadline is null or c.sla_resolution_target_minutes is null or c.sla_resolution_target_minutes = 0 then null
    when c.sla_remaining_minutes_raw <= 0 then 'red'
    when (greatest(c.sla_remaining_minutes_raw, 0)::numeric / c.sla_resolution_target_minutes::numeric) <= 0.2 then 'yellow'
    else 'green'
  end as sla_traffic_light,
  case
    when c.sla_deadline is null or c.sla_resolution_target_minutes is null or c.sla_resolution_target_minutes = 0 then null
    else round((1 - (greatest(c.sla_remaining_minutes_raw, 0)::numeric / c.sla_resolution_target_minutes::numeric)) * 100.0, 2)
  end as sla_pct_used,
  case
    when c.sla_excluded then 'excluded'
    when c.status in ('Cerrado','Cancelado','Rechazado') then 'closed'
    when c.response_deadline is null or c.sla_response_target_minutes is null or c.sla_response_target_minutes = 0 then null
    when c.response_remaining_minutes_raw <= 0 then 'red'
    when (greatest(c.response_remaining_minutes_raw, 0)::numeric / c.sla_response_target_minutes::numeric) <= 0.2 then 'yellow'
    else 'green'
  end as response_traffic_light,
  case
    when c.response_deadline is null or c.sla_response_target_minutes is null or c.sla_response_target_minutes = 0 then null
    else round((1 - (greatest(c.response_remaining_minutes_raw, 0)::numeric / c.sla_response_target_minutes::numeric)) * 100.0, 2)
  end as response_pct_used
from calc c;

revoke all on table public.tickets_sla_live from public;
grant select on table public.tickets_sla_live to authenticated;

-- ---------------------------------------------------------------------
-- Backfill: compute business deadlines for tickets abiertos
-- ---------------------------------------------------------------------

create or replace function public._recalc_ticket_deadlines(_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tickets;
  dept uuid;
  cal uuid;
  svc_id uuid;
  res_hours integer;
  resp_hours integer;
  ola_res_hours integer;
  ola_resp_hours integer;
begin
  perform set_config('row_security', 'off', true);
  select * into t from public.tickets where id = _ticket_id;
  if t.id is null then
    return;
  end if;

  dept := t.department_id;
  cal := coalesce(t.business_calendar_id, public._calendar_for_department(dept));
  svc_id := public._ticket_service_id(t.metadata);

  if svc_id is not null then
    select st.response_time_hours, st.resolution_time_hours
      into resp_hours, res_hours
    from public.service_time_targets st
    join public.service_catalog_items s on s.id = st.service_id
    where st.is_active = true
      and st.target = 'SLA'
      and st.service_id = svc_id
      and st.priority = t.priority
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
      and st.priority = t.priority
      and (s.department_id is null or s.department_id = dept)
    order by st.updated_at desc
    limit 1;
  end if;

  if res_hours is null or resp_hours is null then
    select s.response_time_hours, s.resolution_time_hours
      into resp_hours, res_hours
    from public.slas s
    where s.is_active = true
      and s.priority = t.priority
      and (s.department_id = dept or s.department_id is null)
    order by (s.department_id is null) asc, s.updated_at desc
    limit 1;
  end if;

  update public.tickets
  set
    business_calendar_id = cal,
    sla_response_target_minutes = case when resp_hours is null then sla_response_target_minutes else resp_hours * 60 end,
    sla_resolution_target_minutes = case when res_hours is null then sla_resolution_target_minutes else res_hours * 60 end,
    ola_response_target_minutes = case when ola_resp_hours is null then ola_response_target_minutes else ola_resp_hours * 60 end,
    ola_resolution_target_minutes = case when ola_res_hours is null then ola_resolution_target_minutes else ola_res_hours * 60 end,
    response_deadline = case when resp_hours is null then response_deadline else public.business_add_minutes(cal, t.created_at, resp_hours * 60) end,
    sla_deadline = case when res_hours is null then sla_deadline else public.business_add_minutes(cal, t.created_at, res_hours * 60) end,
    ola_response_deadline = case when ola_resp_hours is null then ola_response_deadline else public.business_add_minutes(cal, t.created_at, ola_resp_hours * 60) end,
    ola_deadline = case when ola_res_hours is null then ola_deadline else public.business_add_minutes(cal, t.created_at, ola_res_hours * 60) end
  where id = _ticket_id;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select id
    from public.tickets
    where status not in ('Cerrado','Rechazado','Cancelado')
  loop
    perform public._recalc_ticket_deadlines(r.id);
  end loop;
end $$;

commit;

-- ============================================================
-- 018_kpi_sla_exclusions.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- KPI updates: excluir tickets fuera de SLA (justificados) y estados terminales
-- ---------------------------------------------------------------------

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
  canceled_count bigint;
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

  -- Volume: created vs closed vs canceled
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

  select count(*) into canceled_count
  from public.tickets t
  where t.department_id = dept_id
    and t.status = 'Cancelado'
    and t.canceled_at is not null
    and t.canceled_at >= p_start and t.canceled_at < p_end
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- MTTR (seconds) - solo cerrados
  select avg(extract(epoch from (t.closed_at - t.created_at))) into mttr_seconds
  from public.tickets t
  where t.department_id = dept_id
    and t.status = 'Cerrado'
    and t.closed_at is not null
    and t.closed_at >= p_start and t.closed_at < p_end
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- SLA compliance (excluye justificadas fuera de SLA)
  select
    count(*) filter (where t.sla_deadline is not null) as total,
    count(*) filter (where t.sla_deadline is not null and t.closed_at <= t.sla_deadline) as ok
  into sla_total, sla_ok
  from public.tickets t
  where t.department_id = dept_id
    and t.status = 'Cerrado'
    and t.closed_at is not null
    and coalesce(t.sla_excluded, false) = false
    and t.closed_at >= p_start and t.closed_at < p_end
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- Pending (snapshot) by priority (excluye terminales)
  select
    count(*) filter (where t.priority = 'Crítica') as crit,
    count(*) filter (where t.priority = 'Alta') as high,
    count(*) filter (where t.priority = 'Media') as med,
    count(*) filter (where t.priority = 'Baja') as low
  into pending_crit, pending_high, pending_med, pending_low
  from public.tickets t
  where t.department_id = dept_id
    and t.status not in ('Cerrado','Rechazado','Cancelado')
    and (p_agent_id is null or t.assignee_id = p_agent_id)
    and (p_category_id is null or t.category_id = p_category_id);

  -- Workload (snapshot): open tickets assigned per agent (excluye terminales)
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
     and t.status not in ('Cerrado','Rechazado','Cancelado')
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
    'volume', jsonb_build_object('created', created_count, 'closed', closed_count, 'canceled', canceled_count),
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

  bucket := case
    when p_bucket in ('hour','day','week','month') then p_bucket
    else 'day'
  end;

  return (
    with series as (
      select generate_series(
        date_trunc(bucket, p_start),
        date_trunc(bucket, p_end),
        ('1 ' || bucket)::interval
      ) as b
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
        and coalesce(t.sla_excluded, false) = false
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

-- ============================================================
-- 019_service_catalog_tiers.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Service Catalog: tiered taxonomy (Tipo de Ticket + Tier1..Tier4)
-- Used for guided combobox UX and reporting.
-- ---------------------------------------------------------------------

alter table public.service_catalog_items add column if not exists tier1 text;
alter table public.service_catalog_items add column if not exists tier2 text;
alter table public.service_catalog_items add column if not exists tier3 text;
alter table public.service_catalog_items add column if not exists tier4 text;

create index if not exists service_catalog_items_tier1_idx on public.service_catalog_items (tier1);
create index if not exists service_catalog_items_tier2_idx on public.service_catalog_items (tier2);
create index if not exists service_catalog_items_tier3_idx on public.service_catalog_items (tier3);
create index if not exists service_catalog_items_tier4_idx on public.service_catalog_items (tier4);

-- Prevent duplicate leaf paths when tiers are populated.
create unique index if not exists service_catalog_items_unique_tier_path
  on public.service_catalog_items (department_id, ticket_type, tier1, tier2, tier3, tier4)
  where tier1 is not null and tier2 is not null and tier3 is not null and tier4 is not null;

commit;

-- ============================================================
-- 020_official_status_and_solution.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Official ticket statuses + solution types (alignment)
-- ---------------------------------------------------------------------

-- Statuses (keep legacy values for backwards compatibility, but migrate data)
do $$ begin
  alter type public.ticket_status_enum add value if not exists 'En Curso';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.ticket_status_enum add value if not exists 'En Espera';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.ticket_status_enum add value if not exists 'Planificado o Coordinado';
exception when duplicate_object then null; end $$;

-- Postgres requires newly added enum values to be committed before use.
commit;
begin;

-- Default status -> En Curso
alter table public.tickets alter column status set default 'En Curso';

-- Solution type
do $$ begin
  create type public.ticket_solution_type_enum as enum ('Instrucción al usuario', 'Soporte Remoto', 'Soporte Terreno', 'Implementación');
exception when duplicate_object then null; end $$;

alter table public.tickets add column if not exists solution_type public.ticket_solution_type_enum;
alter table public.tickets add column if not exists solution_notes text;

-- Data migration: map legacy statuses to official ones
update public.tickets
set status = 'En Curso'
where status in ('Nuevo','Asignado','En Progreso','Resuelto');

update public.tickets
set status = 'En Espera'
where status in ('Pendiente Info','Pendiente Aprobación');

update public.tickets
set status = 'Planificado o Coordinado'
where status = 'Planificado';

update public.tickets
set
  status = 'Cancelado',
  canceled_reason = coalesce(canceled_reason, 'Rechazado'),
  canceled_at = coalesce(canceled_at, closed_at, now()),
  closed_at = coalesce(closed_at, now())
where status = 'Rechazado';

-- Update ticket transition timestamps for official statuses
create or replace function public._set_ticket_transition_timestamps()
returns trigger
language plpgsql
as $$
begin
  -- legacy support
  if new.status = 'Planificado' and old.status is distinct from 'Planificado' then
    new.planned_at := coalesce(new.planned_at, now());
  end if;

  if new.status = 'Planificado o Coordinado' and old.status is distinct from 'Planificado o Coordinado' then
    new.planned_at := coalesce(new.planned_at, now());
  end if;

  if new.status = 'Cancelado' and old.status is distinct from 'Cancelado' then
    new.canceled_at := coalesce(new.canceled_at, now());
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  if new.status = 'Rechazado' and old.status is distinct from 'Rechazado' then
    -- legacy: treat as canceled/closed
    new.canceled_at := coalesce(new.canceled_at, now());
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  if new.status = 'Cerrado' and old.status is distinct from 'Cerrado' then
    new.closed_at := coalesce(new.closed_at, now());
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;

  if new.status = 'Resuelto' and old.status is distinct from 'Resuelto' then
    -- legacy
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;

  return new;
end;
$$;

-- SLA pause: pause when Planificado o Coordinado (and legacy Planificado)
create or replace function public._tickets_apply_sla_pause()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cal uuid;
  paused integer;
  base_response timestamptz;
  base_sla timestamptz;
  base_ola_resp timestamptz;
  base_ola timestamptz;
  is_pause_new boolean;
  is_pause_old boolean;
begin
  if new.status is distinct from old.status then
    cal := coalesce(new.business_calendar_id, public._calendar_for_department(new.department_id));

    is_pause_new := new.status in ('Planificado o Coordinado','Planificado');
    is_pause_old := old.status in ('Planificado o Coordinado','Planificado');

    -- Enter pause
    if is_pause_new and not is_pause_old then
      new.sla_pause_started_at := coalesce(new.sla_pause_started_at, now());
      return new;
    end if;

    -- Exit pause
    if is_pause_old and not is_pause_new then
      if old.sla_pause_started_at is null then
        new.sla_pause_started_at := null;
        return new;
      end if;

      paused := public.business_minutes_between(cal, old.sla_pause_started_at, now());
      new.sla_paused_minutes := coalesce(old.sla_paused_minutes, 0) + paused;
      new.sla_pause_started_at := null;

      if paused > 0 then
        base_response := coalesce(old.response_deadline, new.response_deadline);
        base_sla := coalesce(old.sla_deadline, new.sla_deadline);
        base_ola_resp := coalesce(old.ola_response_deadline, new.ola_response_deadline);
        base_ola := coalesce(old.ola_deadline, new.ola_deadline);

        if base_response is not null then
          new.response_deadline := public.business_add_minutes(cal, base_response, paused);
        end if;
        if base_sla is not null then
          new.sla_deadline := public.business_add_minutes(cal, base_sla, paused);
        end if;
        if base_ola_resp is not null then
          new.ola_response_deadline := public.business_add_minutes(cal, base_ola_resp, paused);
        end if;
        if base_ola is not null then
          new.ola_deadline := public.business_add_minutes(cal, base_ola, paused);
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists t_tickets_sla_pause on public.tickets;
create trigger t_tickets_sla_pause
before update of status on public.tickets
for each row execute function public._tickets_apply_sla_pause();

-- Replace: approval gate to use En Espera instead of Pendiente Aprobación
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

  if needs and new.status in ('En Curso','Nuevo') then
    new.status := 'En Espera';
  end if;

  return new;
end;
$$;

-- Replace: approval_decide status transitions aligned to official statuses
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
    set
      status = 'Cancelado',
      canceled_reason = coalesce(nullif(p_comment, ''), canceled_reason, 'Rechazado'),
      canceled_at = coalesce(canceled_at, now()),
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
    set status = 'En Curso'
    where id = p_ticket_id
      and status in ('En Espera','Pendiente Aprobación');
  end if;
end;
$$;

revoke all on function public.approval_decide(uuid, text, text) from public;
grant execute on function public.approval_decide(uuid, text, text) to authenticated;

-- Update view: treat En Espera and Planificado o Coordinado as active states, and close states as Cerrado/Cancelado
-- NOTE: we must drop the view first because it was previously created using `t.*`,
-- and new columns added to `public.tickets` would otherwise cause column renames (42P16).
drop view if exists public.tickets_sla_live;

create or replace view public.tickets_sla_live as
with base as (
  select
    t.*,
    coalesce(t.business_calendar_id, public._calendar_for_department(t.department_id)) as cal_id
  from public.tickets t
),
calc as (
  select
    b.*,
    case
      when b.response_deadline is null then null
      else public.business_minutes_between(b.cal_id, now(), b.response_deadline)
    end as response_remaining_minutes_raw,
    case
      when b.sla_deadline is null then null
      else public.business_minutes_between(b.cal_id, now(), b.sla_deadline)
    end as sla_remaining_minutes_raw
  from base b
)
select
  c.*,
  greatest(coalesce(c.response_remaining_minutes_raw, 0), 0) as response_remaining_minutes,
  greatest(coalesce(c.sla_remaining_minutes_raw, 0), 0) as sla_remaining_minutes,
  case
    when c.sla_excluded then 'excluded'
    when c.status in ('Cerrado','Cancelado','Rechazado') then 'closed'
    when c.sla_deadline is null or c.sla_resolution_target_minutes is null or c.sla_resolution_target_minutes = 0 then null
    when c.sla_remaining_minutes_raw <= 0 then 'red'
    when (greatest(c.sla_remaining_minutes_raw, 0)::numeric / c.sla_resolution_target_minutes::numeric) <= 0.2 then 'yellow'
    else 'green'
  end as sla_traffic_light,
  case
    when c.sla_deadline is null or c.sla_resolution_target_minutes is null or c.sla_resolution_target_minutes = 0 then null
    else round((1 - (greatest(c.sla_remaining_minutes_raw, 0)::numeric / c.sla_resolution_target_minutes::numeric)) * 100.0, 2)
  end as sla_pct_used,
  case
    when c.sla_excluded then 'excluded'
    when c.status in ('Cerrado','Cancelado','Rechazado') then 'closed'
    when c.response_deadline is null or c.sla_response_target_minutes is null or c.sla_response_target_minutes = 0 then null
    when c.response_remaining_minutes_raw <= 0 then 'red'
    when (greatest(c.response_remaining_minutes_raw, 0)::numeric / c.sla_response_target_minutes::numeric) <= 0.2 then 'yellow'
    else 'green'
  end as response_traffic_light,
  case
    when c.response_deadline is null or c.sla_response_target_minutes is null or c.sla_response_target_minutes = 0 then null
    else round((1 - (greatest(c.response_remaining_minutes_raw, 0)::numeric / c.sla_response_target_minutes::numeric)) * 100.0, 2)
  end as response_pct_used
from calc c;

revoke all on table public.tickets_sla_live from public;
grant select on table public.tickets_sla_live to authenticated;

commit;

-- ============================================================
-- 021_ticket_number.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Ticket tracking number (correlative)
-- - Adds a human-friendly unique number to every ticket for easy tracking.
-- - Format is handled in the app (e.g., TKT-000123).
-- ---------------------------------------------------------------------

create sequence if not exists public.ticket_number_seq;

alter table public.tickets add column if not exists ticket_number bigint;

-- Backfill existing tickets (assign in created_at order, then id)
do $$
declare
  offset_val bigint;
begin
  select coalesce(max(ticket_number), 0) into offset_val from public.tickets;

  with ordered as (
    select id, row_number() over (order by created_at asc, id asc) as rn
    from public.tickets
    where ticket_number is null
  )
  update public.tickets t
  set ticket_number = offset_val + ordered.rn
  from ordered
  where t.id = ordered.id;
end $$;

-- Default for new tickets
alter sequence public.ticket_number_seq owned by public.tickets.ticket_number;
alter table public.tickets alter column ticket_number set default nextval('public.ticket_number_seq');

-- Ensure uniqueness
create unique index if not exists tickets_ticket_number_uq on public.tickets (ticket_number);

-- Set sequence to current max (so nextval continues correctly)
select setval('public.ticket_number_seq', (select coalesce(max(ticket_number), 0) from public.tickets), true);

-- Make it required once backfilled
do $$ begin
  alter table public.tickets alter column ticket_number set not null;
exception when others then
  -- If table is empty or column already has constraint, ignore.
  null;
end $$;

-- Refresh live view so it exposes the new column (the view uses t.*)
drop view if exists public.tickets_sla_live;

create or replace view public.tickets_sla_live as
with base as (
  select
    t.*,
    coalesce(t.business_calendar_id, public._calendar_for_department(t.department_id)) as cal_id
  from public.tickets t
),
calc as (
  select
    b.*,
    case
      when b.response_deadline is null then null
      else public.business_minutes_between(b.cal_id, now(), b.response_deadline)
    end as response_remaining_minutes_raw,
    case
      when b.sla_deadline is null then null
      else public.business_minutes_between(b.cal_id, now(), b.sla_deadline)
    end as sla_remaining_minutes_raw
  from base b
)
select
  c.*,
  greatest(coalesce(c.response_remaining_minutes_raw, 0), 0) as response_remaining_minutes,
  greatest(coalesce(c.sla_remaining_minutes_raw, 0), 0) as sla_remaining_minutes,
  case
    when c.sla_excluded then 'excluded'
    when c.status in ('Cerrado','Cancelado','Rechazado') then 'closed'
    when c.sla_deadline is null or c.sla_resolution_target_minutes is null or c.sla_resolution_target_minutes = 0 then null
    when c.sla_remaining_minutes_raw <= 0 then 'red'
    when (greatest(c.sla_remaining_minutes_raw, 0)::numeric / c.sla_resolution_target_minutes::numeric) <= 0.2 then 'yellow'
    else 'green'
  end as sla_traffic_light,
  case
    when c.sla_deadline is null or c.sla_resolution_target_minutes is null or c.sla_resolution_target_minutes = 0 then null
    else round((1 - (greatest(c.sla_remaining_minutes_raw, 0)::numeric / c.sla_resolution_target_minutes::numeric)) * 100.0, 2)
  end as sla_pct_used,
  case
    when c.sla_excluded then 'excluded'
    when c.status in ('Cerrado','Cancelado','Rechazado') then 'closed'
    when c.response_deadline is null or c.sla_response_target_minutes is null or c.sla_response_target_minutes = 0 then null
    when c.response_remaining_minutes_raw <= 0 then 'red'
    when (greatest(c.response_remaining_minutes_raw, 0)::numeric / c.sla_response_target_minutes::numeric) <= 0.2 then 'yellow'
    else 'green'
  end as response_traffic_light,
  case
    when c.response_deadline is null or c.sla_response_target_minutes is null or c.sla_response_target_minutes = 0 then null
    else round((1 - (greatest(c.response_remaining_minutes_raw, 0)::numeric / c.sla_response_target_minutes::numeric)) * 100.0, 2)
  end as response_pct_used
from calc c;

revoke all on table public.tickets_sla_live from public;
grant select on table public.tickets_sla_live to authenticated;

commit;

-- ============================================================
-- 022_official_sla_mda_and_ola.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Official SLA/OLA presets + time basis (business vs calendar)
-- - SLA (MDA): Resp 2h, Res 8h (horas hábiles 08:00-18:00, lun-vie)
-- - OLA (operación): Resp 1h, Res 2h (nivel 1 + escalamiento nivel 2)
-- Notes:
-- - For "24 horas corridas" targets, use `time_basis='calendar'`.
-- - Service-specific overrides still live in `service_time_targets` (SLA/OLA).
-- ---------------------------------------------------------------------

do $$ begin
  create type public.time_basis_enum as enum ('business', 'calendar');
exception when duplicate_object then null; end $$;

-- Ensure default business calendar matches MDA availability (only "Horario estándar")
update public.business_calendars
set
  timezone = 'America/Santiago',
  work_start = '08:00'::time,
  work_end = '18:00'::time,
  work_days = array[1,2,3,4,5]::smallint[],
  updated_at = now()
where name = 'Horario estándar';

-- SLA: add time basis
alter table public.slas add column if not exists time_basis public.time_basis_enum not null default 'business';

-- OLA: defaults by department/priority
create table if not exists public.olas (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments (id) on delete cascade,
  priority public.ticket_priority_enum not null,
  response_time_hours integer not null check (response_time_hours >= 0),
  resolution_time_hours integer not null check (resolution_time_hours >= 0),
  time_basis public.time_basis_enum not null default 'business',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists olas_active_idx on public.olas (is_active, priority);

alter table public.olas enable row level security;

drop trigger if exists t_olas_touch on public.olas;
create trigger t_olas_touch before update on public.olas
for each row execute function public._touch_updated_at();

drop policy if exists olas_select_agents on public.olas;
create policy olas_select_agents on public.olas
for select to authenticated
using (
  public._has_role(array['agent','supervisor','admin']::public.role_enum[])
  and (department_id is null or public._same_department(department_id))
);

drop policy if exists olas_supervisor_write on public.olas;
create policy olas_supervisor_write on public.olas
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and (department_id is null or public._same_department(department_id))
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and (department_id is null or public._same_department(department_id))
);

-- Service-specific targets: allow choosing business vs calendar time basis
alter table public.service_time_targets add column if not exists time_basis public.time_basis_enum not null default 'business';

-- Store basis per computed deadline (used for pause adjustments)
alter table public.tickets add column if not exists sla_time_basis public.time_basis_enum not null default 'business';
alter table public.tickets add column if not exists response_time_basis public.time_basis_enum not null default 'business';
alter table public.tickets add column if not exists ola_time_basis public.time_basis_enum not null default 'business';
alter table public.tickets add column if not exists ola_response_time_basis public.time_basis_enum not null default 'business';

-- Solution delivery tracking (for supervisor control)
alter table public.tickets add column if not exists solution_delivered_at timestamptz;
alter table public.tickets add column if not exists solution_delivered_by uuid references public.profiles (id);

-- Helpers: add minutes using selected time basis
create or replace function public._add_minutes_with_basis(
  _basis public.time_basis_enum,
  _calendar_id uuid,
  _start timestamptz,
  _minutes integer
)
returns timestamptz
language plpgsql
stable
as $$
begin
  if _start is null then
    return null;
  end if;
  if _minutes is null or _minutes <= 0 then
    return _start;
  end if;

  if _basis = 'calendar' then
    return _start + make_interval(mins => _minutes);
  end if;

  return public.business_add_minutes(_calendar_id, _start, _minutes);
end;
$$;

-- Replace: set dept + SLA/OLA using calendars + time basis
create or replace function public._set_ticket_department_and_sla()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dept uuid;
  cal uuid;
  svc_id uuid;

  sla_res_hours integer;
  sla_resp_hours integer;
  sla_basis public.time_basis_enum := 'business';

  ola_res_hours integer;
  ola_resp_hours integer;
  ola_basis public.time_basis_enum := 'business';
begin
  select p.department_id into dept
  from public.profiles p
  where p.id = new.requester_id;

  if dept is null then
    raise exception 'Requester must have department_id set';
  end if;

  new.department_id := dept;

  cal := public._calendar_for_department(dept);
  new.business_calendar_id := cal;

  svc_id := public._ticket_service_id(new.metadata);

  -- Service SLA override
  if svc_id is not null then
    select st.response_time_hours, st.resolution_time_hours, st.time_basis
      into sla_resp_hours, sla_res_hours, sla_basis
    from public.service_time_targets st
    join public.service_catalog_items s on s.id = st.service_id
    where st.is_active = true
      and st.target = 'SLA'
      and st.service_id = svc_id
      and st.priority = new.priority
      and (s.department_id is null or s.department_id = dept)
    order by st.updated_at desc
    limit 1;

    select st.response_time_hours, st.resolution_time_hours, st.time_basis
      into ola_resp_hours, ola_res_hours, ola_basis
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

  -- Fallback SLA (MDA) if service SLA not defined
  if sla_res_hours is null or sla_resp_hours is null then
    select s.response_time_hours, s.resolution_time_hours, s.time_basis
      into sla_resp_hours, sla_res_hours, sla_basis
    from public.slas s
    where s.is_active = true
      and s.priority = new.priority
      and (s.department_id = dept or s.department_id is null)
    order by (s.department_id is null) asc, s.updated_at desc
    limit 1;
  end if;

  -- Fallback OLA (operación) if not defined by service
  if ola_res_hours is null or ola_resp_hours is null then
    select o.response_time_hours, o.resolution_time_hours, o.time_basis
      into ola_resp_hours, ola_res_hours, ola_basis
    from public.olas o
    where o.is_active = true
      and o.priority = new.priority
      and (o.department_id = dept or o.department_id is null)
    order by (o.department_id is null) asc, o.updated_at desc
    limit 1;
  end if;

  new.sla_response_target_minutes := case when sla_resp_hours is null then null else sla_resp_hours * 60 end;
  new.sla_resolution_target_minutes := case when sla_res_hours is null then null else sla_res_hours * 60 end;
  new.ola_response_target_minutes := case when ola_resp_hours is null then null else ola_resp_hours * 60 end;
  new.ola_resolution_target_minutes := case when ola_res_hours is null then null else ola_res_hours * 60 end;

  new.response_time_basis := coalesce(sla_basis, 'business');
  new.sla_time_basis := coalesce(sla_basis, 'business');
  new.ola_response_time_basis := coalesce(ola_basis, 'business');
  new.ola_time_basis := coalesce(ola_basis, 'business');

  if sla_resp_hours is not null then
    new.response_deadline := public._add_minutes_with_basis(new.response_time_basis, cal, new.created_at, sla_resp_hours * 60);
  end if;

  if sla_res_hours is not null then
    new.sla_deadline := public._add_minutes_with_basis(new.sla_time_basis, cal, new.created_at, sla_res_hours * 60);
  end if;

  if ola_resp_hours is not null then
    new.ola_response_deadline := public._add_minutes_with_basis(new.ola_response_time_basis, cal, new.created_at, ola_resp_hours * 60);
  end if;

  if ola_res_hours is not null then
    new.ola_deadline := public._add_minutes_with_basis(new.ola_time_basis, cal, new.created_at, ola_res_hours * 60);
  end if;

  return new;
end;
$$;

-- Replace pause adjustment: extend deadlines according to basis
create or replace function public._tickets_apply_sla_pause()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cal uuid;
  paused integer;
  base_response timestamptz;
  base_sla timestamptz;
  base_ola_resp timestamptz;
  base_ola timestamptz;
  is_pause_new boolean;
  is_pause_old boolean;
  resp_basis public.time_basis_enum;
  sla_basis public.time_basis_enum;
  ola_resp_basis public.time_basis_enum;
  ola_basis public.time_basis_enum;
begin
  if new.status is distinct from old.status then
    cal := coalesce(new.business_calendar_id, public._calendar_for_department(new.department_id));

    is_pause_new := new.status in ('Planificado o Coordinado','Planificado');
    is_pause_old := old.status in ('Planificado o Coordinado','Planificado');

    -- Enter pause
    if is_pause_new and not is_pause_old then
      new.sla_pause_started_at := coalesce(new.sla_pause_started_at, now());
      return new;
    end if;

    -- Exit pause
    if is_pause_old and not is_pause_new then
      if old.sla_pause_started_at is null then
        new.sla_pause_started_at := null;
        return new;
      end if;

      paused := public.business_minutes_between(cal, old.sla_pause_started_at, now());
      new.sla_paused_minutes := coalesce(old.sla_paused_minutes, 0) + paused;
      new.sla_pause_started_at := null;

      if paused > 0 then
        base_response := coalesce(old.response_deadline, new.response_deadline);
        base_sla := coalesce(old.sla_deadline, new.sla_deadline);
        base_ola_resp := coalesce(old.ola_response_deadline, new.ola_response_deadline);
        base_ola := coalesce(old.ola_deadline, new.ola_deadline);

        resp_basis := coalesce(old.response_time_basis, new.response_time_basis, 'business');
        sla_basis := coalesce(old.sla_time_basis, new.sla_time_basis, 'business');
        ola_resp_basis := coalesce(old.ola_response_time_basis, new.ola_response_time_basis, 'business');
        ola_basis := coalesce(old.ola_time_basis, new.ola_time_basis, 'business');

        if base_response is not null then
          new.response_deadline := public._add_minutes_with_basis(resp_basis, cal, base_response, paused);
        end if;
        if base_sla is not null then
          new.sla_deadline := public._add_minutes_with_basis(sla_basis, cal, base_sla, paused);
        end if;
        if base_ola_resp is not null then
          new.ola_response_deadline := public._add_minutes_with_basis(ola_resp_basis, cal, base_ola_resp, paused);
        end if;
        if base_ola is not null then
          new.ola_deadline := public._add_minutes_with_basis(ola_basis, cal, base_ola, paused);
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists t_tickets_sla_pause on public.tickets;
create trigger t_tickets_sla_pause
before update of status on public.tickets
for each row execute function public._tickets_apply_sla_pause();

-- Enforce solution fields on close + mark delivered
create or replace function public._set_ticket_transition_timestamps()
returns trigger
language plpgsql
as $$
begin
  -- legacy support
  if new.status = 'Planificado' and old.status is distinct from 'Planificado' then
    new.planned_at := coalesce(new.planned_at, now());
  end if;

  if new.status = 'Planificado o Coordinado' and old.status is distinct from 'Planificado o Coordinado' then
    new.planned_at := coalesce(new.planned_at, now());
  end if;

  if new.status = 'Cancelado' and old.status is distinct from 'Cancelado' then
    new.canceled_at := coalesce(new.canceled_at, now());
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  if new.status = 'Rechazado' and old.status is distinct from 'Rechazado' then
    -- legacy: treat as canceled/closed
    new.canceled_at := coalesce(new.canceled_at, now());
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  if new.status = 'Cerrado' and old.status is distinct from 'Cerrado' then
    if new.solution_type is null then
      raise exception 'solution_type_required';
    end if;

    new.closed_at := coalesce(new.closed_at, now());
    new.resolved_at := coalesce(new.resolved_at, now());
    new.solution_delivered_at := coalesce(new.solution_delivered_at, now());
    new.solution_delivered_by := coalesce(new.solution_delivered_by, auth.uid());
  end if;

  if new.status = 'Resuelto' and old.status is distinct from 'Resuelto' then
    -- legacy
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;

  return new;
end;
$$;

-- Official values seed (idempotent): SLA (MDA) and OLA defaults for each dept + global
do $$
declare
  d uuid;
  p public.ticket_priority_enum;
begin
  for d in (select id from public.departments union all select null::uuid) loop
    foreach p in array array['Crítica','Alta','Media','Baja']::public.ticket_priority_enum[] loop
      update public.slas
      set response_time_hours = 2,
          resolution_time_hours = 8,
          time_basis = 'business',
          is_active = true,
          updated_at = now()
      where priority = p
        and is_active = true
        and department_id is not distinct from d;

      if not exists (
        select 1
        from public.slas
        where priority = p
          and is_active = true
          and department_id is not distinct from d
      ) then
        insert into public.slas (department_id, priority, response_time_hours, resolution_time_hours, time_basis, is_active)
        values (d, p, 2, 8, 'business', true);
      end if;

      update public.olas
      set response_time_hours = 1,
          resolution_time_hours = 2,
          time_basis = 'business',
          is_active = true,
          updated_at = now()
      where priority = p
        and is_active = true
        and department_id is not distinct from d;

      if not exists (
        select 1
        from public.olas
        where priority = p
          and is_active = true
          and department_id is not distinct from d
      ) then
        insert into public.olas (department_id, priority, response_time_hours, resolution_time_hours, time_basis, is_active)
        values (d, p, 1, 2, 'business', true);
      end if;
    end loop;
  end loop;
end $$;

commit;

-- ============================================================
-- 023_ticket_closure_codes.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Standardized closure observations (ITIL-style) for ticket closure
-- - Keeps official solution types as-is (solution_type).
-- - Adds a required closure code for status 'Cerrado' to standardize outcomes.
-- ---------------------------------------------------------------------

do $$ begin
  create type public.ticket_closure_code_enum as enum (
    'Resuelto y confirmado por el usuario',
    'Resuelto sin confirmación (usuario no responde)',
    'Resuelto por el usuario (autoservicio)',
    'Cerrado por solicitud del usuario',
    'Cerrado por duplicidad',
    'Cerrado por falta de información del solicitante',
    'Cerrado por fuera de alcance (no aplica)',
    'Cerrado por derivación a tercero'
  );
exception when duplicate_object then null; end $$;

alter table public.tickets add column if not exists closure_code public.ticket_closure_code_enum;

-- Enforce solution fields + closure code on close
create or replace function public._set_ticket_transition_timestamps()
returns trigger
language plpgsql
as $$
begin
  -- legacy support
  if new.status = 'Planificado' and old.status is distinct from 'Planificado' then
    new.planned_at := coalesce(new.planned_at, now());
  end if;

  if new.status = 'Planificado o Coordinado' and old.status is distinct from 'Planificado o Coordinado' then
    new.planned_at := coalesce(new.planned_at, now());
  end if;

  if new.status = 'Cancelado' and old.status is distinct from 'Cancelado' then
    new.canceled_at := coalesce(new.canceled_at, now());
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  if new.status = 'Rechazado' and old.status is distinct from 'Rechazado' then
    -- legacy: treat as canceled/closed
    new.canceled_at := coalesce(new.canceled_at, now());
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  if new.status = 'Cerrado' and old.status is distinct from 'Cerrado' then
    if new.solution_type is null then
      raise exception 'solution_type_required';
    end if;
    if new.closure_code is null then
      raise exception 'closure_code_required';
    end if;

    new.closed_at := coalesce(new.closed_at, now());
    new.resolved_at := coalesce(new.resolved_at, now());
    new.solution_delivered_at := coalesce(new.solution_delivered_at, now());
    new.solution_delivered_by := coalesce(new.solution_delivered_by, auth.uid());
  end if;

  if new.status = 'Resuelto' and old.status is distinct from 'Resuelto' then
    -- legacy
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;

  return new;
end;
$$;

-- Refresh live view so it exposes the new column (the view uses t.*)
drop view if exists public.tickets_sla_live;

create or replace view public.tickets_sla_live as
with base as (
  select
    t.*,
    coalesce(t.business_calendar_id, public._calendar_for_department(t.department_id)) as cal_id
  from public.tickets t
),
calc as (
  select
    b.*,
    case
      when b.response_deadline is null then null
      else public.business_minutes_between(b.cal_id, now(), b.response_deadline)
    end as response_remaining_minutes_raw,
    case
      when b.sla_deadline is null then null
      else public.business_minutes_between(b.cal_id, now(), b.sla_deadline)
    end as sla_remaining_minutes_raw
  from base b
)
select
  c.*,
  greatest(coalesce(c.response_remaining_minutes_raw, 0), 0) as response_remaining_minutes,
  greatest(coalesce(c.sla_remaining_minutes_raw, 0), 0) as sla_remaining_minutes,
  case
    when c.sla_excluded then 'excluded'
    when c.status in ('Cerrado','Cancelado','Rechazado') then 'closed'
    when c.sla_deadline is null or c.sla_resolution_target_minutes is null or c.sla_resolution_target_minutes = 0 then null
    when c.sla_remaining_minutes_raw <= 0 then 'red'
    when (greatest(c.sla_remaining_minutes_raw, 0)::numeric / c.sla_resolution_target_minutes::numeric) <= 0.2 then 'yellow'
    else 'green'
  end as sla_traffic_light,
  case
    when c.sla_deadline is null or c.sla_resolution_target_minutes is null or c.sla_resolution_target_minutes = 0 then null
    else round((1 - (greatest(c.sla_remaining_minutes_raw, 0)::numeric / c.sla_resolution_target_minutes::numeric)) * 100.0, 2)
  end as sla_pct_used,
  case
    when c.sla_excluded then 'excluded'
    when c.status in ('Cerrado','Cancelado','Rechazado') then 'closed'
    when c.response_deadline is null or c.sla_response_target_minutes is null or c.sla_response_target_minutes = 0 then null
    when c.response_remaining_minutes_raw <= 0 then 'red'
    when (greatest(c.response_remaining_minutes_raw, 0)::numeric / c.sla_response_target_minutes::numeric) <= 0.2 then 'yellow'
    else 'green'
  end as response_traffic_light,
  case
    when c.response_deadline is null or c.sla_response_target_minutes is null or c.sla_response_target_minutes = 0 then null
    else round((1 - (greatest(c.response_remaining_minutes_raw, 0)::numeric / c.sla_response_target_minutes::numeric)) * 100.0, 2)
  end as response_pct_used
from calc c;

revoke all on table public.tickets_sla_live from public;
grant select on table public.tickets_sla_live to authenticated;

commit;

-- ============================================================
-- 024_assets.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- IT Assets: inventory + assignments + connectivity + alerts
-- - Designed for CSV/manual/API ingestion, geo visualization, and monitoring.
-- - PostGIS is NOT required (lat/lng stored as numeric).
-- ---------------------------------------------------------------------

do $$ begin
  create type public.asset_connectivity_status_enum as enum ('Online', 'Offline', 'Durmiente', 'Desconocido', 'Crítico');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.asset_lifecycle_status_enum as enum ('Activo', 'En reparación', 'Retirado', 'Descartado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.asset_assignment_role_enum as enum ('principal', 'secundario', 'responsable');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.asset_alert_severity_enum as enum ('info', 'warning', 'critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.asset_alert_status_enum as enum ('open', 'resolved', 'ignored');
exception when duplicate_object then null; end $$;

create sequence if not exists public.asset_tag_seq;

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,

  -- Human-friendly tracking id (global sequence). App can format: AST-000123
  asset_tag bigint not null default nextval('public.asset_tag_seq'),

  -- Identification
  name text not null,
  serial_number text,
  barcode text,
  manufacturer text,
  model text,

  -- Classification (kept as text for flexibility)
  asset_type text,
  category text,
  subcategory text,

  -- Physical location
  region text,
  comuna text,
  building text,
  floor text,
  room text,
  address text,
  latitude numeric,
  longitude numeric,

  -- Ownership / cost
  cost_center text,
  department_name text,

  -- Lifecycle
  lifecycle_status public.asset_lifecycle_status_enum not null default 'Activo',
  purchased_at date,
  installed_at date,
  warranty_expires_at date,
  eol_at date,
  license_expires_at date,

  -- Connectivity snapshot
  connectivity_status public.asset_connectivity_status_enum not null default 'Desconocido',
  last_seen_at timestamptz,
  last_ip text,
  last_mac text,
  last_hostname text,
  last_network_type text,

  -- Health / prediction (0..100)
  failure_risk_pct integer not null default 0 check (failure_risk_pct >= 0 and failure_risk_pct <= 100),

  -- Notes / metadata
  description text,
  admin_notes text,
  tags text[],
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter sequence public.asset_tag_seq owned by public.assets.asset_tag;

create unique index if not exists assets_asset_tag_uq on public.assets (asset_tag);
create unique index if not exists assets_dept_serial_uq on public.assets (department_id, serial_number) where serial_number is not null and length(trim(serial_number)) > 0;
create index if not exists assets_dept_created_idx on public.assets (department_id, created_at desc);
create index if not exists assets_dept_status_idx on public.assets (department_id, lifecycle_status, connectivity_status);
create index if not exists assets_location_idx on public.assets (department_id, region, comuna, building);
create index if not exists assets_lat_lng_idx on public.assets (department_id, latitude, longitude) where latitude is not null and longitude is not null;

drop trigger if exists t_assets_touch on public.assets;
create trigger t_assets_touch before update on public.assets
for each row execute function public._touch_updated_at();

create table if not exists public.asset_assignments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete restrict,
  role public.asset_assignment_role_enum not null default 'principal',
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists asset_assignments_asset_idx on public.asset_assignments (asset_id, assigned_at desc);
create index if not exists asset_assignments_user_idx on public.asset_assignments (user_id, assigned_at desc);
create index if not exists asset_assignments_open_idx on public.asset_assignments (asset_id) where ended_at is null;

create table if not exists public.asset_connectivity_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  status public.asset_connectivity_status_enum not null,
  occurred_at timestamptz not null default now(),
  ip text,
  mac text,
  hostname text,
  network_type text,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists asset_connectivity_events_asset_idx on public.asset_connectivity_events (asset_id, occurred_at desc);

create table if not exists public.asset_alerts (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  kind text not null,
  severity public.asset_alert_severity_enum not null default 'warning',
  status public.asset_alert_status_enum not null default 'open',
  title text not null,
  message text,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists asset_alerts_asset_idx on public.asset_alerts (asset_id, opened_at desc);
create index if not exists asset_alerts_status_idx on public.asset_alerts (status, severity, opened_at desc);

drop trigger if exists t_asset_alerts_touch on public.asset_alerts;
create trigger t_asset_alerts_touch before update on public.asset_alerts
for each row execute function public._touch_updated_at();

alter table public.assets enable row level security;
alter table public.asset_assignments enable row level security;
alter table public.asset_connectivity_events enable row level security;
alter table public.asset_alerts enable row level security;

-- Assets: visibility
drop policy if exists assets_select on public.assets;
create policy assets_select on public.assets
for select to authenticated
using (
  (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or exists (
    select 1
    from public.asset_assignments aa
    where aa.asset_id = assets.id
      and aa.user_id = auth.uid()
      and aa.ended_at is null
  )
);

-- Assets: supervisors/admin manage, agents read-only.
drop policy if exists assets_write on public.assets;
create policy assets_write on public.assets
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

-- Assignments: dept agents/supervisor/admin can read. Only supervisor/admin can change.
drop policy if exists asset_assignments_select on public.asset_assignments;
create policy asset_assignments_select on public.asset_assignments
for select to authenticated
using (
  exists (
    select 1
    from public.assets a
    where a.id = asset_assignments.asset_id
      and (
        (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(a.department_id))
        or asset_assignments.user_id = auth.uid()
      )
  )
);

drop policy if exists asset_assignments_write on public.asset_assignments;
create policy asset_assignments_write on public.asset_assignments
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and exists (select 1 from public.assets a where a.id = asset_assignments.asset_id and public._same_department(a.department_id))
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and exists (select 1 from public.assets a where a.id = asset_assignments.asset_id and public._same_department(a.department_id))
);

-- Connectivity events: dept agents/supervisor/admin can read; write via server/service or supervisor/admin.
drop policy if exists asset_connectivity_events_select on public.asset_connectivity_events;
create policy asset_connectivity_events_select on public.asset_connectivity_events
for select to authenticated
using (
  exists (
    select 1
    from public.assets a
    where a.id = asset_connectivity_events.asset_id
      and public._has_role(array['agent','supervisor','admin']::public.role_enum[])
      and public._same_department(a.department_id)
  )
);

drop policy if exists asset_connectivity_events_insert on public.asset_connectivity_events;
create policy asset_connectivity_events_insert on public.asset_connectivity_events
for insert to authenticated
with check (
  exists (
    select 1
    from public.assets a
    where a.id = asset_connectivity_events.asset_id
      and public._has_role(array['agent','supervisor','admin']::public.role_enum[])
      and public._same_department(a.department_id)
  )
);

-- Alerts: dept agents/supervisor/admin can read; supervisor/admin can update.
drop policy if exists asset_alerts_select on public.asset_alerts;
create policy asset_alerts_select on public.asset_alerts
for select to authenticated
using (
  exists (
    select 1 from public.assets a
    where a.id = asset_alerts.asset_id
      and public._has_role(array['agent','supervisor','admin']::public.role_enum[])
      and public._same_department(a.department_id)
  )
);

drop policy if exists asset_alerts_write on public.asset_alerts;
create policy asset_alerts_write on public.asset_alerts
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and exists (select 1 from public.assets a where a.id = asset_alerts.asset_id and public._same_department(a.department_id))
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and exists (select 1 from public.assets a where a.id = asset_alerts.asset_id and public._same_department(a.department_id))
);

-- ---------------------------------------------------------------------
-- RPC: bulk upsert assets (CSV/API) with validation + partial import
-- Input format: [{ name, serial_number, ... }]
-- ---------------------------------------------------------------------

create or replace function public.asset_upsert_many(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  dept_id uuid;
  idx integer := 0;
  inserted integer := 0;
  updated integer := 0;
  errors jsonb := '[]'::jsonb;

  r jsonb;
  v_name text;
  v_serial text;
  v_tag bigint;
  v_id uuid;
begin
  perform set_config('row_security', 'off', true);

  if not public._has_role(array['supervisor','admin']::public.role_enum[]) then
    raise exception 'forbidden';
  end if;

  select p.department_id into dept_id
  from public.profiles p
  where p.id = auth.uid();

  if dept_id is null then
    raise exception 'department_required';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows_must_be_array';
  end if;

  for r in select * from jsonb_array_elements(p_rows)
  loop
    idx := idx + 1;
    v_name := trim(coalesce(r->>'name', ''));
    v_serial := nullif(trim(coalesce(r->>'serial_number', '')), '');
    v_tag := nullif(trim(coalesce(r->>'asset_tag', '')), '')::bigint;

    if v_name = '' then
      errors := errors || jsonb_build_array(jsonb_build_object('row', idx, 'error', 'name_required'));
      continue;
    end if;

    begin
      v_id := null;
      if v_tag is not null then
        select a.id into v_id from public.assets a where a.asset_tag = v_tag and a.department_id = dept_id;
      elsif v_serial is not null then
        select a.id into v_id from public.assets a where a.serial_number = v_serial and a.department_id = dept_id;
      end if;

      if v_id is null then
        insert into public.assets (
          department_id,
          asset_tag,
          name,
          serial_number,
          barcode,
          manufacturer,
          model,
          asset_type,
          category,
          subcategory,
          region,
          comuna,
          building,
          floor,
          room,
          address,
          latitude,
          longitude,
          cost_center,
          department_name,
          lifecycle_status,
          purchased_at,
          installed_at,
          warranty_expires_at,
          eol_at,
          license_expires_at,
          description,
          admin_notes,
          tags,
          metadata
        )
        values (
          dept_id,
          coalesce(v_tag, nextval('public.asset_tag_seq')),
          v_name,
          v_serial,
          nullif(trim(coalesce(r->>'barcode', '')), ''),
          nullif(trim(coalesce(r->>'manufacturer', '')), ''),
          nullif(trim(coalesce(r->>'model', '')), ''),
          nullif(trim(coalesce(r->>'asset_type', '')), ''),
          nullif(trim(coalesce(r->>'category', '')), ''),
          nullif(trim(coalesce(r->>'subcategory', '')), ''),
          nullif(trim(coalesce(r->>'region', '')), ''),
          nullif(trim(coalesce(r->>'comuna', '')), ''),
          nullif(trim(coalesce(r->>'building', '')), ''),
          nullif(trim(coalesce(r->>'floor', '')), ''),
          nullif(trim(coalesce(r->>'room', '')), ''),
          nullif(trim(coalesce(r->>'address', '')), ''),
          nullif(trim(coalesce(r->>'latitude', '')), '')::numeric,
          nullif(trim(coalesce(r->>'longitude', '')), '')::numeric,
          nullif(trim(coalesce(r->>'cost_center', '')), ''),
          nullif(trim(coalesce(r->>'department_name', '')), ''),
          coalesce(nullif(trim(coalesce(r->>'lifecycle_status', '')), '')::public.asset_lifecycle_status_enum, 'Activo'::public.asset_lifecycle_status_enum),
          nullif(trim(coalesce(r->>'purchased_at', '')), '')::date,
          nullif(trim(coalesce(r->>'installed_at', '')), '')::date,
          nullif(trim(coalesce(r->>'warranty_expires_at', '')), '')::date,
          nullif(trim(coalesce(r->>'eol_at', '')), '')::date,
          nullif(trim(coalesce(r->>'license_expires_at', '')), '')::date,
          nullif(trim(coalesce(r->>'description', '')), ''),
          nullif(trim(coalesce(r->>'admin_notes', '')), ''),
          case
            when r ? 'tags' and jsonb_typeof(r->'tags') = 'array' then (select array_agg(value::text) from jsonb_array_elements_text(r->'tags') as value)
            else null
          end,
          coalesce(r->'metadata', '{}'::jsonb)
        )
        returning id into v_id;
        inserted := inserted + 1;
      else
        update public.assets
        set
          name = v_name,
          serial_number = coalesce(v_serial, serial_number),
          barcode = coalesce(nullif(trim(coalesce(r->>'barcode', '')), ''), barcode),
          manufacturer = coalesce(nullif(trim(coalesce(r->>'manufacturer', '')), ''), manufacturer),
          model = coalesce(nullif(trim(coalesce(r->>'model', '')), ''), model),
          asset_type = coalesce(nullif(trim(coalesce(r->>'asset_type', '')), ''), asset_type),
          category = coalesce(nullif(trim(coalesce(r->>'category', '')), ''), category),
          subcategory = coalesce(nullif(trim(coalesce(r->>'subcategory', '')), ''), subcategory),
          region = coalesce(nullif(trim(coalesce(r->>'region', '')), ''), region),
          comuna = coalesce(nullif(trim(coalesce(r->>'comuna', '')), ''), comuna),
          building = coalesce(nullif(trim(coalesce(r->>'building', '')), ''), building),
          floor = coalesce(nullif(trim(coalesce(r->>'floor', '')), ''), floor),
          room = coalesce(nullif(trim(coalesce(r->>'room', '')), ''), room),
          address = coalesce(nullif(trim(coalesce(r->>'address', '')), ''), address),
          latitude = coalesce(nullif(trim(coalesce(r->>'latitude', '')), '')::numeric, latitude),
          longitude = coalesce(nullif(trim(coalesce(r->>'longitude', '')), '')::numeric, longitude),
          cost_center = coalesce(nullif(trim(coalesce(r->>'cost_center', '')), ''), cost_center),
          department_name = coalesce(nullif(trim(coalesce(r->>'department_name', '')), ''), department_name),
          lifecycle_status = coalesce(nullif(trim(coalesce(r->>'lifecycle_status', '')), '')::public.asset_lifecycle_status_enum, lifecycle_status),
          purchased_at = coalesce(nullif(trim(coalesce(r->>'purchased_at', '')), '')::date, purchased_at),
          installed_at = coalesce(nullif(trim(coalesce(r->>'installed_at', '')), '')::date, installed_at),
          warranty_expires_at = coalesce(nullif(trim(coalesce(r->>'warranty_expires_at', '')), '')::date, warranty_expires_at),
          eol_at = coalesce(nullif(trim(coalesce(r->>'eol_at', '')), '')::date, eol_at),
          license_expires_at = coalesce(nullif(trim(coalesce(r->>'license_expires_at', '')), '')::date, license_expires_at),
          description = coalesce(nullif(trim(coalesce(r->>'description', '')), ''), description),
          admin_notes = coalesce(nullif(trim(coalesce(r->>'admin_notes', '')), ''), admin_notes),
          tags = case
            when r ? 'tags' and jsonb_typeof(r->'tags') = 'array' then (select array_agg(value::text) from jsonb_array_elements_text(r->'tags') as value)
            else tags
          end,
          metadata = case when r ? 'metadata' then coalesce(r->'metadata', '{}'::jsonb) else metadata end,
          updated_at = now()
        where id = v_id;
        updated := updated + 1;
      end if;
    exception when others then
      errors := errors || jsonb_build_array(jsonb_build_object('row', idx, 'error', sqlerrm));
      continue;
    end;
  end loop;

  return jsonb_build_object('inserted', inserted, 'updated', updated, 'errors', errors);
end;
$$;

revoke all on function public.asset_upsert_many(jsonb) from public;
grant execute on function public.asset_upsert_many(jsonb) to authenticated;

commit;

-- ============================================================
-- 025_assets_rls_recursion_fix.sql
-- ============================================================
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

-- ============================================================
-- 026_ticket_first_response_backfill.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Fix: "Tiempos promedio" chart missing data
-- - `kpi_timeseries` computes avg response/resolution hours from:
--     tickets.first_response_at and tickets.closed_at
-- - `first_response_at` was only set by the "first public agent comment" trigger.
-- - In practice, many tickets get handled via assignment/status updates without a
--   public comment, leaving `first_response_at` null and charts empty.
-- - Solution:
--   1) Set `first_response_at` on the first agent/supervisor/admin action
--      (status/assignee update) when it's still null.
--   2) Backfill `first_response_at` for existing tickets from earliest agent
--      action (public comment or ticket event).
-- ---------------------------------------------------------------------

create or replace function public._set_first_response_on_ticket_update()
returns trigger
language plpgsql
as $$
declare
  actor_role public.role_enum;
begin
  if old.first_response_at is not null then
    return new;
  end if;

  -- Service-role / background jobs may not have an authenticated user.
  if auth.uid() is null then
    return new;
  end if;

  select p.role into actor_role
  from public.profiles p
  where p.id = auth.uid();

  if actor_role in ('agent', 'supervisor', 'admin') then
    new.first_response_at := coalesce(new.first_response_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists t_tickets_first_response_on_update on public.tickets;
create trigger t_tickets_first_response_on_update
before update of status, assignee_id on public.tickets
for each row execute function public._set_first_response_on_ticket_update();

do $$
begin
  with agent_actions as (
    select ticket_id, min(at) as first_at
    from (
      select c.ticket_id, c.created_at as at
      from public.comments c
      join public.profiles ap on ap.id = c.author_id
      where c.is_internal = false
        and ap.role in ('agent', 'supervisor', 'admin')
      union all
      select e.ticket_id, e.created_at as at
      from public.ticket_events e
      join public.profiles ep on ep.id = e.actor_id
      where ep.role in ('agent', 'supervisor', 'admin')
    ) s
    group by ticket_id
  )
  update public.tickets t
  set first_response_at = a.first_at
  from agent_actions a
  where t.id = a.ticket_id
    and t.first_response_at is null;
exception
  when undefined_table then
    -- Fallback for DBs that don't have ticket_events.
    with agent_actions as (
      select c.ticket_id, min(c.created_at) as first_at
      from public.comments c
      join public.profiles ap on ap.id = c.author_id
      where c.is_internal = false
        and ap.role in ('agent', 'supervisor', 'admin')
      group by c.ticket_id
    )
    update public.tickets t
    set first_response_at = a.first_at
    from agent_actions a
    where t.id = a.ticket_id
      and t.first_response_at is null;
end;
$$;

commit;

-- ============================================================
-- 027_asset_sites.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Asset sites (locales/sucursales) for location matching
-- - Stores known locations per department (no PostGIS required).
-- - Assets can optionally reference a site via `assets.site_id`.
-- ---------------------------------------------------------------------

create table if not exists public.asset_sites (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  name text not null,
  region text,
  comuna text,
  address text,
  latitude numeric,
  longitude numeric,
  radius_m integer not null default 250 check (radius_m > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, name)
);

create index if not exists asset_sites_dept_idx on public.asset_sites (department_id, name);
create index if not exists asset_sites_lat_lng_idx on public.asset_sites (department_id, latitude, longitude) where latitude is not null and longitude is not null;

drop trigger if exists t_asset_sites_touch on public.asset_sites;
create trigger t_asset_sites_touch before update on public.asset_sites
for each row execute function public._touch_updated_at();

alter table public.asset_sites enable row level security;

drop policy if exists asset_sites_select on public.asset_sites;
create policy asset_sites_select on public.asset_sites
for select to authenticated
using (
  public._has_role(array['agent','supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

drop policy if exists asset_sites_write on public.asset_sites;
create policy asset_sites_write on public.asset_sites
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

alter table public.assets add column if not exists site_id uuid references public.asset_sites (id) on delete set null;
create index if not exists assets_site_idx on public.assets (site_id);

commit;

-- ============================================================
-- 028_asset_picklists.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Asset picklists (subcategorías, marcas, modelos)
-- - Purpose: reduce typos by selecting from curated/learned options.
-- - Scoping: per department.
-- - Seeding: auto-learn distinct values from existing `assets` rows.
-- ---------------------------------------------------------------------

create table if not exists public.asset_subcategories (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  asset_type text,
  category text,
  name text not null,
  name_norm text generated always as (lower(trim(name))) stored,
  asset_type_norm text generated always as (lower(trim(coalesce(asset_type, '')))) stored,
  category_norm text generated always as (lower(trim(coalesce(category, '')))) stored,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, asset_type_norm, category_norm, name_norm)
);

create index if not exists asset_subcategories_dept_idx on public.asset_subcategories (department_id, name);

drop trigger if exists t_asset_subcategories_touch on public.asset_subcategories;
create trigger t_asset_subcategories_touch before update on public.asset_subcategories
for each row execute function public._touch_updated_at();

alter table public.asset_subcategories enable row level security;

drop policy if exists asset_subcategories_select on public.asset_subcategories;
create policy asset_subcategories_select on public.asset_subcategories
for select to authenticated
using (
  public._has_role(array['agent','supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

drop policy if exists asset_subcategories_write on public.asset_subcategories;
create policy asset_subcategories_write on public.asset_subcategories
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

create table if not exists public.asset_manufacturers (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  name text not null,
  name_norm text generated always as (lower(trim(name))) stored,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, name_norm)
);

create index if not exists asset_manufacturers_dept_idx on public.asset_manufacturers (department_id, name);

drop trigger if exists t_asset_manufacturers_touch on public.asset_manufacturers;
create trigger t_asset_manufacturers_touch before update on public.asset_manufacturers
for each row execute function public._touch_updated_at();

alter table public.asset_manufacturers enable row level security;

drop policy if exists asset_manufacturers_select on public.asset_manufacturers;
create policy asset_manufacturers_select on public.asset_manufacturers
for select to authenticated
using (
  public._has_role(array['agent','supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

drop policy if exists asset_manufacturers_write on public.asset_manufacturers;
create policy asset_manufacturers_write on public.asset_manufacturers
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

create table if not exists public.asset_models (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  manufacturer text,
  name text not null,
  manufacturer_norm text generated always as (lower(trim(coalesce(manufacturer, '')))) stored,
  name_norm text generated always as (lower(trim(name))) stored,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, manufacturer_norm, name_norm)
);

create index if not exists asset_models_dept_idx on public.asset_models (department_id, manufacturer, name);

drop trigger if exists t_asset_models_touch on public.asset_models;
create trigger t_asset_models_touch before update on public.asset_models
for each row execute function public._touch_updated_at();

alter table public.asset_models enable row level security;

drop policy if exists asset_models_select on public.asset_models;
create policy asset_models_select on public.asset_models
for select to authenticated
using (
  public._has_role(array['agent','supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

drop policy if exists asset_models_write on public.asset_models;
create policy asset_models_write on public.asset_models
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

-- Seed from existing assets (best-effort).
insert into public.asset_manufacturers (department_id, name)
select
  a.department_id,
  min(trim(a.manufacturer)) as name
from public.assets a
where a.manufacturer is not null
  and length(trim(a.manufacturer)) > 0
group by a.department_id, lower(trim(a.manufacturer))
on conflict do nothing;

insert into public.asset_models (department_id, manufacturer, name)
select
  a.department_id,
  min(nullif(trim(coalesce(a.manufacturer, '')), '')) as manufacturer,
  min(trim(a.model)) as name
from public.assets a
where a.model is not null
  and length(trim(a.model)) > 0
group by a.department_id, lower(trim(coalesce(a.manufacturer, ''))), lower(trim(a.model))
on conflict do nothing;

insert into public.asset_subcategories (department_id, asset_type, category, name)
select
  a.department_id,
  min(nullif(trim(coalesce(a.asset_type, '')), '')) as asset_type,
  min(nullif(trim(coalesce(a.category, '')), '')) as category,
  min(trim(a.subcategory)) as name
from public.assets a
where a.subcategory is not null
  and length(trim(a.subcategory)) > 0
group by a.department_id, lower(trim(coalesce(a.asset_type, ''))), lower(trim(coalesce(a.category, ''))), lower(trim(a.subcategory))
on conflict do nothing;

commit;

-- ============================================================
-- 029_remote_devices.sql
-- ============================================================
begin;

do $$ begin
  create type public.remote_protocol_enum as enum ('rdp','vnc');
exception when duplicate_object then null; end $$;

create table if not exists public.remote_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  department_id uuid not null references public.departments (id) on delete cascade,
  mesh_node_id text,
  protocol public.remote_protocol_enum not null,
  -- Encrypted payload (application-managed). Example structure:
  -- { "v": 1, "alg": "aes-256-gcm", "iv": "...", "tag": "...", "ciphertext": "..." }
  credentials jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, name)
);

create index if not exists remote_devices_department_idx on public.remote_devices (department_id);
create index if not exists remote_devices_mesh_node_idx on public.remote_devices (mesh_node_id);

drop trigger if exists t_remote_devices_touch on public.remote_devices;
create trigger t_remote_devices_touch before update on public.remote_devices
for each row execute function public._touch_updated_at();

alter table public.remote_devices enable row level security;

drop policy if exists remote_devices_select on public.remote_devices;
create policy remote_devices_select on public.remote_devices
for select to authenticated
using (
  public._has_role(array['agent','supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

drop policy if exists remote_devices_write on public.remote_devices;
create policy remote_devices_write on public.remote_devices
for all to authenticated
using (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
)
with check (
  public._has_role(array['supervisor','admin']::public.role_enum[])
  and public._same_department(department_id)
);

commit;

-- ============================================================
-- 030_chat_direct_support.sql
-- ============================================================
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

-- ============================================================
-- 031_assets_mesh_node_id.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- RMM linkage for Assets
-- - Some devices may not provide a reliable serial_number.
-- - We store the RMM device/node id (or access key) to upsert/deduplicate and link remote access.
-- ---------------------------------------------------------------------

alter table public.assets add column if not exists mesh_node_id text;

create index if not exists assets_dept_mesh_node_idx on public.assets (department_id, mesh_node_id);
create unique index if not exists assets_dept_mesh_node_uq on public.assets (department_id, mesh_node_id)
where mesh_node_id is not null and length(trim(mesh_node_id)) > 0;

commit;

-- ============================================================
-- 032_chat_close_tipificaciones.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Chat: cierre con tipificación (para soporte)
-- - Guarda el motivo/resultado en chat_threads.metadata.closure
-- - Propaga la tipificación al evento "closed" para reporting/transcript
-- ---------------------------------------------------------------------

-- Replace: events + timestamps on thread changes (extend "closed" details)
create or replace function public._chat_threads_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  closure jsonb;
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
    closure := nullif(coalesce(new.metadata->'closure', '{}'::jsonb), '{}'::jsonb);
    perform public._chat_events_insert(
      new.id,
      auth.uid(),
      'closed',
      jsonb_build_object('status', new.status, 'closure', closure),
      now()
    );
  end if;

  return new;
end;
$$;

-- New RPC: close with tipification (support-side)
create or replace function public.chat_close_thread_typed(
  p_thread_id uuid,
  p_code text,
  p_notes text default null
)
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
  clean_code text;
  clean_notes text;
begin
  perform set_config('row_security', 'off', true);
  uid := auth.uid();
  if uid is null then raise exception 'Not authenticated'; end if;

  select t.requester_id, t.assigned_agent_id into req, ass
  from public.chat_threads t
  where t.id = p_thread_id;

  if req is null then raise exception 'not_found'; end if;
  select p.role into me_role from public.profiles p where p.id = uid;

  -- Restrict: only assignee/supervisor/admin can close with a support code.
  if not (uid = ass or me_role in ('supervisor','admin')) then
    raise exception 'forbidden';
  end if;

  clean_code := lower(nullif(trim(coalesce(p_code,'')), ''));
  if clean_code is null then raise exception 'code_required'; end if;

  if clean_code not in (
    'resuelto',
    'derivado',
    'informacion_entregada',
    'no_responde',
    'fuera_de_alcance',
    'duplicado'
  ) then
    raise exception 'invalid_code';
  end if;

  clean_notes := nullif(trim(coalesce(p_notes,'')), '');

  update public.chat_threads
  set metadata = jsonb_set(
        coalesce(metadata, '{}'::jsonb),
        '{closure}',
        jsonb_build_object('code', clean_code, 'notes', clean_notes),
        true
      ),
      status = 'Cerrado',
      closed_at = coalesce(closed_at, now()),
      closed_by = uid,
      updated_at = now()
  where id = p_thread_id;
end;
$$;

revoke all on function public.chat_close_thread_typed(uuid, text, text) from public;
grant execute on function public.chat_close_thread_typed(uuid, text, text) to authenticated;

commit;

-- ============================================================
-- 033_agent_work_status.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- Agent work status (turno) + traceability
-- - Separate from chat availability (agent_presence)
-- - Stores current state + event log
-- ---------------------------------------------------------------------

do $$ begin
  create type public.agent_work_status_enum as enum ('En turno', 'Descanso', 'Almuerzo', 'Baño', 'Fin turno');
exception when duplicate_object then null; end $$;

create table if not exists public.agent_work_status (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  department_id uuid references public.departments (id) on delete cascade,
  status public.agent_work_status_enum not null default 'Fin turno',
  note text,
  updated_at timestamptz not null default now()
);

create index if not exists agent_work_status_dept_idx on public.agent_work_status (department_id, status, updated_at desc);

create table if not exists public.agent_work_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  department_id uuid references public.departments (id) on delete cascade,
  status public.agent_work_status_enum not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists agent_work_events_profile_idx on public.agent_work_events (profile_id, created_at desc);
create index if not exists agent_work_events_dept_idx on public.agent_work_events (department_id, created_at desc);

drop trigger if exists t_agent_work_status_touch on public.agent_work_status;
create trigger t_agent_work_status_touch before update on public.agent_work_status
for each row execute function public._touch_updated_at();

alter table public.agent_work_status enable row level security;
alter table public.agent_work_events enable row level security;

-- Read: self + supervisors/admin of same department
drop policy if exists agent_work_status_select on public.agent_work_status;
create policy agent_work_status_select on public.agent_work_status
for select to authenticated
using (
  profile_id = auth.uid()
  or (public._has_role(array['supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
);

drop policy if exists agent_work_events_select on public.agent_work_events;
create policy agent_work_events_select on public.agent_work_events
for select to authenticated
using (
  profile_id = auth.uid()
  or (public._has_role(array['supervisor','admin']::public.role_enum[]) and public._same_department(department_id))
  or public._is_role('admin')
);

-- Writes are via RPC (security definer)
drop policy if exists agent_work_status_write_none on public.agent_work_status;
create policy agent_work_status_write_none on public.agent_work_status
for all to authenticated
using (false)
with check (false);

drop policy if exists agent_work_events_write_none on public.agent_work_events;
create policy agent_work_events_write_none on public.agent_work_events
for all to authenticated
using (false)
with check (false);

create or replace function public.agent_set_work_status(
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  dept uuid;
  st public.agent_work_status_enum;
  note_clean text;
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
    when 'en turno' then st := 'En turno'::public.agent_work_status_enum;
    when 'turno' then st := 'En turno'::public.agent_work_status_enum;
    when 'descanso' then st := 'Descanso'::public.agent_work_status_enum;
    when 'almuerzo' then st := 'Almuerzo'::public.agent_work_status_enum;
    when 'baño' then st := 'Baño'::public.agent_work_status_enum;
    when 'bano' then st := 'Baño'::public.agent_work_status_enum;
    when 'fin turno' then st := 'Fin turno'::public.agent_work_status_enum;
    when 'fin' then st := 'Fin turno'::public.agent_work_status_enum;
    else raise exception 'invalid_status';
  end case;

  note_clean := nullif(trim(coalesce(p_note,'')), '');

  insert into public.agent_work_status (profile_id, department_id, status, note, updated_at)
  values (uid, dept, st, note_clean, now())
  on conflict (profile_id)
  do update set status = excluded.status, note = excluded.note, department_id = excluded.department_id, updated_at = now();

  insert into public.agent_work_events (profile_id, department_id, status, note)
  values (uid, dept, st, note_clean);

  -- Reasonable defaults: end of shift makes chat offline, breaks mark chat away.
  if st = 'Fin turno'::public.agent_work_status_enum then
    perform public.chat_set_presence('offline', null);
  elsif st in ('Descanso'::public.agent_work_status_enum, 'Almuerzo'::public.agent_work_status_enum, 'Baño'::public.agent_work_status_enum) then
    perform public.chat_set_presence('ausente', null);
  end if;
end;
$$;

revoke all on function public.agent_set_work_status(text, text) from public;
grant execute on function public.agent_set_work_status(text, text) to authenticated;

commit;

-- ============================================================
-- 034_rmm_snapshots.sql
-- ============================================================
begin;

-- ---------------------------------------------------------------------
-- RMM snapshots (provider-agnostic)
-- - Stores latest device inventory/telemetry snapshots per asset.
-- - Designed to grow: add new `kind` values without schema changes.
-- ---------------------------------------------------------------------

create table if not exists public.rmm_snapshots (
  id uuid primary key default gen_random_uuid(),
  provider text not null, -- e.g. 'netlock'
  kind text not null,     -- e.g. 'device', 'hardware', 'apps_installed'
  asset_id uuid not null references public.assets (id) on delete cascade,

  -- Provider device key (e.g. access_key). Kept redundant for convenience.
  device_key text,

  -- Timestamp of the upstream snapshot (best-effort).
  source_ts timestamptz,

  payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists rmm_snapshots_uq on public.rmm_snapshots (provider, kind, asset_id);
create index if not exists rmm_snapshots_asset_idx on public.rmm_snapshots (asset_id, updated_at desc);
create index if not exists rmm_snapshots_device_key_idx on public.rmm_snapshots (provider, device_key);

drop trigger if exists t_rmm_snapshots_touch on public.rmm_snapshots;
create trigger t_rmm_snapshots_touch before update on public.rmm_snapshots
for each row execute function public._touch_updated_at();

create table if not exists public.rmm_sync_state (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  kind text not null,
  last_run_at timestamptz,
  last_cursor jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists rmm_sync_state_uq on public.rmm_sync_state (provider, kind);

drop trigger if exists t_rmm_sync_state_touch on public.rmm_sync_state;
create trigger t_rmm_sync_state_touch before update on public.rmm_sync_state
for each row execute function public._touch_updated_at();

alter table public.rmm_snapshots enable row level security;
alter table public.rmm_sync_state enable row level security;

-- Snapshots: same visibility model as assets (assigned user OR dept agent/supervisor/admin).
drop policy if exists rmm_snapshots_select on public.rmm_snapshots;
create policy rmm_snapshots_select on public.rmm_snapshots
for select to authenticated
using (
  exists (
    select 1
    from public.assets a
    where a.id = rmm_snapshots.asset_id
      and (
        (public._has_role(array['agent','supervisor','admin']::public.role_enum[]) and public._same_department(a.department_id))
        or exists (
          select 1
          from public.asset_assignments aa
          where aa.asset_id = a.id
            and aa.user_id = auth.uid()
            and aa.ended_at is null
        )
      )
  )
);

-- Writes: allow only admin via SQL policies (service role bypasses RLS anyway).
drop policy if exists rmm_snapshots_write_admin on public.rmm_snapshots;
create policy rmm_snapshots_write_admin on public.rmm_snapshots
for all to authenticated
using (public._has_role(array['admin']::public.role_enum[]))
with check (public._has_role(array['admin']::public.role_enum[]));

drop policy if exists rmm_sync_state_admin on public.rmm_sync_state;
create policy rmm_sync_state_admin on public.rmm_sync_state
for all to authenticated
using (public._has_role(array['admin']::public.role_enum[]))
with check (public._has_role(array['admin']::public.role_enum[]));

commit;

-- ============================================================
-- 035_rls_helpers_admin_global.sql
-- ============================================================
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

-- ============================================================
-- 036_security_hardening.sql
-- ============================================================
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

-- ============================================================
-- BOOTSTRAP PRODUCCION: usuarios existentes de Supabase Auth
-- ============================================================
begin;

insert into public.departments (name, description)
values ('TI', 'Mesa de ayuda y soporte HP')
on conflict (name) do nothing;

insert into public.profiles (id, email, full_name, role, department_id)
select
  u.id,
  coalesce(u.email, ''),
  nullif(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email, 'Usuario'), ''),
  'user'::public.role_enum,
  (select d.id from public.departments d where d.name = 'TI' order by d.created_at asc limit 1)
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

update public.profiles
set department_id = coalesce(
  department_id,
  (select d.id from public.departments d where d.name = 'TI' order by d.created_at asc limit 1)
);

with first_user as (
  select u.id
  from auth.users u
  order by u.created_at asc
  limit 1
)
update public.profiles p
set role = 'admin'::public.role_enum
where p.id in (select id from first_user);

commit;
