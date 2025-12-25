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

type Store = {
  tickets: Ticket[];
  comments: Comment[];
  articles: Article[];
  slas: Sla[];
  categories: Category[];
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

export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) throw new Error("empty");
    const parsed = JSON.parse(raw) as Store;
    if (!parsed?.tickets || !parsed.comments || !parsed.articles || !parsed.slas || !parsed.categories) throw new Error("invalid");
    return parsed;
  } catch {
    const departmentId = "11111111-1111-1111-1111-111111111111";
    const slas: Sla[] = [
      { id: uuid("sla"), department_id: departmentId, priority: "Crítica", response_time_hours: 1, resolution_time_hours: 4, is_active: true, updated_at: nowIso() },
      { id: uuid("sla"), department_id: departmentId, priority: "Alta", response_time_hours: 2, resolution_time_hours: 8, is_active: true, updated_at: nowIso() },
      { id: uuid("sla"), department_id: departmentId, priority: "Media", response_time_hours: 4, resolution_time_hours: 24, is_active: true, updated_at: nowIso() },
      { id: uuid("sla"), department_id: departmentId, priority: "Baja", response_time_hours: 8, resolution_time_hours: 72, is_active: true, updated_at: nowIso() },
    ];

    const categories: Category[] = [
      { id: uuid("cat"), department_id: departmentId, name: "Accesos", description: "Permisos, MFA, altas/bajas" },
      { id: uuid("cat"), department_id: departmentId, name: "Red", description: "WiFi, VPN, conectividad" },
      { id: uuid("cat"), department_id: departmentId, name: "Hardware", description: "PCs, impresoras, periféricos" },
      { id: uuid("cat"), department_id: departmentId, name: "Software", description: "Instalación/errores/licencias" },
    ];

    const createdAt1 = new Date();
    createdAt1.setHours(createdAt1.getHours() - 3);
    const createdAt2 = new Date();
    createdAt2.setHours(createdAt2.getHours() - 10);
    const createdAt3 = new Date();
    createdAt3.setDate(createdAt3.getDate() - 2);

    const tickets: Ticket[] = [
      {
        id: uuid("tix"),
        department_id: departmentId,
        type: "Incidente",
        title: "No puedo acceder a VPN",
        description: "Error de autenticación al conectar desde casa.",
        status: "Nuevo",
        priority: "Alta",
        category_id: categories[1]!.id,
        requester_id: "demo-user-00000000-0000-0000-0000-000000000001",
        assignee_id: null,
        created_at: createdAt1.toISOString(),
        updated_at: createdAt1.toISOString(),
        sla_deadline: computeSlaDeadline(createdAt1.toISOString(), "Alta", slas),
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
        category_id: categories[3]!.id,
        requester_id: "demo-user-00000000-0000-0000-0000-000000000001",
        assignee_id: "demo-agent-00000000-0000-0000-0000-000000000001",
        created_at: createdAt2.toISOString(),
        updated_at: createdAt2.toISOString(),
        sla_deadline: computeSlaDeadline(createdAt2.toISOString(), "Media", slas),
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
        category_id: categories[2]!.id,
        requester_id: "demo-user-00000000-0000-0000-0000-000000000001",
        assignee_id: "demo-agent-00000000-0000-0000-0000-000000000001",
        created_at: createdAt3.toISOString(),
        updated_at: createdAt3.toISOString(),
        sla_deadline: computeSlaDeadline(createdAt3.toISOString(), "Baja", slas),
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

    const store: Store = { tickets, comments: [], articles, slas, categories };
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

export function createTicket(args: { requester_id: string; title: string; description: string | null; type: TicketType; priority: TicketPriority; category_id: string | null }) {
  const s = loadStore();
  const createdAt = nowIso();
  const departmentId = "11111111-1111-1111-1111-111111111111";
  const ticket: Ticket = {
    id: uuid("tix"),
    department_id: departmentId,
    type: args.type,
    title: args.title,
    description: args.description,
    status: "Nuevo",
    priority: args.priority,
    category_id: args.category_id,
    requester_id: args.requester_id,
    assignee_id: null,
    created_at: createdAt,
    updated_at: createdAt,
    sla_deadline: computeSlaDeadline(createdAt, args.priority, s.slas),
    first_response_at: null,
    resolved_at: null,
    closed_at: null,
  };
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

