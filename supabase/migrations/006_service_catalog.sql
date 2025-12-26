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

