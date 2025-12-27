"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useProfile, useSession } from "@/lib/hooks";
import { supabase } from "@/lib/supabaseBrowser";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { errorMessage } from "@/lib/error";
import { isDemoMode } from "@/lib/demo";
import { getArticle as demoGetArticle, updateArticle as demoUpdateArticle } from "@/lib/demoStore";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { InlineAlert } from "@/components/feedback/InlineAlert";

type Article = {
  id: string;
  department_id: string;
  title: string;
  content: string;
  is_published: boolean;
  updated_at: string;
};

export default function ArticlePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile } = useProfile(session?.user.id);

  const [article, setArticle] = useState<Article | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editPublished, setEditPublished] = useState(false);
  const [saving, setSaving] = useState(false);

  const canWrite = profile?.role === "agent" || profile?.role === "supervisor" || profile?.role === "admin";
  const canEdit = useMemo(() => canWrite && article?.department_id === profile?.department_id, [canWrite, article?.department_id, profile?.department_id]);

  useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  async function load() {
    if (!id) return;
    setLoading(true);
    setError(null);
    if (isDemoMode()) {
      const a = demoGetArticle(id) as Article | null;
      setArticle(a);
      if (a) {
        setEditTitle(a.title);
        setEditContent(a.content);
        setEditPublished(a.is_published);
      }
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("knowledge_base")
      .select("id,department_id,title,content,is_published,updated_at")
      .eq("id", id)
      .single();
    if (error) setError(error.message);
    const a = ((data ?? null) as unknown) as Article | null;
    setArticle(a);
    if (a) {
      setEditTitle(a.title);
      setEditContent(a.content);
      setEditPublished(a.is_published);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function save() {
    if (!canEdit || !id) return;
    setSaving(true);
    setError(null);
    try {
      if (isDemoMode()) {
        demoUpdateArticle(id, { title: editTitle.trim(), content: editContent.trim(), is_published: editPublished });
        await load();
        return;
      }
      const { error } = await supabase
        .from("knowledge_base")
        .update({ title: editTitle.trim(), content: editContent.trim(), is_published: editPublished })
        .eq("id", id);
      if (error) throw error;
      await load();
    } catch (e: unknown) {
      setError(errorMessage(e) ?? "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  if (sessionLoading || profileLoading) return <div className="p-6 text-sm text-muted-foreground">Cargando…</div>;
  if (!session || !profile) return null;

  return (
    <AppShell profile={profile}>
      <div className="space-y-4">
        <PageHeader
          title={article?.title ?? "Artículo"}
          description={article ? (article.is_published ? "Publicado" : "Borrador") : "—"}
          actions={
            <>
              <Button asChild variant="outline">
                <Link href="/app/kb">Volver</Link>
              </Button>
              <Button variant="outline" onClick={() => void load()}>
                Actualizar
              </Button>
            </>
          }
        />

        {error ? <InlineAlert variant="error" description={error} /> : null}
        {loading ? (
          <div className="text-sm text-muted-foreground">Cargando…</div>
        ) : !article ? (
          <Card className="tech-border">
            <CardHeader>
              <CardTitle>No disponible</CardTitle>
              <CardDescription>No existe o no tienes acceso.</CardDescription>
            </CardHeader>
          </Card>
        ) : canEdit ? (
          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <Card className="tech-border tech-glow">
              <CardHeader>
                <CardTitle>Edición</CardTitle>
                <CardDescription>Markdown en texto plano.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <label className="block">
                  <div className="text-xs text-muted-foreground">Título</div>
                  <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                </label>
                <label className="block">
                  <div className="text-xs text-muted-foreground">Contenido</div>
                  <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} className="min-h-80" />
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={editPublished} onChange={(e) => setEditPublished(e.target.checked)} />
                  Publicar
                </label>
                <div className="flex items-center justify-between gap-3">
                  <Badge variant="outline">{editPublished ? "Publicado" : "Borrador"}</Badge>
                  <Button disabled={saving} onClick={() => void save()}>
                    {saving ? "Guardando…" : "Guardar"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="tech-border">
              <CardHeader>
                <CardTitle>Vista previa</CardTitle>
                <CardDescription>Render simple (texto) para revisar rápido.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="whitespace-pre-wrap text-sm text-foreground/90">{editContent}</div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card className="tech-border">
            <CardHeader>
              <CardTitle>Contenido</CardTitle>
              <CardDescription>
                <Badge variant="outline">{article.is_published ? "Publicado" : "Borrador"}</Badge>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="whitespace-pre-wrap text-sm text-foreground/90">{article.content}</div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
