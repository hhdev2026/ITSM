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
      className={cn("h-5 w-5", className)}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export function IconAccess(props: Props) {
  return (
    <Svg title="Accesos" {...props}>
      <path d="M12 10.5a3 3 0 1 0-3-3 3 3 0 0 0 3 3Z" />
      <path d="M6.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M19 8.5h3" />
      <path d="M20.5 7v3" />
    </Svg>
  );
}

export function IconMail(props: Props) {
  return (
    <Svg title="Correo" {...props}>
      <path d="M4.5 7.5h15A2.5 2.5 0 0 1 22 10v8a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18v-8a2.5 2.5 0 0 1 2.5-2.5Z" />
      <path d="m4 10 8 5 8-5" />
    </Svg>
  );
}

export function IconNetwork(props: Props) {
  return (
    <Svg title="Red" {...props}>
      <path d="M7 7.5a3 3 0 1 0 0 6" />
      <path d="M17 7.5a3 3 0 1 1 0 6" />
      <path d="M7 10.5h10" />
      <path d="M12 13v6.5" />
      <path d="M9.5 19.5h5" />
    </Svg>
  );
}

export function IconHardware(props: Props) {
  return (
    <Svg title="Hardware" {...props}>
      <path d="M7 6.5h10a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Z" />
      <path d="M9 19.5h6" />
      <path d="M10 16h4" />
    </Svg>
  );
}

export function IconSoftware(props: Props) {
  return (
    <Svg title="Software" {...props}>
      <path d="M7.5 4.5h9A2.5 2.5 0 0 1 19 7v10a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 17V7A2.5 2.5 0 0 1 7.5 4.5Z" />
      <path d="M8 9h8" />
      <path d="M8 12.5h5" />
      <path d="M8 16h4" />
    </Svg>
  );
}

export function IconShield(props: Props) {
  return (
    <Svg title="Seguridad" {...props}>
      <path d="M12 3.5 19 6.5v6.2c0 4-2.6 7-7 8.8-4.4-1.8-7-4.8-7-8.8V6.5l7-3Z" />
      <path d="M9.5 12.5 11.3 14.3 14.8 10.8" />
    </Svg>
  );
}

export function IconPhone(props: Props) {
  return (
    <Svg title="Telefonía" {...props}>
      <path d="M8.2 5.4 6.9 4.1A2 2 0 0 0 4 4.4c-1 1.8-.3 5.3 3 8.6s6.8 4 8.6 3a2 2 0 0 0 .3-2.9l-1.3-1.3" />
      <path d="M14 9.5a3.5 3.5 0 0 1 2.5 2.5" />
      <path d="M16.5 8a5.5 5.5 0 0 1 3.5 3.5" />
    </Svg>
  );
}

export function IconUsers(props: Props) {
  return (
    <Svg title="Onboarding" {...props}>
      <path d="M9 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3Z" />
      <path d="M17 10.5a2.5 2.5 0 1 0-2.5-2.5A2.5 2.5 0 0 0 17 10.5Z" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M14.5 20a4.5 4.5 0 0 1 6 0" />
    </Svg>
  );
}

export function IconApp(props: Props) {
  return (
    <Svg title="Aplicaciones" {...props}>
      <path d="M7 4.5h10A2.5 2.5 0 0 1 19.5 7v10A2.5 2.5 0 0 1 17 19.5H7A2.5 2.5 0 0 1 4.5 17V7A2.5 2.5 0 0 1 7 4.5Z" />
      <path d="M9 9h6" />
      <path d="M9 12h6" />
      <path d="M9 15h4" />
    </Svg>
  );
}

