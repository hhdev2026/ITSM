"use client";

import { cn } from "@/lib/cn";
import type { AgentPresenceStatus, ChatStatus, Profile } from "@/lib/types";

export function displayName(p: Pick<Profile, "full_name" | "email"> | null | undefined) {
  if (!p) return "—";
  return p.full_name?.trim() || p.email;
}

export function chatStatusBadge(status: ChatStatus) {
  if (status === "Activo") return "bg-emerald-500/15 text-emerald-200 border-emerald-500/30";
  if (status === "Asignado") return "bg-[hsl(var(--brand-cyan))]/12 text-[hsl(var(--brand-cyan))] border-[hsl(var(--brand-cyan))]/30";
  if (status === "En cola") return "bg-amber-500/15 text-amber-200 border-amber-500/30";
  return "bg-zinc-800/60 text-zinc-200 border-zinc-700";
}

export function presenceBadge(status: AgentPresenceStatus) {
  if (status === "Disponible") return "bg-emerald-500/15 text-emerald-200 border-emerald-500/30";
  if (status === "Ocupado") return "bg-amber-500/15 text-amber-200 border-amber-500/30";
  if (status === "Ausente") return "bg-zinc-800/60 text-zinc-200 border-zinc-700";
  return "bg-rose-500/15 text-rose-200 border-rose-500/30";
}

export function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

export function MetricTile({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl glass-surface p-3", className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

