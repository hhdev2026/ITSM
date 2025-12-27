"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export function InlineEmpty({
  title,
  description,
  icon,
  className,
}: {
  title: string;
  description?: string | null;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-dashed border-border bg-background/30 px-4 py-6 text-center", className)}>
      {icon ? <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-2xl bg-[hsl(var(--brand-cyan))]/10 text-[hsl(var(--brand-cyan))]">{icon}</div> : null}
      <div className="text-sm font-medium text-foreground/90">{title}</div>
      {description ? <div className="mt-1 text-sm text-muted-foreground">{description}</div> : null}
    </div>
  );
}

