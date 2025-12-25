"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import type { Profile, Ticket } from "@/lib/types";
import { KanbanStatuses, type KanbanStatus, priorityBadge, slaBadge, type TicketStatus } from "@/lib/constants";
import { isDemoMode } from "@/lib/demo";
import { listTickets as demoListTickets, updateTicket as demoUpdateTicket } from "@/lib/demoStore";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      .select("id,department_id,type,title,description,status,priority,category_id,requester_id,assignee_id,created_at,updated_at,sla_deadline,first_response_at,resolved_at,closed_at")
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
    await supabase.from("tickets").update({ status }).eq("id", ticketId);
  }

  async function assignToMe(ticketId: string) {
    if (isDemoMode()) {
      demoUpdateTicket(ticketId, { assignee_id: profile.id, status: "Asignado" });
      await load();
      return;
    }
    await supabase.from("tickets").update({ assignee_id: profile.id, status: "Asignado" }).eq("id", ticketId);
  }

  const grouped = useMemo(() => groupByStatus(tickets), [tickets]);

  function onDragStart(ev: React.DragEvent, ticketId: string) {
    ev.dataTransfer.setData("text/plain", ticketId);
    ev.dataTransfer.effectAllowed = "move";
  }

  async function onDrop(ev: React.DragEvent, status: KanbanStatus) {
    ev.preventDefault();
    const id = ev.dataTransfer.getData("text/plain");
    if (!id) return;
    await updateStatus(id, status);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
        <div>
          <div className="text-xl font-semibold">Kanban (Agente)</div>
          <div className="mt-1 text-sm text-zinc-400">Arrastra tarjetas entre estados y prioriza por SLA.</div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs text-white ring-1 ring-white/10">
            <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
            Solo asignados a mí
          </label>
          <button
            onClick={() => void load()}
            className="rounded-xl bg-white/5 px-3 py-2 text-xs text-white ring-1 ring-white/10 hover:bg-white/10"
          >
            Actualizar
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl bg-rose-500/15 px-3 py-2 text-xs text-rose-200 ring-1 ring-rose-500/25">{error}</div>}
      {loading ? (
        <div className="text-sm text-zinc-400">Cargando...</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-5">
          {KanbanStatuses.map((status) => (
            <div
              key={status}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => void onDrop(e, status)}
              className="rounded-2xl border border-white/10 bg-black/20 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{status}</div>
                <div className="rounded-full bg-white/5 px-2 py-1 text-xs text-zinc-300 ring-1 ring-white/10">
                  {grouped.get(status)?.length ?? 0}
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {(grouped.get(status) ?? []).map((t) => (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, t.id)}
                    className="rounded-2xl border border-white/10 bg-zinc-900/40 p-3 hover:bg-zinc-900/60"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{t.title}</div>
                        <div className="mt-1 text-xs text-zinc-400">{t.type}</div>
                      </div>
                      <div className={["shrink-0 rounded-full px-2 py-1 text-[11px]", priorityBadge(t.priority)].join(" ")}>
                        {t.priority}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className={["rounded-full px-2 py-1 text-[11px]", slaBadge(now, t.sla_deadline)].join(" ")}>
                        {t.sla_deadline ? `SLA ${new Date(t.sla_deadline).toLocaleString()}` : "SLA n/a"}
                      </div>
                      <div className="flex items-center gap-2">
                        {!t.assignee_id && (
                          <button
                            onClick={() => void assignToMe(t.id)}
                            className="rounded-lg bg-white/5 px-2 py-1 text-[11px] text-white ring-1 ring-white/10 hover:bg-white/10"
                          >
                            Asignarme
                          </button>
                        )}
                        <Link
                          href={`/app/tickets/${t.id}`}
                          className="rounded-lg bg-white/5 px-2 py-1 text-[11px] text-white ring-1 ring-white/10 hover:bg-white/10"
                        >
                          Ver
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
