import type { Role, TicketPriority, TicketStatus, TicketType } from "./constants";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  department_id: string | null;
  manager_id?: string | null;
  points: number;
  rank: string;
};

export type Ticket = {
  id: string;
  ticket_number?: number | string | null;
  department_id: string;
  type: TicketType;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  category_id: string | null;
  subcategory_id: string | null;
  metadata: Record<string, unknown>;
  requester_id: string;
  assignee_id: string | null;
  created_at: string;
  updated_at: string;
  response_deadline: string | null;
  sla_deadline: string | null;
  ola_response_deadline: string | null;
  ola_deadline: string | null;
  solution_type?: "Instrucción al usuario" | "Soporte Remoto" | "Soporte Terreno" | "Implementación" | null;
  solution_notes?: string | null;
  sla_excluded?: boolean;
  sla_exclusion_reason?: string | null;
  sla_excluded_by?: string | null;
  sla_excluded_at?: string | null;
  planned_at?: string | null;
  planned_for_at?: string | null;
  canceled_at?: string | null;
  canceled_reason?: string | null;
  sla_remaining_minutes?: number;
  sla_traffic_light?: "green" | "yellow" | "red" | "closed" | "excluded" | null;
  sla_pct_used?: number | null;
  response_remaining_minutes?: number;
  response_traffic_light?: "green" | "yellow" | "red" | "closed" | "excluded" | null;
  response_pct_used?: number | null;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
};

export type Category = {
  id: string;
  name: string;
  description: string | null;
  department_id: string;
};

export type Subcategory = {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
};

export type ServiceCatalogItem = {
  id: string;
  department_id: string | null;
  name: string;
  user_name?: string | null;
  description: string | null;
  user_description?: string | null;
  keywords?: string[] | null;
  category_id: string | null;
  subcategory_id: string | null;
  tier1?: string | null;
  tier2?: string | null;
  tier3?: string | null;
  tier4?: string | null;
  ticket_type: TicketType;
  default_priority: TicketPriority;
  default_impact: "Alto" | "Medio" | "Bajo";
  default_urgency: "Alta" | "Media" | "Baja";
  icon_key: string | null;
  is_active: boolean;
};

export type ServiceCatalogField = {
  id: string;
  service_id: string;
  key: string;
  label: string;
  field_type: "text" | "textarea" | "select" | "boolean" | "date" | "number";
  required: boolean;
  placeholder: string | null;
  help_text: string | null;
  options: unknown | null;
  sort_order: number;
};

export type Comment = {
  id: string;
  ticket_id: string;
  author_id: string;
  body: string;
  is_internal: boolean;
  created_at: string;
};

export type ChatStatus = "En cola" | "Asignado" | "Activo" | "Cerrado";
export type AgentPresenceStatus = "Disponible" | "Ocupado" | "Ausente" | "Offline";

export type ChatThread = {
  id: string;
  department_id: string;
  requester_id: string;
  category_id: string | null;
  subcategory_id: string | null;
  skill_id: string | null;
  subject: string | null;
  status: ChatStatus;
  assigned_agent_id: string | null;
  assigned_at: string | null;
  accepted_at: string | null;
  first_response_at: string | null;
  closed_at: string | null;
  closed_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ChatMessage = {
  id: string;
  thread_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
};

export type ChatEvent = {
  id: string;
  thread_id: string;
  actor_id: string | null;
  event_type: "created" | "assigned" | "accepted" | "closed" | "message";
  details: Record<string, unknown>;
  created_at: string;
};

export type AgentPresence = {
  profile_id: string;
  department_id: string | null;
  status: AgentPresenceStatus;
  capacity: number;
  updated_at: string;
};

export type Skill = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category_id: string | null;
};

export type TaskStatus = "Pendiente" | "En curso" | "Completada" | "Cancelada";
export type TaskKind = "ticket" | "chat" | "approval" | "general";

export type Task = {
  id: string;
  department_id: string | null;
  kind: TaskKind;
  title: string;
  description: string | null;
  ticket_id: string | null;
  chat_thread_id: string | null;
  created_by: string | null;
  assignee_id: string;
  status: TaskStatus;
  due_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};
