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
  IconStatusClosed,
  IconStatusInProgress,
  IconStatusPendingInfo,
  IconStatusRejected,
} from "@/components/icons/status-icons";

function statusStyle(status: TicketStatus) {
  if (status === "Cancelado") return "border-zinc-700 bg-zinc-900/40 text-zinc-200";
  if (status === "En Espera") return "border-amber-500/30 bg-amber-500/15 text-amber-200";
  if (status === "En Curso") return "border-[hsl(var(--brand-blue))]/30 bg-[hsl(var(--brand-blue))]/10 text-[hsl(var(--brand-blue))]";
  if (status === "Planificado o Coordinado") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  if (status === "Cerrado") return "border-emerald-500/30 bg-emerald-500/15 text-emerald-200";
  return "border-border bg-background/40 text-muted-foreground";
}

function StatusIcon({ status, className }: { status: TicketStatus; className?: string }) {
  const props = { className };
  if (status === "Cancelado") return <IconStatusRejected {...props} />;
  if (status === "En Espera") return <IconStatusPendingInfo {...props} />;
  if (status === "En Curso") return <IconStatusInProgress {...props} />;
  if (status === "Planificado o Coordinado") return <IconStatusPendingInfo {...props} />;
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
