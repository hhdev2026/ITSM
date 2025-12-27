"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { Skeleton } from "@/components/ui/skeleton";

export function AppFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="min-h-dvh bg-background tech-app-bg">
      <div className="mx-auto max-w-7xl p-6">
        <div className={cn("tech-border tech-glow rounded-2xl p-[1px]", className)}>
          <div className="glass-surface rounded-2xl p-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function AppBootScreen({ label }: { label?: string }) {
  return (
    <AppFrame>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-9 w-28" />
        </div>
        <Skeleton className="h-4 w-72" />
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
        <div className="text-xs text-muted-foreground">{label ?? "Cargando…"} </div>
      </div>
    </AppFrame>
  );
}

export function AppNoticeScreen({
  variant = "info",
  title,
  description,
}: {
  variant?: "info" | "error" | "warning" | "success";
  title: string;
  description?: string | null;
}) {
  return (
    <AppFrame>
      <InlineAlert variant={variant} title={title} description={description ?? null} />
    </AppFrame>
  );
}

