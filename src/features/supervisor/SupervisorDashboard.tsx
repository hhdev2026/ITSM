"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import type { Category, Profile } from "@/lib/types";
import Link from "next/link";
import { isDemoMode } from "@/lib/demo";
import { listCategories as demoListCategories, computeKpis as demoComputeKpis } from "@/lib/demoStore";
import { listDemoAgents } from "@/lib/demoAuth";

type KpiData = {
  range: { start: string; end: string };
  volume: { created: number; closed: number };
  mttr_hours: number;
  sla_compliance_pct: number | null;
  pending_by_priority: Record<string, number>;
  workload: Array<{ agent_id: string; agent_name: string; open_assigned: number }>;
  fcr_pct: number | null;
};

const Periods = [
  { value: "daily", label: "Diario" },
  { value: "weekly", label: "Semanal" },
  { value: "monthly", label: "Mensual" },
] as const;

export function SupervisorDashboard({ profile }: { profile: Profile }) {
  const [period, setPeriod] = useState<(typeof Periods)[number]["value"]>("weekly");
  const [agentId, setAgentId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [agents, setAgents] = useState<Array<{ id: string; label: string }>>([]);
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

  async function loadLookups() {
    if (isDemoMode()) {
      setCategories((demoListCategories(profile.department_id!) as unknown) as Category[]);
      setAgents(listDemoAgents(profile.department_id!).map((p) => ({ id: p.id, label: p.full_name || p.email })));
      return;
    }
    const { data: cats } = await supabase
      .from("categories")
      .select("id,name,description,department_id")
      .eq("department_id", profile.department_id!)
      .order("name");
    setCategories((cats ?? []) as Category[]);

    const { data: profsRaw } = await supabase
      .from("profiles")
      .select("id,full_name,email,role")
      .in("role", ["agent", "supervisor"])
      .eq("department_id", profile.department_id!)
      .order("email");
    const profs = (profsRaw ?? []) as Array<{ id: string; full_name: string | null; email: string; role: string }>;
    setAgents(
      profs.map((p) => ({
        id: p.id,
        label: p.full_name || p.email,
      }))
    );
  }

  async function loadKpis() {
    setLoading(true);
    setError(null);
    if (isDemoMode()) {
      setKpis(demoComputeKpis(profile.department_id!, period, agentId || undefined, categoryId || undefined) as KpiData);
      setLoading(false);
      return;
    }
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setError("No hay sesión");
      setLoading(false);
      return;
    }
    const qs = new URLSearchParams({
      period,
      ...(agentId ? { agentId } : {}),
      ...(categoryId ? { categoryId } : {}),
    });
    const res = await fetch(`${apiBase}/api/analytics/kpis?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "No se pudo cargar KPIs");
      setKpis(null);
      setLoading(false);
      return;
    }
    setKpis((await res.json()) as KpiData);
    setLoading(false);
  }

  useEffect(() => {
    void loadLookups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.department_id]);

  useEffect(() => {
    void loadKpis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, agentId, categoryId]);

  const pendingRows = useMemo(() => {
    const p = kpis?.pending_by_priority ?? {};
    return ["Crítica", "Alta", "Media", "Baja"].map((k) => ({ k, v: p[k] ?? 0 }));
  }, [kpis]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
        <div>
          <div className="text-xl font-semibold">Analytics (Supervisor)</div>
          <div className="mt-1 text-sm text-zinc-400">KPIs operativos con filtros por agente, categoría y periodo.</div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/app/slas"
            className="rounded-xl bg-white/5 px-3 py-2 text-sm text-white ring-1 ring-white/10 hover:bg-white/10"
          >
            Configurar SLAs
          </Link>
          <Link
            href="/app/kb"
            className="rounded-xl bg-white/5 px-3 py-2 text-sm text-white ring-1 ring-white/10 hover:bg-white/10"
          >
            Knowledge Base
          </Link>
        </div>
      </div>

      <div className="grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 md:grid-cols-3">
        <label className="block">
          <div className="text-xs text-zinc-400">Periodo</div>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as (typeof Periods)[number]["value"])}
            className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-white/20"
          >
            {Periods.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <div className="text-xs text-zinc-400">Agente</div>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-white/20"
          >
            <option value="">Todos</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <div className="text-xs text-zinc-400">Categoría</div>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-white/20"
          >
            <option value="">Todas</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="rounded-xl bg-rose-500/15 px-3 py-2 text-xs text-rose-200 ring-1 ring-rose-500/25">{error}</div>}

      {loading ? (
        <div className="text-sm text-zinc-400">Cargando...</div>
      ) : !kpis ? (
        <div className="text-sm text-zinc-400">No hay datos.</div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-zinc-400">Tickets (creados vs cerrados)</div>
              <div className="mt-2 text-2xl font-semibold">
                {kpis.volume.created} / {kpis.volume.closed}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-zinc-400">MTTR (hrs)</div>
              <div className="mt-2 text-2xl font-semibold">{kpis.mttr_hours.toFixed(1)}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-zinc-400">Cumplimiento SLA</div>
              <div className="mt-2 text-2xl font-semibold">
                {kpis.sla_compliance_pct === null ? "n/a" : `${kpis.sla_compliance_pct}%`}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-zinc-400">FCR (aprox.)</div>
              <div className="mt-2 text-2xl font-semibold">{kpis.fcr_pct === null ? "n/a" : `${kpis.fcr_pct}%`}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-zinc-400">Rango</div>
              <div className="mt-2 text-xs text-zinc-300">
                {new Date(kpis.range.start).toLocaleString()} → {new Date(kpis.range.end).toLocaleString()}
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-medium">Tickets pendientes (snapshot)</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                {pendingRows.map((r) => (
                  <div key={r.k} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 ring-1 ring-white/10">
                    <div className="text-zinc-300">{r.k}</div>
                    <div className="font-semibold">{r.v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-medium">Carga de trabajo (asignados abiertos)</div>
              <div className="mt-3 space-y-2">
                {kpis.workload.length === 0 ? (
                  <div className="text-sm text-zinc-400">Sin agentes.</div>
                ) : (
                  kpis.workload.slice(0, 10).map((w) => (
                    <div key={w.agent_id} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 ring-1 ring-white/10">
                      <div className="truncate text-sm text-zinc-300">{w.agent_name}</div>
                      <div className="text-sm font-semibold">{w.open_assigned}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
