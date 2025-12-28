"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatEvent, ChatMessage, ChatThread, Profile } from "@/lib/types";
import { supabase } from "@/lib/supabaseBrowser";
import { PageHeader } from "@/components/layout/PageHeader";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Combobox } from "@/components/ui/combobox";
import { cn } from "@/lib/cn";
import { ChatTranscript } from "@/features/chat/ChatTranscript";
import { chatStatusBadge, displayName } from "@/features/chat/chat-ui";
import { RemoteSessionView } from "@/components/RemoteSessionView";
import { toast } from "sonner";
import { CheckCircle2, Laptop, MessageCircle, Monitor, RefreshCcw, Users } from "lucide-react";

type ProfileLite = Pick<Profile, "id" | "full_name" | "email" | "role">;
type RemoteDeviceLite = { id: string; name: string; protocol: "rdp" | "vnc"; mesh_node_id: string | null };

function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") return (e as { message: string }).message;
  return "Error";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function meshNodeIdFromMetadata(meta: unknown): string | null {
  if (!isRecord(meta)) return null;
  const mesh = meta.meshcentral;
  if (!isRecord(mesh)) return null;
  const nodeId = mesh.node_id;
  return typeof nodeId === "string" && nodeId.trim() ? nodeId.trim() : null;
}

export function SupportMessages({ profile }: { profile: Profile }) {
  const isUser = profile.role === "user";
  const canRemote = profile.role === "agent" || profile.role === "supervisor" || profile.role === "admin";
  const deptId = profile.department_id;

  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const [query, setQuery] = useState("");

  // Left list data
  const [agents, setAgents] = useState<ProfileLite[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [loadingLeft, setLoadingLeft] = useState(true);
  const [leftError, setLeftError] = useState<string | null>(null);

  // Selection + thread view
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<ChatThread | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, ProfileLite | undefined>>({});

  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  // Remote modal
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remoteDevices, setRemoteDevices] = useState<RemoteDeviceLite[]>([]);
  const [remoteDeviceId, setRemoteDeviceId] = useState<string | null>(null);

  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) => `${a.full_name ?? ""} ${a.email}`.toLowerCase().includes(q));
  }, [agents, query]);

  const filteredThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = threads;
    if (!q) return base;
    return base.filter((t) => {
      const requester = profilesById[t.requester_id];
      const who = requester ? displayName(requester) : t.requester_id;
      const subj = t.subject ?? "";
      return `${who} ${subj}`.toLowerCase().includes(q);
    });
  }, [profilesById, query, threads]);

  const selectedAgent = useMemo(() => agents.find((a) => a.id === selectedAgentId) ?? null, [agents, selectedAgentId]);

  const canTake = useMemo(() => {
    if (!selectedThread) return false;
    if (!deptId) return false;
    return canRemote && selectedThread.status === "En cola" && selectedThread.department_id === deptId;
  }, [canRemote, deptId, selectedThread]);

  const canAccept = useMemo(() => {
    if (!selectedThread) return false;
    return canRemote && selectedThread.status === "Asignado" && selectedThread.assigned_agent_id === profile.id;
  }, [canRemote, profile.id, selectedThread]);

  const canSend = useMemo(() => {
    if (!selectedThread) return isUser && !!selectedAgentId;
    if (selectedThread.status === "Cerrado") return false;
    if (selectedThread.requester_id === profile.id) return true;
    if (selectedThread.assigned_agent_id === profile.id) return true;
    if (profile.role === "supervisor" || profile.role === "admin") return true;
    return false;
  }, [isUser, profile.id, profile.role, selectedAgentId, selectedThread]);

  const loadPresence = useCallback(() => {
    if (!deptId) return;
    const ch = supabase.channel(`presence-support-${deptId}`, { config: { presence: { key: profile.id } } });
    presenceChannelRef.current = ch;

    function syncOnline() {
      const state = ch.presenceState() as Record<string, unknown>;
      setOnlineIds(new Set(Object.keys(state)));
    }

    ch.on("presence", { event: "sync" }, syncOnline)
      .on("presence", { event: "join" }, syncOnline)
      .on("presence", { event: "leave" }, syncOnline);

    ch.subscribe(async (status) => {
      if (status !== "SUBSCRIBED") return;
      try {
        await ch.track({ id: profile.id, role: profile.role, label: profile.full_name || profile.email });
      } catch {
        // ignore
      }
    });
  }, [deptId, profile.email, profile.full_name, profile.id, profile.role]);

  const loadLeft = useCallback(async () => {
    setLeftError(null);
    setLoadingLeft(true);
    try {
      if (!deptId) {
        setAgents([]);
        setThreads([]);
        setLoadingLeft(false);
        return;
      }

      if (isUser) {
        const { data, error } = await supabase
          .from("profiles")
          .select("id,full_name,email,role")
          .in("role", ["agent", "supervisor", "admin"])
          .eq("department_id", deptId)
          .order("full_name", { ascending: true });
        if (error) throw error;
        setAgents((data ?? []) as ProfileLite[]);
      } else {
        const { data, error } = await supabase
          .from("chat_threads")
          .select("id,department_id,requester_id,category_id,subcategory_id,skill_id,subject,status,assigned_agent_id,assigned_at,accepted_at,first_response_at,closed_at,closed_by,metadata,created_at,updated_at")
          .eq("department_id", deptId)
          .order("updated_at", { ascending: false })
          .limit(200);
        if (error) throw error;

        const next = (data ?? []) as ChatThread[];
        const visible = next.filter((t) => {
          if (profile.role === "supervisor" || profile.role === "admin") return true;
          if (t.status === "En cola") return true;
          return t.assigned_agent_id === profile.id;
        });
        setThreads(visible);

        const ids = new Set<string>();
        for (const t of visible) ids.add(t.requester_id);
        for (const t of visible) if (t.assigned_agent_id) ids.add(t.assigned_agent_id);
        if (ids.size) {
          const { data: profs } = await supabase.from("profiles").select("id,full_name,email,role").in("id", Array.from(ids));
          const map: Record<string, ProfileLite> = {};
          for (const p of (profs ?? []) as ProfileLite[]) map[p.id] = p;
          setProfilesById((prev) => ({ ...prev, ...map }));
        }

        if (!selectedThreadId && visible[0]) setSelectedThreadId(visible[0].id);
      }
    } catch (e: unknown) {
      setLeftError(errorMessage(e));
    } finally {
      setLoadingLeft(false);
    }
  }, [deptId, isUser, profile.id, profile.role, selectedThreadId]);

  const loadThread = useCallback(async () => {
    if (!selectedThreadId) {
      setSelectedThread(null);
      setMessages([]);
      setEvents([]);
      return;
    }

    setThreadError(null);
    setLoadingThread(true);
    try {
      const { data: threadRaw, error: thErr } = await supabase
        .from("chat_threads")
        .select("id,department_id,requester_id,category_id,subcategory_id,skill_id,subject,status,assigned_agent_id,assigned_at,accepted_at,first_response_at,closed_at,closed_by,metadata,created_at,updated_at")
        .eq("id", selectedThreadId)
        .maybeSingle();
      if (thErr) throw thErr;
      const t = (threadRaw ?? null) as ChatThread | null;
      setSelectedThread(t);

      const [{ data: msgs, error: msgErr }, { data: evs, error: evErr }] = await Promise.all([
        supabase.from("chat_messages").select("id,thread_id,author_id,body,created_at").eq("thread_id", selectedThreadId).order("created_at", { ascending: true }),
        supabase.from("chat_events").select("id,thread_id,actor_id,event_type,details,created_at").eq("thread_id", selectedThreadId).order("created_at", { ascending: true }),
      ]);
      if (msgErr) throw msgErr;
      if (evErr) throw evErr;

      const nextMsgs = (msgs ?? []) as ChatMessage[];
      const nextEvents = (evs ?? []) as ChatEvent[];
      setMessages(nextMsgs);
      setEvents(nextEvents);

      const ids = new Set<string>();
      if (t?.requester_id) ids.add(t.requester_id);
      if (t?.assigned_agent_id) ids.add(t.assigned_agent_id);
      for (const m of nextMsgs) if (m.author_id) ids.add(m.author_id);
      for (const e of nextEvents) if (e.actor_id) ids.add(e.actor_id);

      if (ids.size) {
        const { data: profs } = await supabase.from("profiles").select("id,full_name,email,role").in("id", Array.from(ids));
        const map: Record<string, ProfileLite> = {};
        for (const p of (profs ?? []) as ProfileLite[]) map[p.id] = p;
        setProfilesById((prev) => ({ ...prev, ...map }));
      }
    } catch (e: unknown) {
      setThreadError(errorMessage(e));
    } finally {
      setLoadingThread(false);
    }
  }, [selectedThreadId]);

  const selectAgent = useCallback(
    async (agentId: string) => {
      setSelectedAgentId(agentId);
      setSelectedThreadId(null);
      setSelectedThread(null);
      setMessages([]);
      setEvents([]);
      setThreadError(null);

      try {
        const { data, error } = await supabase
          .from("chat_threads")
          .select("id,updated_at,status")
          .eq("requester_id", profile.id)
          .eq("assigned_agent_id", agentId)
          .neq("status", "Cerrado")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (data?.id) setSelectedThreadId(data.id as string);
      } catch (e: unknown) {
        setThreadError(errorMessage(e));
      }
    },
    [profile.id]
  );

  useEffect(() => {
    void loadLeft();
    loadPresence();
    return () => {
      const ch = presenceChannelRef.current;
      presenceChannelRef.current = null;
      if (ch) void supabase.removeChannel(ch);
    };
  }, [loadLeft, loadPresence]);

  useEffect(() => {
    if (!deptId) return;
    if (isUser) {
      const channel = supabase
        .channel(`rt-chat-user-${profile.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "chat_threads", filter: `requester_id=eq.${profile.id}` }, () => void loadLeft())
        .subscribe();
      return () => void supabase.removeChannel(channel);
    }

    const channel = supabase
      .channel(`rt-chats-dept-${deptId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_threads", filter: `department_id=eq.${deptId}` }, () => void loadLeft())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [deptId, isUser, loadLeft, profile.id]);

  useEffect(() => {
    void loadThread();
    if (!selectedThreadId) return;
    const channel = supabase
      .channel(`rt-chat-thread-${selectedThreadId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter: `thread_id=eq.${selectedThreadId}` }, () => void loadThread())
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_events", filter: `thread_id=eq.${selectedThreadId}` }, () => void loadThread())
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_threads", filter: `id=eq.${selectedThreadId}` }, () => void loadThread())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [loadThread, selectedThreadId]);

  async function takeThread() {
    if (!selectedThreadId) return;
    setActing("take");
    try {
      const { error } = await supabase.rpc("chat_take_thread", { p_thread_id: selectedThreadId });
      if (error) throw error;
      toast.success("Chat tomado");
    } catch (e: unknown) {
      toast.error("No se pudo tomar el chat", { description: errorMessage(e) });
    } finally {
      setActing(null);
    }
  }

  async function acceptThread() {
    if (!selectedThreadId) return;
    setActing("accept");
    try {
      const { error } = await supabase.rpc("chat_accept_thread", { p_thread_id: selectedThreadId });
      if (error) throw error;
      toast.success("Chat aceptado");
    } catch (e: unknown) {
      toast.error("No se pudo aceptar", { description: errorMessage(e) });
    } finally {
      setActing(null);
    }
  }

  async function closeThread() {
    if (!selectedThreadId) return;
    setActing("close");
    try {
      const { error } = await supabase.rpc("chat_close_thread", { p_thread_id: selectedThreadId });
      if (error) throw error;
      toast.success("Chat cerrado");
    } catch (e: unknown) {
      toast.error("No se pudo cerrar", { description: errorMessage(e) });
    } finally {
      setActing(null);
    }
  }

  async function send() {
    const clean = body.trim();
    if (!clean) return;
    if (!deptId) return;
    if (!canSend) return;
    setSending(true);
    setThreadError(null);
    try {
      if (isUser && !selectedThreadId) {
        if (!selectedAgentId) throw new Error("Selecciona un agente.");
        const { data, error } = await supabase.rpc("chat_request_to_agent", {
          p_agent_id: selectedAgentId,
          p_subject: null,
          p_category_id: null,
          p_subcategory_id: null,
          p_initial_message: clean,
        });
        if (error) throw error;
        const tid = data as string;
        setSelectedThreadId(tid);
        setBody("");
        toast.success("Conversación iniciada");
        return;
      }

      if (!selectedThreadId) throw new Error("Selecciona una conversación.");
      const { error } = await supabase.rpc("chat_send_message", { p_thread_id: selectedThreadId, p_body: clean });
      if (error) throw error;
      setBody("");
    } catch (e: unknown) {
      toast.error("No se pudo enviar", { description: errorMessage(e) });
      setThreadError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  const remoteOptions = useMemo(() => {
    return remoteDevices.map((d) => ({
      value: d.id,
      label: d.name,
      description: d.protocol.toUpperCase(),
    }));
  }, [remoteDevices]);

  const openRemote = useCallback(async () => {
    if (!canRemote || !selectedThread) return;
    setRemoteOpen(true);
    setRemoteError(null);
    setRemoteLoading(true);
    setRemoteDevices([]);
    setRemoteDeviceId(null);

    try {
      const requesterId = selectedThread.requester_id;

      const [{ data: devicesAll, error: devErr }, { data: assignments, error: aaErr }] = await Promise.all([
        supabase.from("remote_devices").select("id,name,protocol,mesh_node_id").eq("department_id", deptId).order("name").limit(200),
        supabase.from("asset_assignments").select("asset_id").eq("user_id", requesterId).is("ended_at", null).limit(15),
      ]);
      if (devErr) throw devErr;
      if (aaErr) throw aaErr;

      const all = (devicesAll ?? []) as RemoteDeviceLite[];
      const assetIds = (assignments ?? []) as Array<{ asset_id: string }>;

      let matched: RemoteDeviceLite[] = [];
      if (assetIds.length) {
        const { data: assets, error: aErr } = await supabase.from("assets").select("id,metadata").in(
          "id",
          assetIds.map((r) => r.asset_id)
        );
        if (aErr) throw aErr;
        const nodeIds = Array.from(
          new Set(
            (assets ?? [])
              .map((a) => meshNodeIdFromMetadata((a as { metadata?: unknown }).metadata))
              .filter((v): v is string => !!v)
          )
        );
        if (nodeIds.length) {
          const { data: devs, error: mdErr } = await supabase.from("remote_devices").select("id,name,protocol,mesh_node_id").in("mesh_node_id", nodeIds).limit(50);
          if (mdErr) throw mdErr;
          matched = (devs ?? []) as RemoteDeviceLite[];
        }
      }

      const merged = new Map<string, RemoteDeviceLite>();
      for (const d of matched) merged.set(d.id, d);
      for (const d of all) merged.set(d.id, d);

      const list = Array.from(merged.values());
      setRemoteDevices(list);
      const preferred = matched[0]?.id ?? list[0]?.id ?? null;
      setRemoteDeviceId(preferred);
    } catch (e: unknown) {
      setRemoteError(errorMessage(e));
    } finally {
      setRemoteLoading(false);
    }
  }, [canRemote, deptId, selectedThread]);

  const listTitle = isUser ? "Soporte" : "Conversaciones";
  const listIcon = isUser ? <Users className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Mensajes"
        description={isUser ? "Elige un técnico disponible y conversa en tiempo real." : "Gestiona conversaciones 1:1 con trazabilidad y acciones de soporte."}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border">
              <span className={cn("mr-2 inline-block h-2 w-2 rounded-full", onlineIds.has(profile.id) ? "bg-emerald-400" : "bg-zinc-500/60")} aria-hidden />
              {onlineIds.size} online
            </Badge>
            <Button variant="outline" onClick={() => void loadLeft()}>
              <RefreshCcw className="h-4 w-4" />
              Actualizar
            </Button>
          </div>
        }
      />

      {leftError ? <InlineAlert variant="error" description={leftError} /> : null}
      {threadError ? <InlineAlert variant="error" description={threadError} /> : null}

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <Card className="tech-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {listIcon}
              {listTitle}
            </CardTitle>
            <CardDescription>
              {isUser ? "Agentes (online/offline). Selecciona uno para conversar." : "Selecciona un chat. Verás quién está online y podrás tomar/aceptar."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar…" />

            {loadingLeft ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : isUser ? (
              filteredAgents.length === 0 ? (
                <EmptyState title="Sin agentes" description="No hay técnicos visibles en tu departamento." icon={<Users className="h-5 w-5" />} />
              ) : (
                <div className="space-y-2">
                  {filteredAgents.map((a) => {
                    const online = onlineIds.has(a.id);
                    const active = selectedAgentId === a.id;
                    return (
                      <button
                        key={a.id}
                        onClick={() => void selectAgent(a.id)}
                        className={cn(
                          "w-full rounded-2xl border p-3 text-left transition-colors",
                          "bg-background/30 border-border hover:bg-accent/40",
                          active && "ring-1 ring-[hsl(var(--brand-cyan))]/25 border-[hsl(var(--brand-cyan))]/25"
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{displayName(a)}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{a.role}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "h-2.5 w-2.5 rounded-full",
                                online ? "bg-emerald-400 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]" : "bg-zinc-500/60"
                              )}
                              aria-hidden
                            />
                            <span className="text-[11px] text-muted-foreground">{online ? "En línea" : "Desconectado"}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )
            ) : filteredThreads.length === 0 ? (
              <EmptyState title="Sin conversaciones" description="No hay chats en cola o asignados." icon={<MessageCircle className="h-5 w-5" />} />
            ) : (
              <div className="space-y-2">
                {filteredThreads.map((t) => {
                  const active = selectedThreadId === t.id;
                  const requester = profilesById[t.requester_id];
                  const requesterLabel = requester ? displayName(requester) : "Solicitante";
                  const online = onlineIds.has(t.requester_id);
                  const mine = t.assigned_agent_id === profile.id;
                  const eligible = profile.role === "supervisor" || profile.role === "admin" || mine || t.status === "En cola";
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSelectedThreadId(t.id)}
                      className={cn(
                        "w-full rounded-2xl border p-3 text-left transition-colors",
                        "bg-background/30 border-border hover:bg-accent/40",
                        active && "ring-1 ring-[hsl(var(--brand-cyan))]/25 border-[hsl(var(--brand-cyan))]/25",
                        !eligible && "opacity-60"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={cn("h-2 w-2 rounded-full", online ? "bg-emerald-400" : "bg-zinc-500/60")} aria-hidden />
                            <div className="truncate text-sm font-medium">{requesterLabel}</div>
                          </div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">{t.subject || "Chat sin asunto"}</div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <Badge variant="outline" className={cn("border", chatStatusBadge(t.status))}>
                            {t.status}
                          </Badge>
                          {mine ? <span className="text-[11px] text-muted-foreground">Asignado a ti</span> : null}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="tech-border">
          <CardHeader className="flex-row items-start justify-between">
            <div className="min-w-0">
              <CardTitle className="truncate">
                {selectedThread?.subject ||
                  (isUser ? (selectedAgent ? `Chat con ${displayName(selectedAgent)}` : "Selecciona un agente") : "Selecciona una conversación")}
              </CardTitle>
              <CardDescription className="mt-1">
                {selectedThread ? (
                  <span className="mr-2">Estado: {selectedThread.status}</span>
                ) : isUser ? (
                  "Escribe tu mensaje para iniciar o retomar la conversación."
                ) : (
                  "Abre un chat para ver el historial."
                )}
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              {selectedThread ? (
                <Badge variant="outline" className={cn("border", chatStatusBadge(selectedThread.status))}>
                  {selectedThread.status}
                </Badge>
              ) : null}

              {!isUser && selectedThread ? (
                <>
                  {canTake ? (
                    <Button size="sm" disabled={acting === "take"} onClick={() => void takeThread()}>
                      {acting === "take" ? "Tomando…" : "Tomar"}
                    </Button>
                  ) : null}
                  {canAccept ? (
                    <Button size="sm" variant="outline" disabled={acting === "accept"} onClick={() => void acceptThread()}>
                      {acting === "accept" ? "Aceptando…" : "Aceptar"}
                    </Button>
                  ) : null}
                </>
              ) : null}

              {selectedThread ? (
                <Button size="sm" variant="outline" disabled={acting === "close"} onClick={() => void closeThread()}>
                  {acting === "close" ? "Cerrando…" : "Cerrar"}
                </Button>
              ) : null}

              {!isUser && canRemote && selectedThread ? (
                <Button size="sm" variant="outline" onClick={() => void openRemote()}>
                  <Monitor className="h-4 w-4" />
                  Tomar control
                </Button>
              ) : null}
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="max-h-[58vh] overflow-auto rounded-2xl glass-surface p-4">
              {selectedThreadId && loadingThread ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-10/12" />
                  <Skeleton className="h-10 w-8/12" />
                  <Skeleton className="h-10 w-9/12" />
                </div>
              ) : selectedThread ? (
                <ChatTranscript meId={profile.id} messages={messages} events={events} profilesById={profilesById} />
              ) : isUser && selectedAgentId ? (
                <div className="rounded-2xl bg-background/30 p-6 text-sm text-muted-foreground">
                  Envía tu primer mensaje para iniciar la conversación con <span className="text-foreground">{selectedAgent ? displayName(selectedAgent) : "soporte"}</span>.
                </div>
              ) : (
                <div className="rounded-2xl bg-background/30 p-6 text-sm text-muted-foreground">Selecciona un contacto para empezar.</div>
              )}
            </div>

            <div className="flex gap-2">
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={2}
                placeholder={selectedThread?.status === "Cerrado" ? "Chat cerrado" : canSend ? "Escribe un mensaje…" : "Toma o acepta el chat para responder"}
                disabled={selectedThread?.status === "Cerrado" || !canSend}
              />
              <Button disabled={sending || !canSend || body.trim().length === 0} onClick={() => void send()} className="shrink-0">
                {sending ? "Enviando…" : "Enviar"}
              </Button>
            </div>

            {!isUser && selectedThread && !canSend && selectedThread.status !== "Cerrado" ? (
              <div className="text-xs text-muted-foreground">
                Para responder debes tomar el chat (cola) o estar asignado. Esto mantiene trazabilidad y permisos correctos.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Dialog open={remoteOpen} onOpenChange={setRemoteOpen}>
        <DialogContent className="max-w-5xl p-0">
          <div className="border-b border-border px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Laptop className="h-4 w-4 text-muted-foreground" />
                  <div className="truncate text-sm font-semibold">Control remoto</div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Selecciona el equipo y toma control en el navegador (Guacamole).
                </div>
              </div>
              {remoteDeviceId ? (
                <Badge variant="outline" className="border">
                  <CheckCircle2 className="h-4 w-4" />
                  Listo
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="space-y-4 p-5">
            {remoteError ? <InlineAlert variant="error" description={remoteError} /> : null}

            {remoteLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-80" />
                <Skeleton className="h-[520px] w-full" />
              </div>
            ) : remoteDevices.length === 0 ? (
              <EmptyState title="Sin dispositivos remotos" description="No hay equipos configurados para control remoto en este departamento." icon={<Monitor className="h-5 w-5" />} />
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-full max-w-md space-y-1">
                    <div className="text-xs text-muted-foreground">Equipo</div>
                    <Combobox value={remoteDeviceId} onValueChange={(v) => setRemoteDeviceId(v)} options={remoteOptions} placeholder="Seleccionar…" searchPlaceholder="Buscar equipo…" />
                  </div>
                </div>

                {remoteDeviceId ? <RemoteSessionView deviceId={remoteDeviceId} title="Sesión remota" className="w-full" /> : null}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

