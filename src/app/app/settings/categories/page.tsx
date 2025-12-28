"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AppBootScreen, AppNoticeScreen } from "@/components/layout/AppStates";
import { PageHeader } from "@/components/layout/PageHeader";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { useProfile, useSession } from "@/lib/hooks";
import { supabase } from "@/lib/supabaseBrowser";
import { Plus, RefreshCcw, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";

type CategoryRow = { id: string; department_id: string; name: string; description: string | null; updated_at: string };
type SubcategoryRow = { id: string; category_id: string; name: string; description: string | null; updated_at: string };

function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") return (e as { message: string }).message;
  return "Error";
}

export default function CategoriesSettingsPage() {
  const router = useRouter();
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error: profileError } = useProfile(session?.user.id);

  const canUse = profile?.role === "supervisor" || profile?.role === "admin";
  const deptId = profile?.department_id ?? null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [subcategories, setSubcategories] = useState<SubcategoryRow[]>([]);

  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(() => categories.find((c) => c.id === selectedId) ?? null, [categories, selectedId]);
  const subsForSelected = useMemo(() => subcategories.filter((s) => s.category_id === selectedId), [selectedId, subcategories]);

  const [newCatName, setNewCatName] = useState("");
  const [newCatDesc, setNewCatDesc] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);

  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);

  const [newSubName, setNewSubName] = useState("");
  const [newSubDesc, setNewSubDesc] = useState("");
  const [creatingSub, setCreatingSub] = useState(false);

  useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  const load = useCallback(async () => {
    if (!deptId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: cats, error: cErr } = await supabase.from("categories").select("id,department_id,name,description,updated_at").eq("department_id", deptId).order("name");
      if (cErr) throw cErr;
      const nextCats = (cats ?? []) as CategoryRow[];
      setCategories(nextCats);
      if (!selectedId && nextCats[0]) setSelectedId(nextCats[0].id);

      const ids = nextCats.map((c) => c.id);
      if (!ids.length) {
        setSubcategories([]);
        return;
      }

      const { data: subs, error: sErr } = await supabase
        .from("subcategories")
        .select("id,category_id,name,description,updated_at")
        .in("category_id", ids)
        .order("name");
      if (sErr) throw sErr;
      setSubcategories((subs ?? []) as SubcategoryRow[]);
    } catch (e: unknown) {
      setError(errorMessage(e));
      setCategories([]);
      setSubcategories([]);
    } finally {
      setLoading(false);
    }
  }, [deptId, selectedId]);

  useEffect(() => {
    if (!profile || !deptId) return;
    if (!canUse) return;
    void load();
  }, [canUse, deptId, load, profile]);

  useEffect(() => {
    if (!selected) return;
    setEditName(selected.name);
    setEditDesc(selected.description ?? "");
  }, [selected]);

  const filteredCategories = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return categories;
    return categories.filter((c) => `${c.name} ${c.description ?? ""}`.toLowerCase().includes(qq));
  }, [categories, q]);

  const subCountByCatId = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of subcategories) map.set(s.category_id, (map.get(s.category_id) ?? 0) + 1);
    return map;
  }, [subcategories]);

  async function createCategory() {
    if (!deptId) return;
    const name = newCatName.trim();
    if (!name) return;
    setCreatingCategory(true);
    setError(null);
    try {
      const { error } = await supabase.from("categories").insert({ department_id: deptId, name, description: newCatDesc.trim() || null });
      if (error) throw error;
      toast.success("Categoría creada");
      setNewCatName("");
      setNewCatDesc("");
      await load();
    } catch (e: unknown) {
      const msg = errorMessage(e);
      setError(msg);
      toast.error("No se pudo crear", { description: msg });
    } finally {
      setCreatingCategory(false);
    }
  }

  async function saveCategory() {
    if (!selected) return;
    const name = editName.trim();
    if (!name) return;
    setSavingCategory(true);
    setError(null);
    try {
      const { error } = await supabase.from("categories").update({ name, description: editDesc.trim() || null }).eq("id", selected.id);
      if (error) throw error;
      toast.success("Categoría actualizada");
      await load();
    } catch (e: unknown) {
      const msg = errorMessage(e);
      setError(msg);
      toast.error("No se pudo guardar", { description: msg });
    } finally {
      setSavingCategory(false);
    }
  }

  async function deleteCategory() {
    if (!selected) return;
    const ok = window.confirm(`¿Eliminar la categoría "${selected.name}"? También se eliminarán sus subcategorías.`);
    if (!ok) return;
    setError(null);
    try {
      const { error } = await supabase.from("categories").delete().eq("id", selected.id);
      if (error) throw error;
      toast.success("Categoría eliminada");
      setSelectedId(null);
      await load();
    } catch (e: unknown) {
      const msg = errorMessage(e);
      setError(msg);
      toast.error("No se pudo eliminar", { description: msg });
    }
  }

  async function createSubcategory() {
    if (!selected) return;
    const name = newSubName.trim();
    if (!name) return;
    setCreatingSub(true);
    setError(null);
    try {
      const { error } = await supabase.from("subcategories").insert({ category_id: selected.id, name, description: newSubDesc.trim() || null });
      if (error) throw error;
      toast.success("Subcategoría creada");
      setNewSubName("");
      setNewSubDesc("");
      await load();
    } catch (e: unknown) {
      const msg = errorMessage(e);
      setError(msg);
      toast.error("No se pudo crear", { description: msg });
    } finally {
      setCreatingSub(false);
    }
  }

  async function deleteSubcategory(s: SubcategoryRow) {
    const ok = window.confirm(`¿Eliminar la subcategoría "${s.name}"?`);
    if (!ok) return;
    setError(null);
    try {
      const { error } = await supabase.from("subcategories").delete().eq("id", s.id);
      if (error) throw error;
      toast.success("Subcategoría eliminada");
      await load();
    } catch (e: unknown) {
      const msg = errorMessage(e);
      setError(msg);
      toast.error("No se pudo eliminar", { description: msg });
    }
  }

  if (sessionLoading || profileLoading) return <AppBootScreen label="Cargando configuración…" />;
  if (!session) return null;
  if (profileError) return <AppNoticeScreen variant="error" title="No se pudo cargar el perfil" description={profileError} />;
  if (!profile) return null;

  if (!canUse) {
    return (
      <AppShell profile={profile}>
        <AppNoticeScreen variant="error" title="Acceso restringido" description="Esta sección es solo para supervisor/admin." />
      </AppShell>
    );
  }

  return (
    <AppShell profile={profile}>
      <div className="space-y-6">
        <PageHeader
          title="Categorías"
          description="Personaliza cómo se clasifica el soporte (tickets y chat)."
          actions={
            <div className="flex items-center gap-2">
              <Button asChild variant="outline">
                <Link href="/app/settings">Volver</Link>
              </Button>
              <Button variant="outline" onClick={() => void load()} disabled={loading}>
                <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
                Actualizar
              </Button>
            </div>
          }
        />

        {error ? <InlineAlert variant="error" description={error} /> : null}

        <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
          <Card className="tech-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tags className="h-4 w-4 text-[hsl(var(--brand-cyan))]" />
                Categorías
              </CardTitle>
              <CardDescription>Crea y ordena el menú que verá el usuario.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 rounded-2xl border border-border bg-background/30 p-3">
                <div className="text-xs text-muted-foreground">Nueva categoría</div>
                <Input value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder="Ej: Accesos, Hardware, Correo…" />
                <Textarea value={newCatDesc} onChange={(e) => setNewCatDesc(e.target.value)} rows={2} placeholder="Descripción (opcional)" />
                <Button onClick={() => void createCategory()} disabled={creatingCategory || newCatName.trim().length < 2} className="w-full">
                  <Plus className="h-4 w-4" />
                  {creatingCategory ? "Creando…" : "Crear"}
                </Button>
              </div>

              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" />

              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : filteredCategories.length === 0 ? (
                <EmptyState title="Sin categorías" description="Crea la primera categoría para tu departamento." icon={<Tags className="h-5 w-5" />} />
              ) : (
                <div className="space-y-2">
                  {filteredCategories.map((c) => {
                    const active = selectedId === c.id;
                    const count = subCountByCatId.get(c.id) ?? 0;
                    return (
                      <button
                        key={c.id}
                        onClick={() => setSelectedId(c.id)}
                        className={cn(
                          "w-full rounded-2xl border p-3 text-left transition-colors",
                          "bg-background/30 border-border hover:bg-accent/40",
                          active && "ring-1 ring-[hsl(var(--brand-cyan))]/25 border-[hsl(var(--brand-cyan))]/25"
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{c.name}</div>
                            <div className="mt-1 truncate text-xs text-muted-foreground">{c.description ?? "—"}</div>
                          </div>
                          <Badge variant="outline">{count}</Badge>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="tech-border">
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="min-w-0">
                <CardTitle className="truncate">{selected ? selected.name : "Selecciona una categoría"}</CardTitle>
                <CardDescription className="mt-1">Administra subcategorías y detalles.</CardDescription>
              </div>
              {selected ? (
                <Button variant="outline" size="icon" onClick={() => void deleteCategory()} title="Eliminar categoría">
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4">
              {!selected ? (
                <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">Selecciona una categoría a la izquierda.</div>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <div className="text-xs text-muted-foreground">Nombre</div>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                    </label>
                    <label className="block md:col-span-2">
                      <div className="text-xs text-muted-foreground">Descripción</div>
                      <Textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} />
                    </label>
                    <div className="md:col-span-2">
                      <Button onClick={() => void saveCategory()} disabled={savingCategory || editName.trim().length < 2}>
                        {savingCategory ? "Guardando…" : "Guardar categoría"}
                      </Button>
                    </div>
                  </div>

                  <div className="h-px bg-border" />

                  <div className="space-y-2 rounded-2xl border border-border bg-background/30 p-3">
                    <div className="text-xs text-muted-foreground">Nueva subcategoría</div>
                    <Input value={newSubName} onChange={(e) => setNewSubName(e.target.value)} placeholder="Ej: VPN, Impresoras, Contraseñas…" />
                    <Textarea value={newSubDesc} onChange={(e) => setNewSubDesc(e.target.value)} rows={2} placeholder="Descripción (opcional)" />
                    <Button onClick={() => void createSubcategory()} disabled={creatingSub || newSubName.trim().length < 2} className="w-full">
                      <Plus className="h-4 w-4" />
                      {creatingSub ? "Creando…" : "Crear subcategoría"}
                    </Button>
                  </div>

                  {loading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : subsForSelected.length === 0 ? (
                    <EmptyState title="Sin subcategorías" description="Crea al menos una para guiar al usuario." icon={<Tags className="h-5 w-5" />} />
                  ) : (
                    <div className="space-y-2">
                      {subsForSelected.map((s) => (
                        <div key={s.id} className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-background/30 p-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{s.name}</div>
                            <div className="mt-1 truncate text-xs text-muted-foreground">{s.description ?? "—"}</div>
                          </div>
                          <Button variant="outline" size="icon" onClick={() => void deleteSubcategory(s)} title="Eliminar">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

