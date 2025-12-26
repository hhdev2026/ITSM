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

