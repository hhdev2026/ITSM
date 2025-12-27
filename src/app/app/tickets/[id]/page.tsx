"use client";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { useProfile, useSession } from "@/lib/hooks";
import { supabase } from "@/lib/supabaseBrowser";
import type { Comment, Ticket } from "@/lib/types";
import { TicketStatuses, slaBadge } from "@/lib/constants";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { errorMessage } from "@/lib/error";
import { Check, ChevronDown, Clock, Copy, MessageSquare, RefreshCcw, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { MotionItem, MotionList } from "@/components/motion/MotionList";
import { TicketPriorityBadge, TicketStatusBadge, TicketTypeBadge } from "@/components/tickets/TicketBadges";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { InlineEmpty } from "@/components/feedback/InlineEmpty";
import { PageHeader } from "@/components/layout/PageHeader";
import { AppBootScreen } from "@/components/layout/AppStates";

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

type TicketApproval = {
  id: string;
  ticket_id: string;
  step_order: number;
  kind: string;
  required: boolean;
  approver_profile_id: string | null;
  approver_role: string | null;
  status: "pending" | "approved" | "rejected" | "skipped";
  decided_by: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  created_at?: string;
};

type TicketEvent = {
  id: string;
  ticket_id: string;
  actor_id: string | null;
  event_type: "created" | "status_changed" | "assignee_changed" | "priority_changed" | "approval_decided";
  from_status: string | null;
  to_status: string | null;
  from_priority: string | null;
  to_priority: string | null;
  from_assignee_id: string | null;
  to_assignee_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

function approvalKindLabel(kind: string) {
  if (kind === "requester_manager") return "Manager";
  if (kind === "service_owner") return "Owner";
  if (kind === "specific_user") return "Aprobador";
  if (kind === "role") return "Rol";
  return kind;
}

function approvalStatusBadge(status: TicketApproval["status"]) {
  if (status === "approved") return "bg-emerald-500/15 text-emerald-200 border-emerald-500/30";
  if (status === "rejected") return "bg-rose-500/15 text-rose-200 border-rose-500/30";
  if (status === "pending") return "bg-[hsl(var(--brand-cyan))]/12 text-[hsl(var(--brand-cyan))] border-[hsl(var(--brand-cyan))]/30";
  return "bg-zinc-800/60 text-zinc-200 border-zinc-700";
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

export default function TicketDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const ticketId = params?.id;

  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile } = useProfile(session?.user.id);

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [agents, setAgents] = useState<Array<{ id: string; label: string }>>([]);
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [categoryLabel, setCategoryLabel] = useState<string | null>(null);
  const [subcategoryLabel, setSubcategoryLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approvals, setApprovals] = useState<TicketApproval[]>([]);
  const [approvalComment, setApprovalComment] = useState("");
  const [approvalsActing, setApprovalsActing] = useState<null | "approve" | "reject">(null);
  const [events, setEvents] = useState<TicketEvent[]>([]);

  const canModerate = profile?.role === "agent" || profile?.role === "supervisor" || profile?.role === "admin";
  const canReassign = profile?.role === "supervisor" || profile?.role === "admin";

  useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  const load = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    setError(null);
    const { data: t, error: tErr } = await supabase
      .from("tickets")
      .select(
        "id,department_id,type,title,description,status,priority,category_id,subcategory_id,metadata,requester_id,assignee_id,created_at,updated_at,response_deadline,sla_deadline,ola_response_deadline,ola_deadline,first_response_at,resolved_at,closed_at"
      )
      .eq("id", ticketId)
      .single();
    if (tErr) setError(tErr.message);
    const parsed = ((t ?? null) as unknown) as Ticket | null;
    setTicket(parsed);
    setAssigneeId(parsed?.assignee_id ?? "");

    if (parsed?.category_id) {
      const { data: cat } = await supabase.from("categories").select("id,name").eq("id", parsed.category_id).maybeSingle();
      setCategoryLabel(((cat as unknown) as { name?: string } | null)?.name ?? null);
    } else {
      setCategoryLabel(null);
    }
    if (parsed?.subcategory_id) {
      const { data: sub } = await supabase.from("subcategories").select("id,name").eq("id", parsed.subcategory_id).maybeSingle();
      setSubcategoryLabel(((sub as unknown) as { name?: string } | null)?.name ?? null);
    } else {
      setSubcategoryLabel(null);
    }

    const { data: c, error: cErr } = await supabase
      .from("comments")
      .select("id,ticket_id,author_id,body,is_internal,created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    if (cErr) setError(cErr.message);
    setComments((c ?? []) as Comment[]);

    const { data: appr, error: apprErr } = await supabase
      .from("ticket_approvals")
      .select("id,ticket_id,step_order,kind,required,approver_profile_id,approver_role,status,decided_by,decided_at,decision_comment,created_at")
      .eq("ticket_id", ticketId)
      .order("step_order", { ascending: true });
    if (apprErr) setError(apprErr.message);
    setApprovals((appr ?? []) as TicketApproval[]);

    const { data: ev, error: evErr } = await supabase
      .from("ticket_events")
      .select("id,ticket_id,actor_id,event_type,from_status,to_status,from_priority,to_priority,from_assignee_id,to_assignee_id,details,created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    if (evErr) {
      const msg = (evErr.message ?? "").toLowerCase();
      if (msg.includes("ticket_events") || msg.includes("does not exist") || msg.includes("relation")) {
        setEvents([]);
      } else {
        setError(evErr.message);
        setEvents([]);
      }
    } else {
      setEvents((ev ?? []) as TicketEvent[]);
    }

    if (canReassign && profile?.department_id) {
      const { data: profsRaw } = await supabase
        .from("profiles")
        .select("id,full_name,email,role")
        .in("role", ["agent", "supervisor"])
        .eq("department_id", profile.department_id)
        .order("email");
      const profs = (profsRaw ?? []) as Array<{ id: string; full_name: string | null; email: string; role: string }>;
      setAgents(profs.map((p) => ({ id: p.id, label: p.full_name || p.email })));
    }

    setLoading(false);
  }, [ticketId, canReassign, profile?.department_id]);

  useEffect(() => {
    void load();
    if (!ticketId) return;
    const channel = supabase
      .channel(`rt-ticket-${ticketId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets", filter: `id=eq.${ticketId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "comments", filter: `ticket_id=eq.${ticketId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "ticket_approvals", filter: `ticket_id=eq.${ticketId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "ticket_events", filter: `ticket_id=eq.${ticketId}` }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [ticketId, load]);

  const statusActions = useMemo(() => {
    if (!ticket) return [];
    return [
      { label: "Asignado", value: "Asignado" },
      { label: "En Progreso", value: "En Progreso" },
      { label: "Pendiente Info", value: "Pendiente Info" },
      { label: "Resuelto", value: "Resuelto" },
      { label: "Cerrado", value: "Cerrado" },
    ].filter((a) => TicketStatuses.includes(a.value as (typeof TicketStatuses)[number]));
  }, [ticket]);

  async function postComment() {
    if (!profile || !ticketId) return;
    if (body.trim().length < 2) return;
    setSaving(true);
    setError(null);
    try {
      const { error } = await supabase.from("comments").insert({
        ticket_id: ticketId,
        author_id: profile.id,
        body: body.trim(),
        is_internal: canModerate ? internal : false,
      });
      if (error) throw error;
      setBody("");
      setInternal(false);
      await load();
      toast.success("Comentario enviado");
    } catch (e: unknown) {
      const msg = errorMessage(e) ?? "No se pudo guardar el comentario";
      setError(msg);
      toast.error("No se pudo guardar", { description: msg });
    } finally {
      setSaving(false);
    }
  }

  async function assignToMe() {
    if (!profile || !ticketId) return;
    const { error } = await supabase.from("tickets").update({ assignee_id: profile.id, status: "Asignado" }).eq("id", ticketId);
    if (error) toast.error("No se pudo asignar", { description: error.message });
  }

  async function reassign(id: string) {
    if (!ticketId) return;
    const { error } = await supabase.from("tickets").update({ assignee_id: id || null, status: id ? "Asignado" : "Nuevo" }).eq("id", ticketId);
    if (error) toast.error("No se pudo reasignar", { description: error.message });
  }

  async function setStatus(status: string) {
    if (!ticketId) return;
    const { error } = await supabase.from("tickets").update({ status }).eq("id", ticketId);
    if (error) toast.error("No se pudo actualizar estado", { description: error.message });
  }

  async function decideApproval(action: "approve" | "reject") {
    if (!profile || !ticketId) return;
    setApprovalsActing(action);
    try {
      const comment = approvalComment.trim() || null;
      const { error } = await supabase.rpc("approval_decide", { p_ticket_id: ticketId, p_action: action, p_comment: comment });
      if (error) throw error;
      toast.success(action === "approve" ? "Aprobado" : "Rechazado");
      setApprovalComment("");
      await load();
    } catch (e: unknown) {
      toast.error("No se pudo decidir", { description: errorMessage(e) ?? "Error" });
    } finally {
      setApprovalsActing(null);
    }
  }

  const statusBadge = ticket ? <TicketStatusBadge status={ticket.status} /> : null;
  const priorityBadgeEl = ticket ? <TicketPriorityBadge priority={ticket.priority} /> : null;
  const slaBadgeEl =
    ticket ? (
      <span className={cn("rounded-full px-2 py-1 text-[11px]", slaBadge(new Date(), ticket.sla_deadline))}>
        {ticket.sla_deadline ? `SLA ${new Date(ticket.sla_deadline).toLocaleString()}` : "SLA n/a"}
      </span>
    ) : null;

  const metadata = ticket?.metadata ?? {};
  const serviceMetaRaw = metadata["service_catalog"];
  const serviceMeta = isRecord(serviceMetaRaw) ? serviceMetaRaw : null;
  const metaContextRaw = metadata["context"];
  const metaContext = isRecord(metaContextRaw) ? metaContextRaw : null;
  const metaFieldsRaw = metadata["fields"];
  const metaFields = isRecord(metaFieldsRaw) ? metaFieldsRaw : null;
  const metaImpact = typeof metadata["impact"] === "string" ? metadata["impact"] : undefined;
  const metaUrgency = typeof metadata["urgency"] === "string" ? metadata["urgency"] : undefined;

  const traceItems = useMemo(() => {
    const items: Array<{ id: string; at: string; title: string; subtitle?: string | null; actor?: string | null }> = [];

    for (const e of events) {
      const actor = e.actor_id;
      if (e.event_type === "created") {
        items.push({ id: e.id, at: e.created_at, title: "Ticket creado", subtitle: null, actor });
      } else if (e.event_type === "status_changed") {
        items.push({
          id: e.id,
          at: e.created_at,
          title: `Estado: ${e.from_status ?? "—"} → ${e.to_status ?? "—"}`,
          subtitle: null,
          actor,
        });
      } else if (e.event_type === "assignee_changed") {
        items.push({
          id: e.id,
          at: e.created_at,
          title: "Asignación actualizada",
          subtitle: `${(e.from_assignee_id ?? "—").slice(0, 8)} → ${(e.to_assignee_id ?? "—").slice(0, 8)}`,
          actor,
        });
      } else if (e.event_type === "priority_changed") {
        items.push({
          id: e.id,
          at: e.created_at,
          title: `Prioridad: ${e.from_priority ?? "—"} → ${e.to_priority ?? "—"}`,
          subtitle: null,
          actor,
        });
      } else if (e.event_type === "approval_decided") {
        const d = (e.details ?? {}) as Record<string, unknown>;
        const step = typeof d["step_order"] === "number" ? d["step_order"] : null;
        const kind = typeof d["kind"] === "string" ? d["kind"] : null;
        const status = typeof d["status"] === "string" ? d["status"] : null;
        items.push({
          id: e.id,
          at: e.created_at,
          title: `Aprobación${step ? ` (Paso ${step})` : ""}`,
          subtitle: `${kind ? approvalKindLabel(kind) : "—"} · ${status ? status : "—"}`,
          actor,
        });
      }
    }

    if (ticket?.first_response_at) items.push({ id: `milestone-fr`, at: ticket.first_response_at, title: "Primera respuesta", actor: null });
    if (ticket?.resolved_at) items.push({ id: `milestone-res`, at: ticket.resolved_at, title: "Marcado como resuelto", actor: null });
    if (ticket?.closed_at) items.push({ id: `milestone-closed`, at: ticket.closed_at, title: "Cerrado", actor: null });

    if (items.length === 0 && ticket) {
      items.push({ id: "fallback-created", at: ticket.created_at, title: "Ticket creado", actor: null });
      for (const a of approvals) {
        if (a.status !== "pending" && a.decided_at) {
          items.push({
            id: `fallback-approval-${a.id}`,
            at: a.decided_at,
            title: `Aprobación (Paso ${a.step_order})`,
            subtitle: `${approvalKindLabel(a.kind)} · ${a.status}`,
            actor: a.decided_by,
          });
        }
      }
    }

    return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [approvals, events, ticket]);

  const createdAt = ticket ? new Date(ticket.created_at) : null;
  const firstResponseAt = ticket?.first_response_at ? new Date(ticket.first_response_at) : null;
  const closedOrResolvedAt = ticket?.closed_at ? new Date(ticket.closed_at) : ticket?.resolved_at ? new Date(ticket.resolved_at) : null;
  const responseMs = createdAt && firstResponseAt ? firstResponseAt.getTime() - createdAt.getTime() : null;
  const resolutionMs = createdAt && closedOrResolvedAt ? closedOrResolvedAt.getTime() - createdAt.getTime() : null;

  if (sessionLoading || profileLoading) return <AppBootScreen label="Cargando ticket…" />;
  if (!session || !profile) return null;

  const pendingForMe =
    approvals.find(
      (a) =>
        a.status === "pending" &&
        (a.approver_profile_id === profile.id || (a.approver_profile_id === null && a.approver_role && a.approver_role === profile.role))
    ) ?? null;

  return (
    <AppShell profile={profile}>
      <div className="space-y-5">
        <PageHeader
          kicker={
            <Link href="/app" className="hover:underline">
              ← Volver
            </Link>
          }
          title={ticket?.title ?? "Ticket"}
          description="Detalle, actividad y aprobaciones."
          meta={
            ticket ? (
              <>
                <TicketTypeBadge type={ticket.type} />
                {statusBadge}
                {priorityBadgeEl}
                {categoryLabel ? <Badge variant="outline">{categoryLabel}</Badge> : null}
                {subcategoryLabel ? <Badge variant="outline">{subcategoryLabel}</Badge> : null}
                {slaBadgeEl ? slaBadgeEl : null}
              </>
            ) : null
          }
          actions={
            <>
              <Button variant="outline" onClick={() => void load()}>
                <RefreshCcw className="h-4 w-4" />
                Actualizar
              </Button>
              {ticketId ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(ticketId);
                    toast.success("ID copiado");
                  }}
                >
                  <Copy className="h-4 w-4" />
                  Copiar ID
                </Button>
              ) : null}
            </>
          }
        />

        {error ? <InlineAlert variant="error" description={error} /> : null}

        {loading ? (
          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <div className="space-y-4">
              <Card className="tech-border">
                <CardHeader>
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-52" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-24 w-full" />
                </CardContent>
              </Card>
              <Card className="tech-border">
                <CardHeader>
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-4 w-48" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="space-y-4">
              <Card className="tech-border">
                <CardHeader>
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-4 w-40" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-32 w-full" />
                </CardContent>
              </Card>
            </div>
          </div>
	        ) : !ticket ? (
	          <div className="text-sm text-muted-foreground">No existe o no tienes acceso.</div>
	        ) : (
	          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
	            <div className="space-y-4">
	              <Card className="tech-border tech-glow">
	                <CardHeader>
	                  <CardTitle className="flex items-center gap-2">
	                    <Clock className="h-4 w-4 text-[hsl(var(--brand-cyan))]" />
	                    Trazabilidad
	                  </CardTitle>
	                  <CardDescription>Timeline y tiempos (SLA/OLA) del caso.</CardDescription>
	                </CardHeader>
	                <CardContent className="space-y-3">
	                  <div className="grid gap-2 md:grid-cols-3">
	                    <div className="rounded-xl glass-surface px-3 py-2">
	                      <div className="text-xs text-muted-foreground">Tiempo respuesta</div>
	                      <div className="mt-1 text-sm font-semibold">{responseMs === null ? "n/a" : formatDuration(responseMs)}</div>
	                      <div className="mt-1 text-xs text-muted-foreground">
	                        {ticket.response_deadline ? `SLA resp: ${new Date(ticket.response_deadline).toLocaleString()}` : "SLA resp: n/a"}
	                      </div>
	                    </div>
	                    <div className="rounded-xl glass-surface px-3 py-2">
	                      <div className="text-xs text-muted-foreground">Tiempo resolución</div>
	                      <div className="mt-1 text-sm font-semibold">{resolutionMs === null ? "n/a" : formatDuration(resolutionMs)}</div>
	                      <div className="mt-1 text-xs text-muted-foreground">
	                        {ticket.sla_deadline ? `SLA res: ${new Date(ticket.sla_deadline).toLocaleString()}` : "SLA res: n/a"}
	                      </div>
	                    </div>
	                    <div className="rounded-xl glass-surface px-3 py-2">
	                      <div className="text-xs text-muted-foreground">OLA</div>
	                      <div className="mt-1 text-sm font-semibold">{ticket.ola_deadline ? "Definida" : "n/a"}</div>
	                      <div className="mt-1 text-xs text-muted-foreground">
	                        {ticket.ola_deadline ? new Date(ticket.ola_deadline).toLocaleString() : "—"}
	                      </div>
	                    </div>
	                  </div>

	                  {traceItems.length === 0 ? (
	                    <InlineEmpty title="Sin trazas" description="Aún no hay eventos registrados para este ticket." icon={<Clock className="h-5 w-5" />} className="py-8" />
	                  ) : (
	                    <MotionList className="space-y-2">
	                      {traceItems.slice(-30).map((it) => (
	                        <MotionItem key={it.id} id={it.id}>
	                          <div className="rounded-xl glass-surface px-3 py-2">
	                            <div className="flex items-start justify-between gap-3">
	                              <div className="min-w-0">
	                                <div className="truncate text-sm font-medium">{it.title}</div>
	                                {it.subtitle ? <div className="mt-1 text-xs text-muted-foreground">{it.subtitle}</div> : null}
	                              </div>
	                              <div className="shrink-0 text-right text-xs text-muted-foreground">
	                                <div>{new Date(it.at).toLocaleString()}</div>
	                                {it.actor ? <div className="mt-1">actor: {it.actor.slice(0, 8)}</div> : null}
	                              </div>
	                            </div>
	                          </div>
	                        </MotionItem>
	                      ))}
	                    </MotionList>
	                  )}
	                </CardContent>
	              </Card>

	              <Card className="tech-border">
	                <CardHeader>
	                  <CardTitle>Descripción</CardTitle>
	                  <CardDescription>Detalle del caso.</CardDescription>
	                </CardHeader>
                <CardContent>
                  <div className="whitespace-pre-wrap text-sm text-foreground/90">{ticket.description || "—"}</div>
                </CardContent>
              </Card>

              <Card className="tech-border">
                <CardHeader>
                  <CardTitle>Actividad</CardTitle>
                  <CardDescription>Comentarios y notas internas.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {comments.length === 0 ? (
                      <InlineEmpty title="Sin comentarios" description="Aún no hay actividad en este ticket." icon={<MessageSquare className="h-5 w-5" />} className="py-10" />
                    ) : (
                      <MotionList className="space-y-3">
                        {comments.map((c) => (
                          <MotionItem key={c.id} id={c.id}>
                            <div className={cn("rounded-xl glass-surface p-3", c.is_internal && "bg-amber-500/10")}>
                              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{c.author_id.slice(0, 8)}</span>
                                  {c.is_internal ? <Badge variant="outline">Interna</Badge> : null}
                                </div>
                                <div>{new Date(c.created_at).toLocaleString()}</div>
                              </div>
                              <div className="mt-2 whitespace-pre-wrap text-sm">{c.body}</div>
                            </div>
                          </MotionItem>
                        ))}
                      </MotionList>
                    )}
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
                    <Textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder={ticket.status === "Pendiente Info" ? "Provee la información solicitada…" : "Escribe un comentario…"}
                      className="min-h-28"
                    />
                    <div className="flex flex-col gap-2">
                      {canModerate ? (
                        <label className="flex items-center gap-2 rounded-xl glass-surface px-3 py-2 text-sm text-muted-foreground">
                          <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                          Nota interna
                        </label>
                      ) : null}
                      <Button disabled={saving || body.trim().length < 2} onClick={() => void postComment()}>
                        {saving ? "Enviando…" : "Enviar"}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <Card className="tech-border tech-glow">
                <CardHeader>
                  <CardTitle>Acciones</CardTitle>
                  <CardDescription>Asignación y estado.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {canModerate ? (
                    <>
                      <div className="grid gap-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="justify-between">
                              Cambiar estado
                              <ChevronDown className="h-4 w-4 opacity-70" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            {statusActions.map((a) => (
                              <DropdownMenuItem key={a.value} onSelect={() => void setStatus(a.value)}>
                                <Check className={cn("h-4 w-4", ticket.status === a.value ? "opacity-100" : "opacity-0")} />
                                {a.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>

                        {!ticket.assignee_id ? (
                          <Button onClick={() => void assignToMe()}>
                            <UserPlus className="h-4 w-4" />
                            Asignarme
                          </Button>
                        ) : null}
                      </div>

                      {canReassign ? (
                        <div className="rounded-xl glass-surface p-3">
                          <div className="text-xs text-muted-foreground">Reasignar</div>
                          <div className="mt-2">
                            <Combobox
                              value={assigneeId || null}
                              onValueChange={(next) => {
                                const v = next ?? "";
                                setAssigneeId(v);
                                void reassign(v);
                              }}
                              options={[
                                { value: "", label: "(Sin asignación)" },
                                ...agents.map((a) => ({ value: a.id, label: a.label })),
                              ]}
                              placeholder="Selecciona agente…"
                              searchPlaceholder="Buscar agente…"
                              emptyText="Sin resultados."
                            />
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground">No tienes permisos para modificar.</div>
                  )}
                </CardContent>
              </Card>

              {approvals.length > 0 ? (
                <Card className="tech-border">
                  <CardHeader>
                    <CardTitle>Aprobaciones</CardTitle>
                    <CardDescription>Flujo multi-nivel (manager/owner) y decisiones.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <MotionList className="space-y-2">
                      {approvals.map((a) => (
                        <MotionItem key={a.id} id={a.id}>
                          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl glass-surface px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">Paso {a.step_order}</Badge>
                              <Badge variant="outline">{approvalKindLabel(a.kind)}</Badge>
                              {a.required ? <Badge variant="outline">Requerida</Badge> : <Badge variant="outline">Opcional</Badge>}
                            </div>
                            <Badge variant="outline" className={approvalStatusBadge(a.status)}>
                              {a.status === "pending"
                                ? "Pendiente"
                                : a.status === "approved"
                                  ? "Aprobada"
                                  : a.status === "rejected"
                                    ? "Rechazada"
                                    : "Omitida"}
                            </Badge>
                          </div>
                        </MotionItem>
                      ))}
                    </MotionList>

                    {pendingForMe ? (
                      <div className="rounded-2xl glass-surface p-3">
                        <div className="text-sm font-medium">Tu decisión</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Pendiente en paso {pendingForMe.step_order} ({approvalKindLabel(pendingForMe.kind)}).
                        </div>
                        <div className="mt-3 grid gap-2">
                          <Input value={approvalComment} onChange={(e) => setApprovalComment(e.target.value)} placeholder="Comentario (opcional)" />
                          <div className="flex items-center gap-2">
                            <Button disabled={approvalsActing !== null} onClick={() => void decideApproval("approve")}>
                              Aprobar
                            </Button>
                            <Button disabled={approvalsActing !== null} variant="destructive" onClick={() => void decideApproval("reject")}>
                              Rechazar
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">No tienes aprobaciones pendientes en este ticket.</div>
                    )}
                  </CardContent>
                </Card>
              ) : null}

              <Card className="tech-border">
                <CardHeader>
                  <CardTitle>Detalles</CardTitle>
                  <CardDescription>Datos del ticket.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Creado</span>
                    <span>{new Date(ticket.created_at).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Actualizado</span>
                    <span>{new Date(ticket.updated_at).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Asignado</span>
                    <span>{ticket.assignee_id ? ticket.assignee_id.slice(0, 8) : "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">SLA</span>
                    <span>{ticket.sla_deadline ? new Date(ticket.sla_deadline).toLocaleString() : "n/a"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Respuesta (SLA)</span>
                    <span>{ticket.response_deadline ? new Date(ticket.response_deadline).toLocaleString() : "n/a"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">OLA</span>
                    <span>{ticket.ola_deadline ? new Date(ticket.ola_deadline).toLocaleString() : "n/a"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Respuesta (OLA)</span>
                    <span>{ticket.ola_response_deadline ? new Date(ticket.ola_response_deadline).toLocaleString() : "n/a"}</span>
                  </div>
                </CardContent>
              </Card>

              {(serviceMeta || metaContext || metaFields) && (
                <Card className="tech-border">
                  <CardHeader>
                    <CardTitle>Solicitud</CardTitle>
                    <CardDescription>Service Catalog / metadata.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {serviceMeta ? (
                      <div className="rounded-xl glass-surface p-3">
                        <div className="text-xs text-muted-foreground">Servicio</div>
                        <div className="mt-1 text-sm font-medium">{typeof serviceMeta["service_name"] === "string" ? serviceMeta["service_name"] : "—"}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {metaImpact ? <Badge variant="outline">Impacto: {metaImpact}</Badge> : null}
                          {metaUrgency ? <Badge variant="outline">Urgencia: {metaUrgency}</Badge> : null}
                        </div>
                      </div>
                    ) : null}

                    {metaContext ? (
                      <div className="rounded-xl glass-surface p-3">
                        <div className="text-xs text-muted-foreground">Contexto</div>
                        <div className="mt-2 grid gap-2 text-sm">
                          {Object.entries(metaContext)
                            .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
                            .slice(0, 10)
                            .map(([k, v]) => (
                              <div key={k} className="flex items-center justify-between gap-3">
                                <span className="text-muted-foreground">{k}</span>
                                <span className="truncate">{String(v)}</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    ) : null}

                    {metaFields ? (
                      <div className="rounded-xl glass-surface p-3">
                        <div className="text-xs text-muted-foreground">Campos</div>
                        <div className="mt-2 grid gap-2 text-sm">
                          {Object.entries(metaFields)
                            .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
                            .slice(0, 12)
                            .map(([k, v]) => (
                              <div key={k} className="flex items-center justify-between gap-3">
                                <span className="text-muted-foreground">{k}</span>
                                <span className="truncate">{String(v)}</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
