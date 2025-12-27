"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentPresence, AgentPresenceStatus, Category, ChatEvent, ChatMessage, ChatThread, Profile } from "@/lib/types";
import { supabase } from "@/lib/supabaseBrowser";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { EmptyState } from "@/components/feedback/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { ChatTranscript } from "@/features/chat/ChatTranscript";
import { chatStatusBadge, formatDuration, MetricTile, presenceBadge } from "@/features/chat/chat-ui";
import { CheckCircle2, RefreshCcw, UserPlus2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type ProfileLite = Pick<Profile, "id" | "full_name" | "email" | "role">;

function msBetween(a: string | null, b: string | null) {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") return (e as { message: string }).message;
  return "Error";
}

const PresenceOptions: AgentPresenceStatus[] = ["Disponible", "Ocupado", "Ausente", "Offline"];

export function ChatsInbox({ profile }: { profile: Profile }) {
  const canManage = profile.role === "supervisor" || profile.role === "admin";
  const canWork = profile.role === "agent" || canManage;

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ChatThread | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, ProfileLite | undefined>>({});

  const [presence, setPresence] = useState<AgentPresence | null>(null);
  const [agents, setAgents] = useState<Array<{ id: string; label: string }>>([]);
  const [categories, setCategories] = useState<Record<string, string>>({});

  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const q: ChatThread[] = [];
    const assigned: ChatThread[] = [];
    const active: ChatThread[] = [];
    const closed: ChatThread[] = [];
    for (const t of threads) {
      if (t.status === "Cerrado") {
        if (canManage || t.assigned_agent_id === profile.id) closed.push(t);
        continue;
      }
      if (t.status === "En cola") q.push(t);
      else if (t.status === "Asignado") {
        if (canManage || t.assigned_agent_id === profile.id) assigned.push(t);
      } else if (t.status === "Activo") {
        if (canManage || t.assigned_agent_id === profile.id) active.push(t);
      }
    }
    return { q, assigned, active, closed };
  }, [canManage, profile.id, threads]);

  const loadLookups = useCallback(async () => {
    if (!profile.department_id) {
      setCategories({});
      setAgents([]);
      setPresence(null);
      return;
    }
    const [{ data: cats }, { data: profs }, { data: pres }] = await Promise.all([
      supabase.from("categories").select("id,name").eq("department_id", profile.department_id),
      supabase.from("profiles").select("id,full_name,email,role").in("role", ["agent", "supervisor"]).eq("department_id", profile.department_id).order("email"),
      supabase.from("agent_presence").select("profile_id,department_id,status,capacity,updated_at").eq("profile_id", profile.id).maybeSingle(),
    ]);
    const map: Record<string, string> = {};
    for (const c of (cats ?? []) as Array<Pick<Category, "id" | "name">>) map[c.id] = c.name;
    setCategories(map);
    const list = (profs ?? []) as Array<{ id: string; full_name: string | null; email: string }>;
    setAgents(list.map((p) => ({ id: p.id, label: p.full_name || p.email })));
    setPresence((pres ?? null) as AgentPresence | null);
  }, [profile.department_id, profile.id]);

  const loadThreads = useCallback(async () => {
    setError(null);
    setLoading(true);
    if (!profile.department_id) {
      setThreads([]);
      setSelectedId(null);
      setSelected(null);
      setLoading(false);
      setError("Tu perfil no tiene departamento asignado. Pide a un admin que configure tu cuenta.");
      return;
    }
    const { data, error } = await supabase
      .from("chat_threads")
      .select("id,department_id,requester_id,category_id,subcategory_id,skill_id,subject,status,assigned_agent_id,assigned_at,accepted_at,first_response_at,closed_at,closed_by,metadata,created_at,updated_at")
      .eq("department_id", profile.department_id)
      .order("updated_at", { ascending: false })
      .limit(120);
    if (error) setError(error.message);
    const next = (data ?? []) as ChatThread[];
    setThreads(next);
    if (!selectedId && next[0]) setSelectedId(next[0].id);
    setLoading(false);
  }, [profile.department_id, selectedId]);

  const loadThreadData = useCallback(async () => {
    if (!selectedId) return;
    setLoadingThread(true);
    setError(null);

    const { data: threadRaw } = await supabase
      .from("chat_threads")
      .select("id,department_id,requester_id,category_id,subcategory_id,skill_id,subject,status,assigned_agent_id,assigned_at,accepted_at,first_response_at,closed_at,closed_by,metadata,created_at,updated_at")
      .eq("id", selectedId)
      .maybeSingle();
    setSelected((threadRaw ?? null) as ChatThread | null);

    const [{ data: msgs, error: msgErr }, { data: evs, error: evErr }] = await Promise.all([
      supabase.from("chat_messages").select("id,thread_id,author_id,body,created_at").eq("thread_id", selectedId).order("created_at", { ascending: true }),
      supabase.from("chat_events").select("id,thread_id,actor_id,event_type,details,created_at").eq("thread_id", selectedId).order("created_at", { ascending: true }),
    ]);
    if (msgErr) setError(msgErr.message);
    if (evErr) setError(evErr.message);

    const nextMsgs = (msgs ?? []) as ChatMessage[];
    const nextEvents = ((evs ?? []) as unknown) as ChatEvent[];
    setMessages(nextMsgs);
    setEvents(nextEvents);

    const ids = new Set<string>();
    if (threadRaw?.requester_id) ids.add(threadRaw.requester_id);
    if (threadRaw?.assigned_agent_id) ids.add(threadRaw.assigned_agent_id);
    for (const m of nextMsgs) if (m.author_id) ids.add(m.author_id);
    for (const e of nextEvents) if (e.actor_id) ids.add(e.actor_id);

    if (ids.size) {
      const { data: profs } = await supabase.from("profiles").select("id,full_name,email,role").in("id", Array.from(ids));
      const map: Record<string, ProfileLite> = {};
      for (const p of (profs ?? []) as ProfileLite[]) map[p.id] = p;
      setProfilesById(map);
    } else {
      setProfilesById({});
    }

    setLoadingThread(false);
  }, [selectedId]);

  useEffect(() => {
    void loadLookups();
    void loadThreads();
    if (!profile.department_id) return;
    const channel = supabase
      .channel(`rt-chats-dept-${profile.department_id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_threads", filter: `department_id=eq.${profile.department_id}` }, (payload) => {
        const row = payload.new as { id?: string; status?: string };
        if (row?.status === "En cola") toast.message("Nuevo chat en cola");
        void loadThreads();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_threads", filter: `department_id=eq.${profile.department_id}` }, () => void loadThreads())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [loadLookups, loadThreads, profile.department_id]);

  useEffect(() => {
    void loadThreadData();
    if (!selectedId) return;
    const channel = supabase
      .channel(`rt-chat-thread-${selectedId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter: `thread_id=eq.${selectedId}` }, () => void loadThreadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_events", filter: `thread_id=eq.${selectedId}` }, () => void loadThreadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_threads", filter: `id=eq.${selectedId}` }, () => void loadThreadData())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [loadThreadData, selectedId]);

  async function setPresenceStatus(next: AgentPresenceStatus) {
    try {
      const { error } = await supabase.rpc("chat_set_presence", { p_status: next, p_capacity: presence?.capacity ?? 3 });
      if (error) throw error;
      toast.success(`Estado: ${next}`);
      await loadLookups();
    } catch (e: unknown) {
      toast.error("No se pudo actualizar presencia", { description: errorMessage(e) });
    }
  }

  async function takeThread(threadId: string) {
    setActing(threadId);
    try {
      const { error } = await supabase.rpc("chat_take_thread", { p_thread_id: threadId });
      if (error) throw error;
      toast.success("Chat tomado");
      setSelectedId(threadId);
    } catch (e: unknown) {
      toast.error("No se pudo tomar el chat", { description: errorMessage(e) });
    } finally {
      setActing(null);
    }
  }

  async function acceptThread(threadId: string) {
    setActing(threadId);
    try {
      const { error } = await supabase.rpc("chat_accept_thread", { p_thread_id: threadId });
      if (error) throw error;
      toast.success("Chat aceptado");
    } catch (e: unknown) {
      toast.error("No se pudo aceptar el chat", { description: errorMessage(e) });
    } finally {
      setActing(null);
    }
  }

  async function assignThread(threadId: string, agentId: string) {
    setActing(threadId);
    try {
      const { error } = await supabase.rpc("chat_assign_thread", { p_thread_id: threadId, p_agent_id: agentId });
      if (error) throw error;
      toast.success("Chat asignado");
    } catch (e: unknown) {
      toast.error("No se pudo asignar", { description: errorMessage(e) });
    } finally {
      setActing(null);
    }
  }

  async function closeThread(threadId: string) {
    setActing(threadId);
    try {
      const { error } = await supabase.rpc("chat_close_thread", { p_thread_id: threadId });
      if (error) throw error;
      toast.success("Chat cerrado");
    } catch (e: unknown) {
      toast.error("No se pudo cerrar", { description: errorMessage(e) });
    } finally {
      setActing(null);
    }
  }

  async function send() {
    if (!selected) return;
    const clean = body.trim();
    if (!clean) return;
    setSending(true);
    try {
      const { error } = await supabase.rpc("chat_send_message", { p_thread_id: selected.id, p_body: clean });
      if (error) throw error;
      setBody("");
    } catch (e: unknown) {
      toast.error("No se pudo enviar", { description: errorMessage(e) });
    } finally {
      setSending(false);
    }
  }

  const timeToTake = selected ? msBetween(selected.created_at, selected.accepted_at) : null;
  const timeToFirstResponse = selected ? msBetween(selected.created_at, selected.first_response_at) : null;
  const timeToClose = selected ? msBetween(selected.created_at, selected.closed_at) : null;
  const canSend = !!selected && (canManage || selected.requester_id === profile.id || selected.assigned_agent_id === profile.id);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Chats"
        description="Canal en tiempo real: cola, asignación y trazabilidad."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => void loadThreads()}>
              <RefreshCcw className="h-4 w-4" />
              Actualizar
            </Button>
          </div>
        }
      />

      {error ? <InlineAlert variant="error" description={error} /> : null}

      {canWork ? (
        <Card className="tech-border">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Disponibilidad</CardTitle>
              <CardDescription>Controla si recibes auto‑asignación.</CardDescription>
            </div>
            <Badge variant="outline" className={cn("border", presenceBadge(presence?.status ?? "Offline"))}>
              {presence?.status ?? "Offline"}
            </Badge>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {PresenceOptions.map((s) => (
              <Button key={s} variant={presence?.status === s ? "default" : "outline"} onClick={() => void setPresenceStatus(s)}>
                {s}
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
        <Card className="tech-border">
          <CardHeader>
            <CardTitle>Backlog</CardTitle>
            <CardDescription>En cola, asignados, activos y cerrados.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : threads.length === 0 ? (
              <EmptyState title="Sin chats" description="La cola está vacía." />
            ) : (
              <div className="space-y-3">
                {([
                  { key: "En cola", title: "En cola", list: grouped.q },
                  { key: "Asignado", title: "Asignados", list: grouped.assigned },
                  { key: "Activo", title: "Activos", list: grouped.active },
                  { key: "Cerrado", title: "Cerrados", list: grouped.closed.slice(0, 20) },
                ] as const).map((g) => (
                  <div key={g.key} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">{g.title}</div>
                      <Badge variant="outline">{g.list.length}</Badge>
                    </div>
                    <div className="space-y-2">
                      {g.list.slice(0, 10).map((t) => {
                        const isSelected = selectedId === t.id;
                        const category = t.category_id ? categories[t.category_id] : null;
                        const canTake = t.status === "En cola" || (t.status === "Asignado" && t.assigned_agent_id === profile.id);
                        const canAccept = t.status === "Asignado" && t.assigned_agent_id === profile.id;
                        const canClose = t.status !== "Cerrado" && (canManage || t.assigned_agent_id === profile.id);
                        return (
                          <div
                            key={t.id}
                            className={cn(
                              "rounded-2xl border bg-background/30 p-3 transition-colors",
                              "border-border hover:bg-accent/40",
                              isSelected && "ring-1 ring-[hsl(var(--brand-cyan))]/25 border-[hsl(var(--brand-cyan))]/25"
                            )}
                          >
                            <button onClick={() => setSelectedId(t.id)} className="block w-full text-left">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium">{t.subject || "Chat"}</div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {category ? `${category} · ` : null}
                                    {new Date(t.created_at).toLocaleString()}
                                  </div>
                                </div>
                                <Badge variant="outline" className={cn("border", chatStatusBadge(t.status))}>
                                  {t.status}
                                </Badge>
                              </div>
                            </button>

                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {t.status === "En cola" && (
                                <Button size="sm" onClick={() => void takeThread(t.id)} disabled={acting === t.id}>
                                  {acting === t.id ? "Tomando…" : "Tomar"}
                                </Button>
                              )}
                              {canAccept && (
                                <Button size="sm" variant="outline" onClick={() => void acceptThread(t.id)} disabled={acting === t.id}>
                                  <CheckCircle2 className="h-4 w-4" />
                                  Aceptar
                                </Button>
                              )}
                              {canClose && (
                                <Button size="sm" variant="outline" onClick={() => void closeThread(t.id)} disabled={acting === t.id}>
                                  Cerrar
                                </Button>
                              )}

                              {canManage ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button size="sm" variant="outline">
                                      <UserPlus2 className="h-4 w-4" />
                                      Asignar
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
                                    {agents.map((a) => (
                                      <DropdownMenuItem key={a.id} onClick={() => void assignThread(t.id, a.id)}>
                                        {a.label}
                                      </DropdownMenuItem>
                                    ))}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : null}

                              {!canTake && !canAccept && t.status !== "Cerrado" && (
                                <span className="text-xs text-muted-foreground">
                                  {t.assigned_agent_id && t.assigned_agent_id !== profile.id ? "Asignado a otro agente" : null}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="tech-border">
          <CardHeader className="flex-row items-center justify-between">
            <div className="min-w-0">
              <CardTitle className="truncate">{selected?.subject || "Selecciona un chat"}</CardTitle>
              <CardDescription className="mt-1">
                {selected ? (
                  <>
                    <span className="mr-2">{selected.status}</span>
                    {selected.category_id && categories[selected.category_id] ? (
                      <span className="text-muted-foreground">· {categories[selected.category_id]}</span>
                    ) : null}
                  </>
                ) : (
                  "Abre un chat del backlog para ver el hilo."
                )}
              </CardDescription>
            </div>
            {selected ? (
              <Badge variant="outline" className={cn("border", chatStatusBadge(selected.status))}>
                {selected.status}
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {selected ? (
              <div className="grid gap-2 sm:grid-cols-3">
                <MetricTile label="Tiempo a tomar" value={timeToTake != null ? formatDuration(timeToTake) : "—"} />
                <MetricTile label="Primera respuesta" value={timeToFirstResponse != null ? formatDuration(timeToFirstResponse) : "—"} />
                <MetricTile label="Tiempo total" value={timeToClose != null ? formatDuration(timeToClose) : "—"} />
              </div>
            ) : null}

            <div className="max-h-[56vh] overflow-auto rounded-2xl glass-surface p-4">
              {selectedId && loadingThread ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-10/12" />
                  <Skeleton className="h-10 w-8/12" />
                  <Skeleton className="h-10 w-9/12" />
                </div>
              ) : selected ? (
                <ChatTranscript meId={profile.id} messages={messages} events={events} profilesById={profilesById} />
              ) : (
                <div className="rounded-2xl bg-background/30 p-6 text-sm text-muted-foreground">Selecciona un chat a la izquierda.</div>
              )}
            </div>

            {selected ? (
              <div className="flex gap-2">
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={2}
                  placeholder={selected.status === "Cerrado" ? "Chat cerrado" : canSend ? "Escribe un mensaje…" : "Toma o acepta el chat para responder"}
                  disabled={selected.status === "Cerrado" || !canSend}
                />
                <Button disabled={sending || selected.status === "Cerrado" || !canSend || body.trim().length === 0} onClick={() => void send()} className="shrink-0">
                  {sending ? "Enviando…" : "Enviar"}
                </Button>
              </div>
            ) : null}
            {selected && !canSend && selected.status !== "Cerrado" ? (
              <div className="text-xs text-muted-foreground">
                Para responder debes tomar el chat (cola) o estar asignado. Esto mantiene trazabilidad y permisos correctos.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
