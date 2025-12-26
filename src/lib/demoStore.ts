"use client";

import type { Comment, Ticket } from "./types";
import type { TicketPriority, TicketStatus, TicketType } from "./constants";

const KEY = "itsm_demo_store_v1";

type Article = {
  id: string;
  department_id: string;
  title: string;
  content: string;
  is_published: boolean;
  updated_at: string;
};

type Sla = {
  id: string;
  department_id: string | null;
  priority: TicketPriority;
  response_time_hours: number;
  resolution_time_hours: number;
  is_active: boolean;
  updated_at: string;
};

type Category = { id: string; department_id: string; name: string; description: string | null };
type Subcategory = { id: string; category_id: string; name: string; description: string | null };
type ServiceCatalogItem = {
  id: string;
  department_id: string | null;
  name: string;
  description: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  ticket_type: TicketType;
  default_priority: TicketPriority;
  default_impact: "Alto" | "Medio" | "Bajo";
  default_urgency: "Alta" | "Media" | "Baja";
  icon_key: string | null;
  is_active: boolean;
  updated_at: string;
};

type ServiceCatalogField = {
  id: string;
  service_id: string;
  key: string;
  label: string;
  field_type: "text" | "textarea" | "select" | "boolean" | "date" | "number";
  required: boolean;
  placeholder: string | null;
  help_text: string | null;
  options: string[] | null;
  sort_order: number;
  updated_at: string;
};

type Store = {
  tickets: Ticket[];
  comments: Comment[];
  articles: Article[];
  slas: Sla[];
  categories: Category[];
  subcategories: Subcategory[];
  services: ServiceCatalogItem[];
  service_fields: ServiceCatalogField[];
  service_approval_steps: Array<{
    id: string;
    service_id: string;
    step_order: number;
    kind: "requester_manager" | "service_owner" | "specific_user";
    required: boolean;
  }>;
  ticket_approvals: Array<{
    id: string;
    ticket_id: string;
    step_order: number;
    kind: "requester_manager" | "service_owner" | "specific_user";
    required: boolean;
    approver_profile_id: string;
    status: "pending" | "approved" | "rejected";
    decided_by: string | null;
    decided_at: string | null;
    decision_comment: string | null;
  }>;
};

function nowIso() {
  return new Date().toISOString();
}

function uuid(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

function computeSlaDeadline(createdAtIso: string, priority: TicketPriority, slas: Sla[]) {
  const created = new Date(createdAtIso);
  const active = slas.find((s) => s.is_active && s.priority === priority) ?? null;
  if (!active) return null;
  const d = new Date(created);
  d.setHours(d.getHours() + active.resolution_time_hours);
  return d.toISOString();
}

function computeResponseDeadline(createdAtIso: string, priority: TicketPriority, slas: Sla[]) {
  const created = new Date(createdAtIso);
  const active = slas.find((s) => s.is_active && s.priority === priority) ?? null;
  if (!active) return null;
  const d = new Date(created);
  d.setHours(d.getHours() + active.response_time_hours);
  return d.toISOString();
}

export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) throw new Error("empty");
    const parsed = JSON.parse(raw) as Partial<Store> & Record<string, unknown>;
    if (!parsed?.tickets || !parsed.comments || !parsed.articles || !parsed.slas || !parsed.categories || !parsed.subcategories) {
      throw new Error("invalid");
    }
    return {
      ...(parsed as Store),
      services: (parsed.services ?? []) as ServiceCatalogItem[],
      service_fields: (parsed.service_fields ?? []) as ServiceCatalogField[],
      service_approval_steps: (parsed.service_approval_steps ?? []) as Store["service_approval_steps"],
      ticket_approvals: (parsed.ticket_approvals ?? []) as Store["ticket_approvals"],
      tickets: parsed.tickets.map((t) => ({
        ...t,
        subcategory_id: ((t as unknown) as { subcategory_id?: string | null }).subcategory_id ?? null,
        metadata: ((t as unknown) as { metadata?: Record<string, unknown> }).metadata ?? {},
        response_deadline: ((t as unknown) as { response_deadline?: string | null }).response_deadline ?? null,
        ola_response_deadline: ((t as unknown) as { ola_response_deadline?: string | null }).ola_response_deadline ?? null,
        ola_deadline: ((t as unknown) as { ola_deadline?: string | null }).ola_deadline ?? null,
      })),
    };
  } catch {
    const departmentId = "11111111-1111-1111-1111-111111111111";
    const slas: Sla[] = [
      { id: uuid("sla"), department_id: departmentId, priority: "Crítica", response_time_hours: 1, resolution_time_hours: 4, is_active: true, updated_at: nowIso() },
      { id: uuid("sla"), department_id: departmentId, priority: "Alta", response_time_hours: 2, resolution_time_hours: 8, is_active: true, updated_at: nowIso() },
      { id: uuid("sla"), department_id: departmentId, priority: "Media", response_time_hours: 4, resolution_time_hours: 24, is_active: true, updated_at: nowIso() },
      { id: uuid("sla"), department_id: departmentId, priority: "Baja", response_time_hours: 8, resolution_time_hours: 72, is_active: true, updated_at: nowIso() },
    ];

    const categories: Category[] = [
      { id: uuid("cat"), department_id: departmentId, name: "Accesos", description: "Alta/baja, permisos, MFA" },
      { id: uuid("cat"), department_id: departmentId, name: "Correo", description: "Outlook/Exchange, buzones, listas" },
      { id: uuid("cat"), department_id: departmentId, name: "Red", description: "WiFi, VPN, conectividad" },
      { id: uuid("cat"), department_id: departmentId, name: "Hardware", description: "PCs, impresoras, periféricos" },
      { id: uuid("cat"), department_id: departmentId, name: "Software", description: "Instalación, errores, licencias" },
      { id: uuid("cat"), department_id: departmentId, name: "Seguridad", description: "Phishing, malware, incidentes" },
      { id: uuid("cat"), department_id: departmentId, name: "Colaboración", description: "Teams/Zoom/SharePoint/OneDrive" },
      { id: uuid("cat"), department_id: departmentId, name: "Telefonía", description: "Softphone, extensiones, voicemail" },
      { id: uuid("cat"), department_id: departmentId, name: "Onboarding/Offboarding", description: "Altas, bajas, equipo inicial" },
      { id: uuid("cat"), department_id: departmentId, name: "Aplicaciones", description: "ERP/CRM/apps internas" },
    ];

    const catByName = new Map(categories.map((c) => [c.name, c]));
    const subcategories: Subcategory[] = [
      { id: uuid("subcat"), category_id: catByName.get("Accesos")!.id, name: "Reset de contraseña", description: "Recuperación/cambio de contraseña, bloqueo, MFA" },
      { id: uuid("subcat"), category_id: catByName.get("Accesos")!.id, name: "Cuenta bloqueada", description: "Usuario bloqueado / demasiados intentos" },
      { id: uuid("subcat"), category_id: catByName.get("Accesos")!.id, name: "Alta/Baja de usuario", description: "Creación, baja, reactivación" },
      { id: uuid("subcat"), category_id: catByName.get("Accesos")!.id, name: "Permisos y roles", description: "Acceso a apps, carpetas, grupos" },
      { id: uuid("subcat"), category_id: catByName.get("Accesos")!.id, name: "MFA / 2FA", description: "Problemas con MFA, dispositivo, enrolamiento" },
      { id: uuid("subcat"), category_id: catByName.get("Accesos")!.id, name: "Acceso a carpeta compartida", description: "Permisos a recursos compartidos" },
      { id: uuid("subcat"), category_id: catByName.get("Correo")!.id, name: "No sincroniza", description: "Problemas de envío/recepción, sincronización" },
      { id: uuid("subcat"), category_id: catByName.get("Correo")!.id, name: "No envía / No recibe", description: "Mensajes rebotan, colas, límites" },
      { id: uuid("subcat"), category_id: catByName.get("Correo")!.id, name: "Buzón compartido", description: "Altas, permisos, delegación" },
      { id: uuid("subcat"), category_id: catByName.get("Correo")!.id, name: "Lista de distribución", description: "Crear/editar grupos, miembros" },
      { id: uuid("subcat"), category_id: catByName.get("Correo")!.id, name: "Firma", description: "Configuración de firma corporativa" },
      { id: uuid("subcat"), category_id: catByName.get("Red")!.id, name: "VPN no conecta", description: "Errores de autenticación/conectividad" },
      { id: uuid("subcat"), category_id: catByName.get("Red")!.id, name: "WiFi", description: "Conexión, cobertura, portal cautivo" },
      { id: uuid("subcat"), category_id: catByName.get("Red")!.id, name: "LAN / Cable", description: "Punto de red, switch, patch, DHCP" },
      { id: uuid("subcat"), category_id: catByName.get("Red")!.id, name: "DNS / Acceso web", description: "Resolución de nombres, proxy, navegación" },
      { id: uuid("subcat"), category_id: catByName.get("Hardware")!.id, name: "Impresora no imprime", description: "Cola, drivers, atasco, conectividad" },
      { id: uuid("subcat"), category_id: catByName.get("Hardware")!.id, name: "Laptop/PC lenta", description: "Rendimiento, disco, RAM" },
      { id: uuid("subcat"), category_id: catByName.get("Hardware")!.id, name: "Periféricos", description: "Mouse/teclado/docking/monitor" },
      { id: uuid("subcat"), category_id: catByName.get("Hardware")!.id, name: "Equipo dañado", description: "Golpe, pantalla rota, no enciende" },
      { id: uuid("subcat"), category_id: catByName.get("Hardware")!.id, name: "Nuevo equipo", description: "Solicitud de laptop/PC/accesorios" },
      { id: uuid("subcat"), category_id: catByName.get("Software")!.id, name: "Instalación", description: "Instalar/actualizar software" },
      { id: uuid("subcat"), category_id: catByName.get("Software")!.id, name: "Error de aplicación", description: "Crash, errores, licencias" },
      { id: uuid("subcat"), category_id: catByName.get("Software")!.id, name: "Licencias / Activación", description: "Asignación, activación, renovaciones" },
      { id: uuid("subcat"), category_id: catByName.get("Software")!.id, name: "Actualización", description: "Update, parches, compatibilidad" },
      { id: uuid("subcat"), category_id: catByName.get("Seguridad")!.id, name: "Phishing", description: "Reporte de correo sospechoso" },
      { id: uuid("subcat"), category_id: catByName.get("Seguridad")!.id, name: "Malware", description: "Virus, comportamiento anómalo, cuarentena" },
      { id: uuid("subcat"), category_id: catByName.get("Seguridad")!.id, name: "Incidente de seguridad", description: "Acceso no autorizado, fuga, alerta" },
      { id: uuid("subcat"), category_id: catByName.get("Colaboración")!.id, name: "Microsoft Teams", description: "Llamadas, reuniones, chat, canales" },
      { id: uuid("subcat"), category_id: catByName.get("Colaboración")!.id, name: "Zoom/Meet", description: "Audio/video, salas, permisos" },
      { id: uuid("subcat"), category_id: catByName.get("Colaboración")!.id, name: "SharePoint/OneDrive", description: "Sync, permisos, enlaces" },
      { id: uuid("subcat"), category_id: catByName.get("Telefonía")!.id, name: "Softphone", description: "Cliente de softphone, login, audio" },
      { id: uuid("subcat"), category_id: catByName.get("Telefonía")!.id, name: "Voicemail / Desvío", description: "Buzón de voz, desvíos, IVR" },
      { id: uuid("subcat"), category_id: catByName.get("Onboarding/Offboarding")!.id, name: "Onboarding (alta)", description: "Usuario nuevo: cuentas, accesos, equipo" },
      { id: uuid("subcat"), category_id: catByName.get("Onboarding/Offboarding")!.id, name: "Offboarding (baja)", description: "Baja: bloqueo, respaldos, devoluciones" },
      { id: uuid("subcat"), category_id: catByName.get("Aplicaciones")!.id, name: "ERP/CRM", description: "Acceso, errores, performance" },
      { id: uuid("subcat"), category_id: catByName.get("Aplicaciones")!.id, name: "Apps internas", description: "Portales internos, apps corporativas" },
    ];

    const createdAt1 = new Date();
    createdAt1.setHours(createdAt1.getHours() - 3);
    const createdAt2 = new Date();
    createdAt2.setHours(createdAt2.getHours() - 10);
    const createdAt3 = new Date();
    createdAt3.setDate(createdAt3.getDate() - 2);

    const subByName = new Map(subcategories.map((s) => [s.name, s]));

    const services: ServiceCatalogItem[] = [
      {
        id: uuid("svc"),
        department_id: departmentId,
        name: "Reset de contraseña",
        description: "Restablecimiento de contraseña / bloqueo / MFA.",
        category_id: catByName.get("Accesos")!.id,
        subcategory_id: subByName.get("Reset de contraseña")!.id,
        ticket_type: "Requerimiento",
        default_priority: "Alta",
        default_impact: "Medio",
        default_urgency: "Alta",
        icon_key: "access",
        is_active: true,
        updated_at: nowIso(),
      },
      {
        id: uuid("svc"),
        department_id: departmentId,
        name: "Solicitud de permisos",
        description: "Acceso a aplicación/carpeta/grupo/rol.",
        category_id: catByName.get("Accesos")!.id,
        subcategory_id: subByName.get("Permisos y roles")!.id,
        ticket_type: "Requerimiento",
        default_priority: "Media",
        default_impact: "Medio",
        default_urgency: "Media",
        icon_key: "access",
        is_active: true,
        updated_at: nowIso(),
      },
      {
        id: uuid("svc"),
        department_id: departmentId,
        name: "VPN no conecta",
        description: "Problemas de autenticación o conectividad por VPN.",
        category_id: catByName.get("Red")!.id,
        subcategory_id: subByName.get("VPN no conecta")!.id,
        ticket_type: "Incidente",
        default_priority: "Alta",
        default_impact: "Alto",
        default_urgency: "Alta",
        icon_key: "network",
        is_active: true,
        updated_at: nowIso(),
      },
      {
        id: uuid("svc"),
        department_id: departmentId,
        name: "Instalar software",
        description: "Instalación/actualización de software.",
        category_id: catByName.get("Software")!.id,
        subcategory_id: subByName.get("Instalación")!.id,
        ticket_type: "Requerimiento",
        default_priority: "Media",
        default_impact: "Medio",
        default_urgency: "Media",
        icon_key: "software",
        is_active: true,
        updated_at: nowIso(),
      },
      {
        id: uuid("svc"),
        department_id: departmentId,
        name: "Nuevo equipo",
        description: "Solicitud de laptop/PC/accesorios.",
        category_id: catByName.get("Hardware")!.id,
        subcategory_id: subByName.get("Nuevo equipo")!.id,
        ticket_type: "Requerimiento",
        default_priority: "Baja",
        default_impact: "Medio",
        default_urgency: "Baja",
        icon_key: "hardware",
        is_active: true,
        updated_at: nowIso(),
      },
      {
        id: uuid("svc"),
        department_id: departmentId,
        name: "Reporte de phishing",
        description: "Correo sospechoso, enlace o adjunto malicioso.",
        category_id: catByName.get("Seguridad")!.id,
        subcategory_id: subByName.get("Phishing")!.id,
        ticket_type: "Incidente",
        default_priority: "Alta",
        default_impact: "Alto",
        default_urgency: "Alta",
        icon_key: "security",
        is_active: true,
        updated_at: nowIso(),
      },
    ];

    const svcByName = new Map(services.map((s) => [s.name, s]));
    const service_fields: ServiceCatalogField[] = [
      { id: uuid("sf"), service_id: svcByName.get("Reset de contraseña")!.id, key: "affected_user", label: "Usuario afectado", field_type: "text", required: true, placeholder: "usuario@empresa.com", help_text: null, options: null, sort_order: 10, updated_at: nowIso() },
      { id: uuid("sf"), service_id: svcByName.get("Reset de contraseña")!.id, key: "mfa_issue", label: "¿Problema con MFA?", field_type: "select", required: false, placeholder: null, help_text: null, options: ["No", "Sí"], sort_order: 20, updated_at: nowIso() },

      { id: uuid("sf"), service_id: svcByName.get("Solicitud de permisos")!.id, key: "system", label: "Sistema / recurso", field_type: "text", required: true, placeholder: "Ej: ERP, Carpeta X", help_text: null, options: null, sort_order: 10, updated_at: nowIso() },
      { id: uuid("sf"), service_id: svcByName.get("Solicitud de permisos")!.id, key: "requested_role", label: "Rol / permiso solicitado", field_type: "text", required: true, placeholder: "Ej: Lectura, Admin", help_text: null, options: null, sort_order: 20, updated_at: nowIso() },
      { id: uuid("sf"), service_id: svcByName.get("Solicitud de permisos")!.id, key: "business_reason", label: "Justificación", field_type: "textarea", required: false, placeholder: "¿Por qué se necesita?", help_text: null, options: null, sort_order: 30, updated_at: nowIso() },

      { id: uuid("sf"), service_id: svcByName.get("VPN no conecta")!.id, key: "device", label: "Dispositivo", field_type: "select", required: false, placeholder: null, help_text: null, options: ["Laptop", "PC", "Móvil"], sort_order: 10, updated_at: nowIso() },
      { id: uuid("sf"), service_id: svcByName.get("VPN no conecta")!.id, key: "os", label: "Sistema operativo", field_type: "select", required: false, placeholder: null, help_text: null, options: ["Windows", "macOS", "Linux", "Android", "iOS"], sort_order: 20, updated_at: nowIso() },
      { id: uuid("sf"), service_id: svcByName.get("VPN no conecta")!.id, key: "error_message", label: "Mensaje de error", field_type: "text", required: false, placeholder: null, help_text: null, options: null, sort_order: 30, updated_at: nowIso() },

      { id: uuid("sf"), service_id: svcByName.get("Instalar software")!.id, key: "software", label: "Software", field_type: "text", required: true, placeholder: "Ej: Office, Visio", help_text: null, options: null, sort_order: 10, updated_at: nowIso() },
      { id: uuid("sf"), service_id: svcByName.get("Instalar software")!.id, key: "license", label: "Licencia / suscripción", field_type: "select", required: false, placeholder: null, help_text: null, options: ["Ya tengo", "Necesito asignación", "No sé"], sort_order: 20, updated_at: nowIso() },

      { id: uuid("sf"), service_id: svcByName.get("Nuevo equipo")!.id, key: "device_type", label: "Tipo de equipo", field_type: "select", required: true, placeholder: null, help_text: null, options: ["Laptop", "PC", "Monitor", "Docking", "Otro"], sort_order: 10, updated_at: nowIso() },
      { id: uuid("sf"), service_id: svcByName.get("Nuevo equipo")!.id, key: "for_user", label: "Para usuario", field_type: "text", required: true, placeholder: "usuario@empresa.com", help_text: null, options: null, sort_order: 20, updated_at: nowIso() },

      { id: uuid("sf"), service_id: svcByName.get("Reporte de phishing")!.id, key: "sender", label: "Remitente", field_type: "text", required: false, placeholder: "correo@dominio.com", help_text: null, options: null, sort_order: 10, updated_at: nowIso() },
      { id: uuid("sf"), service_id: svcByName.get("Reporte de phishing")!.id, key: "clicked", label: "¿Se hizo clic?", field_type: "select", required: false, placeholder: null, help_text: null, options: ["No", "Sí"], sort_order: 20, updated_at: nowIso() },
    ];

    const service_approval_steps: Store["service_approval_steps"] = [
      { id: uuid("as"), service_id: svcByName.get("Nuevo equipo")!.id, step_order: 10, kind: "requester_manager", required: true },
      { id: uuid("as"), service_id: svcByName.get("Nuevo equipo")!.id, step_order: 20, kind: "service_owner", required: true },
      { id: uuid("as"), service_id: svcByName.get("Solicitud de permisos")!.id, step_order: 10, kind: "requester_manager", required: true },
      { id: uuid("as"), service_id: svcByName.get("Solicitud de permisos")!.id, step_order: 20, kind: "service_owner", required: false },
    ];

    const ticket_approvals: Store["ticket_approvals"] = [];

    const tickets: Ticket[] = [
      {
        id: uuid("tix"),
        department_id: departmentId,
        type: "Incidente",
        title: "No puedo acceder a VPN",
        description: "Error de autenticación al conectar desde casa.",
        status: "Nuevo",
        priority: "Alta",
        category_id: catByName.get("Red")!.id,
        subcategory_id: subByName.get("VPN no conecta")!.id,
        metadata: { impact: "Alto", urgency: "Alta", location: "Remoto", device: "Laptop" },
        requester_id: "demo-user-00000000-0000-0000-0000-000000000001",
        assignee_id: null,
        created_at: createdAt1.toISOString(),
        updated_at: createdAt1.toISOString(),
        response_deadline: computeResponseDeadline(createdAt1.toISOString(), "Alta", slas),
        sla_deadline: computeSlaDeadline(createdAt1.toISOString(), "Alta", slas),
        ola_response_deadline: null,
        ola_deadline: null,
        first_response_at: null,
        resolved_at: null,
        closed_at: null,
      },
      {
        id: uuid("tix"),
        department_id: departmentId,
        type: "Requerimiento",
        title: "Instalar Office en laptop nueva",
        description: "Equipo nuevo para usuario de ventas.",
        status: "En Progreso",
        priority: "Media",
        category_id: catByName.get("Software")!.id,
        subcategory_id: subByName.get("Instalación")!.id,
        metadata: { software: "Office", license: "M365", device: "Laptop nueva", requesterDepartment: "Ventas" },
        requester_id: "demo-user-00000000-0000-0000-0000-000000000001",
        assignee_id: "demo-agent-00000000-0000-0000-0000-000000000001",
        created_at: createdAt2.toISOString(),
        updated_at: createdAt2.toISOString(),
        response_deadline: computeResponseDeadline(createdAt2.toISOString(), "Media", slas),
        sla_deadline: computeSlaDeadline(createdAt2.toISOString(), "Media", slas),
        ola_response_deadline: null,
        ola_deadline: null,
        first_response_at: null,
        resolved_at: null,
        closed_at: null,
      },
      {
        id: uuid("tix"),
        department_id: departmentId,
        type: "Incidente",
        title: "Impresora no imprime",
        description: "Cola de impresión se queda en pausa.",
        status: "Pendiente Info",
        priority: "Baja",
        category_id: catByName.get("Hardware")!.id,
        subcategory_id: subByName.get("Impresora no imprime")!.id,
        metadata: { location: "Oficina 2° piso", assetTag: "PRN-013", connection: "Red" },
        requester_id: "demo-user-00000000-0000-0000-0000-000000000001",
        assignee_id: "demo-agent-00000000-0000-0000-0000-000000000001",
        created_at: createdAt3.toISOString(),
        updated_at: createdAt3.toISOString(),
        response_deadline: computeResponseDeadline(createdAt3.toISOString(), "Baja", slas),
        sla_deadline: computeSlaDeadline(createdAt3.toISOString(), "Baja", slas),
        ola_response_deadline: null,
        ola_deadline: null,
        first_response_at: null,
        resolved_at: null,
        closed_at: null,
      },
    ];

    const articles: Article[] = [
      {
        id: uuid("kb"),
        department_id: departmentId,
        title: "VPN: pasos de diagnóstico rápido",
        content: "# VPN\n\n1) Verifica MFA\n2) Prueba otra red\n3) Reinstala el cliente\n",
        is_published: true,
        updated_at: nowIso(),
      },
      {
        id: uuid("kb"),
        department_id: departmentId,
        title: "Office: activación y licencias",
        content: "# Office\n\n- Inicia sesión con tu cuenta corporativa\n- Revisa asignación de licencia\n",
        is_published: true,
        updated_at: nowIso(),
      },
    ];

    const store: Store = {
      tickets,
      comments: [],
      articles,
      slas,
      categories,
      subcategories,
      services,
      service_fields,
      service_approval_steps,
      ticket_approvals,
    };
    saveStore(store);
    return store;
  }
}

export function saveStore(store: Store) {
  localStorage.setItem(KEY, JSON.stringify(store));
}

export function listCategories(departmentId: string) {
  const s = loadStore();
  return s.categories.filter((c) => c.department_id === departmentId);
}

export function listSubcategories(categoryId: string) {
  const s = loadStore();
  return s.subcategories.filter((sc) => sc.category_id === categoryId);
}

export function listServiceCatalogItems(departmentId: string) {
  const s = loadStore();
  return s.services.filter((svc) => svc.is_active && (svc.department_id === null || svc.department_id === departmentId)).sort((a, b) => a.name.localeCompare(b.name));
}

export function listServiceCatalogFields(serviceId: string) {
  const s = loadStore();
  return s.service_fields.filter((f) => f.service_id === serviceId).sort((a, b) => a.sort_order - b.sort_order);
}

export function listServiceApprovalSteps(serviceId: string) {
  const s = loadStore();
  return s.service_approval_steps.filter((x) => x.service_id === serviceId).sort((a, b) => a.step_order - b.step_order);
}

export function listTicketApprovals(ticketId: string) {
  const s = loadStore();
  return s.ticket_approvals.filter((x) => x.ticket_id === ticketId).sort((a, b) => a.step_order - b.step_order);
}

export function listPendingApprovalsForApprover(approverId: string) {
  const s = loadStore();
  return s.ticket_approvals
    .filter((x) => x.status === "pending" && x.approver_profile_id === approverId)
    .sort((a, b) => (a.ticket_id === b.ticket_id ? a.step_order - b.step_order : a.ticket_id.localeCompare(b.ticket_id)));
}

export function decideTicketApproval(args: { ticket_id: string; actor_id: string; action: "approve" | "reject"; comment?: string | null }) {
  const s = loadStore();
  const approval = s.ticket_approvals
    .filter((a) => a.ticket_id === args.ticket_id)
    .find((a) => a.status === "pending" && a.approver_profile_id === args.actor_id) ?? null;
  if (!approval) return null;
  approval.status = args.action === "approve" ? "approved" : "rejected";
  approval.decided_by = args.actor_id;
  approval.decided_at = nowIso();
  approval.decision_comment = args.comment ?? null;

  const t = s.tickets.find((x) => x.id === args.ticket_id) ?? null;
  if (t) {
    if (approval.status === "rejected") {
      t.status = "Rechazado" as TicketStatus;
      t.closed_at = t.closed_at ?? nowIso();
    } else {
      const pendingReq = s.ticket_approvals.some((a) => a.ticket_id === args.ticket_id && a.required && a.status === "pending");
      if (!pendingReq && t.status === ("Pendiente Aprobación" as TicketStatus)) {
        t.status = "Nuevo" as TicketStatus;
      }
    }
    t.updated_at = nowIso();
  }

  saveStore(s);
  return approval;
}

export function listTickets(filter: Partial<Pick<Ticket, "department_id" | "requester_id" | "assignee_id">> & { statusIn?: TicketStatus[] }) {
  const s = loadStore();
  return s.tickets
    .filter((t) => (filter.department_id ? t.department_id === filter.department_id : true))
    .filter((t) => (filter.requester_id ? t.requester_id === filter.requester_id : true))
    .filter((t) => (filter.assignee_id ? t.assignee_id === filter.assignee_id : true))
    .filter((t) => (filter.statusIn ? filter.statusIn.includes(t.status) : true))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getTicket(id: string) {
  const s = loadStore();
  return s.tickets.find((t) => t.id === id) ?? null;
}

export function createTicket(args: {
  requester_id: string;
  title: string;
  description: string | null;
  type: TicketType;
  priority: TicketPriority;
  category_id: string | null;
  subcategory_id: string | null;
  metadata?: Record<string, unknown>;
  status?: TicketStatus;
}) {
  const s = loadStore();
  const createdAt = nowIso();
  const departmentId = "11111111-1111-1111-1111-111111111111";

  const serviceId = ((args.metadata?.service_catalog as unknown) as { service_id?: string } | undefined)?.service_id ?? null;
  const approvalSteps = serviceId ? listServiceApprovalSteps(serviceId) : [];
  const needsApproval = approvalSteps.length > 0;

  const ticket: Ticket = {
    id: uuid("tix"),
    department_id: departmentId,
    type: args.type,
    title: args.title,
    description: args.description,
    status: args.status ?? (needsApproval ? ("Pendiente Aprobación" as TicketStatus) : ("Nuevo" as TicketStatus)),
    priority: args.priority,
    category_id: args.category_id,
    subcategory_id: args.subcategory_id,
    metadata: args.metadata ?? {},
    requester_id: args.requester_id,
    assignee_id: null,
    created_at: createdAt,
    updated_at: createdAt,
    response_deadline: computeResponseDeadline(createdAt, args.priority, s.slas),
    sla_deadline: computeSlaDeadline(createdAt, args.priority, s.slas),
    ola_response_deadline: null,
    ola_deadline: null,
    first_response_at: null,
    resolved_at: null,
    closed_at: null,
  };

  if (needsApproval) {
    const fallbackApproverId = "demo-supervisor-0000-0000-0000-000000000001";
    for (const step of approvalSteps) {
      s.ticket_approvals.push({
        id: uuid("appr"),
        ticket_id: ticket.id,
        step_order: step.step_order,
        kind: step.kind,
        required: step.required,
        approver_profile_id: fallbackApproverId,
        status: "pending",
        decided_by: null,
        decided_at: null,
        decision_comment: null,
      });
    }
  }

  s.tickets.unshift(ticket);
  saveStore(s);
  return ticket;
}

export function updateTicket(id: string, patch: Partial<Pick<Ticket, "status" | "assignee_id">>) {
  const s = loadStore();
  const t = s.tickets.find((x) => x.id === id);
  if (!t) return null;
  if (patch.status) t.status = patch.status;
  if ("assignee_id" in patch) t.assignee_id = patch.assignee_id ?? null;
  t.updated_at = nowIso();
  if (t.status === "Resuelto" && !t.resolved_at) t.resolved_at = nowIso();
  if (t.status === "Cerrado" && !t.closed_at) t.closed_at = nowIso();
  saveStore(s);
  return t;
}

export function listComments(ticketId: string) {
  const s = loadStore();
  return s.comments.filter((c) => c.ticket_id === ticketId).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function addComment(args: { ticket_id: string; author_id: string; body: string; is_internal: boolean }) {
  const s = loadStore();
  const c: Comment = { id: uuid("cmt"), ticket_id: args.ticket_id, author_id: args.author_id, body: args.body, is_internal: args.is_internal, created_at: nowIso() };
  s.comments.push(c);
  saveStore(s);
  return c;
}

export function listArticles(departmentId: string) {
  const s = loadStore();
  return s.articles.filter((a) => a.department_id === departmentId).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function getArticle(id: string) {
  const s = loadStore();
  return s.articles.find((a) => a.id === id) ?? null;
}

export function createArticle(args: { department_id: string; title: string; content: string; is_published: boolean }) {
  const s = loadStore();
  const a: Article = { id: uuid("kb"), department_id: args.department_id, title: args.title, content: args.content, is_published: args.is_published, updated_at: nowIso() };
  s.articles.unshift(a);
  saveStore(s);
  return a;
}

export function updateArticle(id: string, patch: Partial<Pick<Article, "title" | "content" | "is_published">>) {
  const s = loadStore();
  const a = s.articles.find((x) => x.id === id);
  if (!a) return null;
  if (typeof patch.title === "string") a.title = patch.title;
  if (typeof patch.content === "string") a.content = patch.content;
  if (typeof patch.is_published === "boolean") a.is_published = patch.is_published;
  a.updated_at = nowIso();
  saveStore(s);
  return a;
}

export function listSlas(departmentId: string) {
  const s = loadStore();
  return s.slas.filter((x) => x.department_id === null || x.department_id === departmentId).sort((a, b) => a.priority.localeCompare(b.priority));
}

export function createSla(args: { department_id: string; priority: TicketPriority; response_time_hours: number; resolution_time_hours: number; is_active: boolean }) {
  const s = loadStore();
  const sla: Sla = { id: uuid("sla"), department_id: args.department_id, priority: args.priority, response_time_hours: args.response_time_hours, resolution_time_hours: args.resolution_time_hours, is_active: args.is_active, updated_at: nowIso() };
  s.slas.unshift(sla);
  saveStore(s);
  return sla;
}

export function toggleSla(id: string, is_active: boolean) {
  const s = loadStore();
  const sla = s.slas.find((x) => x.id === id);
  if (!sla) return null;
  sla.is_active = is_active;
  sla.updated_at = nowIso();
  saveStore(s);
  return sla;
}

export function computeKpis(departmentId: string, period: "daily" | "weekly" | "monthly", agentId?: string, categoryId?: string) {
  const s = loadStore();
  const end = new Date();
  const start = new Date(end);
  if (period === "daily") start.setDate(end.getDate() - 1);
  if (period === "weekly") start.setDate(end.getDate() - 7);
  if (period === "monthly") start.setMonth(end.getMonth() - 1);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const base = s.tickets
    .filter((t) => t.department_id === departmentId)
    .filter((t) => (agentId ? t.assignee_id === agentId : true))
    .filter((t) => (categoryId ? t.category_id === categoryId : true));

  const created = base.filter((t) => t.created_at >= startIso && t.created_at < endIso).length;
  const closedTickets = base.filter((t) => t.status === "Cerrado" && t.closed_at && t.closed_at >= startIso && t.closed_at < endIso);
  const closed = closedTickets.length;

  const mttrHours =
    closedTickets.length === 0
      ? 0
      : closedTickets.reduce((acc, t) => acc + (new Date(t.closed_at!).getTime() - new Date(t.created_at).getTime()), 0) / closedTickets.length / 3600000;

  const slaTotal = closedTickets.filter((t) => !!t.sla_deadline).length;
  const slaOk = closedTickets.filter((t) => !!t.sla_deadline && new Date(t.closed_at!).getTime() <= new Date(t.sla_deadline!).getTime()).length;
  const slaPct = slaTotal === 0 ? null : Math.round(((slaOk / slaTotal) * 100 + Number.EPSILON) * 100) / 100;

  const pending = base.filter((t) => t.status !== "Cerrado");
  const pendingByPriority = {
    "Crítica": pending.filter((t) => t.priority === "Crítica").length,
    "Alta": pending.filter((t) => t.priority === "Alta").length,
    "Media": pending.filter((t) => t.priority === "Media").length,
    "Baja": pending.filter((t) => t.priority === "Baja").length,
  };

  const workloadMap = new Map<string, number>();
  for (const t of pending) {
    if (!t.assignee_id) continue;
    workloadMap.set(t.assignee_id, (workloadMap.get(t.assignee_id) ?? 0) + 1);
  }

  const workload = Array.from(workloadMap.entries()).map(([agent_id, open_assigned]) => ({
    agent_id,
    agent_name: agent_id.slice(0, 8),
    open_assigned,
  }));

  return {
    range: { start: startIso, end: endIso },
    volume: { created, closed },
    mttr_hours: mttrHours,
    sla_compliance_pct: slaPct,
    pending_by_priority: pendingByPriority,
    workload,
    fcr_pct: null as number | null,
  };
}
