"use client";

import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { AppBootScreen, AppNoticeScreen } from "@/components/layout/AppStates";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TicketPriorityBadge, TicketStatusBadge, TicketTypeBadge } from "@/components/tickets/TicketBadges";
import { TicketPriorities, TicketStatuses } from "@/lib/constants";
import { useProfile, useSession } from "@/lib/hooks";
import { supabase } from "@/lib/supabaseBrowser";
import type { Category, Subcategory, Ticket } from "@/lib/types";
import { formatTicketNumber } from "@/lib/ticketNumber";
import { errorMessage } from "@/lib/error";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCcw, AlertCircle, Clock, UserX, User, CalendarDays } from "lucide-react";

type TicketLiveRow = Partial<Ticket> & {
  id: string;
  department_id: string;
  title: string;
  type: Ticket["type"];
  status: Ticket["status"];
  priority: Ticket["priority"];
  created_at: string;
  updated_at: string;
};

type QuickFilter = "all" | "mine" | "overdue" | "at_risk" | "unassigned";

function profileLabel(p: { full_name: string | null; email: string }) {
  return p.full_name?.trim() || p.email;
}

function tierPathFromMetadata(meta: unknown) {
  if (!meta || typeof meta !== "object") return null;
  const sc = (meta as { service_catalog?: unknown }).service_catalog;
  if (!sc || typeof sc !== "object") return null;
  const parts = [
    (sc as { ticket_type?: unknown }).ticket_type,
    (sc as { tier1?: unknown }).tier1,
    (sc as { tier2?: unknown }).tier2,
    (sc as { tier3?: unknown }).tier3,
    (sc as { tier4?: unknown }).tier4,
  ].filter((v) => typeof v === "string" && v.trim().length > 0) as string[];
  if (!parts.length) return null;
  return parts.join(" → ");
}

function downloadCsv(filename: string, header: string[], rows: Array<Array<unknown>>) {
  const escape = (value: unknown) => {
    if (value == null) return "";
    const str = String(value);
    if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };
  const lines: string[] = [];
  lines.push(header.map(escape).join(","));
  for (const row of rows) lines.push(row.map(escape).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function computeTraffic(opts: {
  status?: unknown;
  excluded?: unknown;
  deadline?: unknown;
  targetMinutes?: unknown;
}): { light: Ticket["sla_traffic_light"]; remainingMinutes: number | null; pctUsed: number | null } {
  const status = typeof opts.status === "string" ? opts.status : null;
  if (opts.excluded === true) return { light: "excluded", remainingMinutes: null, pctUsed: null };
  if (status === "Cerrado" || status === "Cancelado" || status === "Rechazado") return { light: "closed", remainingMinutes: null, pctUsed: null };

  const deadline = typeof opts.deadline === "string" ? opts.deadline : null;
  const target = typeof opts.targetMinutes === "number" ? opts.targetMinutes : null;
  if (!deadline || !target || target <= 0) return { light: null, remainingMinutes: null, pctUsed: null };

  const remaining = Math.floor((new Date(deadline).getTime() - Date.now()) / 60000);
  const ratio = remaining / target;
  const light: Ticket["sla_traffic_light"] = remaining <= 0 ? "red" : ratio <= 0.2 ? "yellow" : "green";
  
  const remainingClamped = Math.max(remaining, 0);
  const pctUsed = Math.round((1 - remainingClamped / target) * 10000) / 100;
  
  return { light, remainingMinutes: remaining, pctUsed };
}

function KpiCard({
  title,
  value,
  icon: Icon,
  onClick,
  active,
  color,
}: {
  title: string;
  value: number;
  icon: any;
  onClick: () => void;
  active: boolean;
  color: "red" | "yellow" | "blue" | "purple";
}) {
  const colorMap = {
    red: "border-red-500 bg-red-500/10 text-red-500",
    yellow: "border-yellow-500 bg-yellow-500/10 text-yellow-500",
    blue: "border-blue-500 bg-blue-500/10 text-blue-500",
    purple: "border-purple-500 bg-purple-500/10 text-purple-500",
  };
  const activeClass = active ? colorMap[color] : "border-border bg-background hover:bg-accent/50";
  const iconColorMap = {
    red: "text-red-500",
    yellow: "text-yellow-500",
    blue: "text-blue-500",
    purple: "text-purple-500",
  };

  return (
    <Card className={`cursor-pointer transition-colors tech-border ${activeClass}`} onClick={onClick}>
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium text-muted-foreground">{title}</div>
          <div className="text-3xl font-bold">{value}</div>
        </div>
        <div className={`rounded-full bg-background/50 p-2.5 ${active ? iconColorMap[color] : "text-muted-foreground"}`}>
          <Icon className="h-6 w-6" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function TicketsTrackingPage() {
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error: profileError } = useProfile(session?.user.id);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [allTickets, setAllTickets] = useState<TicketLiveRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [profiles, setProfiles] = useState<Array<{ id: string; email: string; full_name: string | null }>>([]);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");

  const canSee = profile?.role === "supervisor" || profile?.role === "admin";

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const subById = useMemo(() => new Map(subcategories.map((s) => [s.id, s.name])), [subcategories]);
  const profById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  const load = useCallback(async () => {
    if (!profile?.department_id) return;
    setLoading(true);
    setError(null);

    try {
      const { data: cats, error: catErr } = await supabase
        .from("categories")
        .select("id,name,description,department_id")
        .eq("department_id", profile.department_id)
        .order("name");
      if (catErr) throw catErr;
      setCategories((cats ?? []) as Category[]);

      const catIds = (cats ?? []).map((c) => c.id);
      if (catIds.length) {
        const { data: subs, error: subErr } = await supabase
          .from("subcategories")
          .select("id,category_id,name,description")
          .in("category_id", catIds)
          .order("name");
        if (subErr) throw subErr;
        setSubcategories((subs ?? []) as Subcategory[]);
      } else {
        setSubcategories([]);
      }

      // Fetch a snapshot
      const { data, error } = await supabase
        .from("tickets_sla_live")
        .select("*")
        .eq("department_id", profile.department_id)
        .order("created_at", { ascending: false })
        .limit(250);

      let fetchedRows: TicketLiveRow[] = [];

      if (error) {
        // Fallback: DB may not have the view/grants yet; use base table.
        const base = await supabase.from("tickets").select("*").eq("department_id", profile.department_id).order("created_at", { ascending: false }).limit(250);
        if (base.error) throw base.error;

        fetchedRows = ((base.data ?? []) as Array<Record<string, unknown>>).map((t) => {
          const sla = computeTraffic({
            status: t.status,
            excluded: (t as { sla_excluded?: unknown }).sla_excluded,
            deadline: (t as { sla_deadline?: unknown }).sla_deadline,
            targetMinutes: (t as { sla_resolution_target_minutes?: unknown }).sla_resolution_target_minutes,
          });
          const resp = computeTraffic({
            status: t.status,
            excluded: (t as { sla_excluded?: unknown }).sla_excluded,
            deadline: (t as { response_deadline?: unknown }).response_deadline,
            targetMinutes: (t as { sla_response_target_minutes?: unknown }).sla_response_target_minutes,
          });
          return {
            ...(t as unknown as TicketLiveRow),
            sla_remaining_minutes: sla.remainingMinutes ?? undefined,
            sla_traffic_light: sla.light,
            sla_pct_used: sla.pctUsed,
            response_remaining_minutes: resp.remainingMinutes ?? undefined,
            response_traffic_light: resp.light,
            response_pct_used: resp.pctUsed,
          } satisfies TicketLiveRow;
        });
      } else {
        fetchedRows = (data ?? []) as unknown as TicketLiveRow[];
      }

      setAllTickets(fetchedRows);

      const ids = new Set<string>();
      for (const t of fetchedRows) {
        if (typeof t.requester_id === "string") ids.add(t.requester_id);
        if (typeof t.assignee_id === "string") ids.add(t.assignee_id);
      }

      if (ids.size) {
        const { data: profsRaw, error: pErr } = await supabase.from("profiles").select("id,email,full_name").in("id", Array.from(ids));
        if (pErr) throw pErr;
        setProfiles((profsRaw ?? []) as Array<{ id: string; email: string; full_name: string | null }>);
      } else {
        setProfiles([]);
      }
    } catch (e: unknown) {
      const msg = errorMessage(e) ?? "No se pudo cargar tickets";
      setError(msg);
      setAllTickets([]);
    } finally {
      setLoading(false);
    }
  }, [profile?.department_id]);

  useEffect(() => {
    if (canSee) void load();
  }, [canSee, load]);

  const kpiCounts = useMemo(() => {
    let overdue = 0;
    let atRisk = 0;
    let unassigned = 0;
    let mine = 0;
    for (const t of allTickets) {
      if (t.status === "Cerrado" || t.status === "Cancelado") continue;
      if (t.sla_traffic_light === "red" || t.response_traffic_light === "red") overdue++;
      else if (t.sla_traffic_light === "yellow" || t.response_traffic_light === "yellow") atRisk++;
      if (!t.assignee_id) unassigned++;
      if (t.assignee_id === session?.user.id) mine++;
    }
    return { overdue, atRisk, unassigned, mine };
  }, [allTickets, session?.user.id]);

  const finalRows = useMemo(() => {
    const filtered = allTickets.filter((t) => {
      const st = typeof t.status === "string" ? t.status : "";
      const pr = typeof t.priority === "string" ? t.priority : "";
      const asg = typeof t.assignee_id === "string" ? t.assignee_id : null;
      const title = typeof t.title === "string" ? t.title : "";
      
      if (!showClosed && (st === "Cerrado" || st === "Cancelado")) return false;
      if (status && st !== status) return false;
      if (priority && pr !== priority) return false;
      if (assigneeId && asg !== assigneeId) return false;
      if (q.trim() && !title.toLowerCase().includes(q.trim().toLowerCase())) return false;
      
      if (quickFilter === "mine" && asg !== session?.user.id) return false;
      if (quickFilter === "overdue" && t.sla_traffic_light !== "red" && t.response_traffic_light !== "red") return false;
      if (quickFilter === "at_risk" && t.sla_traffic_light !== "yellow" && t.response_traffic_light !== "yellow") return false;
      if (quickFilter === "unassigned" && asg !== null) return false;
      
      return true;
    });

    filtered.sort((a, b) => {
      // Prioritize SLA remaining time
      const aRem = typeof a.sla_remaining_minutes === "number" ? a.sla_remaining_minutes : 999999;
      const bRem = typeof b.sla_remaining_minutes === "number" ? b.sla_remaining_minutes : 999999;
      if (aRem !== bRem) return aRem - bRem;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return filtered;
  }, [allTickets, showClosed, status, priority, assigneeId, q, quickFilter, session?.user.id]);

  const groupedTickets = useMemo(() => {
    return {
      red: finalRows.filter(t => t.sla_traffic_light === "red" || t.response_traffic_light === "red"),
      yellow: finalRows.filter(t => (t.sla_traffic_light === "yellow" || t.response_traffic_light === "yellow") && t.sla_traffic_light !== "red" && t.response_traffic_light !== "red"),
      green: finalRows.filter(t => (t.sla_traffic_light === "green" || t.response_traffic_light === "green") && t.sla_traffic_light !== "red" && t.response_traffic_light !== "red" && t.sla_traffic_light !== "yellow" && t.response_traffic_light !== "yellow"),
      other: finalRows.filter(t => !["red", "yellow", "green"].includes(t.sla_traffic_light || "") && !["red", "yellow", "green"].includes(t.response_traffic_light || "")),
    };
  }, [finalRows]);

  const renderTicketTable = (tickets: TicketLiveRow[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left border-collapse whitespace-nowrap">
        <thead>
          <tr className="border-b border-border/30 text-muted-foreground text-xs bg-black/10">
            <th className="px-5 py-3 font-medium w-24">Ticket</th>
            <th className="px-5 py-3 font-medium min-w-[300px] w-full">Título</th>
            <th className="px-5 py-3 font-medium w-32">Estado</th>
            <th className="px-5 py-3 font-medium w-32">Prioridad</th>
            <th className="px-5 py-3 font-medium w-48">Asignado</th>
            <th className="px-5 py-3 font-medium w-48 text-right">SLA Restante</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {tickets.map(t => {
            const tracking = formatTicketNumber(t.ticket_number) ?? t.id.slice(0, 8).toUpperCase();
            const assignee = t.assignee_id ? profById.get(t.assignee_id) ?? null : null;
            const remaining = typeof t.sla_remaining_minutes === "number" ? Math.round(t.sla_remaining_minutes) : null;
            
            let remClass = "text-muted-foreground";
            if (remaining !== null) {
              if (remaining < 0) remClass = "text-red-500 font-bold";
              else if (remaining <= 60) remClass = "text-yellow-500 font-medium";
              else remClass = "text-green-500";
            }
            
            const formatTime = (mins: number) => {
              const abs = Math.abs(mins);
              const d = Math.floor(abs / 1440);
              const h = Math.floor((abs % 1440) / 60);
              const m = abs % 60;
              if (d > 0) return `${d}d ${h}h`;
              if (h > 0) return `${h}h ${m}m`;
              return `${m}m`;
            };

            return (
              <tr key={t.id} className="hover:bg-accent/20 group transition-colors">
                <td className="px-5 py-3.5">
                  <Link href={`/app/tickets/${t.id}`} className="font-mono font-semibold text-primary hover:underline">
                    {tracking}
                  </Link>
                </td>
                <td className="px-5 py-3.5">
                  <div className="truncate max-w-[400px]" title={t.title}>
                    <Link href={`/app/tickets/${t.id}`} className="hover:underline font-medium text-foreground">
                      {t.title}
                    </Link>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2">
                    <span>{new Date(t.created_at).toLocaleString()}</span>
                  </div>
                </td>
                <td className="px-5 py-3.5">
                  <TicketStatusBadge status={t.status} />
                </td>
                <td className="px-5 py-3.5">
                  <TicketPriorityBadge priority={t.priority} />
                </td>
                <td className="px-5 py-3.5">
                  {assignee ? (
                    <span className="text-foreground/90">{profileLabel(assignee)}</span>
                  ) : (
                    <span className="text-yellow-500 font-medium flex items-center gap-1.5 text-xs">
                      <UserX className="w-3.5 h-3.5" /> Sin asignar
                    </span>
                  )}
                </td>
                <td className={`px-5 py-3.5 text-right ${remClass}`}>
                  {remaining !== null ? (
                    remaining < 0 ? (
                       <span className="flex items-center justify-end gap-1.5">
                         Vencido hace {formatTime(remaining)} <AlertCircle className="w-4 h-4" />
                       </span>
                    ) : (
                       <span className="flex items-center justify-end gap-1.5">
                         {formatTime(remaining)}
                       </span>
                    )
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  if (sessionLoading || profileLoading) return <AppBootScreen label="Cargando…" />;
  if (!session) return null;
  if (profileError) return <AppNoticeScreen variant="error" title="No se pudo cargar el perfil" description={profileError} />;
  if (!profile) return null;

  if (!canSee) {
    return (
      <AppShell profile={profile}>
        <AppNoticeScreen title="Acceso restringido" description="Esta vista está disponible para supervisor y admin." />
      </AppShell>
    );
  }

  const statusOptions: ComboboxOption[] = [{ value: "__all__", label: "Todos" }].concat(
    TicketStatuses.map((s) => ({ value: s, label: s }))
  );
  const priorityOptions: ComboboxOption[] = [{ value: "__all__", label: "Todas" }].concat(
    TicketPriorities.map((p) => ({ value: p, label: p }))
  );
  const assigneeOptions: ComboboxOption[] = [{ value: "__all__", label: "Todos" }].concat(
    profiles
      .slice()
      .sort((a, b) => profileLabel(a).localeCompare(profileLabel(b)))
      .map((p) => ({ value: p.id, label: profileLabel(p) }))
  );

  return (
    <AppShell profile={profile}>
      <div className="space-y-6">
        <PageHeader
          kicker={
            <Link href="/app" className="hover:underline">
              ← Volver al panel
            </Link>
          }
          title="Monitoreo de Tickets (NOC)"
          description="Vista operacional agrupada por estado de SLA y urgencia."
          actions={
            <>
              <Button
                variant="outline"
                onClick={() => {
                  const header = [
                    "ticket_number",
                    "title",
                    "type",
                    "status",
                    "priority",
                    "sla_light",
                    "response_light",
                    "sla_remaining_minutes",
                    "response_remaining_minutes",
                    "created_at",
                    "assignee",
                    "requester",
                    "category",
                    "subcategory",
                  ];
                  const out = finalRows.map((t) => {
                    const tracking = formatTicketNumber(t.ticket_number) ?? t.id.slice(0, 8).toUpperCase();
                    const requester = t.requester_id ? profById.get(t.requester_id) ?? null : null;
                    const assignee = t.assignee_id ? profById.get(t.assignee_id) ?? null : null;
                    const cat = t.category_id ? catById.get(t.category_id) ?? "" : "";
                    const sub = t.subcategory_id ? subById.get(t.subcategory_id) ?? "" : "";
                    return [
                      tracking,
                      t.title,
                      t.type,
                      t.status,
                      t.priority,
                      t.sla_traffic_light ?? "",
                      t.response_traffic_light ?? "",
                      typeof t.sla_remaining_minutes === "number" ? Math.round(t.sla_remaining_minutes) : "",
                      typeof t.response_remaining_minutes === "number" ? Math.round(t.response_remaining_minutes) : "",
                      t.created_at,
                      assignee ? profileLabel(assignee) : "",
                      requester ? profileLabel(requester) : "",
                      cat,
                      sub,
                    ];
                  });
                  downloadCsv(`tickets-seguimiento-${profile.department_id}.csv`, header, out);
                }}
                disabled={loading || finalRows.length === 0}
              >
                Descargar CSV
              </Button>
              <Button variant="outline" onClick={() => void load()} disabled={loading}>
                <RefreshCcw className="h-4 w-4" />
                Actualizar
              </Button>
            </>
          }
        />

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            title="Vencidos / Fuera SLA"
            value={kpiCounts.overdue}
            icon={AlertCircle}
            active={quickFilter === "overdue"}
            onClick={() => setQuickFilter(quickFilter === "overdue" ? "all" : "overdue")}
            color="red"
          />
          <KpiCard
            title="SLA en Riesgo"
            value={kpiCounts.atRisk}
            icon={Clock}
            active={quickFilter === "at_risk"}
            onClick={() => setQuickFilter(quickFilter === "at_risk" ? "all" : "at_risk")}
            color="yellow"
          />
          <KpiCard
            title="Sin Asignar"
            value={kpiCounts.unassigned}
            icon={UserX}
            active={quickFilter === "unassigned"}
            onClick={() => setQuickFilter(quickFilter === "unassigned" ? "all" : "unassigned")}
            color="blue"
          />
          <KpiCard
            title="Mis Tickets"
            value={kpiCounts.mine}
            icon={User}
            active={quickFilter === "mine"}
            onClick={() => setQuickFilter(quickFilter === "mine" ? "all" : "mine")}
            color="purple"
          />
        </div>

        <Card className="tech-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Filtros de Tablero</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <label className="block">
                <div className="text-xs text-muted-foreground mb-1.5 font-medium">Búsqueda Rápida</div>
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej: impresora, wifi, office…" className="bg-background" />
              </label>
              <label className="block">
                <div className="text-xs text-muted-foreground mb-1.5 font-medium">Estado</div>
                <Combobox
                  value={status ?? "__all__"}
                  onValueChange={(v) => setStatus(v === "__all__" ? null : v)}
                  options={statusOptions}
                  placeholder="Todos"
                />
              </label>
              <label className="block">
                <div className="text-xs text-muted-foreground mb-1.5 font-medium">Prioridad</div>
                <Combobox
                  value={priority ?? "__all__"}
                  onValueChange={(v) => setPriority(v === "__all__" ? null : v)}
                  options={priorityOptions}
                  placeholder="Todas"
                />
              </label>
              <label className="block">
                <div className="text-xs text-muted-foreground mb-1.5 font-medium">Asignado a</div>
                <Combobox
                  value={assigneeId ?? "__all__"}
                  onValueChange={(v) => setAssigneeId(v === "__all__" ? null : v)}
                  options={assigneeOptions}
                  placeholder="Todos"
                />
              </label>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-4">
              <div className="flex gap-2">
                <Button variant={showClosed ? "secondary" : "outline"} size="sm" onClick={() => setShowClosed((v) => !v)}>
                  {showClosed ? "Ocultar cerrados" : "Incluir cerrados"}
                </Button>
                {quickFilter !== "all" && (
                  <Button variant="ghost" size="sm" onClick={() => setQuickFilter("all")} className="text-muted-foreground">
                    Quitar filtro rápido ({quickFilter})
                  </Button>
                )}
              </div>
              <div className="text-sm font-medium text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-md">
                Total en vista: {finalRows.length} tickets
              </div>
            </div>
          </CardContent>
        </Card>

        {error ? <InlineAlert variant="error" description={error} /> : null}

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        ) : finalRows.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center rounded-xl border-2 border-dashed border-border/50 text-muted-foreground">
            <CalendarDays className="w-8 h-8 mb-2 opacity-20" />
            <p className="text-sm font-medium">No hay tickets que coincidan con los filtros.</p>
          </div>
        ) : (
          <div className="space-y-8 pb-10">
            {groupedTickets.red.length > 0 && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 overflow-hidden shadow-sm shadow-red-500/10">
                <div className="bg-red-500/10 px-5 py-3.5 border-b border-red-500/20 flex items-center gap-3">
                  <div className="w-3.5 h-3.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]"></div>
                  <h3 className="font-bold text-red-500 tracking-wide">FUERA DE SLA / VENCIDOS</h3>
                  <Badge variant="outline" className="ml-2 border-red-500/50 text-red-500 bg-red-500/10">{groupedTickets.red.length}</Badge>
                  <span className="text-xs text-red-500/80 ml-auto flex items-center gap-1.5 uppercase font-bold"><AlertCircle className="w-4 h-4" /> Atención Inmediata</span>
                </div>
                {renderTicketTable(groupedTickets.red)}
              </div>
            )}

            {groupedTickets.yellow.length > 0 && (
              <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 overflow-hidden shadow-sm shadow-yellow-500/5">
                <div className="bg-yellow-500/10 px-5 py-3.5 border-b border-yellow-500/20 flex items-center gap-3">
                  <div className="w-3.5 h-3.5 rounded-full bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.6)]"></div>
                  <h3 className="font-bold text-yellow-500 tracking-wide">SLA EN RIESGO</h3>
                  <Badge variant="outline" className="ml-2 border-yellow-500/50 text-yellow-500 bg-yellow-500/10">{groupedTickets.yellow.length}</Badge>
                  <span className="text-xs text-yellow-500/80 ml-auto flex items-center gap-1.5 uppercase font-bold"><Clock className="w-4 h-4" /> Próximos a Vencer</span>
                </div>
                {renderTicketTable(groupedTickets.yellow)}
              </div>
            )}

            {groupedTickets.green.length > 0 && (
              <div className="rounded-xl border border-green-500/20 bg-green-500/5 overflow-hidden">
                <div className="bg-green-500/10 px-5 py-3 border-b border-green-500/20 flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]"></div>
                  <h3 className="font-bold text-green-500 tracking-wide">EN PLAZO</h3>
                  <Badge variant="outline" className="ml-2 border-green-500/50 text-green-500 bg-green-500/10">{groupedTickets.green.length}</Badge>
                </div>
                {renderTicketTable(groupedTickets.green)}
              </div>
            )}

            {groupedTickets.other.length > 0 && (
              <div className="rounded-xl border border-border bg-background overflow-hidden">
                <div className="bg-muted/30 px-5 py-3 border-b border-border flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-muted-foreground"></div>
                  <h3 className="font-bold text-muted-foreground tracking-wide">OTROS (Cerrados / Sin SLA)</h3>
                  <Badge variant="outline" className="ml-2">{groupedTickets.other.length}</Badge>
                </div>
                {renderTicketTable(groupedTickets.other)}
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
