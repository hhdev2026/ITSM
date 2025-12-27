"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Category, ChatEvent, ChatMessage, ChatThread, Profile, Subcategory } from "@/lib/types";
import { supabase } from "@/lib/supabaseBrowser";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { EmptyState } from "@/components/feedback/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Combobox } from "@/components/ui/combobox";
import { toast } from "sonner";
import { ChatTranscript } from "@/features/chat/ChatTranscript";
import { chatStatusBadge, formatDuration, MetricTile } from "@/features/chat/chat-ui";
import { cn } from "@/lib/cn";
import { MessageSquarePlus, RefreshCcw, XCircle } from "lucide-react";

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

export function UserChat({ profile }: { profile: Profile }) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, ProfileLite | undefined>>({});

  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);

  const [subject, setSubject] = useState("");
  const [initialBody, setInitialBody] = useState("");
  const [body, setBody] = useState("");

  const [loading, setLoading] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);

  const selected = useMemo(() => threads.find((t) => t.id === selectedId) ?? null, [threads, selectedId]);

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ value: c.id, label: c.name, description: c.description })),
    [categories]
  );
  const subcategoryOptions = useMemo(
    () => subcategories.map((s) => ({ value: s.id, label: s.name, description: s.description })),
    [subcategories]
  );

  const loadLookups = useCallback(async () => {
    if (!profile.department_id) {
      setCategories([]);
      return;
    }
    const { data: cats } = await supabase
      .from("categories")
      .select("id,name,description,department_id")
      .eq("department_id", profile.department_id!)
      .order("name");
    setCategories((cats ?? []) as Category[]);
  }, [profile.department_id]);

  const loadThreads = useCallback(async () => {
    setError(null);
    setLoading(true);
    const { data, error } = await supabase
      .from("chat_threads")
      .select("id,department_id,requester_id,category_id,subcategory_id,skill_id,subject,status,assigned_agent_id,assigned_at,accepted_at,first_response_at,closed_at,closed_by,metadata,created_at,updated_at")
      .eq("requester_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) setError(error.message);
    const next = (data ?? []) as ChatThread[];
    setThreads(next);
    if (!selectedId && next[0]) setSelectedId(next[0].id);
    setLoading(false);
  }, [profile.id, selectedId]);

  const loadSubcategories = useCallback(async (catId: string | null) => {
    setSubcategories([]);
    setSubcategoryId(null);
    if (!catId) return;
    const { data } = await supabase
      .from("subcategories")
      .select("id,category_id,name,description")
      .eq("category_id", catId)
      .order("name");
    setSubcategories((data ?? []) as Subcategory[]);
  }, []);

  const loadThreadData = useCallback(async () => {
    if (!selectedId) return;
    setLoadingThread(true);
    setError(null);

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
    const channel = supabase
      .channel(`rt-chat-user-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_threads", filter: `requester_id=eq.${profile.id}` }, () => void loadThreads())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [loadLookups, loadThreads, profile.id]);

  useEffect(() => {
    void loadThreadData();
    if (!selectedId) return;
    const channel = supabase
      .channel(`rt-chat-thread-${selectedId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter: `thread_id=eq.${selectedId}` }, () => void loadThreadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_events", filter: `thread_id=eq.${selectedId}` }, () => void loadThreadData())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [loadThreadData, selectedId]);

  async function createThread() {
    setCreating(true);
    setError(null);
    try {
      const { data, error } = await supabase.rpc("chat_request", {
        p_subject: subject.trim() || null,
        p_category_id: categoryId,
        p_subcategory_id: subcategoryId,
        p_initial_message: initialBody.trim() || null,
      });
      if (error) throw error;
      const tid = data as string;
      toast.success("Chat creado");
      setSubject("");
      setInitialBody("");
      setCategoryId(null);
      setSubcategoryId(null);
      setSubcategories([]);
      await loadThreads();
      setSelectedId(tid);
    } catch (e: unknown) {
      toast.error("No se pudo crear el chat", { description: errorMessage(e) });
      setError(errorMessage(e));
    } finally {
      setCreating(false);
    }
  }

  async function send() {
    if (!selectedId) return;
    const clean = body.trim();
    if (!clean) return;
    setSending(true);
    try {
      const { error } = await supabase.rpc("chat_send_message", { p_thread_id: selectedId, p_body: clean });
      if (error) throw error;
      setBody("");
    } catch (e: unknown) {
      toast.error("No se pudo enviar el mensaje", { description: errorMessage(e) });
    } finally {
      setSending(false);
    }
  }

  async function closeChat() {
    if (!selectedId) return;
    setClosing(true);
    try {
      const { error } = await supabase.rpc("chat_close_thread", { p_thread_id: selectedId });
      if (error) throw error;
      toast.success("Chat cerrado");
      await loadThreads();
      await loadThreadData();
    } catch (e: unknown) {
      toast.error("No se pudo cerrar el chat", { description: errorMessage(e) });
    } finally {
      setClosing(false);
    }
  }

  const timeToTake = selected ? msBetween(selected.created_at, selected.accepted_at) : null;
  const timeToFirstResponse = selected ? msBetween(selected.created_at, selected.first_response_at) : null;
  const timeToClose = selected ? msBetween(selected.created_at, selected.closed_at) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Chat"
        description="Conversa con mesa de ayuda y sigue el estado en tiempo real."
        actions={
          <Button variant="outline" onClick={() => void loadThreads()}>
            <RefreshCcw className="h-4 w-4" />
            Actualizar
          </Button>
        }
      />

      {error ? <InlineAlert variant="error" description={error} /> : null}

      <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
        <Card className="tech-border">
          <CardHeader>
            <CardTitle>Iniciar conversación</CardTitle>
            <CardDescription>Elige el tema para asignación y resolución más rápida.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Categoría</div>
                <Combobox
                  value={categoryId}
                  onValueChange={(v) => {
                    setCategoryId(v);
                    void loadSubcategories(v);
                  }}
                  options={categoryOptions}
                  placeholder="Seleccionar…"
                  searchPlaceholder="Buscar categoría…"
                />
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Subcategoría</div>
                <Combobox
                  value={subcategoryId}
                  onValueChange={(v) => setSubcategoryId(v)}
                  options={subcategoryOptions}
                  disabled={!categoryId}
                  placeholder={categoryId ? "Seleccionar…" : "Primero elige categoría"}
                  searchPlaceholder="Buscar subcategoría…"
                />
              </div>
            </div>

            <label className="block">
              <div className="text-xs text-muted-foreground">Asunto (opcional)</div>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ej: VPN no conecta" />
            </label>

            <label className="block">
              <div className="text-xs text-muted-foreground">Mensaje inicial</div>
              <Textarea value={initialBody} onChange={(e) => setInitialBody(e.target.value)} rows={4} placeholder="Describe el problema, impacto y pasos ya realizados…" />
            </label>

            <Button disabled={creating || initialBody.trim().length < 3} onClick={() => void createThread()} className="w-full">
              {creating ? "Creando…" : "Crear chat"}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="tech-border">
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Conversaciones</CardTitle>
                <CardDescription>Selecciona un chat para ver la traza completa.</CardDescription>
              </div>
              <Badge variant="outline">{threads.length}</Badge>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : threads.length === 0 ? (
                <EmptyState title="Aún no hay chats" description="Crea uno para conversar con mesa de ayuda." icon={<MessageSquarePlus className="h-5 w-5" />} />
              ) : (
                <div className="space-y-2">
                  {threads.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedId(t.id)}
                      className={cn(
                        "w-full text-left rounded-2xl border p-3 transition-colors",
                        "bg-background/30 border-border hover:bg-accent/40",
                        selectedId === t.id && "ring-1 ring-[hsl(var(--brand-cyan))]/25 border-[hsl(var(--brand-cyan))]/25"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{t.subject || "Chat sin asunto"}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString()}</div>
                        </div>
                        <Badge variant="outline" className={cn("border", chatStatusBadge(t.status))}>
                          {t.status}
                        </Badge>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {selected ? (
            <Card className="tech-border">
              <CardHeader className="flex-row items-center justify-between">
                <div className="min-w-0">
                  <CardTitle className="truncate">{selected.subject || "Chat"}</CardTitle>
                  <CardDescription className="mt-1">Estado: {selected.status}</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={cn("border", chatStatusBadge(selected.status))}>
                    {selected.status}
                  </Badge>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={closing || selected.status === "Cerrado"}
                    onClick={() => void closeChat()}
                    aria-label="Cerrar chat"
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  <MetricTile label="Tiempo a tomar" value={timeToTake != null ? formatDuration(timeToTake) : "—"} />
                  <MetricTile label="Primera respuesta" value={timeToFirstResponse != null ? formatDuration(timeToFirstResponse) : "—"} />
                  <MetricTile label="Tiempo total" value={timeToClose != null ? formatDuration(timeToClose) : "—"} />
                </div>

                <div className="max-h-[52vh] overflow-auto rounded-2xl glass-surface p-4">
                  {loadingThread ? (
                    <div className="space-y-2">
                      <Skeleton className="h-10 w-10/12" />
                      <Skeleton className="h-10 w-8/12" />
                      <Skeleton className="h-10 w-9/12" />
                    </div>
                  ) : (
                    <ChatTranscript meId={profile.id} messages={messages} events={events} profilesById={profilesById} />
                  )}
                </div>

                <div className="flex gap-2">
                  <Textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={2}
                    placeholder={selected.status === "Cerrado" ? "Chat cerrado" : "Escribe un mensaje…"}
                    disabled={selected.status === "Cerrado"}
                  />
                  <Button disabled={sending || selected.status === "Cerrado" || body.trim().length === 0} onClick={() => void send()} className="shrink-0">
                    {sending ? "Enviando…" : "Enviar"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
