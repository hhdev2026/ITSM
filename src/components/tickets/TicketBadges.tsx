"use client";

import * as React from "react";
import type { TicketPriority, TicketStatus, TicketType } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import {
  IconPriorityCritical,
  IconPriorityHigh,
  IconPriorityLow,
  IconPriorityMedium,
  IconStatusAssigned,
  IconStatusClosed,
  IconStatusInProgress,
  IconStatusNew,
  IconStatusPendingApproval,
  IconStatusPendingInfo,
  IconStatusRejected,
  IconStatusResolved,
} from "@/components/icons/status-icons";

function statusStyle(status: TicketStatus) {
  if (status === "Pendiente Aprobación") return "border-[hsl(var(--brand-cyan))]/30 bg-[hsl(var(--brand-cyan))]/10 text-[hsl(var(--brand-cyan))]";
  if (status === "Rechazado") return "border-rose-500/30 bg-rose-500/15 text-rose-200";
  if (status === "Cancelado") return "border-zinc-700 bg-zinc-900/40 text-zinc-200";
  if (status === "Nuevo") return "border-border bg-background/50 text-foreground";
  if (status === "Asignado") return "border-[hsl(var(--brand-blue))]/30 bg-[hsl(var(--brand-blue))]/10 text-[hsl(var(--brand-blue))]";
  if (status === "En Progreso") return "border-[hsl(var(--brand-violet))]/30 bg-[hsl(var(--brand-violet))]/10 text-[hsl(var(--brand-violet))]";
  if (status === "Pendiente Info") return "border-amber-500/30 bg-amber-500/15 text-amber-200";
  if (status === "Planificado") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  if (status === "Resuelto") return "border-emerald-500/30 bg-emerald-500/15 text-emerald-200";
  return "border-border bg-background/40 text-muted-foreground";
}

function StatusIcon({ status, className }: { status: TicketStatus; className?: string }) {
  const props = { className };
  if (status === "Pendiente Aprobación") return <IconStatusPendingApproval {...props} />;
  if (status === "Rechazado") return <IconStatusRejected {...props} />;
  if (status === "Cancelado") return <IconStatusRejected {...props} />;
  if (status === "Nuevo") return <IconStatusNew {...props} />;
  if (status === "Asignado") return <IconStatusAssigned {...props} />;
  if (status === "En Progreso") return <IconStatusInProgress {...props} />;
  if (status === "Pendiente Info") return <IconStatusPendingInfo {...props} />;
  if (status === "Planificado") return <IconStatusPendingInfo {...props} />;
  if (status === "Resuelto") return <IconStatusResolved {...props} />;
  return <IconStatusClosed {...props} />;
}

function priorityStyle(priority: TicketPriority) {
  if (priority === "Crítica") return "border-rose-500/30 bg-rose-500/15 text-rose-200";
  if (priority === "Alta") return "border-amber-500/30 bg-amber-500/15 text-amber-200";
  if (priority === "Media") return "border-sky-500/30 bg-sky-500/15 text-sky-200";
  return "border-emerald-500/30 bg-emerald-500/15 text-emerald-200";
}

function PriorityIcon({ priority, className }: { priority: TicketPriority; className?: string }) {
  const props = { className };
  if (priority === "Crítica") return <IconPriorityCritical {...props} />;
  if (priority === "Alta") return <IconPriorityHigh {...props} />;
  if (priority === "Media") return <IconPriorityMedium {...props} />;
  return <IconPriorityLow {...props} />;
}

export function TicketStatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1.5", statusStyle(status), className)}>
      <StatusIcon status={status} className="h-3.5 w-3.5" />
      {status}
    </Badge>
  );
}

export function TicketPriorityBadge({ priority, className }: { priority: TicketPriority; className?: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1.5", priorityStyle(priority), className)}>
      <PriorityIcon priority={priority} className="h-3.5 w-3.5" />
      {priority}
    </Badge>
  );
}

export function TicketTypeBadge({ type, className }: { type: TicketType; className?: string }) {
  const style =
    type === "Incidente"
      ? "border-[hsl(var(--brand-violet))]/30 bg-[hsl(var(--brand-violet))]/10 text-[hsl(var(--brand-violet))]"
      : "border-[hsl(var(--brand-cyan))]/30 bg-[hsl(var(--brand-cyan))]/10 text-[hsl(var(--brand-cyan))]";
  return (
    <Badge variant="outline" className={cn(style, className)}>
      {type}
    </Badge>
  );
}
