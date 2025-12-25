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

  if (sessionLoading || profileLoading) return <div className="p-6 text-sm text-zinc-300">Cargando...</div>;
  if (!session || !profile) return null;

  return (
    <AppShell profile={profile}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xl font-semibold">Knowledge Base</div>
            <div className="mt-1 text-sm text-zinc-400">Artículos de autoservicio (Markdown en texto plano).</div>
          </div>
          <Link href="/app" className="rounded-xl bg-white/5 px-3 py-2 text-sm text-white ring-1 ring-white/10 hover:bg-white/10">
            Volver
          </Link>
        </div>

        {canWrite && (
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm font-medium">Nuevo artículo</div>
            <div className="mt-3 grid gap-3">
              <label className="block">
                <div className="text-xs text-zinc-400">Título</div>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-white/20"
                />
              </label>
              <label className="block">
                <div className="text-xs text-zinc-400">Contenido (Markdown)</div>
                <textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="mt-1 min-h-40 w-full rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-white/20"
                  placeholder={"# Título\n\nPasos...\n- Item\n\n```bash\ncomando\n```"}
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input type="checkbox" checked={newPublished} onChange={(e) => setNewPublished(e.target.checked)} />
                Publicar
              </label>
              {error && <div className="rounded-xl bg-rose-500/15 px-3 py-2 text-xs text-rose-200 ring-1 ring-rose-500/25">{error}</div>}
              <button
                disabled={!canCreate || creating}
                onClick={() => void createArticle(profile)}
                className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50"
              >
                {creating ? "Creando..." : "Crear artículo"}
              </button>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">Artículos</div>
            <button onClick={() => void load(profile)} className="rounded-xl bg-white/5 px-3 py-2 text-xs text-white ring-1 ring-white/10 hover:bg-white/10">
              Actualizar
            </button>
          </div>
          {loading ? (
            <div className="mt-4 text-sm text-zinc-400">Cargando...</div>
          ) : articles.length === 0 ? (
            <div className="mt-4 text-sm text-zinc-400">No hay artículos.</div>
          ) : (
            <div className="mt-4 divide-y divide-white/10">
              {articles.map((a) => (
                <Link key={a.id} href={`/app/kb/${a.id}`} className="block py-3 hover:bg-white/5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{a.title}</div>
                      <div className="mt-1 text-xs text-zinc-400">{a.is_published ? "Publicado" : "Borrador"}</div>
                    </div>
                    <div className="text-xs text-zinc-500">{new Date(a.updated_at).toLocaleString()}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
