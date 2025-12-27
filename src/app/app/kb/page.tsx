"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useProfile, useSession } from "@/lib/hooks";
import { supabase } from "@/lib/supabaseBrowser";
import type { Profile } from "@/lib/types";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { errorMessage } from "@/lib/error";
import { isDemoMode } from "@/lib/demo";
import { createArticle as demoCreateArticle, listArticles as demoListArticles } from "@/lib/demoStore";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MotionItem, MotionList } from "@/components/motion/MotionList";

type Article = {
  id: string;
  department_id: string;
  title: string;
  content: string;
  category_id: string | null;
  author_id: string | null;
  is_published: boolean;
  updated_at: string;
};

export default function KnowledgeBasePage() {
  const router = useRouter();
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile } = useProfile(session?.user.id);

  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newPublished, setNewPublished] = useState(false);
  const [creating, setCreating] = useState(false);

  const canWrite = profile?.role === "agent" || profile?.role === "supervisor" || profile?.role === "admin";

  useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  async function load(p: Profile) {
    setLoading(true);
    setError(null);
    if (isDemoMode()) {
      setArticles((demoListArticles(p.department_id!) as unknown) as Article[]);
      setLoading(false);
      return;
    }
    const q = supabase
      .from("knowledge_base")
      .select("id,department_id,title,content,category_id,author_id,is_published,updated_at")
      .eq("department_id", p.department_id!)
      .order("updated_at", { ascending: false })
      .limit(50);
    const { data, error } = await q;
    if (error) setError(error.message);
    setArticles((data ?? []) as Article[]);
    setLoading(false);
  }

  useEffect(() => {
    if (!profile) return;
    void load(profile);
    if (isDemoMode()) return;
    const channel = supabase
      .channel(`rt-kb-${profile.department_id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "knowledge_base", filter: `department_id=eq.${profile.department_id}` }, () => void load(profile))
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profile]);

  const canCreate = useMemo(() => canWrite && newTitle.trim().length >= 5 && newContent.trim().length >= 20, [canWrite, newTitle, newContent]);

  async function createArticle(p: Profile) {
    setCreating(true);
    setError(null);
    try {
      if (isDemoMode()) {
        demoCreateArticle({ department_id: p.department_id!, title: newTitle.trim(), content: newContent.trim(), is_published: newPublished });
        setNewTitle("");
        setNewContent("");
        setNewPublished(false);
        await load(p);
        return;
      }
      const { error } = await supabase.from("knowledge_base").insert({
        department_id: p.department_id!,
        title: newTitle.trim(),
        content: newContent.trim(),
        author_id: p.id,
        is_published: newPublished,
      });
      if (error) throw error;
      setNewTitle("");
      setNewContent("");
      setNewPublished(false);
      await load(p);
    } catch (e: unknown) {
      setError(errorMessage(e) ?? "No se pudo crear el artículo");
    } finally {
      setCreating(false);
    }
  }

  if (sessionLoading || profileLoading) return <div className="p-6 text-sm text-muted-foreground">Cargando…</div>;
  if (!session || !profile) return null;

  return (
    <AppShell profile={profile}>
      <div className="space-y-6">
        <PageHeader
          title="Base de conocimiento"
          description="Artículos de autoservicio (Markdown en texto plano)."
          actions={
            <Button asChild variant="outline">
              <Link href="/app">Volver</Link>
            </Button>
          }
        />

        {canWrite ? (
          <Card className="tech-border tech-glow">
            <CardHeader>
              <CardTitle>Nuevo artículo</CardTitle>
              <CardDescription>Publica guías y soluciones para reducir tickets.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <label className="block">
                <div className="text-xs text-muted-foreground">Título</div>
                <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Ej: VPN: diagnóstico rápido" />
              </label>
              <label className="block">
                <div className="text-xs text-muted-foreground">Contenido (Markdown)</div>
                <Textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="min-h-44"
                  placeholder={"# Título\n\nPasos...\n- Item\n\n```bash\ncomando\n```"}
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={newPublished} onChange={(e) => setNewPublished(e.target.checked)} />
                Publicar
              </label>
              {error ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">{error}</div>
              ) : null}
              <Button disabled={!canCreate || creating} onClick={() => void createArticle(profile)}>
                {creating ? "Creando…" : "Crear"}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <Card className="tech-border">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Artículos</CardTitle>
              <CardDescription>Lista y estado de publicación.</CardDescription>
            </div>
            <Button variant="outline" onClick={() => void load(profile)}>
              Actualizar
            </Button>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">{error}</div>
            ) : null}
            {loading ? (
              <div className="text-sm text-muted-foreground">Cargando…</div>
            ) : articles.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">No hay artículos.</div>
            ) : (
              <MotionList className="divide-y divide-border">
                {articles.map((a) => (
                  <MotionItem key={a.id} id={a.id}>
                    <Link href={`/app/kb/${a.id}`} className="block rounded-lg py-3 transition-colors hover:bg-accent/40">
                      <div className="flex items-center justify-between gap-3 px-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{a.title}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline">{a.is_published ? "Publicado" : "Borrador"}</Badge>
                            <span>{new Date(a.updated_at).toLocaleString()}</span>
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground">Abrir</span>
                      </div>
                    </Link>
                  </MotionItem>
                ))}
              </MotionList>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
