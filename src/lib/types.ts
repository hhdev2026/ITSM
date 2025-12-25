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
  requester_id: string;
  assignee_id: string | null;
  created_at: string;
  updated_at: string;
  sla_deadline: string | null;
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

export type Comment = {
  id: string;
  ticket_id: string;
  author_id: string;
  body: string;
  is_internal: boolean;
  created_at: string;
};

