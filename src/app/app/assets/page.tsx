"use client";

import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { AppBootScreen, AppNoticeScreen } from "@/components/layout/AppStates";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { AssetConnectivityBadge, AssetLifecycleBadge } from "@/components/assets/AssetBadges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/error";
import { useProfile, useSession } from "@/lib/hooks";
import { supabase } from "@/lib/supabaseBrowser";
import type { Asset, Profile } from "@/lib/types";
import { formatAssetTag } from "@/lib/assetTag";
import { UserAssets } from "@/features/assets/UserAssets";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Map, Plus, RefreshCcw, Upload } from "lucide-react";

type AssetRow = Pick<
  Asset,
  | "id"
  | "department_id"
  | "asset_tag"
  | "mesh_node_id"
  | "name"
  | "serial_number"
  | "asset_type"
  | "category"
  | "subcategory"
  | "region"
  | "comuna"
  | "building"
  | "floor"
  | "room"
  | "lifecycle_status"
  | "connectivity_status"
  | "last_seen_at"
  | "failure_risk_pct"
  | "created_at"
  | "updated_at"
>;

function csvEscape(value: unknown) {
  if (value == null) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function downloadCsv(filename: string, header: string[], rows: Array<Array<unknown>>) {
  const lines: string[] = [];
  lines.push(header.map(csvEscape).join(","));
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function uniqueOptions(values: Array<string | null | undefined>, allLabel: string): ComboboxOption[] {
  const set = new Set<string>();
  for (const v of values) {
    const s = typeof v === "string" ? v.trim() : "";
    if (s) set.add(s);
  }
  return [{ value: "__all__", label: allLabel }, ...Array.from(set).sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }))];
}

export default function AssetsPage() {
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error: profileError } = useProfile(session?.user.id);

  if (sessionLoading || profileLoading) return <AppBootScreen />;
  if (!session) return <AppNoticeScreen title="Inicia sesión" description="Debes iniciar sesión para ver activos." />;
  if (!profile) return <AppNoticeScreen title="No se pudo cargar tu perfil" description={profileError ?? "Intenta nuevamente."} />;

  if (profile.role === "user") {
    return (
      <AppShell profile={profile}>
        <UserAssets profile={profile} />
      </AppShell>
    );
  }

  return <AssetsInventory profile={profile} />;
}

function AssetsInventory({ profile }: { profile: Profile }) {
  const rmmLabel = "Agente remoto";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AssetRow[]>([]);

  const [q, setQ] = useState("");
  const [life, setLife] = useState<string>("__all__");
  const [conn, setConn] = useState<string>("__all__");
  const [region, setRegion] = useState<string>("__all__");
  const [comuna, setComuna] = useState<string>("__all__");

  const canManage = profile.role === "admin" || profile.role === "supervisor";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from("assets")
        .select(
          "id,department_id,asset_tag,mesh_node_id,name,serial_number,asset_type,category,subcategory,region,comuna,building,floor,room,lifecycle_status,connectivity_status,last_seen_at,failure_risk_pct,created_at,updated_at"
        )
        .order("updated_at", { ascending: false })
        .limit(500);

      const qq = q.trim();
      if (qq) {
        const like = `%${qq.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
        query = query.or(`name.ilike.${like},serial_number.ilike.${like},asset_type.ilike.${like},category.ilike.${like},subcategory.ilike.${like}`);
      }
      if (life !== "__all__") query = query.eq("lifecycle_status", life);
      if (conn !== "__all__") query = query.eq("connectivity_status", conn);
      if (region !== "__all__") query = query.eq("region", region);
      if (comuna !== "__all__") query = query.eq("comuna", comuna);

      const { data, error } = await query;
      if (error) throw error;
      setRows((data ?? []) as unknown as AssetRow[]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [q, life, conn, region, comuna]);

  useEffect(() => {
    void load();
  }, [load]);

  const lifeOptions = useMemo(
    () =>
      uniqueOptions(
        rows.map((r) => r.lifecycle_status),
        "Todos"
      ),
    [rows]
  );
  const connOptions = useMemo(
    () =>
      uniqueOptions(
        rows.map((r) => r.connectivity_status),
        "Todos"
      ),
    [rows]
  );
  const regionOptions = useMemo(() => uniqueOptions(rows.map((r) => r.region), "Todas"), [rows]);
  const comunaOptions = useMemo(() => uniqueOptions(rows.map((r) => r.comuna), "Todas"), [rows]);

  const stats = useMemo(() => {
    const total = rows.length;
    const online = rows.filter((r) => r.connectivity_status === "Online").length;
    const offline = rows.filter((r) => r.connectivity_status === "Offline" || r.connectivity_status === "Crítico").length;
    const repair = rows.filter((r) => r.lifecycle_status === "En reparación").length;
    const mesh = rows.filter((r) => !!r.mesh_node_id).length;
    const manual = Math.max(0, total - mesh);
    return { total, online, offline, repair, mesh, manual };
  }, [rows]);

  return (
    <AppShell profile={profile}>
      <div className="space-y-5">
        <PageHeader
          title="Activos"
          description={`Inventario y gestión de activos IT (incluye ${rmmLabel}).`}
          actions={
            <>
              {canManage ? (
                <>
                  <Button asChild variant="outline">
                    <Link href="/app/assets/import">
                      <Upload className="h-4 w-4" />
                      Importar CSV
                    </Link>
                  </Button>
                  <Button asChild>
                    <Link href="/app/assets/new">
                      <Plus className="h-4 w-4" />
                      Nuevo activo
                    </Link>
                  </Button>
                </>
              ) : null}
              <Button asChild variant="outline">
                <Link href="/app/assets/map">
                  <Map className="h-4 w-4" />
                  Mapa
                </Link>
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const header = [
                    "asset_tag",
                    "name",
                    "serial_number",
                    "asset_type",
                    "category",
                    "subcategory",
                    "lifecycle_status",
                    "connectivity_status",
                    "last_seen_at",
                    "region",
                    "comuna",
                    "building",
                    "floor",
                    "room",
                    "created_at",
                  ];
                  const out = rows.map((a) => [
                    formatAssetTag(a.asset_tag) ?? a.asset_tag,
                    a.name,
                    a.serial_number ?? "",
                    a.asset_type ?? "",
                    a.category ?? "",
                    a.subcategory ?? "",
                    a.lifecycle_status,
                    a.connectivity_status,
                    a.last_seen_at ?? "",
                    a.region ?? "",
                    a.comuna ?? "",
                    a.building ?? "",
                    a.floor ?? "",
                    a.room ?? "",
                    a.created_at,
                  ]);
                  downloadCsv(`activos-${profile.department_id ?? "sin-area"}.csv`, header, out);
                }}
                disabled={rows.length === 0}
              >
                Descargar Excel (CSV)
              </Button>
              <Button variant="outline" onClick={() => window.print()}>
                Descargar PDF (Imprimir)
              </Button>
              <Button variant="outline" onClick={() => void load()} disabled={loading}>
                <RefreshCcw className="h-4 w-4" />
                Actualizar
              </Button>
            </>
          }
        />

        {error ? <InlineAlert variant="error" title="No se pudo cargar activos" description={error} /> : null}

        <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <Card className="tech-border">
            <CardHeader>
              <CardTitle>Filtros</CardTitle>
              <CardDescription>Busca por nombre, serial o tipo. Filtra por estado y ubicación.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="block">
                <div className="text-xs text-muted-foreground">Buscar</div>
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej: Laptop, ABC123, Impresora…" />
              </label>
              <label className="block">
                <div className="text-xs text-muted-foreground">Ciclo de vida</div>
                <Combobox value={life} onValueChange={(v) => setLife(v ?? "__all__")} options={lifeOptions} placeholder="Todos" />
              </label>
              <label className="block">
                <div className="text-xs text-muted-foreground">Conectividad</div>
                <Combobox value={conn} onValueChange={(v) => setConn(v ?? "__all__")} options={connOptions} placeholder="Todos" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <label className="block">
                  <div className="text-xs text-muted-foreground">Región</div>
                  <Combobox value={region} onValueChange={(v) => setRegion(v ?? "__all__")} options={regionOptions} placeholder="Todas" />
                </label>
                <label className="block">
                  <div className="text-xs text-muted-foreground">Comuna</div>
                  <Combobox value={comuna} onValueChange={(v) => setComuna(v ?? "__all__")} options={comunaOptions} placeholder="Todas" />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">Activos</div>
                  <div className="text-lg font-semibold">{loading ? "…" : stats.total}</div>
                </div>
                <div className="rounded-xl border border-border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">{rmmLabel}</div>
                  <div className="text-lg font-semibold">{loading ? "…" : stats.mesh}</div>
                </div>
                <div className="rounded-xl border border-border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">Manual</div>
                  <div className="text-lg font-semibold">{loading ? "…" : stats.manual}</div>
                </div>
                <div className="rounded-xl border border-border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">Offline/Crítico</div>
                  <div className="text-lg font-semibold">{loading ? "…" : stats.offline}</div>
                </div>
                <div className="rounded-xl border border-border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">Online</div>
                  <div className="text-lg font-semibold">{loading ? "…" : stats.online}</div>
                </div>
                <div className="rounded-xl border border-border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">En reparación</div>
                  <div className="text-lg font-semibold">{loading ? "…" : stats.repair}</div>
                </div>
              </div>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setQ("");
                  setLife("__all__");
                  setConn("__all__");
                  setRegion("__all__");
                  setComuna("__all__");
                }}
              >
                Limpiar filtros
              </Button>
            </CardContent>
          </Card>

          <Card className="tech-border">
            <CardHeader>
              <CardTitle>Inventario</CardTitle>
              <CardDescription>{loading ? "Cargando…" : `Mostrando ${rows.length} activos`}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : rows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center">
                  <div className="text-sm font-medium">Sin activos</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {canManage ? "Importa un CSV o crea un activo manualmente." : "Aún no tienes activos asignados o visibles."}
                  </div>
                  {canManage ? (
                    <div className="mt-4 flex items-center justify-center gap-2">
                      <Button asChild variant="outline">
                        <Link href="/app/assets/import">Importar CSV</Link>
                      </Button>
                      <Button asChild>
                        <Link href="/app/assets/new">Nuevo activo</Link>
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-2">
                  {rows.map((a) => (
                    <Link
                      key={a.id}
                      href={`/app/assets/${a.id}`}
                      className={cn(
                        "block rounded-2xl border border-border bg-card/40 p-4",
                        "transition-[background,box-shadow] hover:bg-card/70 hover:shadow-sm"
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="default" className="font-mono">
                              {formatAssetTag(a.asset_tag) ?? `AST-${a.asset_tag}`}
                            </Badge>
                            {a.asset_type ? <Badge variant="outline">{a.asset_type}</Badge> : null}
                            <AssetLifecycleBadge status={a.lifecycle_status} />
                            <AssetConnectivityBadge status={a.connectivity_status} />
                            {a.mesh_node_id ? (
                              <Badge className="bg-[hsl(var(--brand-cyan))]/12 text-[hsl(var(--brand-cyan))] ring-1 ring-[hsl(var(--brand-cyan))]/25">
                                {rmmLabel}
                              </Badge>
                            ) : null}
                            {a.failure_risk_pct >= 80 ? <Badge className="bg-rose-500/15 text-rose-200 ring-1 ring-rose-500/25">Riesgo alto</Badge> : null}
                          </div>
                          <div className="mt-2 truncate text-base font-semibold">{a.name}</div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                            {a.serial_number ? <span className="font-mono">SN: {a.serial_number}</span> : null}
                            <span className="truncate">
                              {[a.region, a.comuna, a.building, a.floor ? `Piso ${a.floor}` : null, a.room].filter(Boolean).join(" · ") || "Sin ubicación"}
                            </span>
                            {a.last_seen_at ? <span>Última conexión: {new Date(a.last_seen_at).toLocaleString()}</span> : <span>Sin telemetría</span>}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-xs text-muted-foreground">
                          <div>Actualizado</div>
                          <div className="mt-0.5">{new Date(a.updated_at).toLocaleString()}</div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
