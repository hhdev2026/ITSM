"use client";

import { Badge } from "@/components/ui/badge";
import type { AssetConnectivityStatus, AssetLifecycleStatus } from "@/lib/types";
import { cn } from "@/lib/cn";

export function AssetConnectivityBadge({ status, compact }: { status: AssetConnectivityStatus; compact?: boolean }) {
  const cls =
    status === "Online"
      ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/25"
      : status === "Offline"
        ? "bg-rose-500/15 text-rose-200 ring-1 ring-rose-500/25"
        : status === "Crítico"
          ? "bg-rose-500/20 text-rose-100 ring-1 ring-rose-500/35"
          : status === "Durmiente"
            ? "bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/25"
            : "bg-muted/40 text-muted-foreground ring-1 ring-border";

  const label = compact
    ? status === "Crítico"
      ? "!"
      : status === "Online"
        ? "ON"
        : status === "Offline"
          ? "OFF"
          : status === "Durmiente"
            ? "Zz"
            : "?"
    : status;

  return (
    <Badge className={cn("whitespace-nowrap", cls)} variant="default">
      {label}
    </Badge>
  );
}

export function AssetLifecycleBadge({ status }: { status: AssetLifecycleStatus }) {
  const cls =
    status === "Activo"
      ? "bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/25"
      : status === "En reparación"
        ? "bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/25"
        : status === "Retirado"
          ? "bg-muted/40 text-muted-foreground ring-1 ring-border"
          : "bg-zinc-500/20 text-zinc-200 ring-1 ring-zinc-500/25";
  return (
    <Badge className={cn("whitespace-nowrap", cls)} variant="default">
      {status}
    </Badge>
  );
}
