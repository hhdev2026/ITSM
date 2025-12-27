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

