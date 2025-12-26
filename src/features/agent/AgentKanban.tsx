"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseBrowser";
import type { Profile, Ticket } from "@/lib/types";
import { KanbanStatuses, type KanbanStatus, priorityBadge, slaBadge, type TicketStatus } from "@/lib/constants";
import { isDemoMode } from "@/lib/demo";
import { listTickets as demoListTickets, updateTicket as demoUpdateTicket } from "@/lib/demoStore";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCcw, UserCheck } from "lucide-react";

function groupByStatus(tickets: Ticket[]) {
  const map = new Map<KanbanStatus, Ticket[]>();
  for (const s of KanbanStatuses) map.set(s, []);
  for (const t of tickets) {
    if (KanbanStatuses.includes(t.status as KanbanStatus)) map.get(t.status as KanbanStatus)!.push(t);
  }
  for (const s of KanbanStatuses) map.get(s)!.sort((a, b) => (a.sla_deadline ?? "").localeCompare(b.sla_deadline ?? ""));
  return map;
}

export function AgentKanban({ profile }: { profile: Profile }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [onlyMine, setOnlyMine] = useState(true);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<KanbanStatus | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const now = new Date();

  async function load() {
    setLoading(true);
    setError(null);
    if (isDemoMode()) {
      const statusIn: TicketStatus[] = ["Nuevo", "Asignado", "En Progreso", "Pendiente Info", "Resuelto"];
      const data = demoListTickets({
        department_id: profile.department_id!,
        ...(onlyMine ? { assignee_id: profile.id } : {}),
        statusIn,
      });
      setTickets((data as unknown) as Ticket[]);
      setLoading(false);
      return;
    }
    const q = supabase
      .from("tickets")
      .select("id,department_id,type,title,description,status,priority,category_id,subcategory_id,metadata,requester_id,assignee_id,created_at,updated_at,sla_deadline,first_response_at,resolved_at,closed_at")
      .eq("department_id", profile.department_id!)
      .in("status", ["Nuevo", "Asignado", "En Progreso", "Pendiente Info", "Resuelto"])
      .order("created_at", { ascending: false })
      .limit(200);
    if (onlyMine) q.eq("assignee_id", profile.id);
    const { data, error } = await q;
    if (error) setError(error.message);
    setTickets((data ?? []) as Ticket[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    if (isDemoMode()) return;
    const channel = supabase
      .channel(`rt-agent-${profile.department_id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets", filter: `department_id=eq.${profile.department_id}` }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.department_id, onlyMine]);

  async function updateStatus(ticketId: string, status: KanbanStatus) {
    if (isDemoMode()) {
      demoUpdateTicket(ticketId, { status });
      await load();
      return;
    }
    const prev = tickets;
    setTickets((cur) => cur.map((t) => (t.id === ticketId ? { ...t, status } : t)));
    const { error } = await supabase.from("tickets").update({ status }).eq("id", ticketId);
    if (error) {
      setTickets(prev);
      toast.error("No se pudo actualizar el estado", { description: error.message });
    }
  }

  async function assignToMe(ticketId: string) {
    if (isDemoMode()) {
      demoUpdateTicket(ticketId, { assignee_id: profile.id, status: "Asignado" });
      await load();
      return;
    }
    const prev = tickets;
    setTickets((cur) => cur.map((t) => (t.id === ticketId ? { ...t, assignee_id: profile.id, status: "Asignado" } : t)));
    const { error } = await supabase.from("tickets").update({ assignee_id: profile.id, status: "Asignado" }).eq("id", ticketId);
    if (error) {
      setTickets(prev);
      toast.error("No se pudo asignar el ticket", { description: error.message });
    }
  }

  const filteredTickets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter((t) => {
      return (
        t.title.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q) ||
        t.type.toLowerCase().includes(q) ||
        t.priority.toLowerCase().includes(q) ||
        t.status.toLowerCase().includes(q)
      );
    });
  }, [tickets, query]);

  const grouped = useMemo(() => groupByStatus(filteredTickets), [filteredTickets]);

  function onDragStart(ev: React.DragEvent, ticketId: string) {
    ev.dataTransfer.setData("text/plain", ticketId);
    ev.dataTransfer.effectAllowed = "move";
    setDraggingId(ticketId);
  }

  function onDragEnd() {
    setDraggingId(null);
    setDragOver(null);
  }

  async function onDrop(ev: React.DragEvent, status: KanbanStatus) {
    ev.preventDefault();
    const id = ev.dataTransfer.getData("text/plain");
    if (!id) return;
    await updateStatus(id, status);
    setDragOver(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-2xl font-semibold tracking-tight">Kanban</div>
          <div className="mt-1 text-sm text-muted-foreground">Arrastra tickets entre estados y prioriza por SLA.</div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <Button variant={onlyMine ? "default" : "outline"} onClick={() => setOnlyMine(true)}>
              <UserCheck className="h-4 w-4" />
              Solo míos
            </Button>
            <Button variant={!onlyMine ? "default" : "outline"} onClick={() => setOnlyMine(false)}>
              Equipo
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrar por texto…" className="sm:w-72" />
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCcw className="h-4 w-4" />
              Actualizar
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-3 lg:grid-cols-5">
          {KanbanStatuses.map((status) => (
            <Card key={status} className="tech-border p-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-10 rounded-full" />
              </div>
              <div className="mt-3 space-y-2">
                <Skeleton className="h-20 w-full rounded-xl" />
                <Skeleton className="h-20 w-full rounded-xl" />
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-5">
          {KanbanStatuses.map((status) => {
            const list = grouped.get(status) ?? [];
            const isOver = dragOver === status;
            return (
              <div
                key={status}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(status);
                }}
                onDragLeave={() => setDragOver((cur) => (cur === status ? null : cur))}
                onDrop={(e) => void onDrop(e, status)}
                className={cn(
                  "rounded-xl p-3 transition-colors tech-border",
                  isOver && "tech-glow"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">{status}</div>
                  <Badge variant="outline">{list.length}</Badge>
                </div>

                <div className="mt-3 space-y-2">
                  {list.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                      Suelta aquí
                    </div>
                  ) : (
                    <AnimatePresence initial={false}>
                      {list.map((t) => (
                        <motion.div
                          key={t.id}
                          layout
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                        >
                          <div
                            draggable
                            onDragStart={(e) => onDragStart(e, t.id)}
                            onDragEnd={onDragEnd}
                            className={cn(
                              "rounded-xl border border-border bg-background p-3 shadow-sm",
                              "transition-colors hover:bg-accent/40",
                              draggingId === t.id && "opacity-60"
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <Link href={`/app/tickets/${t.id}`} className="block truncate text-sm font-medium hover:underline">
                                  {t.title}
                                </Link>
                                <div className="mt-1 text-xs text-muted-foreground">{t.type}</div>
                              </div>
                              <div className={cn("shrink-0 rounded-full px-2 py-1 text-[11px]", priorityBadge(t.priority))}>
                                {t.priority}
                              </div>
                            </div>

                            <div className="mt-2 flex items-center justify-between gap-2">
                              <div className={cn("rounded-full px-2 py-1 text-[11px]", slaBadge(now, t.sla_deadline))}>
                                {t.sla_deadline ? `SLA ${new Date(t.sla_deadline).toLocaleString()}` : "SLA n/a"}
                              </div>
                              <div className="flex items-center gap-2">
                                {!t.assignee_id && (
                                  <Button size="sm" variant="outline" onClick={() => void assignToMe(t.id)}>
                                    Asignarme
                                  </Button>
                                )}
                                <Button asChild size="sm" variant="secondary">
                                  <Link href={`/app/tickets/${t.id}`}>Ver</Link>
                                </Button>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
