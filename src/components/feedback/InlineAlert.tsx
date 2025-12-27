"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";

type Variant = "error" | "warning" | "info" | "success";

const iconByVariant: Record<Variant, React.ComponentType<{ className?: string }>> = {
  error: AlertCircle,
  warning: TriangleAlert,
  info: Info,
  success: CheckCircle2,
};

function styleByVariant(variant: Variant) {
  if (variant === "error") return "border-destructive/30 bg-destructive/10 text-destructive-foreground";
  if (variant === "warning") return "border-amber-500/30 bg-amber-500/10 text-amber-100";
  if (variant === "success") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
  return "border-border/60 bg-background/40 text-foreground";
}

export function InlineAlert({
  variant = "info",
  title,
  description,
  className,
}: {
  variant?: Variant;
  title?: string | null;
  description?: string | null;
  className?: string;
}) {
  const Icon = iconByVariant[variant];
  return (
    <div className={cn("rounded-xl border px-3 py-2", "glass-surface", styleByVariant(variant), className)}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 opacity-90" />
        <div className="min-w-0">
          {title ? <div className="text-sm font-medium">{title}</div> : null}
          {description ? <div className={cn("text-sm", title ? "text-foreground/80" : "text-foreground/90")}>{description}</div> : null}
        </div>
      </div>
    </div>
  );
}

