import type { Role, TicketPriority, TicketStatus, TicketType } from "./constants";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  department_id: string | null;
  points: number;
  rank: string;
};

export type Ticket = {
  id: string;
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
  description: string | null;
  category_id: string | null;
  subcategory_id: string | null;
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
