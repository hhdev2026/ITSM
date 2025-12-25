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
  ('Software', 'Instalación/errores/licencias', '11111111-1111-1111-1111-111111111111')
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

commit;

