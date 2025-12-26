export const TicketStatuses = ["Pendiente Aprobación", "Nuevo", "Asignado", "En Progreso", "Pendiente Info", "Resuelto", "Cerrado", "Rechazado"] as const;
export type TicketStatus = (typeof TicketStatuses)[number];

export const KanbanStatuses = ["Nuevo", "Asignado", "En Progreso", "Pendiente Info", "Resuelto"] as const;
export type KanbanStatus = (typeof KanbanStatuses)[number];

export const TicketPriorities = ["Crítica", "Alta", "Media", "Baja"] as const;
export type TicketPriority = (typeof TicketPriorities)[number];

export const TicketTypes = ["Incidente", "Requerimiento"] as const;
export type TicketType = (typeof TicketTypes)[number];

export const Roles = ["user", "agent", "supervisor", "admin"] as const;
export type Role = (typeof Roles)[number];

export function priorityBadge(priority: TicketPriority) {
  if (priority === "Crítica") return "bg-rose-500/20 text-rose-200 ring-1 ring-rose-500/30";
  if (priority === "Alta") return "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/30";
  if (priority === "Media") return "bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/30";
  return "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/30";
}

export function slaBadge(now: Date, slaDeadline: string | null) {
  if (!slaDeadline) return "bg-zinc-800/60 text-zinc-200 ring-1 ring-zinc-700";
  const d = new Date(slaDeadline);
  const ms = d.getTime() - now.getTime();
  if (ms <= 0) return "bg-rose-500/20 text-rose-200 ring-1 ring-rose-500/30";
  if (ms <= 2 * 60 * 60 * 1000) return "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/30";
  return "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/30";
}
