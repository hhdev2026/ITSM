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
import { slaBadgeFromTrafficLight, TicketPriorities, TicketStatuses } from "@/lib/constants";
import { useProfile, useSession } from "@/lib/hooks";
import { supabase } from "@/lib/supabaseBrowser";
import type { Category, Subcategory, Ticket } from "@/lib/types";
import { formatTicketNumber } from "@/lib/ticketNumber";
import { errorMessage } from "@/lib/error";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCcw } from "lucide-react";

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
  if (opts.excluded === true) return { light: "excluded", remainingMinutes: 0, pctUsed: null };
  if (status === "Cerrado" || status === "Cancelado" || status === "Rechazado") return { light: "closed", remainingMinutes: 0, pctUsed: null };

  const deadline = typeof opts.deadline === "string" ? opts.deadline : null;
  const target = typeof opts.targetMinutes === "number" ? opts.targetMinutes : null;
  if (!deadline || !target || target <= 0) return { light: null, remainingMinutes: null, pctUsed: null };

  const remaining = Math.floor((new Date(deadline).getTime() - Date.now()) / 60000);
  const remainingClamped = Math.max(remaining, 0);
  const ratio = remaining / target;
  const light: Ticket["sla_traffic_light"] = remaining <= 0 ? "red" : ratio <= 0.2 ? "yellow" : "green";
  const pctUsed = Math.round((1 - remainingClamped / target) * 10000) / 100;
  return { light, remainingMinutes: remainingClamped, pctUsed };
}

export default function TicketsTrackingPage() {
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error: profileError } = useProfile(session?.user.id);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<TicketLiveRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [profiles, setProfiles] = useState<Array<{ id: string; email: string; full_name: string | null }>>([]);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

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

      // Fetch a snapshot and apply filters locally (avoids enum-filter errors if DB is mid-migration).
      const { data, error } = await supabase
        .from("tickets_sla_live")
        .select("*")
        .eq("department_id", profile.department_id)
        .order("created_at", { ascending: false })
        .limit(250);

      let finalRows: TicketLiveRow[] = [];

      if (error) {
        // Fallback: DB may not have the view/grants yet; use base table.
        const base = await supabase.from("tickets").select("*").eq("department_id", profile.department_id).order("created_at", { ascending: false }).limit(250);
        if (base.error) throw base.error;

        const computed = ((base.data ?? []) as Array<Record<string, unknown>>).map((t) => {
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

        finalRows = computed.filter((t) => {
          const title = typeof t.title === "string" ? t.title : "";
          if (!showClosed && (t.status === "Cerrado" || t.status === "Cancelado")) return false;
          if (status && t.status !== status) return false;
          if (priority && t.priority !== priority) return false;
          if (assigneeId && t.assignee_id !== assigneeId) return false;
          if (q.trim() && !title.toLowerCase().includes(q.trim().toLowerCase())) return false;
          return true;
        });
      } else {
        const tickets = (data ?? []) as Array<Record<string, unknown>>;
        finalRows = tickets.filter((t) => {
          const st = typeof t.status === "string" ? t.status : "";
          const pr = typeof t.priority === "string" ? t.priority : "";
          const asg = typeof t.assignee_id === "string" ? t.assignee_id : null;
          const title = typeof t.title === "string" ? t.title : "";
          if (!showClosed && (st === "Cerrado" || st === "Cancelado")) return false;
          if (status && st !== status) return false;
          if (priority && pr !== priority) return false;
          if (assigneeId && asg !== assigneeId) return false;
          if (q.trim() && !title.toLowerCase().includes(q.trim().toLowerCase())) return false;
          return true;
        }) as unknown as TicketLiveRow[];
      }

      const ids = new Set<string>();
      for (const t of finalRows) {
        if (typeof t.requester_id === "string") ids.add(t.requester_id);
        if (typeof t.assignee_id === "string") ids.add(t.assignee_id);
      }

      setRows(finalRows);

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
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [assigneeId, priority, profile?.department_id, q, showClosed, status]);

  useEffect(() => {
    if (canSee) void load();
  }, [canSee, load]);

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
      <div className="space-y-5">
        <PageHeader
          kicker={
            <Link href="/app" className="hover:underline">
              ← Volver al panel
            </Link>
          }
          title="Seguimiento de tickets"
          description="Detalle por ticket con semáforo de SLA y tiempos restantes."
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
                  const out = rows.map((t) => {
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
                disabled={loading || rows.length === 0}
              >
                Descargar Excel (CSV)
              </Button>
              <Button variant="outline" onClick={() => window.print()}>
                Descargar PDF (Imprimir)
              </Button>
              <Button variant="outline" onClick={() => void load()} disabled={loading}>
                <RefreshCcw className="h-4 w-4" />
                Actualizar
              </Button>
            </>
          }
        />

        <Card className="tech-border">
          <CardHeader>
            <CardTitle>Filtros</CardTitle>
            <CardDescription>Filtra por estado, prioridad y asignado. Busca por título.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <label className="block">
                <div className="text-xs text-muted-foreground">Buscar</div>
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej: impresora, wifi, office…" />
              </label>
              <label className="block">
                <div className="text-xs text-muted-foreground">Estado</div>
                <Combobox
                  value={status ?? "__all__"}
                  onValueChange={(v) => setStatus(v === "__all__" ? null : v)}
                  options={statusOptions}
                  placeholder="Todos"
                />
              </label>
              <label className="block">
                <div className="text-xs text-muted-foreground">Prioridad</div>
                <Combobox
                  value={priority ?? "__all__"}
                  onValueChange={(v) => setPriority(v === "__all__" ? null : v)}
                  options={priorityOptions}
                  placeholder="Todas"
                />
              </label>
              <label className="block">
                <div className="text-xs text-muted-foreground">Asignado</div>
                <Combobox
                  value={assigneeId ?? "__all__"}
                  onValueChange={(v) => setAssigneeId(v === "__all__" ? null : v)}
                  options={assigneeOptions}
                  placeholder="Todos"
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant={showClosed ? "secondary" : "outline"} onClick={() => setShowClosed((v) => !v)}>
                {showClosed ? "Incluye cerrados/cancelados" : "Oculta cerrados/cancelados"}
              </Button>
              <div className="text-xs text-muted-foreground">Mostrando {rows.length} tickets</div>
            </div>
          </CardContent>
        </Card>

        {error ? <InlineAlert variant="error" description={error} /> : null}

        <Card className="tech-border">
          <CardHeader>
            <CardTitle>Detalle</CardTitle>
            <CardDescription>Semáforo SLA/Respuesta: verde (ok), amarillo (riesgo), rojo (vencido), excluido/cerrado.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : rows.length === 0 ? (
              <div className="text-sm text-muted-foreground">No hay tickets con los filtros actuales.</div>
            ) : (
              <div className="space-y-2">
                {rows.map((t) => {
                  const tracking = formatTicketNumber(t.ticket_number) ?? t.id.slice(0, 8).toUpperCase();
                  const requester = t.requester_id ? profById.get(t.requester_id) ?? null : null;
                  const assignee = t.assignee_id ? profById.get(t.assignee_id) ?? null : null;
                  const cat = t.category_id ? catById.get(t.category_id) ?? null : null;
                  const sub = t.subcategory_id ? subById.get(t.subcategory_id) ?? null : null;
                  const tiers = tierPathFromMetadata(t.metadata);
                  const slaLabel =
                    t.sla_traffic_light === "excluded"
                      ? "Excluido"
                      : t.sla_traffic_light === "closed"
                        ? "Cerrado"
                        : t.sla_traffic_light === "red"
                          ? "Fuera de SLA"
                          : t.sla_traffic_light === "yellow"
                            ? "En riesgo"
                            : t.sla_traffic_light === "green"
                              ? "OK"
                              : "Sin SLA";
                  const respLabel =
                    t.response_traffic_light === "excluded"
                      ? "Excluido"
                      : t.response_traffic_light === "closed"
                        ? "Cerrado"
                        : t.response_traffic_light === "red"
                          ? "Vencido"
                          : t.response_traffic_light === "yellow"
                            ? "En riesgo"
                            : t.response_traffic_light === "green"
                              ? "OK"
                              : "Sin objetivo";

                  return (
                    <Link key={t.id} href={`/app/tickets/${t.id}`} className="block rounded-2xl border border-border bg-background/20 p-3 hover:bg-accent/20">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="font-mono">
                              {tracking}
                            </Badge>
                            <TicketTypeBadge type={t.type} />
                            <TicketPriorityBadge priority={t.priority} />
                            <TicketStatusBadge status={t.status} />
                            <Badge variant="outline" className={slaBadgeFromTrafficLight(t.sla_traffic_light)}>
                              SLA: {slaLabel}
                            </Badge>
                            <Badge variant="outline" className={slaBadgeFromTrafficLight(t.response_traffic_light)}>
                              Resp: {respLabel}
                            </Badge>
                            {t.sla_excluded ? <Badge variant="outline">Excluido de KPI</Badge> : null}
                          </div>

                          <div className="mt-2 min-w-0 truncate text-sm font-medium">{t.title}</div>

                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>Creado: {new Date(t.created_at).toLocaleString()}</span>
                            {requester ? <span>• Solicitante: {profileLabel(requester)}</span> : null}
                            {assignee ? <span>• Asignado: {profileLabel(assignee)}</span> : <span>• Asignado: Sin asignar</span>}
                            {cat ? <span>• {cat}</span> : null}
                            {sub ? <span>• {sub}</span> : null}
                          </div>

                          {tiers ? <div className="mt-2 truncate text-xs text-muted-foreground">{tiers}</div> : null}

                          {(t.sla_excluded && t.sla_exclusion_reason) || t.canceled_reason || t.planned_for_at ? (
                            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                              {t.sla_excluded && t.sla_exclusion_reason ? <span>Justificación SLA: {t.sla_exclusion_reason}</span> : null}
                              {t.canceled_reason ? <span>Motivo cancelación: {t.canceled_reason}</span> : null}
                              {t.planned_for_at ? <span>Planificado: {new Date(t.planned_for_at).toLocaleString()}</span> : null}
                            </div>
                          ) : null}
                        </div>

                        <div className="shrink-0 text-right text-xs text-muted-foreground">
                          {typeof t.sla_remaining_minutes === "number" ? <div>SLA: {Math.max(0, Math.round(t.sla_remaining_minutes))}m</div> : null}
                          {typeof t.response_remaining_minutes === "number" ? <div>Resp: {Math.max(0, Math.round(t.response_remaining_minutes))}m</div> : null}
                          {typeof t.sla_pct_used === "number" ? <div>Uso SLA: {Math.round(t.sla_pct_used)}%</div> : null}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
