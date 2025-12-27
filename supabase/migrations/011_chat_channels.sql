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
