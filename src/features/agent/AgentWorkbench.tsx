"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseBrowser";
import type { Category, Profile, Subcategory, Ticket } from "@/lib/types";
import { KanbanStatuses, type KanbanStatus, TicketPriorities, type TicketPriority } from "@/lib/constants";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { EmptyState } from "@/components/feedback/EmptyState";
import { MotionItem, MotionList } from "@/components/motion/MotionList";
import { TicketPriorityBadge, TicketStatusBadge, TicketTypeBadge } from "@/components/tickets/TicketBadges";
import {
  ArrowDownUp,
  CheckCircle2,
  Clock,
  Filter,
  Grid2X2,
  Inbox,
  List,
  MessageSquareText,
  PlayCircle,
  RefreshCcw,
  UserCheck,
  Users2,
} from "lucide-react";

type Scope = "mine" | "team";
type ViewMode = "grid" | "list";
type Focus = "all" | "waiting" | "inProgress" | "pendingInfo" | "resolved" | "unassigned";
type Sort = "sla" | "priority" | "recent";
type ActionTab = "approvals" | "tasks" | "participations";

type ApprovalItem = {
  id: string;
  ticket_id: string;
  step_order: number;
  kind: string;
  required: boolean;
  created_at: string;
  tickets?: { id: string; title: string; priority: TicketPriority; status: Ticket["status"] } | Array<{ id: string; title: string; priority: TicketPriority; status: Ticket["status"] }> | null;
};

type TaskItem = {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  status: "Pendiente" | "En curso" | "Completada" | "Cancelada";
  due_at: string | null;
  ticket_id: string | null;
  chat_thread_id: string | null;
  created_at: string;
};

type ParticipationItem = {
  ticket: { id: string; title: string; priority: TicketPriority; status: Ticket["status"]; sla_deadline: string | null; assignee_id: string | null };
  last_at: string;
};

function priorityStripe(priority: TicketPriority) {
  if (priority === "Crítica") return "from-rose-500/70 via-rose-500/25 to-transparent";
  if (priority === "Alta") return "from-amber-500/70 via-amber-500/25 to-transparent";
  if (priority === "Media") return "from-sky-500/70 via-sky-500/25 to-transparent";
  return "from-emerald-500/70 via-emerald-500/25 to-transparent";
}

function formatShortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}

function formatTimeLeft(deadline: string | null) {
  if (!deadline) return { label: "Sin SLA", tone: "muted" as const };
  const ms = new Date(deadline).getTime() - Date.now();
  const abs = Math.abs(ms);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const pretty = days >= 2 ? `${days}d` : hours >= 2 ? `${hours}h` : `${Math.max(1, minutes)}m`;
  if (ms <= 0) return { label: `Vencido · ${pretty}`, tone: "danger" as const };
  if (ms <= 2 * 60 * 60 * 1000) return { label: `Vence en ${pretty}`, tone: "warn" as const };
  return { label: `Vence en ${pretty}`, tone: "ok" as const };
}

function formatDue(deadline: string | null) {
  if (!deadline) return { label: "Sin fecha", tone: "muted" as const };
  const ms = new Date(deadline).getTime() - Date.now();
  const abs = Math.abs(ms);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const pretty = days >= 2 ? `${days}d` : hours >= 2 ? `${hours}h` : `${Math.max(1, minutes)}m`;
  if (ms <= 0) return { label: `Vencida · ${pretty}`, tone: "danger" as const };
  if (ms <= 6 * 60 * 60 * 1000) return { label: `Vence en ${pretty}`, tone: "warn" as const };
  return { label: `Vence en ${pretty}`, tone: "ok" as const };
}

function formatRelativeTime(ts: string) {
  const ms = new Date(ts).getTime() - Date.now();
  const abs = Math.abs(ms);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  if (days >= 1) return rtf.format(Math.round(ms / 86400000), "day");
  if (hours >= 1) return rtf.format(Math.round(ms / 3600000), "hour");
  return rtf.format(Math.round(ms / 60000), "minute");
}

function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") return (e as { message: string }).message;
  return "Error";
}

function approvalKindLabel(kind: string) {
  if (kind === "requester_manager") return "Jefatura";
  if (kind === "service_owner") return "Owner";
  if (kind === "specific_user") return "Usuario específico";
  if (kind === "role") return "Rol";
  return kind;
}

function comparePriority(a: TicketPriority, b: TicketPriority) {
  const idx = (p: TicketPriority) => TicketPriorities.indexOf(p);
  return idx(a) - idx(b);
}

function inferFocusCount(focus: Focus, tickets: Ticket[], meId: string) {
  if (focus === "unassigned") return tickets.filter((t) => !t.assignee_id).length;
  if (focus === "waiting") return tickets.filter((t) => t.assignee_id === meId && (t.status === "Nuevo" || t.status === "Asignado")).length;
  if (focus === "inProgress") return tickets.filter((t) => t.assignee_id === meId && t.status === "En Progreso").length;
  if (focus === "pendingInfo") return tickets.filter((t) => t.assignee_id === meId && t.status === "Pendiente Info").length;
  if (focus === "resolved") return tickets.filter((t) => t.assignee_id === meId && t.status === "Resuelto").length;
  return tickets.length;
}

export function AgentWorkbench({ profile }: { profile: Profile }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scope, setScope] = useState<Scope>("mine");
  const [focus, setFocus] = useState<Focus>("waiting");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sort, setSort] = useState<Sort>("sla");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<KanbanStatus[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority[]>([]);

  const [categoriesById, setCategoriesById] = useState<Record<string, Category>>({});
  const [subcategoriesById, setSubcategoriesById] = useState<Record<string, Subcategory>>({});
  const [profilesById, setProfilesById] = useState<Record<string, { id: string; full_name: string | null; email: string }>>({});

  const [actionTab, setActionTab] = useState<ActionTab>("approvals");
  const [actionLoading, setActionLoading] = useState(false);
  const [approvalItems, setApprovalItems] = useState<ApprovalItem[]>([]);
  const [taskItems, setTaskItems] = useState<TaskItem[]>([]);
  const [participations, setParticipations] = useState<ParticipationItem[]>([]);

  const [pendingApprovals, setPendingApprovals] = useState<number>(0);
  const [assignedChats, setAssignedChats] = useState<number>(0);
  const [queuedChats, setQueuedChats] = useState<number>(0);
  const [openTasks, setOpenTasks] = useState<number>(0);

  const [decisionOpen, setDecisionOpen] = useState(false);
  const [decisionTicketId, setDecisionTicketId] = useState<string | null>(null);
  const [decisionAction, setDecisionAction] = useState<"approve" | "reject">("approve");
  const [decisionComment, setDecisionComment] = useState("");

  const loadLookups = useCallback(
    async (rows: Ticket[]) => {
      const categoryIds = Array.from(new Set(rows.map((t) => t.category_id).filter(Boolean))) as string[];
      const subcategoryIds = Array.from(new Set(rows.map((t) => t.subcategory_id).filter(Boolean))) as string[];
      const profileIds = Array.from(
        new Set(rows.flatMap((t) => [t.requester_id, t.assignee_id].filter(Boolean) as string[]))
      );

      const [catsRes, subsRes, profsRes] = await Promise.all([
        categoryIds.length
          ? supabase.from("categories").select("id,name,description,department_id").in("id", categoryIds)
          : Promise.resolve({ data: [] as unknown, error: null }),
        subcategoryIds.length
          ? supabase.from("subcategories").select("id,category_id,name,description").in("id", subcategoryIds)
          : Promise.resolve({ data: [] as unknown, error: null }),
        profileIds.length
          ? supabase.from("profiles").select("id,full_name,email").in("id", profileIds)
          : Promise.resolve({ data: [] as unknown, error: null }),
      ]);

      if (!catsRes.error) {
        const map: Record<string, Category> = {};
        for (const c of (catsRes.data ?? []) as Category[]) map[c.id] = c;
        setCategoriesById(map);
      }
      if (!subsRes.error) {
        const map: Record<string, Subcategory> = {};
        for (const s of (subsRes.data ?? []) as Subcategory[]) map[s.id] = s;
        setSubcategoriesById(map);
      }
      if (!profsRes.error) {
        const map: Record<string, { id: string; full_name: string | null; email: string }> = {};
        for (const p of (profsRes.data ?? []) as Array<{ id: string; full_name: string | null; email: string }>) map[p.id] = p;
        setProfilesById(map);
      }
    },
    [setCategoriesById, setProfilesById, setSubcategoriesById]
  );

  const loadSideStats = useCallback(async () => {
    const deptId = profile.department_id!;
    const [approvalsRes, chatsMineRes, chatsQueueRes, tasksRes] = await Promise.all([
      supabase
        .from("ticket_approvals")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .or(`approver_profile_id.eq.${profile.id},and(approver_profile_id.is.null,approver_role.eq.${profile.role})`),
      supabase
        .from("chat_threads")
        .select("id", { count: "exact", head: true })
        .eq("department_id", deptId)
        .eq("assigned_agent_id", profile.id)
        .in("status", ["Asignado", "Activo"]),
      supabase
        .from("chat_threads")
        .select("id", { count: "exact", head: true })
        .eq("department_id", deptId)
        .eq("status", "En cola"),
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("assignee_id", profile.id)
        .in("status", ["Pendiente", "En curso"]),
    ]);

    setPendingApprovals(approvalsRes.count ?? 0);
    setAssignedChats(chatsMineRes.count ?? 0);
    setQueuedChats(chatsQueueRes.count ?? 0);
    setOpenTasks(tasksRes.count ?? 0);
  }, [profile.department_id, profile.id, profile.role]);

  const loadActionTab = useCallback(
    async (tab: ActionTab) => {
      setActionLoading(true);
      try {
        if (tab === "approvals") {
          const { data, error } = await supabase
            .from("ticket_approvals")
            .select("id,ticket_id,step_order,kind,required,created_at,tickets(id,title,priority,status)")
            .eq("status", "pending")
            .or(`approver_profile_id.eq.${profile.id},and(approver_profile_id.is.null,approver_role.eq.${profile.role})`)
            .order("created_at", { ascending: true })
            .limit(20);
          if (error) throw error;
          setApprovalItems((data ?? []) as unknown as ApprovalItem[]);
        }

        if (tab === "tasks") {
          const { data, error } = await supabase
            .from("tasks")
            .select("id,kind,title,description,status,due_at,ticket_id,chat_thread_id,created_at")
            .eq("assignee_id", profile.id)
            .in("status", ["Pendiente", "En curso"])
            .order("due_at", { ascending: true, nullsFirst: false })
            .order("created_at", { ascending: false })
            .limit(30);
          if (error) throw error;
          setTaskItems((data ?? []) as unknown as TaskItem[]);
        }

        if (tab === "participations") {
          const { data, error } = await supabase
            .from("comments")
            .select("ticket_id,created_at,tickets(id,title,priority,status,assignee_id,sla_deadline)")
            .eq("author_id", profile.id)
            .order("created_at", { ascending: false })
            .limit(40);
          if (error) throw error;
          const seen = new Set<string>();
          const list: ParticipationItem[] = [];
          for (const row of (data ?? []) as unknown as Array<{
            ticket_id: string;
            created_at: string;
            tickets:
              | { id: string; title: string; priority: TicketPriority; status: Ticket["status"]; sla_deadline: string | null; assignee_id: string | null }
              | Array<{ id: string; title: string; priority: TicketPriority; status: Ticket["status"]; sla_deadline: string | null; assignee_id: string | null }>
              | null;
          }>) {
            const rel = row.tickets;
            const t = Array.isArray(rel) ? rel[0] : rel;
            if (!t?.id) continue;
            if (seen.has(t.id)) continue;
            seen.add(t.id);
            if (t.status === "Cerrado" || t.status === "Rechazado") continue;
            list.push({ ticket: t, last_at: row.created_at });
            if (list.length >= 12) break;
          }
          setParticipations(list);
        }
      } catch (e: unknown) {
        toast.error("No se pudo cargar acciones", { description: errorMessage(e) });
      } finally {
        setActionLoading(false);
      }
    },
    [profile.id, profile.role]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const q = supabase
      .from("tickets")
      .select(
        "id,department_id,type,title,description,status,priority,category_id,subcategory_id,metadata,requester_id,assignee_id,created_at,updated_at,response_deadline,sla_deadline,ola_response_deadline,ola_deadline,first_response_at,resolved_at,closed_at"
      )
      .eq("department_id", profile.department_id!)
      .in("status", ["Nuevo", "Asignado", "En Progreso", "Pendiente Info", "Resuelto"])
      .order("created_at", { ascending: false })
      .limit(250);
    if (scope === "mine") q.eq("assignee_id", profile.id);
    const { data, error } = await q;
    if (error) setError(error.message);
    const rows = (data ?? []) as Ticket[];
    setTickets(rows);
    await Promise.all([loadLookups(rows), loadSideStats()]);
    setLoading(false);
  }, [loadLookups, loadSideStats, profile.department_id, profile.id, scope]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`rt-agent-work-${profile.department_id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets", filter: `department_id=eq.${profile.department_id}` }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.department_id, scope]);

  async function updateTicket(ticketId: string, patch: Partial<Pick<Ticket, "status" | "assignee_id">>) {
    const prev = tickets;
    setTickets((cur) => cur.map((t) => (t.id === ticketId ? { ...t, ...patch } : t)));
    const { error } = await supabase.from("tickets").update(patch).eq("id", ticketId);
    if (error) {
      setTickets(prev);
      toast.error("No se pudo actualizar el ticket", { description: error.message });
      return;
    }
    void loadSideStats();
  }

  function openDecision(ticketId: string, action: "approve" | "reject") {
    setDecisionTicketId(ticketId);
    setDecisionAction(action);
    setDecisionComment("");
    setDecisionOpen(true);
  }

  async function submitDecision() {
    if (!decisionTicketId) return;
    const ticketId = decisionTicketId;
    const action = decisionAction;
    const comment = decisionComment.trim() || null;
    setDecisionOpen(false);
    setDecisionTicketId(null);
    try {
      const { error } = await supabase.rpc("approval_decide", { p_ticket_id: ticketId, p_action: action, p_comment: comment });
      if (error) throw error;
      toast.success(action === "approve" ? "Aprobación registrada" : "Rechazo registrado");
      await Promise.all([loadSideStats(), loadActionTab("approvals")]);
    } catch (e: unknown) {
      toast.error("No se pudo registrar la decisión", { description: errorMessage(e) });
    }
  }

  async function updateTaskStatus(taskId: string, status: "Pendiente" | "En curso" | "Completada") {
    try {
      const { error } = await supabase.from("tasks").update({ status }).eq("id", taskId);
      if (error) throw error;
      toast.success(status === "Completada" ? "Tarea completada" : "Tarea actualizada");
      await Promise.all([loadSideStats(), loadActionTab("tasks")]);
    } catch (e: unknown) {
      toast.error("No se pudo actualizar la tarea", { description: errorMessage(e) });
    }
  }

  function resetFilters() {
    setQuery("");
    setStatusFilter([]);
    setPriorityFilter([]);
    setFocus(scope === "mine" ? "waiting" : "all");
  }

  useEffect(() => {
    const raw = localStorage.getItem("itsm.agent.viewMode");
    if (raw === "list" || raw === "grid") setViewMode(raw);
  }, []);

  useEffect(() => {
    localStorage.setItem("itsm.agent.viewMode", viewMode);
  }, [viewMode]);

  useEffect(() => {
    setFocus(scope === "mine" ? "waiting" : "all");
  }, [scope]);

  useEffect(() => {
    if (focus === "unassigned") setSort("sla");
  }, [focus]);

  useEffect(() => {
    void loadActionTab(actionTab);
  }, [actionTab, loadActionTab]);

  const tiles = useMemo(() => {
    const mine = profile.id;
    const items: Array<{
      id: Focus;
      label: string;
      description: string;
      icon: React.ComponentType<{ className?: string }>;
      show: boolean;
    }> = [
      { id: "waiting", label: "Por atender", description: "Nuevo / asignado a ti", icon: Inbox, show: scope === "mine" },
      { id: "inProgress", label: "En curso", description: "Trabajo activo", icon: PlayCircle, show: true },
      { id: "pendingInfo", label: "Pendiente", description: "Esperando respuesta", icon: Clock, show: true },
      { id: "resolved", label: "Resueltos", description: "Listos para cerrar", icon: CheckCircle2, show: true },
      { id: "unassigned", label: "Sin asignar", description: "Cola del equipo", icon: Users2, show: scope === "team" },
      { id: "all", label: "Todo", description: "Vista general", icon: ArrowDownUp, show: scope === "team" },
    ];
    return items
      .filter((t) => t.show)
      .map((t) => ({
        ...t,
        count: inferFocusCount(t.id, tickets, mine),
      }));
  }, [profile.id, scope, tickets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byFocus = tickets.filter((t) => {
      if (focus === "unassigned") return !t.assignee_id;
      if (focus === "waiting") return t.assignee_id === profile.id && (t.status === "Nuevo" || t.status === "Asignado");
      if (focus === "inProgress") return (scope === "mine" ? t.assignee_id === profile.id : true) && t.status === "En Progreso";
      if (focus === "pendingInfo") return (scope === "mine" ? t.assignee_id === profile.id : true) && t.status === "Pendiente Info";
      if (focus === "resolved") return (scope === "mine" ? t.assignee_id === profile.id : true) && t.status === "Resuelto";
      return true;
    });

    const byStatus = statusFilter.length ? byFocus.filter((t) => statusFilter.includes(t.status as KanbanStatus)) : byFocus;
    const byPriority = priorityFilter.length ? byStatus.filter((t) => priorityFilter.includes(t.priority)) : byStatus;
    if (!q) return byPriority;

    return byPriority.filter((t) => {
      const cat = t.category_id ? categoriesById[t.category_id]?.name ?? "" : "";
      const sub = t.subcategory_id ? subcategoriesById[t.subcategory_id]?.name ?? "" : "";
      const requester = profilesById[t.requester_id]?.full_name || profilesById[t.requester_id]?.email || "";
      return (
        t.title.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q) ||
        cat.toLowerCase().includes(q) ||
        sub.toLowerCase().includes(q) ||
        requester.toLowerCase().includes(q) ||
        t.priority.toLowerCase().includes(q) ||
        t.status.toLowerCase().includes(q) ||
        t.type.toLowerCase().includes(q)
      );
    });
  }, [categoriesById, focus, priorityFilter, profilesById, query, scope, statusFilter, subcategoriesById, tickets, profile.id]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (sort === "recent") return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (sort === "priority") return list.sort((a, b) => comparePriority(a.priority, b.priority) || (a.sla_deadline ?? "").localeCompare(b.sla_deadline ?? ""));
    return list.sort((a, b) => (a.sla_deadline ?? "9999").localeCompare(b.sla_deadline ?? "9999"));
  }, [filtered, sort]);

  const slaHotlist = useMemo(() => {
    return [...tickets]
      .filter((t) => t.sla_deadline)
      .sort((a, b) => (a.sla_deadline ?? "9999").localeCompare(b.sla_deadline ?? "9999"))
      .slice(0, 6);
  }, [tickets]);

  const headerMeta = useMemo(() => {
    const parts = [];
    if (scope === "mine") parts.push(<Badge key="scope" variant="outline"><UserCheck className="mr-1 h-3.5 w-3.5" />Mis casos</Badge>);
    if (scope === "team") parts.push(<Badge key="scope" variant="outline"><Users2 className="mr-1 h-3.5 w-3.5" />Equipo</Badge>);
    if (pendingApprovals > 0) parts.push(<Badge key="appr" variant="outline" className="border-[hsl(var(--brand-cyan))]/30 bg-[hsl(var(--brand-cyan))]/10">Aprobaciones: {pendingApprovals}</Badge>);
    if (assignedChats > 0) parts.push(<Badge key="chats" variant="outline" className="border-[hsl(var(--brand-violet))]/30 bg-[hsl(var(--brand-violet))]/10">Chats: {assignedChats}</Badge>);
    if (openTasks > 0) parts.push(<Badge key="tasks" variant="outline" className="border-[hsl(var(--brand-blue))]/30 bg-[hsl(var(--brand-blue))]/10">Tareas: {openTasks}</Badge>);
    return parts.length ? <>{parts}</> : null;
  }, [assignedChats, openTasks, pendingApprovals, scope]);

  return (
    <div className="space-y-5">
      <Dialog
        open={decisionOpen}
        onOpenChange={(open) => {
          setDecisionOpen(open);
          if (!open) {
            setDecisionTicketId(null);
            setDecisionComment("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <div className="space-y-1.5">
            <div className="text-base font-semibold">{decisionAction === "approve" ? "Aprobar solicitud" : "Rechazar solicitud"}</div>
            <div className="text-sm text-muted-foreground">Agrega un comentario opcional para dejar trazabilidad.</div>
          </div>
          <div className="space-y-3">
            <Textarea
              value={decisionComment}
              onChange={(e) => setDecisionComment(e.target.value)}
              placeholder="Comentario (opcional)…"
              className="min-h-28"
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setDecisionOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={() => void submitDecision()}>
                Confirmar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <PageHeader
        title="Mi trabajo"
        description="Prioriza por SLA, toma tickets de la cola y mantén foco en lo crítico."
        meta={headerMeta}
        actions={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <Button variant={scope === "mine" ? "default" : "outline"} onClick={() => setScope("mine")}>
                <UserCheck className="h-4 w-4" />
                Mis casos
              </Button>
              <Button variant={scope === "team" ? "default" : "outline"} onClick={() => setScope("team")}>
                <Users2 className="h-4 w-4" />
                Equipo
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por título, usuario, categoría…"
                className="sm:w-80"
              />
              <Button variant="outline" onClick={() => void load()}>
                <RefreshCcw className="h-4 w-4" />
                Actualizar
              </Button>
            </div>
          </div>
        }
      />

      {error ? <InlineAlert variant="error" description={error} /> : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div className={cn("grid gap-3", tiles.length >= 6 ? "md:grid-cols-6" : "md:grid-cols-5")}>
            {tiles.map((t) => {
              const Icon = t.icon;
              const active = focus === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setFocus(t.id)}
                  className={cn(
                    "group text-left rounded-2xl tech-border p-[1px] transition",
                    active ? "tech-glow" : "hover:tech-glow"
                  )}
                >
                  <div className="glass-surface rounded-2xl p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium tracking-wide text-muted-foreground">{t.label.toUpperCase()}</div>
                        <div className="mt-1 text-2xl font-semibold">{t.count}</div>
                        <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{t.description}</div>
                      </div>
                      <div
                        className={cn(
                          "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
                          "bg-gradient-to-br from-[hsl(var(--brand-cyan))]/30 via-[hsl(var(--brand-blue))]/20 to-[hsl(var(--brand-violet))]/20",
                          "ring-1 ring-[hsl(var(--brand-cyan))]/15"
                        )}
                      >
                        <Icon className="h-5 w-5 text-foreground" />
                      </div>
                    </div>
                    {active ? (
                      <div className="mt-3 h-[2px] w-full rounded-full bg-gradient-to-r from-[hsl(var(--brand-cyan))] via-[hsl(var(--brand-blue))] to-[hsl(var(--brand-violet))]" />
                    ) : (
                      <div className="mt-3 h-[2px] w-full rounded-full bg-gradient-to-r from-transparent via-border to-transparent opacity-70 group-hover:opacity-100" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <Card className="tech-border">
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="min-w-0">
                <CardTitle className="truncate">Bandeja operativa</CardTitle>
                <CardDescription>Filtros rápidos, acciones y lectura clara del SLA.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                      <Filter className="h-4 w-4" />
                      Filtros
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72">
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Estados</div>
                    {KanbanStatuses.map((s) => {
                      const on = statusFilter.includes(s);
                      return (
                        <DropdownMenuItem
                          key={s}
                          onClick={() => setStatusFilter((cur) => (on ? cur.filter((x) => x !== s) : [...cur, s]))}
                        >
                          <span className={cn("mr-2 inline-block h-2 w-2 rounded-full", on ? "bg-[hsl(var(--brand-cyan))]" : "bg-border")} />
                          {s}
                        </DropdownMenuItem>
                      );
                    })}
                    <DropdownMenuSeparator />
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Prioridad</div>
                    {TicketPriorities.map((p) => {
                      const on = priorityFilter.includes(p);
                      return (
                        <DropdownMenuItem
                          key={p}
                          onClick={() => setPriorityFilter((cur) => (on ? cur.filter((x) => x !== p) : [...cur, p]))}
                        >
                          <span className={cn("mr-2 inline-block h-2 w-2 rounded-full", on ? "bg-[hsl(var(--brand-violet))]" : "bg-border")} />
                          {p}
                        </DropdownMenuItem>
                      );
                    })}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={resetFilters}>Limpiar filtros</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                      <ArrowDownUp className="h-4 w-4" />
                      Orden
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setSort("sla")}>SLA primero</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSort("priority")}>Prioridad</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSort("recent")}>Recientes</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <div className="flex items-center rounded-xl border border-border bg-background/40 p-1">
                  <Button variant={viewMode === "grid" ? "secondary" : "ghost"} size="icon" onClick={() => setViewMode("grid")} aria-label="Vista tarjetas">
                    <Grid2X2 className="h-4 w-4" />
                  </Button>
                  <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="icon" onClick={() => setViewMode("list")} aria-label="Vista lista">
                    <List className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className={cn(viewMode === "grid" ? "grid gap-3 md:grid-cols-2 xl:grid-cols-3" : "space-y-2")}>
                  {Array.from({ length: 9 }).map((_, i) => (
                    <Skeleton key={i} className={cn(viewMode === "grid" ? "h-[154px] w-full rounded-2xl" : "h-16 w-full")} />
                  ))}
                </div>
              ) : sorted.length === 0 ? (
                <EmptyState
                  title="Sin resultados"
                  description="Ajusta filtros o cambia a la vista de equipo para tomar casos de la cola."
                  icon={<Inbox className="h-5 w-5" />}
                  action={
                    <Button variant="outline" onClick={resetFilters}>
                      Limpiar filtros
                    </Button>
                  }
                />
              ) : viewMode === "grid" ? (
                <MotionList className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {sorted.map((t) => (
                    <MotionItem key={t.id} id={t.id}>
                      <TicketCard
                        ticket={t}
                        categoriesById={categoriesById}
                        subcategoriesById={subcategoriesById}
                        requesterLabel={profilesById[t.requester_id]?.full_name || profilesById[t.requester_id]?.email || "Usuario"}
                        canTake={scope === "team" && !t.assignee_id}
                        onTake={() => void updateTicket(t.id, { assignee_id: profile.id, status: "Asignado" })}
                        onSetStatus={(s) => void updateTicket(t.id, { status: s })}
                      />
                    </MotionItem>
                  ))}
                </MotionList>
              ) : (
                <MotionList className="divide-y divide-border">
                  {sorted.map((t) => (
                    <MotionItem key={t.id} id={t.id}>
                      <TicketRow
                        ticket={t}
                        categoriesById={categoriesById}
                        subcategoriesById={subcategoriesById}
                        requesterLabel={profilesById[t.requester_id]?.full_name || profilesById[t.requester_id]?.email || "Usuario"}
                        canTake={scope === "team" && !t.assignee_id}
                        onTake={() => void updateTicket(t.id, { assignee_id: profile.id, status: "Asignado" })}
                        onSetStatus={(s) => void updateTicket(t.id, { status: s })}
                      />
                    </MotionItem>
                  ))}
                </MotionList>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="tech-border">
            <CardHeader>
              <CardTitle>SLAs al límite</CardTitle>
              <CardDescription>Ordenados por vencimiento.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {loading ? (
                <>
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </>
              ) : slaHotlist.length === 0 ? (
                <div className="text-sm text-muted-foreground">No hay SLAs activos en la bandeja actual.</div>
              ) : (
                slaHotlist.map((t) => {
                  const tl = formatTimeLeft(t.sla_deadline);
                  const tone =
                    tl.tone === "danger"
                      ? "border-rose-500/30 bg-rose-500/10"
                      : tl.tone === "warn"
                        ? "border-amber-500/30 bg-amber-500/10"
                        : "border-border bg-background/30";
                  return (
                    <Link
                      key={t.id}
                      href={`/app/tickets/${t.id}`}
                      className={cn("block rounded-xl border p-3 transition-colors hover:bg-accent/40", tone)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{t.title}</div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <TicketPriorityBadge priority={t.priority} />
                            <TicketStatusBadge status={t.status} />
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">{tl.label}</div>
                      </div>
                    </Link>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card className="tech-border">
            <CardHeader className="pb-3">
              <CardTitle>Acciones pendientes</CardTitle>
              <CardDescription>Aprobaciones, tareas y colaboraciones con trazabilidad.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between rounded-xl border border-border bg-background/30 p-3">
                  <div className="flex items-center gap-2">
                    <MessageSquareText className="h-4 w-4 text-[hsl(var(--brand-violet))]" />
                    <div className="text-sm font-medium">Chats</div>
                  </div>
                  <Badge variant="outline">{assignedChats}</Badge>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border bg-background/30 p-3">
                  <div className="flex items-center gap-2">
                    <Users2 className="h-4 w-4 text-[hsl(var(--brand-cyan))]" />
                    <div className="text-sm font-medium">Cola</div>
                  </div>
                  <Badge variant="outline">{queuedChats}</Badge>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border bg-background/30 p-3">
                  <div className="flex items-center gap-2">
                    <Users2 className="h-4 w-4 text-[hsl(var(--brand-blue))]" />
                    <div className="text-sm font-medium">Aprobaciones</div>
                  </div>
                  <Badge variant="outline">{pendingApprovals}</Badge>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border bg-background/30 p-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[hsl(var(--brand-blue))]" />
                    <div className="text-sm font-medium">Tareas</div>
                  </div>
                  <Badge variant="outline">{openTasks}</Badge>
                </div>
              </div>

              <div className="grid grid-cols-3 rounded-xl border border-border bg-background/35 p-1">
                <Button variant={actionTab === "approvals" ? "secondary" : "ghost"} size="sm" onClick={() => setActionTab("approvals")}>
                  Aprobaciones
                </Button>
                <Button variant={actionTab === "tasks" ? "secondary" : "ghost"} size="sm" onClick={() => setActionTab("tasks")}>
                  Tareas
                </Button>
                <Button variant={actionTab === "participations" ? "secondary" : "ghost"} size="sm" onClick={() => setActionTab("participations")}>
                  Participaciones
                </Button>
              </div>

              {actionLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : actionTab === "approvals" ? (
                approvalItems.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No tienes aprobaciones pendientes.</div>
                ) : (
                  <div className="space-y-2">
                    {approvalItems.map((a) => {
                      const rel = a.tickets;
                      const t = (Array.isArray(rel) ? rel[0] : rel) ?? null;
                      if (!t) return null;
                      return (
                        <div key={a.id} className="rounded-xl border border-border bg-background/30 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{t.title}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span className="font-mono">{formatShortId(t.id)}</span>
                                <span>·</span>
                                <span>Paso {a.step_order}</span>
                                <span>·</span>
                                <span>{approvalKindLabel(a.kind)}</span>
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <TicketPriorityBadge priority={t.priority} />
                                <TicketStatusBadge status={t.status} />
                              </div>
                            </div>
                            <div className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(a.created_at)}</div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button asChild variant="secondary" size="sm" className="flex-1">
                              <Link href={`/app/tickets/${t.id}`}>Abrir</Link>
                            </Button>
                            <Button size="sm" className="flex-1" onClick={() => openDecision(t.id, "approve")}>
                              Aprobar
                            </Button>
                            <Button size="sm" variant="outline" className="flex-1" onClick={() => openDecision(t.id, "reject")}>
                              Rechazar
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : actionTab === "tasks" ? (
                taskItems.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No tienes tareas pendientes.</div>
                ) : (
                  <div className="space-y-2">
                    {taskItems.map((t) => {
                      const due = formatDue(t.due_at);
                      const dueTone =
                        due.tone === "danger"
                          ? "border-rose-500/30 bg-rose-500/10"
                          : due.tone === "warn"
                            ? "border-amber-500/30 bg-amber-500/10"
                            : due.tone === "ok"
                              ? "border-emerald-500/25 bg-emerald-500/10"
                              : "border-border bg-background/30";
                      return (
                        <div key={t.id} className="rounded-xl border border-border bg-background/30 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{t.title}</div>
                              {t.description ? <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.description}</div> : null}
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <Badge variant="outline">{t.status}</Badge>
                                <span className={cn("rounded-md border px-2 py-1 text-[11px]", dueTone)}>{due.label}</span>
                              </div>
                            </div>
                            <div className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(t.created_at)}</div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {t.ticket_id ? (
                              <Button asChild size="sm" variant="secondary" className="flex-1">
                                <Link href={`/app/tickets/${t.ticket_id}`}>Abrir ticket</Link>
                              </Button>
                            ) : (
                              <Button asChild size="sm" variant="secondary" className="flex-1">
                                <Link href="/app/chats">Abrir chat</Link>
                              </Button>
                            )}

                            {t.status === "Pendiente" ? (
                              <Button size="sm" variant="outline" className="flex-1" onClick={() => void updateTaskStatus(t.id, "En curso")}>
                                En curso
                              </Button>
                            ) : null}

                            <Button size="sm" className="flex-1" onClick={() => void updateTaskStatus(t.id, "Completada")}>
                              Completar
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : participations.length === 0 ? (
                <div className="text-sm text-muted-foreground">Aún no tienes participaciones recientes.</div>
              ) : (
                <div className="space-y-2">
                  {participations.map((p) => {
                    const tl = formatTimeLeft(p.ticket.sla_deadline);
                    const tone =
                      tl.tone === "danger"
                        ? "border-rose-500/30 bg-rose-500/10"
                        : tl.tone === "warn"
                          ? "border-amber-500/30 bg-amber-500/10"
                          : "border-border bg-background/30";
                    return (
                      <Link
                        key={p.ticket.id}
                        href={`/app/tickets/${p.ticket.id}`}
                        className="block rounded-xl border border-border bg-background/30 p-3 transition-colors hover:bg-accent/35"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{p.ticket.title}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span className="font-mono">{formatShortId(p.ticket.id)}</span>
                              <span>·</span>
                              <span>Última actividad {formatRelativeTime(p.last_at)}</span>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <TicketPriorityBadge priority={p.ticket.priority} />
                              <TicketStatusBadge status={p.ticket.status} />
                              <span className={cn("rounded-md border px-2 py-1 text-[11px]", tone)}>{tl.label}</span>
                            </div>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button asChild variant="secondary" className="w-full">
                  <Link href="/app/chats">Abrir inbox de chats</Link>
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link href="/app/approvals">Ver aprobaciones</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function TicketCard({
  ticket,
  requesterLabel,
  categoriesById,
  subcategoriesById,
  canTake,
  onTake,
  onSetStatus,
}: {
  ticket: Ticket;
  requesterLabel: string;
  categoriesById: Record<string, Category>;
  subcategoriesById: Record<string, Subcategory>;
  canTake: boolean;
  onTake: () => void;
  onSetStatus: (status: KanbanStatus) => void;
}) {
  const tl = formatTimeLeft(ticket.sla_deadline);
  const category = ticket.category_id ? categoriesById[ticket.category_id]?.name : null;
  const sub = ticket.subcategory_id ? subcategoriesById[ticket.subcategory_id]?.name : null;
  const meta = [category, sub].filter(Boolean).join(" · ");
  const warnTone =
    tl.tone === "danger"
      ? "border-rose-500/30 bg-rose-500/10"
      : tl.tone === "warn"
        ? "border-amber-500/30 bg-amber-500/10"
        : "border-border bg-background/30";

  return (
    <Card className="group relative overflow-hidden tech-border">
      <div className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", priorityStripe(ticket.priority))} />
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{ticket.title}</div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono tracking-wide">{formatShortId(ticket.id)}</span>
              <span className="text-muted-foreground/70">·</span>
              <span className="truncate">{requesterLabel}</span>
            </div>
          </div>
          <div className={cn("shrink-0 rounded-lg border px-2 py-1 text-[11px]", warnTone)}>{tl.label}</div>
        </div>
        {meta ? <div className="mt-2 line-clamp-1 text-xs text-muted-foreground">{meta}</div> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <TicketTypeBadge type={ticket.type} />
          <TicketPriorityBadge priority={ticket.priority} />
          <TicketStatusBadge status={ticket.status} />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="secondary" className="flex-1">
            <Link href={`/app/tickets/${ticket.id}`}>Abrir</Link>
          </Button>
          {canTake ? (
            <Button onClick={onTake} className="flex-1">
              Tomar
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="flex-1">
                  <ArrowDownUp className="h-4 w-4" />
                  Estado
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {KanbanStatuses.map((s) => (
                  <DropdownMenuItem key={s} onClick={() => onSetStatus(s)}>
                    {s}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TicketRow({
  ticket,
  requesterLabel,
  categoriesById,
  subcategoriesById,
  canTake,
  onTake,
  onSetStatus,
}: {
  ticket: Ticket;
  requesterLabel: string;
  categoriesById: Record<string, Category>;
  subcategoriesById: Record<string, Subcategory>;
  canTake: boolean;
  onTake: () => void;
  onSetStatus: (status: KanbanStatus) => void;
}) {
  const tl = formatTimeLeft(ticket.sla_deadline);
  const category = ticket.category_id ? categoriesById[ticket.category_id]?.name : null;
  const sub = ticket.subcategory_id ? subcategoriesById[ticket.subcategory_id]?.name : null;
  const meta = [category, sub].filter(Boolean).join(" · ");
  const tone =
    tl.tone === "danger"
      ? "border-rose-500/30 bg-rose-500/10"
      : tl.tone === "warn"
        ? "border-amber-500/30 bg-amber-500/10"
        : "border-border bg-background/30";

  return (
    <div className="group flex flex-col gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-accent/35 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 truncate text-sm font-medium">{ticket.title}</div>
          <span className={cn("rounded-md border px-2 py-1 text-[11px]", tone)}>{tl.label}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">{formatShortId(ticket.id)}</span>
          <span className="text-xs text-muted-foreground">{requesterLabel}</span>
          {meta ? <span className="text-xs text-muted-foreground">{meta}</span> : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <TicketTypeBadge type={ticket.type} />
          <TicketPriorityBadge priority={ticket.priority} />
          <TicketStatusBadge status={ticket.status} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 md:shrink-0">
        <Button asChild variant="secondary">
          <Link href={`/app/tickets/${ticket.id}`}>Abrir</Link>
        </Button>
        {canTake ? (
          <Button onClick={onTake}>Tomar</Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <ArrowDownUp className="h-4 w-4" />
                Estado
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {KanbanStatuses.map((s) => (
                <DropdownMenuItem key={s} onClick={() => onSetStatus(s)}>
                  {s}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
