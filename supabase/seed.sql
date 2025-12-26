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
