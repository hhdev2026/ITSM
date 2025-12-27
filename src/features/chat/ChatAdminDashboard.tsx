"use client";

import { useEffect, useMemo, useState } from "react";
import type { Category, Profile } from "@/lib/types";
import { supabase } from "@/lib/supabaseBrowser";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCard } from "@/components/charts/ChartCard";
import { Badge } from "@/components/ui/badge";
import { VolumeAreaChart, ChatTimeLineChart } from "@/components/charts/Charts";
import { MetricTile, formatDuration } from "@/features/chat/chat-ui";
import { cn } from "@/lib/cn";
import { RefreshCcw } from "lucide-react";

type Period = "daily" | "weekly" | "monthly";

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

type ChatTrendPoint = {
  bucket: string;
  created: number;
  closed: number;
  avg_first_response_minutes: number | null;
  avg_resolution_minutes: number | null;
};

type ChatReport = {
  range: { start: string; end: string };
  top_requesters: Array<{ requester_id: string; requester_name: string; created_count: number }>;
  top_agents: Array<{
    agent_id: string;
    agent_name: string;
    closed_count: number;
    avg_take_minutes: number | null;
    avg_first_response_minutes: number | null;
    avg_resolution_minutes: number | null;
  }>;
  by_category: Array<{
    category_id: string | null;
    category_name: string;
    created_count: number;
    closed_count: number;
    avg_resolution_minutes: number | null;
  }>;
  by_subcategory: Array<{
    subcategory_id: string | null;
    subcategory_name: string;
    created_count: number;
    closed_count: number;
  }>;
};

const Periods: Array<{ value: Period; label: string }> = [
  { value: "daily", label: "Diario" },
  { value: "weekly", label: "Semanal" },
  { value: "monthly", label: "Mensual" },
];

function rangeForPeriod(period: Period) {
  const end = new Date();
  const start = new Date(end);
  if (period === "daily") start.setDate(end.getDate() - 1);
  if (period === "weekly") start.setDate(end.getDate() - 7);
  if (period === "monthly") start.setMonth(end.getMonth() - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function defaultBucketForPeriod(period: Period) {
  if (period === "daily") return "hour";
  if (period === "weekly") return "day";
  return "day";
}

function fmtCount(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "—";
}

function fmtMinutes(v: unknown) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return formatDuration(v * 60_000);
}

export function ChatAdminDashboard({ profile }: { profile: Profile }) {
  const [period, setPeriod] = useState<Period>("weekly");
  const [agentId, setAgentId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [agents, setAgents] = useState<Array<{ id: string; label: string }>>([]);

  const [kpis, setKpis] = useState<ChatKpiData | null>(null);
  const [trends, setTrends] = useState<ChatTrendPoint[] | null>(null);
  const [report, setReport] = useState<ChatReport | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingLookups, setLoadingLookups] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadLookups() {
    setLoadingLookups(true);
    if (!profile.department_id) {
      setCategories([]);
      setAgents([]);
      setLoadingLookups(false);
      return;
    }
    const [{ data: cats }, { data: profs }] = await Promise.all([
      supabase.from("categories").select("id,name,description,department_id").eq("department_id", profile.department_id).order("name"),
      supabase.from("profiles").select("id,full_name,email,role").in("role", ["agent", "supervisor"]).eq("department_id", profile.department_id).order("email"),
    ]);
    setCategories((cats ?? []) as Category[]);
    const list = (profs ?? []) as Array<{ id: string; full_name: string | null; email: string }>;
    setAgents(list.map((p) => ({ id: p.id, label: p.full_name || p.email })));
    setLoadingLookups(false);
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    const { start, end } = rangeForPeriod(period);
    const bucket = defaultBucketForPeriod(period);

    const [kpiRes, trendRes, reportRes] = await Promise.all([
      supabase.rpc("kpi_chat_dashboard", { p_start: start, p_end: end, p_agent_id: agentId || null, p_category_id: categoryId || null }),
      supabase.rpc("kpi_chat_timeseries", { p_start: start, p_end: end, p_bucket: bucket, p_agent_id: agentId || null, p_category_id: categoryId || null }),
      supabase.rpc("kpi_chat_report", { p_start: start, p_end: end, p_agent_id: agentId || null, p_category_id: categoryId || null }),
    ]);

    if (kpiRes.error) setError(kpiRes.error.message);
    if (trendRes.error) setError(trendRes.error.message);
    if (reportRes.error) setError(reportRes.error.message);

    setKpis((kpiRes.data ?? null) as ChatKpiData | null);
    setTrends((trendRes.data ?? null) as ChatTrendPoint[] | null);
    setReport((reportRes.data ?? null) as ChatReport | null);
    setLoading(false);
  }

  useEffect(() => {
    void loadLookups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.department_id]);

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, agentId, categoryId]);

  const trendPoints = useMemo(() => (trends ?? []), [trends]);

  const requesterMax = useMemo(() => Math.max(1, ...(report?.top_requesters ?? []).map((r) => r.created_count)), [report]);
  const categoryMax = useMemo(() => Math.max(1, ...(report?.by_category ?? []).map((r) => r.created_count)), [report]);
  const subcategoryMax = useMemo(() => Math.max(1, ...(report?.by_subcategory ?? []).map((r) => r.created_count)), [report]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reporte de chats"
        description="Actividad, casuísticas, tiempos y desempeño del canal interno."
        actions={
          <Button variant="outline" onClick={() => void loadAll()}>
            <RefreshCcw className="h-4 w-4" />
            Actualizar
          </Button>
        }
      />

      {error ? <InlineAlert variant="error" description={error} /> : null}

      <Card className="tech-border">
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>Refina por periodo, agente y categoría.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <label className="block">
            <div className="text-xs text-muted-foreground">Periodo</div>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
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
              disabled={loadingLookups}
              className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:opacity-60"
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
              disabled={loadingLookups}
              className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:opacity-60"
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

      <Card className="tech-border">
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle>Resumen</CardTitle>
            <CardDescription>Indicadores del periodo seleccionado.</CardDescription>
          </div>
          {kpis?.range ? (
            <Badge variant="outline" className="border">
              {new Date(kpis.range.start).toLocaleDateString()} → {new Date(kpis.range.end).toLocaleDateString()}
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Skeleton className="h-[66px] rounded-2xl" />
              <Skeleton className="h-[66px] rounded-2xl" />
              <Skeleton className="h-[66px] rounded-2xl" />
              <Skeleton className="h-[66px] rounded-2xl" />
              <Skeleton className="h-[66px] rounded-2xl" />
              <Skeleton className="h-[66px] rounded-2xl" />
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <MetricTile label="Ingresados" value={fmtCount(kpis?.volume.created)} />
              <MetricTile label="Cerrados" value={fmtCount(kpis?.volume.closed)} />
              <MetricTile label="Backlog" value={fmtCount(kpis?.backlog_open)} />
              <MetricTile label="Activos" value={fmtCount(kpis?.active_open)} />
              <MetricTile label="Tiempo a tomar" value={fmtMinutes(kpis?.avg_take_minutes)} />
              <MetricTile label="Tiempo total" value={fmtMinutes(kpis?.avg_resolution_minutes)} />
            </div>
          )}
          {!loading ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <MetricTile label="Primera respuesta" value={fmtMinutes(kpis?.avg_first_response_minutes)} />
              <MetricTile
                label="Carga (abiertos por agente)"
                value={kpis?.workload?.length ? `${kpis.workload.reduce((acc, r) => acc + (r.open_assigned ?? 0), 0)} abiertos` : "—"}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Volumen" description="Chats creados vs cerrados (tendencia).">
          {loading ? <Skeleton className="h-72 w-full" /> : <VolumeAreaChart data={trendPoints} />}
        </ChartCard>
        <ChartCard title="Tiempos" description="Promedios por periodo (minutos).">
          {loading ? <Skeleton className="h-64 w-full" /> : <ChatTimeLineChart data={trendPoints} />}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="tech-border">
          <CardHeader>
            <CardTitle>Top solicitantes</CardTitle>
            <CardDescription>Usuarios que más usan el chat (ingresos).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <>
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </>
            ) : (report?.top_requesters?.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground">Sin datos para el periodo.</div>
            ) : (
              report!.top_requesters.map((r) => (
                <div key={r.requester_id} className="rounded-2xl glass-surface p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate text-sm font-semibold">{r.requester_name}</div>
                    <Badge variant="outline">{r.created_count}</Badge>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-background/30">
                    <div
                      className="h-2 rounded-full bg-[linear-gradient(90deg,hsl(var(--brand-cyan))/0.9,hsl(var(--brand-violet))/0.9)]"
                      style={{ width: `${Math.round((r.created_count / requesterMax) * 100)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="tech-border">
          <CardHeader>
            <CardTitle>Top agentes</CardTitle>
            <CardDescription>Desempeño por cierres y tiempos promedio.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <>
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </>
            ) : (report?.top_agents?.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground">Sin datos para el periodo.</div>
            ) : (
              report!.top_agents.map((a) => (
                <div key={a.agent_id} className="rounded-2xl glass-surface p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate text-sm font-semibold">{a.agent_name}</div>
                    <Badge variant="outline">{a.closed_count} cerrados</Badge>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <MetricTile label="Tomar" value={fmtMinutes(a.avg_take_minutes)} className="bg-transparent" />
                    <MetricTile label="1ª resp" value={fmtMinutes(a.avg_first_response_minutes)} className="bg-transparent" />
                    <MetricTile label="Total" value={fmtMinutes(a.avg_resolution_minutes)} className="bg-transparent" />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="tech-border">
          <CardHeader>
            <CardTitle>Casuísticas (categorías)</CardTitle>
            <CardDescription>Ingresos por categoría (y cierre).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <>
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </>
            ) : (report?.by_category?.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground">Sin datos para el periodo.</div>
            ) : (
              report!.by_category.map((c) => (
                <div key={c.category_id ?? c.category_name} className="rounded-2xl glass-surface p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate text-sm font-semibold">{c.category_name}</div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{c.created_count} in</Badge>
                      <Badge variant="outline" className={cn("border", c.closed_count ? "text-emerald-200 border-emerald-500/30 bg-emerald-500/10" : "")}>
                        {c.closed_count} out
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Tiempo total prom.</span>
                    <span className="font-medium text-foreground/80">{fmtMinutes(c.avg_resolution_minutes)}</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-background/30">
                    <div
                      className="h-2 rounded-full bg-[linear-gradient(90deg,hsl(var(--brand-cyan))/0.85,hsl(var(--brand-violet))/0.85)]"
                      style={{ width: `${Math.round((c.created_count / categoryMax) * 100)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="tech-border">
          <CardHeader>
            <CardTitle>Casuísticas (subcategorías)</CardTitle>
            <CardDescription>Top subcategorías por volumen.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <>
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </>
            ) : (report?.by_subcategory?.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground">Sin datos para el periodo.</div>
            ) : (
              report!.by_subcategory.map((s) => (
                <div key={s.subcategory_id ?? s.subcategory_name} className="rounded-2xl glass-surface p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate text-sm font-semibold">{s.subcategory_name}</div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{s.created_count} in</Badge>
                      <Badge variant="outline">{s.closed_count} out</Badge>
                    </div>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-background/30">
                    <div
                      className="h-2 rounded-full bg-[linear-gradient(90deg,hsl(var(--brand-cyan))/0.85,hsl(var(--brand-violet))/0.85)]"
                      style={{ width: `${Math.round((s.created_count / subcategoryMax) * 100)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
