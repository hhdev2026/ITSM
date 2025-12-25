"use client";

import { AppShell } from "@/components/AppShell";
import { useProfile, useSession } from "@/lib/hooks";
import { supabase } from "@/lib/supabaseBrowser";
import type { Comment, Ticket } from "@/lib/types";
import { TicketStatuses } from "@/lib/constants";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { errorMessage } from "@/lib/error";
import { isDemoMode } from "@/lib/demo";
import { listDemoAgents } from "@/lib/demoAuth";
import { addComment as demoAddComment, getTicket as demoGetTicket, listComments as demoListComments, updateTicket as demoUpdateTicket } from "@/lib/demoStore";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [saving, setSaving] = useState(false);

  const canModerate = profile?.role === "agent" || profile?.role === "supervisor" || profile?.role === "admin";
  const canReassign = profile?.role === "supervisor" || profile?.role === "admin";

  useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  const load = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    setError(null);
    if (isDemoMode()) {
      const t = demoGetTicket(ticketId);
      setTicket(t);
      setAssigneeId(t?.assignee_id ?? "");
      setComments((demoListComments(ticketId) as unknown) as Comment[]);
      if (canReassign && profile?.department_id) {
        setAgents(listDemoAgents(profile.department_id).map((p) => ({ id: p.id, label: p.full_name || p.email })));
      }
      setLoading(false);
      return;
    }
    const { data: t, error: tErr } = await supabase
      .from("tickets")
      .select("id,department_id,type,title,description,status,priority,category_id,requester_id,assignee_id,created_at,updated_at,sla_deadline,first_response_at,resolved_at,closed_at")
      .eq("id", ticketId)
      .single();
    if (tErr) setError(tErr.message);
    const parsed = ((t ?? null) as unknown) as Ticket | null;
    setTicket(parsed);
    setAssigneeId(parsed?.assignee_id ?? "");

    const { data: c, error: cErr } = await supabase
      .from("comments")
      .select("id,ticket_id,author_id,body,is_internal,created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    if (cErr) setError(cErr.message);
    setComments((c ?? []) as Comment[]);

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
    if (isDemoMode()) return;
    const channel = supabase
      .channel(`rt-ticket-${ticketId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets", filter: `id=eq.${ticketId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "comments", filter: `ticket_id=eq.${ticketId}` }, () => void load())
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
      if (isDemoMode()) {
        demoAddComment({ ticket_id: ticketId, author_id: profile.id, body: body.trim(), is_internal: canModerate ? internal : false });
        setBody("");
        setInternal(false);
        await load();
        return;
      }
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
    } catch (e: unknown) {
      setError(errorMessage(e) ?? "No se pudo guardar el comentario");
    } finally {
      setSaving(false);
    }
  }

  async function assignToMe() {
    if (!profile || !ticketId) return;
    if (isDemoMode()) {
      demoUpdateTicket(ticketId, { assignee_id: profile.id, status: "Asignado" });
      await load();
      return;
    }
    await supabase.from("tickets").update({ assignee_id: profile.id, status: "Asignado" }).eq("id", ticketId);
  }

  async function reassign(id: string) {
    if (!ticketId) return;
    if (isDemoMode()) {
      demoUpdateTicket(ticketId, { assignee_id: id || null, status: id ? "Asignado" : "Nuevo" });
      await load();
      return;
    }
    await supabase.from("tickets").update({ assignee_id: id || null, status: id ? "Asignado" : "Nuevo" }).eq("id", ticketId);
  }

  async function setStatus(status: string) {
    if (!ticketId) return;
    if (isDemoMode()) {
      if (TicketStatuses.includes(status as (typeof TicketStatuses)[number])) {
        demoUpdateTicket(ticketId, { status: status as (typeof TicketStatuses)[number] });
      }
      await load();
      return;
    }
    await supabase.from("tickets").update({ status }).eq("id", ticketId);
  }

  if (sessionLoading || profileLoading) return <div className="p-6 text-sm text-zinc-300">Cargando...</div>;
  if (!session || !profile) return null;

  return (
    <AppShell profile={profile}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-zinc-500">
              <Link href="/app" className="hover:text-zinc-300">
                ← Volver
              </Link>
            </div>
            <div className="truncate text-xl font-semibold">{ticket?.title ?? "Ticket"}</div>
            <div className="mt-1 text-sm text-zinc-400">
              {ticket ? `${ticket.type} · ${ticket.priority} · ${ticket.status}` : ""}
            </div>
          </div>
          <button onClick={() => void load()} className="rounded-xl bg-white/5 px-3 py-2 text-xs text-white ring-1 ring-white/10 hover:bg-white/10">
            Actualizar
          </button>
        </div>

        {error && <div className="rounded-xl bg-rose-500/15 px-3 py-2 text-xs text-rose-200 ring-1 ring-rose-500/25">{error}</div>}

        {loading ? (
          <div className="text-sm text-zinc-400">Cargando...</div>
        ) : !ticket ? (
          <div className="text-sm text-zinc-400">No existe o no tienes acceso.</div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4 md:col-span-2">
                <div className="text-sm font-medium">Descripción</div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">{ticket.description || "—"}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-sm font-medium">Detalles</div>
                <div className="mt-3 space-y-2 text-sm text-zinc-300">
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-500">Creado</span>
                    <span>{new Date(ticket.created_at).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-500">SLA</span>
                    <span>{ticket.sla_deadline ? new Date(ticket.sla_deadline).toLocaleString() : "n/a"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-500">Asignado</span>
                    <span>{ticket.assignee_id ? ticket.assignee_id.slice(0, 8) : "—"}</span>
                  </div>
                </div>

                {canModerate && (
                  <div className="mt-4 space-y-2">
                    {canReassign && (
                      <label className="block">
                        <div className="text-xs text-zinc-400">Reasignar</div>
                        <select
                          value={assigneeId}
                          onChange={(e) => {
                            const v = e.target.value;
                            setAssigneeId(v);
                            void reassign(v);
                          }}
                          className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-white/20"
                        >
                          <option value="">(Sin asignación)</option>
                          {agents.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {!ticket.assignee_id && (
                      <button onClick={() => void assignToMe()} className="w-full rounded-xl bg-white px-3 py-2 text-sm font-medium text-zinc-900">
                        Asignarme
                      </button>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      {statusActions.map((a) => (
                        <button
                          key={a.value}
                          onClick={() => void setStatus(a.value)}
                          className="rounded-xl bg-white/5 px-3 py-2 text-xs text-white ring-1 ring-white/10 hover:bg-white/10"
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-medium">Comentarios</div>
              <div className="mt-3 space-y-2">
                {comments.length === 0 ? (
                  <div className="text-sm text-zinc-400">Sin comentarios.</div>
                ) : (
                  comments.map((c) => (
                    <div key={c.id} className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                      <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
                        <div>
                          {c.author_id.slice(0, 8)} {c.is_internal ? "· interna" : ""}
                        </div>
                        <div>{new Date(c.created_at).toLocaleString()}</div>
                      </div>
                      <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-200">{c.body}</div>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-4 grid gap-2 md:grid-cols-[1fr_auto]">
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="min-h-24 w-full rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-white/20"
                  placeholder={ticket.status === "Pendiente Info" ? "Provee la información solicitada..." : "Escribe un comentario..."}
                />
                <div className="flex flex-col gap-2">
                  {canModerate && (
                    <label className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs text-white ring-1 ring-white/10">
                      <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                      Nota interna
                    </label>
                  )}
                  <button
                    disabled={saving || body.trim().length < 2}
                    onClick={() => void postComment()}
                    className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50"
                  >
                    {saving ? "Enviando..." : "Enviar"}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
