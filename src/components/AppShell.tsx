"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Profile } from "@/lib/types";
import { Logo } from "./Logo";
import { signOut } from "@/lib/hooks";

function NavItem({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={[
        "rounded-xl px-3 py-2 text-sm transition",
        active ? "bg-white/10 text-white" : "text-zinc-300 hover:bg-white/5 hover:text-white",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

export function AppShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const nav = profile.role === "user"
    ? [
        { href: "/app", label: "Mis Tickets" },
        { href: "/app/kb", label: "Autoservicio" },
      ]
    : profile.role === "agent"
      ? [
          { href: "/app", label: "Kanban" },
          { href: "/app/kb", label: "Knowledge Base" },
        ]
      : [
          { href: "/app", label: "Analytics" },
          { href: "/app/slas", label: "SLAs" },
          { href: "/app/kb", label: "Knowledge Base" },
        ];

  return (
    <div className="min-h-dvh bg-zinc-950">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 p-4 md:grid-cols-[260px_1fr] md:p-6">
        <aside className="rounded-2xl border border-white/10 bg-zinc-900/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <Logo />
            <button
              onClick={() => void signOut().then(() => window.location.assign("/login"))}
              className="rounded-xl bg-white/5 px-3 py-2 text-xs text-zinc-200 ring-1 ring-white/10 hover:bg-white/10"
            >
              Salir
            </button>
          </div>
          <div className="mt-4 rounded-2xl bg-black/20 p-3 ring-1 ring-white/10">
            <div className="text-sm font-medium">{profile.full_name || profile.email}</div>
            <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
              <span className="rounded-full bg-white/5 px-2 py-1 ring-1 ring-white/10">{profile.role}</span>
              <span className="rounded-full bg-white/5 px-2 py-1 ring-1 ring-white/10">
                {profile.rank} · {profile.points} pts
              </span>
            </div>
          </div>
          <nav className="mt-4 flex flex-wrap gap-2 md:flex-col">
            {nav.map((i) => (
              <NavItem key={i.href} href={i.href} label={i.label} />
            ))}
          </nav>
          <div className="mt-6 text-xs text-zinc-500">
            Departamento: <span className="text-zinc-300">{profile.department_id ?? "Sin asignar"}</span>
          </div>
        </aside>
        <main className="rounded-2xl border border-white/10 bg-zinc-900/30 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
