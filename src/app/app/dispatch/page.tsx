"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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
import { cn } from "@/lib/cn";
import { useProfile, useSession } from "@/lib/hooks";
import { supabase } from "@/lib/supabaseBrowser";
import type { Ticket } from "@/lib/types";
import { errorMessage } from "@/lib/error";
import { formatTicketNumber } from "@/lib/ticketNumber";
import { RefreshCcw } from "lucide-react";

type RangePreset = "today" | "7d" | "30d" | "open";

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

type LaneKey = "unassigned" | "in_sla" | "at_risk" | "out_of_time" | "planned" | "closed";

function startOfLocalDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function presetStart(preset: RangePreset) {
  const now = new Date();
  if (preset === "today") return startOfLocalDay(now);
  if (preset === "7d") return new Date(now.getTime() - 7 * 86400000);
  if (preset === "30d") return new Date(now.getTime() - 30 * 86400000);
  return null;
}

function profileLabel(p: { full_name: string | null; email: string }) {
  return p.full_name?.trim() || p.email;
}

function formatPct(v: unknown) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v > 0 && v < 1) return "<1%";
  return `${Math.round(v)}%`;
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

function laneLabel(key: LaneKey) {
  if (key === "unassigned") return "Sin asignar";
  if (key === "out_of_time") return "Fuera de plazo";
  if (key === "at_risk") return "En riesgo";
  if (key === "planned") return "Planificados";
  if (key === "closed") return "Cerrados/Cancelados";
  return "En plazo";
}

function laneSortKey(key: LaneKey) {
  const order: Record<LaneKey, number> = { unassigned: 1, out_of_time: 2, at_risk: 3, in_sla: 4, planned: 5, closed: 6 };
  return order[key];
}

function pickLane(t: TicketLiveRow): LaneKey {
  const status = String(t.status ?? "");
  if (status === "Cerrado" || status === "Cancelado" || status === "Rechazado") return "closed";
  if (status === "Planificado o Coordinado") return "planned";
  if (t.sla_traffic_light === "red") return "out_of_time";
  if (t.sla_traffic_light === "yellow") return "at_risk";
  if (!t.assignee_id) return "unassigned";
  return "in_sla";
}

export default function DispatchPage() {
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error: profileError } = useProfile(session?.user.id);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<TicketLiveRow[]>([]);
  const [profiles, setProfiles] = useState<Array<{ id: string; email: string; full_name: string | null; role?: string | null }>>([]);

  const [preset, setPreset] = useState<RangePreset>("today");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const canSee = profile?.role === "supervisor" || profile?.role === "admin";

  const profById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  const assigneeOptions: ComboboxOption[] = useMemo(() => {
    const opts: ComboboxOption[] = [{ value: "__all__", label: "Todos" }, { value: "__unassigned__", label: "Sin asignar" }];
    const people = profiles
      .slice()
      .sort((a, b) => profileLabel(a).localeCompare(profileLabel(b)))
      .map((p) => ({ value: p.id, label: profileLabel(p) }));
    return opts.concat(people);
  }, [profiles]);

  const statusOptions: ComboboxOption[] = useMemo(
    () => [{ value: "__all__", label: "Todos" }].concat(TicketStatuses.map((s) => ({ value: s, label: s }))),
    []
  );
  const priorityOptions: ComboboxOption[] = useMemo(
    () => [{ value: "__all__", label: "Todas" }].concat(TicketPriorities.map((p) => ({ value: p, label: p }))),
    []
  );

  const load = useCallback(async () => {
    if (!profile?.department_id) return;
    setLoading(true);
    setError(null);
    try {
      const start = presetStart(preset);
      const deptId = profile.department_id;

      const profilesRes = await supabase
        .from("profiles")
        .select("id,email,full_name,role")
        .eq("department_id", deptId)
        .in("role", ["agent", "supervisor"])
        .order("email");
      if (profilesRes.error) throw profilesRes.error;
      setProfiles((profilesRes.data ?? []) as Array<{ id: string; email: string; full_name: string | null; role?: string | null }>);

      let q = supabase
        .from("tickets_sla_live")
        .select("*")
        .eq("department_id", deptId)
        .order("created_at", { ascending: false })
        .limit(600);

      if (start) q = q.gte("created_at", start.toISOString());
      if (preset === "open") q = q.not("status", "in", '("Cerrado","Cancelado","Rechazado")');

      const { data, error } = await q;
      if (error) {
        const base = await supabase
          .from("tickets")
          .select("*")
          .eq("department_id", deptId)
          .order("created_at", { ascending: false })
          .limit(600);
        if (base.error) throw base.error;
        const rows = ((base.data ?? []) as unknown as TicketLiveRow[]).filter((t) => (start ? new Date(t.created_at) >= start : true));
        setTickets(rows);
        setLoading(false);
        return;
      }

      setTickets((data ?? []) as unknown as TicketLiveRow[]);
      setLoading(false);
    } catch (e: unknown) {
      setError(errorMessage(e) ?? "No se pudo cargar el centro de mando");
      setLoading(false);
    }
  }, [profile?.department_id, preset]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tickets.filter((t) => {
      const st = String(t.status ?? "");
      if (!showClosed && (st === "Cerrado" || st === "Cancelado" || st === "Rechazado")) return false;

      if (status && st !== status) return false;
      if (priority && t.priority !== priority) return false;

      if (assignee) {
        if (assignee === "__unassigned__") {
          if (t.assignee_id) return false;
        } else if (t.assignee_id !== assignee) {
          return false;
        }
      }

      if (!q) return true;
      const a = t.assignee_id ? profById.get(t.assignee_id) ?? null : null;
      return (
        t.title.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q) ||
        t.type.toLowerCase().includes(q) ||
        t.priority.toLowerCase().includes(q) ||
        st.toLowerCase().includes(q) ||
        (a ? profileLabel(a).toLowerCase().includes(q) : false)
      );
    });
  }, [tickets, query, showClosed, status, priority, assignee, profById]);

  const normalized = useMemo(() => {
    return filtered.map((t) => {
      const sla = t.sla_traffic_light
        ? { light: t.sla_traffic_light, remainingMinutes: t.sla_remaining_minutes ?? null, pctUsed: t.sla_pct_used ?? null }
        : computeTraffic({
            status: t.status,
            excluded: t.sla_excluded,
            deadline: t.sla_deadline,
            targetMinutes: (t as { sla_resolution_target_minutes?: unknown }).sla_resolution_target_minutes,
          });
      const resp = t.response_traffic_light
        ? { light: t.response_traffic_light, remainingMinutes: t.response_remaining_minutes ?? null, pctUsed: t.response_pct_used ?? null }
        : computeTraffic({
            status: t.status,
            excluded: t.sla_excluded,
            deadline: t.response_deadline,
            targetMinutes: (t as { sla_response_target_minutes?: unknown }).sla_response_target_minutes,
          });

      return {
        ...t,
        sla_traffic_light: sla.light,
        sla_remaining_minutes: sla.remainingMinutes,
        sla_pct_used: sla.pctUsed,
        response_traffic_light: resp.light,
        response_remaining_minutes: resp.remainingMinutes,
        response_pct_used: resp.pctUsed,
      } as TicketLiveRow;
    });
  }, [filtered]);

  const lanes = useMemo(() => {
    const map = new Map<LaneKey, TicketLiveRow[]>();
    const keys: LaneKey[] = ["unassigned", "out_of_time", "at_risk", "in_sla", "planned", "closed"];
    for (const k of keys) map.set(k, []);

    for (const t of normalized) {
      map.get(pickLane(t))!.push(t);
    }

    for (const [k, list] of map) {
      if (k === "closed") {
        list.sort((a, b) => (b.closed_at ?? b.updated_at).localeCompare(a.closed_at ?? a.updated_at));
      } else if (k === "out_of_time" || k === "at_risk") {
        list.sort((a, b) => (a.sla_deadline ?? "").localeCompare(b.sla_deadline ?? ""));
      } else {
        list.sort((a, b) => b.created_at.localeCompare(a.created_at));
      }
    }

    return Array.from(map.entries()).sort((a, b) => laneSortKey(a[0]) - laneSortKey(b[0]));
  }, [normalized]);

  const workload = useMemo(() => {
    const rows = profiles.map((p) => {
      const open = normalized.filter((t) => {
        const st = String(t.status ?? "");
        return t.assignee_id === p.id && st !== "Cerrado" && st !== "Cancelado" && st !== "Rechazado";
      });
      const red = open.filter((t) => t.sla_traffic_light === "red").length;
      const yellow = open.filter((t) => t.sla_traffic_light === "yellow").length;
      return { id: p.id, label: profileLabel(p), open: open.length, red, yellow };
    });
    rows.sort((a, b) => b.open - a.open || a.label.localeCompare(b.label));
    return rows;
  }, [profiles, normalized]);

  async function updateAssignee(ticketId: string, assigneeId: string | null) {
    const prev = tickets;
    setTickets((cur) => cur.map((t) => (t.id === ticketId ? { ...t, assignee_id: assigneeId } : t)));
    const { error } = await supabase.from("tickets").update({ assignee_id: assigneeId }).eq("id", ticketId);
    if (error) {
      setTickets(prev);
      toast.error("No se pudo reasignar", { description: error.message });
      return;
    }
    toast.success("Asignación actualizada");
  }

  if (sessionLoading || profileLoading) return <AppBootScreen label="Preparando tu sesión…" />;
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

  return (
    <AppShell profile={profile} wide>
      <div className="space-y-5">
        <PageHeader
          kicker={
            <Link href="/app" className="hover:underline">
              ← Volver al panel
            </Link>
          }
          title="Centro de mando"
          description="Kanban operativo para asignación rápida, carga por técnico y control de SLA."
          actions={
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant={preset === "today" ? "default" : "outline"} onClick={() => setPreset("today")}>
                  Hoy
                </Button>
                <Button variant={preset === "7d" ? "default" : "outline"} onClick={() => setPreset("7d")}>
                  7 días
                </Button>
                <Button variant={preset === "30d" ? "default" : "outline"} onClick={() => setPreset("30d")}>
                  30 días
                </Button>
                <Button variant={preset === "open" ? "default" : "outline"} onClick={() => setPreset("open")}>
                  Abiertos
                </Button>
              </div>
              <Button variant="outline" onClick={() => void load()} disabled={loading}>
                <RefreshCcw className="h-4 w-4" />
                Actualizar
              </Button>
            </div>
          }
        />

        <Card className="tech-border">
          <CardHeader>
            <CardTitle>Filtros</CardTitle>
            <CardDescription>Busca por texto y filtra por estado, prioridad y asignado.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <label className="block">
                <div className="text-xs text-muted-foreground">Buscar</div>
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ej: impresora, wifi, bitdefender…" />
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
                  value={assignee ?? "__all__"}
                  onValueChange={(v) => setAssignee(v === "__all__" ? null : v)}
                  options={assigneeOptions}
                  placeholder="Todos"
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant={showClosed ? "secondary" : "outline"} onClick={() => setShowClosed((v) => !v)}>
                {showClosed ? "Incluye cerrados/cancelados" : "Oculta cerrados/cancelados"}
              </Button>
              <div className="text-xs text-muted-foreground">Mostrando {normalized.length} tickets</div>
            </div>
          </CardContent>
        </Card>

        <Card className="tech-border">
          <CardHeader>
            <CardTitle>Carga por técnico</CardTitle>
            <CardDescription>Útil para detectar sobrecarga y redistribuir tickets.</CardDescription>
          </CardHeader>
          <CardContent>
            {profiles.length === 0 ? (
              <div className="text-sm text-muted-foreground">No hay técnicos en tu área.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {workload.map((w) => (
                  <button
                    key={w.id}
                    className={cn(
                      "rounded-xl border border-border bg-background/20 px-3 py-2 text-left hover:bg-accent/20",
                      assignee === w.id && "ring-1 ring-[hsl(var(--brand-cyan))]/25"
                    )}
                    onClick={() => setAssignee((cur) => (cur === w.id ? null : w.id))}
                    type="button"
                  >
                    <div className="text-xs font-medium">{w.label}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>Abiertos: {w.open}</span>
                      {w.red > 0 ? <span className="text-rose-200">• Fuera: {w.red}</span> : null}
                      {w.yellow > 0 ? <span className="text-amber-200">• Riesgo: {w.yellow}</span> : null}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {error ? <InlineAlert variant="error" description={error} /> : null}

        <Card className="tech-border">
          <CardHeader>
            <CardTitle>Tablero</CardTitle>
            <CardDescription>Arriba lo crítico (fuera de plazo/sin asignar). Reasigna desde cada tarjeta.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="min-w-0 rounded-xl border border-border bg-background/20 p-2">
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-5 w-10 rounded-full" />
                    </div>
                    <div className="mt-3 space-y-2">
                      <Skeleton className="h-24 w-full rounded-xl" />
                      <Skeleton className="h-24 w-full rounded-xl" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
                {lanes.map(([k, list]) => (
                  <div key={k} className="min-w-0 rounded-xl border border-border bg-background/20 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold">{laneLabel(k)}</div>
                      <Badge variant="outline">{list.length}</Badge>
                    </div>
                    <div className="mt-2 space-y-2">
                      {list.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">Sin tickets</div>
                      ) : (
                        <div className="space-y-2">
                          {list.map((t) => {
                          const tracking = formatTicketNumber(t.ticket_number) ?? t.id.slice(0, 8).toUpperCase();
                          const who = t.assignee_id ? profById.get(t.assignee_id) ?? null : null;

                          const slaLabel =
                            t.sla_traffic_light === "excluded"
                              ? "Excluido"
                              : t.sla_traffic_light === "closed"
                                ? "Cerrado"
                                : t.sla_traffic_light === "red"
                                  ? "Fuera de plazo"
                                  : t.sla_traffic_light === "yellow"
                                    ? "En riesgo"
                                    : t.sla_traffic_light === "green"
                                      ? "En plazo"
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
                                      ? "En plazo"
                                      : "Sin objetivo";

                          const slaUse = formatPct(t.sla_pct_used);
                          const respUse = formatPct(t.response_pct_used);

                          const cardTone =
                            t.sla_traffic_light === "red"
                              ? "border-rose-500/25"
                              : t.sla_traffic_light === "yellow"
                                ? "border-amber-500/25"
                                : "border-border";

                          return (
                            <div key={t.id} className={cn("rounded-xl border bg-background/30 p-2 hover:bg-accent/20", cardTone)}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <Link href={`/app/tickets/${t.id}`} className="block truncate text-[13px] font-medium hover:underline">
                                    {t.title}
                                  </Link>
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                    <Badge variant="outline" className="font-mono text-[10px]">
                                      {tracking}
                                    </Badge>
                                    <TicketTypeBadge type={t.type} />
                                    <TicketPriorityBadge priority={t.priority} />
                                    <TicketStatusBadge status={t.status} />
                                  </div>
                                </div>
                              </div>

                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <Badge variant="outline" className={cn("text-[10px]", slaBadgeFromTrafficLight(t.sla_traffic_light))}>
                                  SLA: {slaLabel}
                                </Badge>
                                <Badge variant="outline" className={cn("text-[10px]", slaBadgeFromTrafficLight(t.response_traffic_light))}>
                                  Resp: {respLabel}
                                </Badge>
                              </div>

                              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                                <div className="space-y-0.5">
                                  {typeof t.sla_remaining_minutes === "number" ? <div>SLA: {Math.max(0, Math.round(t.sla_remaining_minutes))}m</div> : null}
                                  {typeof t.response_remaining_minutes === "number" ? <div>Resp: {Math.max(0, Math.round(t.response_remaining_minutes))}m</div> : null}
                                </div>
                                <div className="space-y-0.5 text-right">
                                  {slaUse ? <div>Consumo SLA: {slaUse}</div> : null}
                                  {respUse ? <div>Consumo Resp: {respUse}</div> : null}
                                </div>
                              </div>

                              <div className="mt-3 grid gap-2">
                                <div className="text-[10px] text-muted-foreground">Asignado</div>
                                <Combobox
                                  value={t.assignee_id ?? "__unassigned__"}
                                  onValueChange={(v) => {
                                    const st = String(t.status ?? "");
                                    if (st === "Cerrado" || st === "Cancelado" || st === "Rechazado") return;
                                    const next = v === "__unassigned__" ? null : v;
                                    void updateAssignee(t.id, next);
                                  }}
                                  options={[{ value: "__unassigned__", label: "Sin asignar" }].concat(
                                    profiles
                                      .slice()
                                      .sort((a, b) => profileLabel(a).localeCompare(profileLabel(b)))
                                      .map((p) => ({ value: p.id, label: profileLabel(p) }))
                                  )}
                                  placeholder={who ? profileLabel(who) : "Sin asignar"}
                                />
                              </div>
                            </div>
                          );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
