"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export function PageHeader({
  title,
  description,
  kicker,
  meta,
  actions,
  className,
}: {
  title: string;
  description?: string | null;
  kicker?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0">
        {kicker ? <div className="text-xs text-muted-foreground">{kicker}</div> : null}
        <div className="text-pretty break-words text-2xl font-semibold tracking-tight">{title}</div>
        {description ? <div className="mt-1 text-sm text-muted-foreground">{description}</div> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
