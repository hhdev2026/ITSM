"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description?: string | null;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("tech-border", className)}>
      <CardHeader className="items-center text-center">
        {icon ? <div className="mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-[hsl(var(--brand-cyan))]/10 text-[hsl(var(--brand-cyan))]">{icon}</div> : null}
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription className="max-w-md">{description}</CardDescription> : null}
      </CardHeader>
      {action ? <CardContent className="flex justify-center pt-0">{action}</CardContent> : null}
    </Card>
  );
}

