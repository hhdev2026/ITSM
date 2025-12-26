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

export function IconTickets(props: Props) {
  return (
    <Svg title="Tickets" {...props}>
      <path d="M6 7.5h12a2 2 0 0 1 2 2v2a1.5 1.5 0 0 0 0 3v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a1.5 1.5 0 0 0 0-3v-2a2 2 0 0 1 2-2Z" />
      <path d="M9 12h6" />
    </Svg>
  );
}

export function IconKanban(props: Props) {
  return (
    <Svg title="Kanban" {...props}>
      <path d="M5 6.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" />
      <path d="M8 9v8" />
      <path d="M12 9v6" />
      <path d="M16 9v4" />
      <path d="M6.5 9h11" />
    </Svg>
  );
}

export function IconKb(props: Props) {
  return (
    <Svg title="Knowledge Base" {...props}>
      <path d="M5.5 5.5h6.5a2 2 0 0 1 2 2V19a2 2 0 0 0-2-2H5.5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" />
      <path d="M18.5 5.5H12a2 2 0 0 0-2 2V19a2 2 0 0 1 2-2h6.5a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1Z" />
      <path d="M8 9h3" />
      <path d="M13 9h3" />
    </Svg>
  );
}

export function IconAnalytics(props: Props) {
  return (
    <Svg title="Analytics" {...props}>
      <path d="M5 19V6.5a1.5 1.5 0 0 1 1.5-1.5H19" />
      <path d="M7.5 16l3.5-4 3 2 4-6" />
      <path d="M18 8v2h-2" />
    </Svg>
  );
}

export function IconSla(props: Props) {
  return (
    <Svg title="SLAs" {...props}>
      <path d="M12 21a9 9 0 1 0-9-9 9 9 0 0 0 9 9Z" />
      <path d="M12 7v5l3 2" />
      <path d="M7.5 4.5 6 3" />
      <path d="M16.5 4.5 18 3" />
    </Svg>
  );
}

export function IconCatalog(props: Props) {
  return (
    <Svg title="Catálogo" {...props}>
      <path d="M6.5 6.5h5v5h-5z" />
      <path d="M12.5 6.5h5v5h-5z" />
      <path d="M6.5 12.5h5v5h-5z" />
      <path d="M12.5 12.5h5v5h-5z" />
    </Svg>
  );
}

export function IconApprovals(props: Props) {
  return (
    <Svg title="Aprobaciones" {...props}>
      <path d="M12 21a9 9 0 1 0-9-9 9 9 0 0 0 9 9Z" />
      <path d="M8.5 12 11 14.5 15.8 9.7" />
    </Svg>
  );
}
