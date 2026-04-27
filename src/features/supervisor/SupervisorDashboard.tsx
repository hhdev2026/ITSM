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
import { RadialGauge, SparkLine, TimeLineChart, VolumeSlaComposedChart, PriorityPieChart } from "@/components/charts/Charts";
import { Info, ArrowUpRight, ArrowDownRight, Activity } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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
  { value: "daily", label: "Últimas 24h" },
  { value: "weekly", label: "Últimos 7 días" },
  { value: "monthly", label: "Últimos 30 días" },
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadLookups() {
      if (!profile.department_id) return;
      const { data: cats } = await supabase.from("categories").select("id,name").eq("department_id", profile.department_id!).order("name");
      setCategories((cats ?? []) as Category[]);
      const { data: profs } = await supabase.from("profiles").select("id,full_name,email").in("role", ["agent", "supervisor"]).eq("department_id", profile.department_id!).order("email");
      setAgents((profs ?? []).map((p: any) => ({ id: p.id, label: p.full_name || p.email })));
    }
    void loadLookups();
  }, [profile.department_id]);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const { start, end } = rangeForPeriod(period);
        const bucket = defaultBucketForPeriod(period);
        const [kpiRes, chatRes, trendRes] = await Promise.all([
          supabase.rpc("kpi_dashboard", { p_start: start, p_end: end, p_agent_id: agentId || null, p_category_id: categoryId || null }),
          supabase.rpc("kpi_chat_dashboard", { p_start: start, p_end: end, p_agent_id: agentId || null, p_category_id: categoryId || null }),
          supabase.rpc("kpi_timeseries", { p_start: start, p_end: end, p_bucket: bucket, p_agent_id: agentId || null, p_category_id: categoryId || null }),
        ]);
        if (kpiRes.error) throw kpiRes.error;
        if (chatRes.error) throw chatRes.error;
        if (trendRes.error) throw trendRes.error;
        setKpis(kpiRes.data as KpiData);
        setChatKpis(chatRes.data as ChatKpiData);
        setTrends({ bucket: bucket as TrendsResponse["bucket"], start, end, points: trendRes.data as TrendPoint[] });
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Error al cargar dashboard");
      } finally {
        setLoading(false);
      }
    }
    void loadData();
  }, [period, agentId, categoryId]);

  const pendingPieData = useMemo(() => {
    const p = kpis?.pending_by_priority ?? {};
    const rows = ["Crítica", "Alta", "Media", "Baja"].map((k) => ({ k, v: p[k] ?? 0 }));
    return rows.map((r) => {
      let color = "hsl(var(--emerald-500))";
      if (r.k === "Crítica") color = "#ef4444";
      if (r.k === "Alta") color = "#f97316";
      if (r.k === "Media") color = "#eab308";
      if (r.k === "Baja") color = "#3b82f6";
      return { name: r.k, value: r.v, color };
    });
  }, [kpis]);

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <PageHeader
          title="Executive Dashboard"
          description="Monitoreo de inteligencia en tiempo real y KPI corporativos."
          actions={
            <>
              <Button asChild variant="outline" className="border-primary/20 bg-primary/5 hover:bg-primary/10 transition-all">
                <Link href="/app/reportes"><Activity className="mr-2 h-4 w-4" /> Reportes Gerenciales</Link>
              </Button>
            </>
          }
        />

        <div className="flex flex-col md:flex-row gap-4 mb-6 rounded-2xl glass-surface p-2 border border-border/50">
          <select value={period} onChange={(e) => setPeriod(e.target.value as any)} className="h-10 px-4 rounded-xl border-none bg-background/50 hover:bg-background outline-none focus:ring-2 focus:ring-primary/50 text-sm font-medium transition-all">
            {Periods.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="h-10 px-4 rounded-xl border-none bg-background/50 hover:bg-background outline-none focus:ring-2 focus:ring-primary/50 text-sm font-medium transition-all">
            <option value="">Todos los Agentes</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="h-10 px-4 rounded-xl border-none bg-background/50 hover:bg-background outline-none focus:ring-2 focus:ring-primary/50 text-sm font-medium transition-all">
            <option value="">Todas las Categorías</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {error ? <InlineAlert variant="error" description={error} /> : null}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-3xl" />)}
            <Skeleton className="h-[400px] md:col-span-3 rounded-3xl" />
            <Skeleton className="h-[400px] rounded-3xl" />
          </div>
        ) : !kpis || !trends ? null : (
          <div className="space-y-6">
            
            {/* ROW 1: SPARKLINE KPI CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card className="tech-border bg-gradient-to-br from-card to-card/40 shadow-sm border-brand-cyan/20 overflow-hidden relative">
                <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none"><Activity className="w-16 h-16 text-brand-cyan" /></div>
                <CardContent className="p-6 relative z-10">
                  <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-1 flex items-center justify-between">
                    Tickets Creados
                    <Badge variant="outline" className="border-emerald-500/30 text-emerald-500 bg-emerald-500/10"><ArrowUpRight className="w-3 h-3 mr-1"/> 12%</Badge>
                  </div>
                  <div className="flex items-end justify-between mt-3">
                    <div className="text-4xl font-black tabular-nums tracking-tighter">{kpis.volume.created}</div>
                    <SparkLine data={trends.points} dataKey="created" color="hsl(var(--brand-cyan))" />
                  </div>
                </CardContent>
              </Card>

              <Card className="tech-border bg-gradient-to-br from-card to-card/40 shadow-sm border-brand-violet/20 overflow-hidden relative">
                <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none"><Activity className="w-16 h-16 text-brand-violet" /></div>
                <CardContent className="p-6 relative z-10">
                  <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-1 flex items-center justify-between">
                    Tickets Cerrados
                    <Badge variant="outline" className="border-emerald-500/30 text-emerald-500 bg-emerald-500/10"><ArrowUpRight className="w-3 h-3 mr-1"/> 8%</Badge>
                  </div>
                  <div className="flex items-end justify-between mt-3">
                    <div className="text-4xl font-black tabular-nums tracking-tighter">{kpis.volume.closed}</div>
                    <SparkLine data={trends.points} dataKey="closed" color="hsl(var(--brand-violet))" />
                  </div>
                </CardContent>
              </Card>

              <Card className="tech-border bg-gradient-to-br from-card to-card/40 shadow-sm border-orange-500/20 overflow-hidden relative">
                <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none"><Activity className="w-16 h-16 text-orange-500" /></div>
                <CardContent className="p-6 relative z-10">
                  <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-1 flex items-center justify-between">
                    MTTR (Horas)
                    <Badge variant="outline" className="border-emerald-500/30 text-emerald-500 bg-emerald-500/10"><ArrowDownRight className="w-3 h-3 mr-1"/> -1.5h</Badge>
                  </div>
                  <div className="flex items-end justify-between mt-3">
                    <div className="text-4xl font-black tabular-nums tracking-tighter">{kpis.mttr_hours.toFixed(1)}</div>
                    <SparkLine data={trends.points} dataKey="avg_resolution_hours" color="#f97316" />
                  </div>
                </CardContent>
              </Card>

              <Card className="tech-border bg-gradient-to-br from-card to-card/40 shadow-sm border-blue-500/20 overflow-hidden relative">
                <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none"><Activity className="w-16 h-16 text-blue-500" /></div>
                <CardContent className="p-6 relative z-10">
                  <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-1 flex items-center justify-between">
                    Volumen Chats
                    <Badge variant="outline" className="border-muted/30 text-muted-foreground">— 0%</Badge>
                  </div>
                  <div className="flex items-end justify-between mt-3">
                    <div className="text-4xl font-black tabular-nums tracking-tighter">{chatKpis?.volume.created ?? 0}</div>
                    <SparkLine data={trends.points} dataKey="created" color="#3b82f6" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* ROW 2: COMPOSED CHART + GAUGES */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              <Card className="tech-border lg:col-span-3 bg-card/40 backdrop-blur-md">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Rendimiento Operativo vs SLA</CardTitle>
                  <CardDescription>Correlación de volumen de tickets entrantes, resolución y cumplimiento de SLA (Objetivo: 90%)</CardDescription>
                </CardHeader>
                <CardContent>
                  <VolumeSlaComposedChart data={trends.points} />
                </CardContent>
              </Card>
              
              <div className="flex flex-col gap-6">
                <Card className="tech-border flex-1 bg-card/40 backdrop-blur-md">
                  <CardContent className="p-6 flex flex-col items-center justify-center h-full relative">
                    <Tooltip>
                      <TooltipTrigger className="absolute top-4 right-4">
                        <Info className="h-4 w-4 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent><p>Service Level Agreement: % de tickets resueltos en tiempo.</p></TooltipContent>
                    </Tooltip>
                    <RadialGauge value={kpis.sla_compliance_pct ?? 0} label="SLA Compliance" color="#10b981" />
                  </CardContent>
                </Card>
                
                <Card className="tech-border flex-1 bg-card/40 backdrop-blur-md">
                  <CardContent className="p-6 flex flex-col items-center justify-center h-full relative">
                    <Tooltip>
                      <TooltipTrigger className="absolute top-4 right-4">
                        <Info className="h-4 w-4 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent><p>First Contact Resolution: % de tickets resueltos de inmediato.</p></TooltipContent>
                    </Tooltip>
                    <RadialGauge value={kpis.fcr_pct ?? 0} label="FCR Score" color="hsl(var(--brand-cyan))" />
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* ROW 3: BENTO GRID */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              <Card className="tech-border bg-card/40 backdrop-blur-md">
                <CardHeader>
                  <CardTitle>Backlog Activo</CardTitle>
                  <CardDescription>Distribución de tickets por criticidad</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <PriorityPieChart data={pendingPieData} />
                  <div className="grid grid-cols-2 gap-2 mt-4">
                    {pendingPieData.map((d) => (
                      <div key={d.name} className="flex items-center justify-between bg-background/50 rounded-lg px-3 py-2 border border-border/50">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                          <span className="text-xs font-medium text-muted-foreground">{d.name}</span>
                        </div>
                        <span className="font-bold">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="tech-border lg:col-span-2 bg-card/40 backdrop-blur-md">
                <CardHeader>
                  <CardTitle>Tiempos Promedio de Respuesta</CardTitle>
                  <CardDescription>Evolución de tiempos de primera respuesta y resolución total</CardDescription>
                </CardHeader>
                <CardContent>
                  <TimeLineChart data={trends.points} />
                </CardContent>
              </Card>

            </div>

            {/* ROW 4: AGENTS WORKLOAD & CHAT INSIGHTS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="tech-border bg-card/40">
                <CardHeader>
                  <CardTitle>Carga de Trabajo Operativa</CardTitle>
                  <CardDescription>Top agentes por volumen de asignación abierta</CardDescription>
                </CardHeader>
                <CardContent>
                  {kpis.workload.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-4 text-center">Sin agentes con carga activa.</div>
                  ) : (
                    <div className="space-y-3">
                      {kpis.workload.slice(0, 5).map((w, idx) => (
                        <div key={w.agent_id} className="flex items-center gap-4 group">
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium">{w.agent_name}</span>
                              <span className="text-xs font-bold">{w.open_assigned} tickets</span>
                            </div>
                            <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                              <div className="h-full bg-brand-cyan transition-all duration-1000" style={{ width: `${Math.min(100, (w.open_assigned / (kpis.workload[0]?.open_assigned || 1)) * 100)}%` }} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="tech-border bg-card/40">
                <CardHeader>
                  <CardTitle>Métricas de Chat</CardTitle>
                  <CardDescription>Rendimiento del canal conversacional</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-background/40 p-4 rounded-xl border border-border/50">
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Backlog</div>
                      <div className="text-2xl font-bold">{chatKpis?.backlog_open ?? 0}</div>
                    </div>
                    <div className="bg-background/40 p-4 rounded-xl border border-border/50">
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Toma de Chat</div>
                      <div className="text-2xl font-bold">{chatKpis?.avg_take_minutes.toFixed(1) ?? "—"} <span className="text-xs font-normal text-muted-foreground">min</span></div>
                    </div>
                    <div className="bg-background/40 p-4 rounded-xl border border-border/50">
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Resolución Chat</div>
                      <div className="text-2xl font-bold">{chatKpis?.avg_resolution_minutes.toFixed(1) ?? "—"} <span className="text-xs font-normal text-muted-foreground">min</span></div>
                    </div>
                    <div className="bg-background/40 p-4 rounded-xl border border-border/50">
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Chats Activos</div>
                      <div className="text-2xl font-bold text-emerald-500">{chatKpis?.active_open ?? 0}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
