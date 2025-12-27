"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import type { Category, Profile } from "@/lib/types";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCard } from "@/components/charts/ChartCard";
import { SlaLineChart, TimeLineChart, VolumeAreaChart } from "@/components/charts/Charts";

type KpiData = {
  range: { start: string; end: string };
  volume: { created: number; closed: number; canceled?: number };
  mttr_hours: number;
  sla_compliance_pct: number | null;
  pending_by_priority: Record<string, number>;
  workload: Array<{ agent_id: string; agent_name: string; open_assigned: number }>;
  fcr_pct: number | null;
};

type ChatKpiData = {
  range: { start: string; end: string };
  volume: { created: number; closed: number };
  backlog_open: number;
  active_open: number;
  avg_take_minutes: number;
  avg_first_response_minutes: number;
  avg_resolution_minutes: number;
  workload: Array<{ agent_id: string; agent_name: string; open_assigned: number }>;
};

type TrendPoint = {
  bucket: string;
  created: number;
  closed: number;
  avg_response_hours: number | null;
  avg_resolution_hours: number | null;
  sla_pct: number | null;
};

type TrendsResponse = {
  bucket: "hour" | "day" | "week" | "month";
  start: string;
  end: string;
  points: TrendPoint[];
};

const Periods = [
  { value: "daily", label: "Diario" },
  { value: "weekly", label: "Semanal" },
  { value: "monthly", label: "Mensual" },
] as const;

function rangeForPeriod(period: (typeof Periods)[number]["value"]) {
  const end = new Date();
  const start = new Date(end);
  if (period === "daily") start.setDate(end.getDate() - 1);
  if (period === "weekly") start.setDate(end.getDate() - 7);
  if (period === "monthly") start.setMonth(end.getMonth() - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function defaultBucketForPeriod(period: (typeof Periods)[number]["value"]) {
  if (period === "daily") return "hour";
  if (period === "weekly") return "day";
  return "day";
}

export function SupervisorDashboard({ profile }: { profile: Profile }) {
  const [period, setPeriod] = useState<(typeof Periods)[number]["value"]>("weekly");
  const [agentId, setAgentId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [agents, setAgents] = useState<Array<{ id: string; label: string }>>([]);
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [trends, setTrends] = useState<TrendsResponse | null>(null);
  const [chatKpis, setChatKpis] = useState<ChatKpiData | null>(null);
  const [loadingChatKpis, setLoadingChatKpis] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingTrends, setLoadingTrends] = useState(true);

  async function loadLookups() {
    if (!profile.department_id) {
      setCategories([]);
      setAgents([]);
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
    setLoadingChatKpis(true);
    setError(null);
    try {
      const { start, end } = rangeForPeriod(period);
      const [ticketsKpisRes, chatsKpisRes] = await Promise.all([
        supabase.rpc("kpi_dashboard", { p_start: start, p_end: end, p_agent_id: agentId || null, p_category_id: categoryId || null }),
        supabase.rpc("kpi_chat_dashboard", { p_start: start, p_end: end, p_agent_id: agentId || null, p_category_id: categoryId || null }),
      ]);
      if (ticketsKpisRes.error) throw ticketsKpisRes.error;
      if (chatsKpisRes.error) throw chatsKpisRes.error;
      setKpis((ticketsKpisRes.data ?? null) as KpiData | null);
      setChatKpis((chatsKpisRes.data ?? null) as ChatKpiData | null);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "No se pudo cargar KPIs";
      setError(message);
      setKpis(null);
      setChatKpis(null);
    } finally {
      setLoading(false);
      setLoadingChatKpis(false);
    }
  }

  async function loadTrends() {
    setLoadingTrends(true);
    try {
      const { start, end } = rangeForPeriod(period);
      const bucket = defaultBucketForPeriod(period);
      const res = await supabase.rpc("kpi_timeseries", { p_start: start, p_end: end, p_bucket: bucket, p_agent_id: agentId || null, p_category_id: categoryId || null });
      if (res.error) throw res.error;
      setTrends({ bucket: bucket as TrendsResponse["bucket"], start, end, points: (res.data ?? []) as TrendPoint[] });
    } catch {
      setTrends(null);
    } finally {
      setLoadingTrends(false);
    }
  }

  useEffect(() => {
    void loadLookups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.department_id]);

  useEffect(() => {
    void loadKpis();
    void loadTrends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, agentId, categoryId]);

  const pendingRows = useMemo(() => {
    const p = kpis?.pending_by_priority ?? {};
    return ["Crítica", "Alta", "Media", "Baja"].map((k) => ({ k, v: p[k] ?? 0 }));
  }, [kpis]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Panel ejecutivo"
        description="KPIs, SLA y tendencias operativas por periodo, agente y categoría."
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
          <CardDescription>Refina la vista por periodo, agente y categoría.</CardDescription>
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

      {error ? <InlineAlert variant="error" description={error} /> : null}

      {loading ? (
        <div className="grid gap-3 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="tech-border">
              <CardHeader className="gap-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent className="pt-0">
                <Skeleton className="h-7 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
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
                <CardDescription>Creados / cerrados / cancelados</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl font-semibold">
                  {kpis.volume.created} / {kpis.volume.closed} / {kpis.volume.canceled ?? 0}
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

          <div className="grid gap-3 lg:grid-cols-3">
            <ChartCard
              title="Tendencia de volumen"
              description="Creados vs cerrados en el periodo."
              right={trends?.bucket ? <Badge variant="outline">{trends.bucket}</Badge> : null}
              className="lg:col-span-2"
            >
              {loadingTrends ? (
                <Skeleton className="h-72 w-full rounded-2xl" />
              ) : (
                <VolumeAreaChart data={(trends?.points ?? []) as TrendPoint[]} />
              )}
            </ChartCard>

            <ChartCard title="Cumplimiento SLA" description="Cerrados dentro de SLA (%).">
              {loadingTrends ? <Skeleton className="h-64 w-full rounded-2xl" /> : <SlaLineChart data={(trends?.points ?? []) as TrendPoint[]} />}
            </ChartCard>
          </div>

          <ChartCard title="Tiempos promedio" description="Respuesta y resolución (horas) por bucket.">
            {loadingTrends ? <Skeleton className="h-64 w-full rounded-2xl" /> : <TimeLineChart data={(trends?.points ?? []) as TrendPoint[]} />}
          </ChartCard>

          <div className="grid gap-3 md:grid-cols-2">
            <Card className="tech-border">
              <CardHeader>
                <CardTitle>Pendientes</CardTitle>
                <CardDescription>Snapshot por prioridad.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 text-sm">
                {pendingRows.map((r) => (
                  <div key={r.k} className="flex items-center justify-between rounded-xl glass-surface px-3 py-2">
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
                    <div key={w.agent_id} className="flex items-center justify-between rounded-xl glass-surface px-3 py-2">
                      <div className="truncate text-sm text-muted-foreground">{w.agent_name}</div>
                      <Badge variant="outline">{w.open_assigned}</Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-3 md:grid-cols-5">
            <Card className="tech-border md:col-span-2">
              <CardHeader>
                <CardTitle>Chats</CardTitle>
                <CardDescription>Volumen y backlog</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {loadingChatKpis ? (
                  <Skeleton className="h-8 w-40" />
                ) : !chatKpis ? (
                  <div className="text-sm text-muted-foreground">Sin datos de chats.</div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-2xl font-semibold">
                      {chatKpis.volume.created} / {chatKpis.volume.closed}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Backlog: {chatKpis.backlog_open} · Activos: {chatKpis.active_open}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="tech-border">
              <CardHeader className="gap-2">
                <CardTitle>Tomado</CardTitle>
                <CardDescription>Prom (min)</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {loadingChatKpis ? <Skeleton className="h-7 w-24" /> : <div className="text-2xl font-semibold">{chatKpis ? chatKpis.avg_take_minutes.toFixed(1) : "—"}</div>}
              </CardContent>
            </Card>
            <Card className="tech-border">
              <CardHeader className="gap-2">
                <CardTitle>1ª respuesta</CardTitle>
                <CardDescription>Prom (min)</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {loadingChatKpis ? <Skeleton className="h-7 w-24" /> : <div className="text-2xl font-semibold">{chatKpis ? chatKpis.avg_first_response_minutes.toFixed(1) : "—"}</div>}
              </CardContent>
            </Card>
            <Card className="tech-border">
              <CardHeader className="gap-2">
                <CardTitle>Resolución</CardTitle>
                <CardDescription>Prom (min)</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {loadingChatKpis ? <Skeleton className="h-7 w-24" /> : <div className="text-2xl font-semibold">{chatKpis ? chatKpis.avg_resolution_minutes.toFixed(1) : "—"}</div>}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
