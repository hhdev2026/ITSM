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

