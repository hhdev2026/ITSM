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
import { AlertTriangle, ChevronDown, ChevronRight, Map as MapIcon, Plus, RefreshCcw, Upload } from "lucide-react";

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

function locationKey(a: AssetRow) {
  return [a.region, a.comuna, a.building].map((v) => (typeof v === "string" && v.trim() ? v.trim() : "Sin dato")).join("||");
}

function locationTitle(a: AssetRow) {
  return typeof a.building === "string" && a.building.trim() ? a.building.trim() : "Sin establecimiento";
}

function locationSubtitle(a: AssetRow) {
  return [a.region, a.comuna].filter(Boolean).join(" · ") || "Sin ubicación";
}

function countBy<T extends string>(items: T[]) {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item] = (acc[item] ?? 0) + 1;
    return acc;
  }, {});
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
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());

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
        .order("region", { ascending: true })
        .order("comuna", { ascending: true })
        .order("building", { ascending: true })
        .order("asset_type", { ascending: true })
        .limit(1000);

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
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
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

  const grouped = useMemo(() => {
    const byKey = new Map<
      string,
      {
        key: string;
        title: string;
        subtitle: string;
        rows: AssetRow[];
        total: number;
        online: number;
        offline: number;
        critical: number;
        repair: number;
        risk: number;
        types: Record<string, number>;
      }
    >();

    for (const row of rows) {
      const key = locationKey(row);
      const existing =
        byKey.get(key) ??
        {
          key,
          title: locationTitle(row),
          subtitle: locationSubtitle(row),
          rows: [],
          total: 0,
          online: 0,
          offline: 0,
          critical: 0,
          repair: 0,
          risk: 0,
          types: {},
        };
      existing.rows.push(row);
      existing.total += 1;
      if (row.connectivity_status === "Online") existing.online += 1;
      if (row.connectivity_status === "Offline") existing.offline += 1;
      if (row.connectivity_status === "Crítico") existing.critical += 1;
      if (row.lifecycle_status === "En reparación") existing.repair += 1;
      if (row.failure_risk_pct >= 80) existing.risk += 1;
      const type = row.asset_type || "Sin tipo";
      existing.types[type] = (existing.types[type] ?? 0) + 1;
      byKey.set(key, existing);
    }

    return Array.from(byKey.values()).sort((a, b) => {
      const problemDelta = b.critical + b.offline + b.risk - (a.critical + a.offline + a.risk);
      if (problemDelta !== 0) return problemDelta;
      return a.title.localeCompare(b.title);
    });
  }, [rows]);

  const summaryByType = useMemo(() => {
    const entries = Object.entries(countBy(rows.map((r) => r.asset_type || "Sin tipo"))).sort((a, b) => b[1] - a[1]);
    return entries.slice(0, 6);
  }, [rows]);

  const allGroupsExpanded = grouped.length > 0 && grouped.every((group) => expandedGroups.has(group.key));

  function toggleGroup(key: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function setAllGroups(expanded: boolean) {
    setExpandedGroups(expanded ? new Set(grouped.map((group) => group.key)) : new Set());
  }

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
                  <MapIcon className="h-4 w-4" />
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
              <CardDescription>
                {loading ? "Cargando…" : `${rows.length} activos agrupados en ${grouped.length} establecimientos`}
              </CardDescription>
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
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Resumen por tipo</span>
                      {summaryByType.map(([type, count]) => (
                        <Badge key={type} variant="outline">
                          {type}: {count}
                        </Badge>
                      ))}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setAllGroups(!allGroupsExpanded)}>
                      {allGroupsExpanded ? "Contraer sedes" : "Expandir sedes"}
                    </Button>
                  </div>

                  <div className="overflow-hidden rounded-lg border border-border">
                    <div className="grid grid-cols-[minmax(280px,1fr)_90px_110px_110px_140px] gap-3 border-b border-border bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground max-xl:hidden">
                      <div>Establecimiento</div>
                      <div className="text-right">Activos</div>
                      <div className="text-right">Online</div>
                      <div className="text-right">Problemas</div>
                      <div>Tipos</div>
                    </div>

                    <div className="divide-y divide-border">
                      {grouped.map((group) => {
                        const expanded = expandedGroups.has(group.key);
                        const problemCount = group.offline + group.critical + group.risk;
                        const topTypes = Object.entries(group.types)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 4);

                        return (
                          <section key={group.key} className="bg-card/25">
                            <button
                              type="button"
                              onClick={() => toggleGroup(group.key)}
                              className="grid w-full grid-cols-1 gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/20 xl:grid-cols-[minmax(280px,1fr)_90px_110px_110px_140px]"
                            >
                              <div className="flex min-w-0 items-start gap-3">
                                <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background/40">
                                  {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </span>
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold">{group.title}</div>
                                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{group.subtitle}</div>
                                </div>
                              </div>

                              <div className="flex items-center justify-between gap-2 xl:block xl:text-right">
                                <span className="text-xs text-muted-foreground xl:hidden">Activos</span>
                                <span className="text-sm font-semibold">{group.total}</span>
                              </div>
                              <div className="flex items-center justify-between gap-2 xl:block xl:text-right">
                                <span className="text-xs text-muted-foreground xl:hidden">Online</span>
                                <span className="text-sm font-semibold text-emerald-200">{group.online}</span>
                              </div>
                              <div className="flex items-center justify-between gap-2 xl:block xl:text-right">
                                <span className="text-xs text-muted-foreground xl:hidden">Problemas</span>
                                <span
                                  className={cn(
                                    "inline-flex items-center justify-end gap-1 text-sm font-semibold",
                                    problemCount > 0 ? "text-rose-200" : "text-muted-foreground"
                                  )}
                                >
                                  {problemCount > 0 ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
                                  {problemCount}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-1">
                                {topTypes.map(([type, count]) => (
                                  <Badge key={type} variant="outline" className="text-[11px]">
                                    {type} {count}
                                  </Badge>
                                ))}
                              </div>
                            </button>

                            {expanded ? (
                              <div className="border-t border-border bg-background/35">
                                <div className="overflow-x-auto">
                                  <table className="min-w-full text-sm">
                                    <thead className="bg-muted/20 text-xs text-muted-foreground">
                                      <tr>
                                        <th className="px-4 py-2 text-left font-medium">Activo</th>
                                        <th className="px-3 py-2 text-left font-medium">Tipo</th>
                                        <th className="px-3 py-2 text-left font-medium">Estado</th>
                                        <th className="px-3 py-2 text-left font-medium">Conexión</th>
                                        <th className="px-3 py-2 text-left font-medium">Ubicación</th>
                                        <th className="px-3 py-2 text-right font-medium">Riesgo</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/70">
                                      {group.rows
                                        .slice()
                                        .sort((a, b) => {
                                          const problemDelta =
                                            (b.connectivity_status === "Crítico" ? 3 : b.connectivity_status === "Offline" ? 2 : b.failure_risk_pct >= 80 ? 1 : 0) -
                                            (a.connectivity_status === "Crítico" ? 3 : a.connectivity_status === "Offline" ? 2 : a.failure_risk_pct >= 80 ? 1 : 0);
                                          if (problemDelta !== 0) return problemDelta;
                                          return (a.asset_type ?? "").localeCompare(b.asset_type ?? "");
                                        })
                                        .map((a) => (
                                          <tr key={a.id} className="hover:bg-accent/20">
                                            <td className="max-w-[360px] px-4 py-2">
                                              <Link href={`/app/assets/${a.id}`} className="block min-w-0 hover:underline">
                                                <span className="block truncate font-medium">{a.name}</span>
                                                <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                                                  {formatAssetTag(a.asset_tag) ?? `AST-${a.asset_tag}`} {a.serial_number ? `· ${a.serial_number}` : ""}
                                                </span>
                                              </Link>
                                            </td>
                                            <td className="px-3 py-2">
                                              <Badge variant="outline">{a.asset_type || "Sin tipo"}</Badge>
                                            </td>
                                            <td className="px-3 py-2">
                                              <AssetLifecycleBadge status={a.lifecycle_status} />
                                            </td>
                                            <td className="px-3 py-2">
                                              <AssetConnectivityBadge status={a.connectivity_status} compact />
                                            </td>
                                            <td className="max-w-[260px] px-3 py-2 text-xs text-muted-foreground">
                                              <span className="block truncate">{[a.floor ? `Piso ${a.floor}` : null, a.room].filter(Boolean).join(" · ") || "Sin detalle"}</span>
                                              <span className="block truncate">
                                                {a.last_seen_at ? `Última conexión: ${new Date(a.last_seen_at).toLocaleString()}` : "Sin telemetría"}
                                              </span>
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                              <span className={cn("font-mono text-xs", a.failure_risk_pct >= 80 ? "text-rose-200" : "text-muted-foreground")}>
                                                {a.failure_risk_pct}%
                                              </span>
                                            </td>
                                          </tr>
                                        ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ) : null}
                          </section>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
