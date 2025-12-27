"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import type { Category, Profile } from "@/lib/types";
import Link from "next/link";
import { isDemoMode } from "@/lib/demo";
import { listCategories as demoListCategories, computeKpis as demoComputeKpis } from "@/lib/demoStore";
import { listDemoAgents } from "@/lib/demoAuth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
      <PageHeader
        title="Panel (Supervisor)"
        description="KPIs operativos con filtros por agente, categoría y periodo."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/app/slas">SLAs</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/app/kb">Base de conocimiento</Link>
            </Button>
            <Button variant="outline" onClick={() => void loadKpis()}>
              Actualizar
            </Button>
          </>
        }
      />

      <Card className="tech-border">
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>Restringe KPIs por periodo, agente y categoría.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
        <label className="block">
          <div className="text-xs text-muted-foreground">Periodo</div>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as (typeof Periods)[number]["value"])}
            className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
          >
            {Periods.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <div className="text-xs text-muted-foreground">Agente</div>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
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
          <div className="text-xs text-muted-foreground">Categoría</div>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
          >
            <option value="">Todas</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">{error}</div>
      ) : null}

      {loading ? (
        <div className="text-sm text-muted-foreground">Cargando…</div>
      ) : !kpis ? (
        <Card className="tech-border">
          <CardHeader>
            <CardTitle>Sin datos</CardTitle>
            <CardDescription>No hay KPIs disponibles para este filtro.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            <Card className="tech-border">
              <CardHeader className="gap-2">
                <CardTitle>Tickets</CardTitle>
                <CardDescription>Creados / cerrados</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl font-semibold">
                  {kpis.volume.created} / {kpis.volume.closed}
                </div>
              </CardContent>
            </Card>
            <Card className="tech-border">
              <CardHeader className="gap-2">
                <CardTitle>MTTR</CardTitle>
                <CardDescription>Horas</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl font-semibold">{kpis.mttr_hours.toFixed(1)}</div>
              </CardContent>
            </Card>
            <Card className="tech-border">
              <CardHeader className="gap-2">
                <CardTitle>SLA</CardTitle>
                <CardDescription>Cumplimiento</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl font-semibold">{kpis.sla_compliance_pct === null ? "n/a" : `${kpis.sla_compliance_pct}%`}</div>
              </CardContent>
            </Card>
            <Card className="tech-border">
              <CardHeader className="gap-2">
                <CardTitle>FCR</CardTitle>
                <CardDescription>Aprox.</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl font-semibold">{kpis.fcr_pct === null ? "n/a" : `${kpis.fcr_pct}%`}</div>
              </CardContent>
            </Card>
            <Card className="tech-border">
              <CardHeader className="gap-2">
                <CardTitle>Rango</CardTitle>
                <CardDescription>Ventana</CardDescription>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground">
                {new Date(kpis.range.start).toLocaleString()} → {new Date(kpis.range.end).toLocaleString()}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Card className="tech-border">
              <CardHeader>
                <CardTitle>Pendientes</CardTitle>
                <CardDescription>Snapshot por prioridad.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 text-sm">
                {pendingRows.map((r) => (
                  <div key={r.k} className="flex items-center justify-between rounded-xl border border-border bg-background/40 px-3 py-2">
                    <div className="text-muted-foreground">{r.k}</div>
                    <div className="font-semibold">{r.v}</div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="tech-border">
              <CardHeader>
                <CardTitle>Carga de trabajo</CardTitle>
                <CardDescription>Asignados abiertos (top 10).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {kpis.workload.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Sin agentes.</div>
                ) : (
                  kpis.workload.slice(0, 10).map((w) => (
                    <div key={w.agent_id} className="flex items-center justify-between rounded-xl border border-border bg-background/40 px-3 py-2">
                      <div className="truncate text-sm text-muted-foreground">{w.agent_name}</div>
                      <Badge variant="outline">{w.open_assigned}</Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
