"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

type Props = React.SVGProps<SVGSVGElement> & { className?: string; title?: string };

function Svg({ className, title, children, ...props }: Props & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : "presentation"}
      className={cn("h-4 w-4", className)}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export function IconStatusPendingApproval(props: Props) {
  return (
    <Svg title="Pendiente aprobación" {...props}>
      <path d="M12 21a9 9 0 1 0-9-9 9 9 0 0 0 9 9Z" />
      <path d="M12 7v5" />
      <path d="M12 16h.01" />
    </Svg>
  );
}

export function IconStatusNew(props: Props) {
  return (
    <Svg title="Nuevo" {...props}>
      <path d="M12 21a9 9 0 1 0-9-9 9 9 0 0 0 9 9Z" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </Svg>
  );
}

export function IconStatusAssigned(props: Props) {
  return (
    <Svg title="Asignado" {...props}>
      <path d="M8 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      <path d="M16.5 12.5 19 15l-4 4" />
      <path d="M12 20a6 6 0 0 0-12 0" />
      <path d="M19 15h-6" />
    </Svg>
  );
}

export function IconStatusInProgress(props: Props) {
  return (
    <Svg title="En progreso" {...props}>
      <path d="M12 21a9 9 0 1 0-9-9 9 9 0 0 0 9 9Z" />
      <path d="M10 8.5 16 12l-6 3.5Z" />
    </Svg>
  );
}

export function IconStatusPendingInfo(props: Props) {
  return (
    <Svg title="Pendiente info" {...props}>
      <path d="M12 21a9 9 0 1 0-9-9 9 9 0 0 0 9 9Z" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.6-2 2-2 3.5" />
      <path d="M12 16h.01" />
    </Svg>
  );
}

export function IconStatusResolved(props: Props) {
  return (
    <Svg title="Resuelto" {...props}>
      <path d="M12 21a9 9 0 1 0-9-9 9 9 0 0 0 9 9Z" />
      <path d="M8.5 12 11 14.5 15.8 9.7" />
    </Svg>
  );
}

export function IconStatusClosed(props: Props) {
  return (
    <Svg title="Cerrado" {...props}>
      <path d="M6 8h12" />
      <path d="M7 8v10a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V8" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </Svg>
  );
}

export function IconStatusRejected(props: Props) {
  return (
    <Svg title="Rechazado" {...props}>
      <path d="M12 21a9 9 0 1 0-9-9 9 9 0 0 0 9 9Z" />
      <path d="M9 9l6 6" />
      <path d="M15 9l-6 6" />
    </Svg>
  );
}

export function IconPriorityCritical(props: Props) {
  return (
    <Svg title="Crítica" {...props}>
      <path d="M12 3l8 14H4L12 3Z" />
      <path d="M12 9v4" />
      <path d="M12 15h.01" />
    </Svg>
  );
}

export function IconPriorityHigh(props: Props) {
  return (
    <Svg title="Alta" {...props}>
      <path d="M12 3l6 7-6 7-6-7Z" />
    </Svg>
  );
}

export function IconPriorityMedium(props: Props) {
  return (
    <Svg title="Media" {...props}>
      <path d="M7 12h10" />
      <path d="M7 8h10" />
      <path d="M7 16h10" />
    </Svg>
  );
}

export function IconPriorityLow(props: Props) {
  return (
    <Svg title="Baja" {...props}>
      <path d="M8 10l4 4 4-4" />
    </Svg>
  );
}

