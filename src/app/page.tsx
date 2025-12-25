"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/hooks";
import { Logo } from "@/components/Logo";

export default function HomePage() {
  const router = useRouter();
  const { loading, session } = useSession();

  useEffect(() => {
    if (!loading && session) router.replace("/app");
  }, [loading, session, router]);

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-50">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-16">
        <Logo />
        <h1 className="text-3xl font-semibold tracking-tight">Mesa de Servicios (ITSM)</h1>
        <p className="text-zinc-300">
          Gestiona incidentes y requerimientos con buenas prácticas ITIL: Kanban para agentes, autoservicio, SLAs y
          analítica para supervisión.
        </p>
        <div className="flex gap-3">
          <Link
            href="/login"
            className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-100"
          >
            Ingresar
          </Link>
          <Link
            href="/login"
            className="rounded-xl bg-white/5 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/10 hover:bg-white/10"
          >
            Crear cuenta
          </Link>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm font-medium">Kanban</div>
            <div className="mt-1 text-xs text-zinc-400">Estados y priorización con SLA.</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm font-medium">Autoservicio</div>
            <div className="mt-1 text-xs text-zinc-400">Knowledge Base para reducir tickets.</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm font-medium">Analytics</div>
            <div className="mt-1 text-xs text-zinc-400">KPIs: MTTR, SLA, FCR y carga.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

