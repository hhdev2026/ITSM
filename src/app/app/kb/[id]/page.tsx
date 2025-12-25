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

  if (sessionLoading || profileLoading) return <div className="p-6 text-sm text-zinc-300">Cargando...</div>;
  if (!session || !profile) return null;

  return (
    <AppShell profile={profile}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-zinc-500">
              <Link href="/app/kb" className="hover:text-zinc-300">
                ← Volver a KB
              </Link>
            </div>
            <div className="truncate text-xl font-semibold">{article?.title ?? "Artículo"}</div>
            {article && <div className="mt-1 text-sm text-zinc-400">{article.is_published ? "Publicado" : "Borrador"}</div>}
          </div>
          <button onClick={() => void load()} className="rounded-xl bg-white/5 px-3 py-2 text-xs text-white ring-1 ring-white/10 hover:bg-white/10">
            Actualizar
          </button>
        </div>

        {error && <div className="rounded-xl bg-rose-500/15 px-3 py-2 text-xs text-rose-200 ring-1 ring-rose-500/25">{error}</div>}
        {loading ? (
          <div className="text-sm text-zinc-400">Cargando...</div>
        ) : !article ? (
          <div className="text-sm text-zinc-400">No existe o no tienes acceso.</div>
        ) : canEdit ? (
          <div className="grid gap-3">
            <label className="block">
              <div className="text-xs text-zinc-400">Título</div>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-white/20"
              />
            </label>
            <label className="block">
              <div className="text-xs text-zinc-400">Contenido (Markdown)</div>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="mt-1 min-h-80 w-full rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-white/20"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-zinc-300">
              <input type="checkbox" checked={editPublished} onChange={(e) => setEditPublished(e.target.checked)} />
              Publicar
            </label>
            <button disabled={saving} onClick={() => void save()} className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50">
              {saving ? "Guardando..." : "Guardar"}
            </button>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-medium">Vista (texto)</div>
              <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-200">{editContent}</div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="whitespace-pre-wrap text-sm text-zinc-200">{article.content}</div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
