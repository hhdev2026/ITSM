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

