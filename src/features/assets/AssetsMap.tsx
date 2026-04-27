"use client";

import dynamic from "next/dynamic";
import * as React from "react";
import { supabase } from "@/lib/supabaseBrowser";
import type { Asset } from "@/lib/types";
import { AssetConnectivityBadge, AssetLifecycleBadge } from "@/components/assets/AssetBadges";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { AlertTriangle, Monitor, Wifi, WifiOff } from "lucide-react";

// ── Leaflet CSS loaded dynamically to avoid SSR crash ──────────────────────
if (typeof window !== "undefined") {
  const id = "leaflet-css";
  if (!document.getElementById(id)) {
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);
  }
}

// ── Leaflet components — all dynamic, no SSR ───────────────────────────────
const MapContainer = dynamic(
  () => import("react-leaflet").then((m) => m.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((m) => m.TileLayer),
  { ssr: false }
);
const CircleMarker = dynamic(
  () => import("react-leaflet").then((m) => m.CircleMarker),
  { ssr: false }
);
const Tooltip = dynamic(
  () => import("react-leaflet").then((m) => m.Tooltip),
  { ssr: false }
);

// ── Types ──────────────────────────────────────────────────────────────────
type MapAsset = Pick<
  Asset,
  | "id"
  | "asset_tag"
  | "name"
  | "serial_number"
  | "asset_type"
  | "region"
  | "comuna"
  | "building"
  | "floor"
  | "room"
  | "address"
  | "latitude"
  | "longitude"
  | "lifecycle_status"
  | "connectivity_status"
  | "last_seen_at"
>;

interface LocationGroup {
  key: string;
  lat: number;
  lng: number;
  building: string;
  region: string;
  comuna: string;
  address: string | null;
  assets: MapAsset[];
  total: number;
  online: number;
  problems: number;
}

function uniqueOptions(
  values: Array<string | null | undefined>,
  allLabel: string
): ComboboxOption[] {
  const set = new Set<string>();
  for (const v of values) {
    const s = typeof v === "string" ? v.trim() : "";
    if (s) set.add(s);
  }
  return [
    { value: "__all__", label: allLabel },
    ...Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((v) => ({ value: v, label: v })),
  ];
}

function groupByLocation(assets: MapAsset[]): LocationGroup[] {
  const map = new Map<string, LocationGroup>();
  for (const a of assets) {
    if (a.latitude == null || a.longitude == null) continue;
    const key = `${a.latitude.toFixed(5)}|${a.longitude.toFixed(5)}`;
    const existing = map.get(key) ?? {
      key,
      lat: a.latitude as number,
      lng: a.longitude as number,
      building: a.building ?? "Sin establecimiento",
      region: a.region ?? "",
      comuna: a.comuna ?? "",
      address: a.address ?? null,
      assets: [],
      total: 0,
      online: 0,
      problems: 0,
    };
    existing.assets.push(a);
    existing.total += 1;
    if (a.connectivity_status === "Online") existing.online += 1;
    if (a.connectivity_status === "Offline" || a.connectivity_status === "Crítico")
      existing.problems += 1;
    map.set(key, existing);
  }
  return Array.from(map.values()).sort((a, b) => b.problems - a.problems);
}

function markerColor(g: LocationGroup): string {
  if (g.problems > 0) return "#f43f5e"; // rose
  if (g.online === g.total) return "#10b981"; // emerald
  return "#f59e0b"; // amber
}

function markerRadius(total: number): number {
  if (total >= 20) return 18;
  if (total >= 10) return 14;
  if (total >= 5) return 11;
  return 8;
}

// ── Main component ─────────────────────────────────────────────────────────
export function AssetsMap() {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [assets, setAssets] = React.useState<MapAsset[]>([]);
  const [selected, setSelected] = React.useState<LocationGroup | null>(null);
  const [q, setQ] = React.useState("");
  const [conn, setConn] = React.useState<string>("__all__");
  const [region, setRegion] = React.useState<string>("__all__");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from("assets")
        .select(
          "id,asset_tag,name,serial_number,asset_type,region,comuna,building,floor,room,address,latitude,longitude,lifecycle_status,connectivity_status,last_seen_at"
        )
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .limit(5000);

      const qq = q.trim();
      if (qq) {
        const like = `%${qq.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
        query = query.or(`name.ilike.${like},building.ilike.${like},comuna.ilike.${like}`);
      }
      if (conn !== "__all__") query = query.eq("connectivity_status", conn);
      if (region !== "__all__") query = query.eq("region", region);

      const { data, error } = await query;
      if (error) throw error;
      setAssets((data ?? []) as unknown as MapAsset[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el mapa");
    } finally {
      setLoading(false);
    }
  }, [q, conn, region]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const groups = React.useMemo(() => groupByLocation(assets), [assets]);
  const regionOptions = React.useMemo(
    () => uniqueOptions(assets.map((a) => a.region), "Todas las regiones"),
    [assets]
  );
  const connOptions = React.useMemo(
    () => uniqueOptions(assets.map((a) => a.connectivity_status), "Todos"),
    [assets]
  );

  const totalOnline = groups.reduce((s, g) => s + g.online, 0);
  const totalProblems = groups.reduce((s, g) => s + g.problems, 0);
  const totalAssets = groups.reduce((s, g) => s + g.total, 0);

  // Chile center
  const mapCenter: [number, number] = [-35.5, -71.2];

  return (
    <div className="flex h-[calc(100vh-160px)] min-h-[600px] flex-col gap-4">
      {/* ── Top toolbar ── */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card/40 px-4 py-3 backdrop-blur">
        <label className="block min-w-[220px] flex-1">
          <div className="mb-1 text-xs text-muted-foreground">Buscar establecimiento</div>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Hospital, CESFAM, SEREMI…"
          />
        </label>
        <label className="block min-w-[200px]">
          <div className="mb-1 text-xs text-muted-foreground">Región</div>
          <Combobox
            value={region}
            onValueChange={(v) => setRegion(v ?? "__all__")}
            options={regionOptions}
            placeholder="Todas las regiones"
          />
        </label>
        <label className="block min-w-[180px]">
          <div className="mb-1 text-xs text-muted-foreground">Conectividad</div>
          <Combobox
            value={conn}
            onValueChange={(v) => setConn(v ?? "__all__")}
            options={connOptions}
            placeholder="Todos"
          />
        </label>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? "Cargando…" : "Actualizar"}
        </Button>

        {/* Live stats */}
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
            <Wifi className="h-3 w-3" />
            {totalOnline} online
          </div>
          <div className={cn(
            "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
            totalProblems > 0
              ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
              : "border-border bg-muted/20 text-muted-foreground"
          )}>
            {totalProblems > 0 ? <AlertTriangle className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {totalProblems} con problemas
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
            <Monitor className="h-3 w-3" />
            {totalAssets} equipos · {groups.length} sedes
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {/* ── Map + side panel ── */}
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1fr_380px]">
        {/* Map */}
        <div className="relative overflow-hidden rounded-2xl border border-border shadow-xl">
          {loading && (
            <div className="absolute inset-0 z-[9999] flex items-center justify-center bg-background/60 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="text-sm text-muted-foreground">Cargando mapa…</span>
              </div>
            </div>
          )}

          <MapContainer
            center={mapCenter}
            zoom={5}
            scrollWheelZoom
            style={{ height: "100%", width: "100%", background: "#0f172a" }}
          >
            <TileLayer
              attribution='&copy; <a href="https://carto.com/">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />

            {groups.map((g) => {
              const color = markerColor(g);
              const radius = markerRadius(g.total);
              const isSelected = selected?.key === g.key;

              return (
                <CircleMarker
                  key={g.key}
                  center={[g.lat, g.lng]}
                  radius={isSelected ? radius + 4 : radius}
                  pathOptions={{
                    fillColor: color,
                    fillOpacity: isSelected ? 0.95 : 0.78,
                    color: isSelected ? "#fff" : color,
                    weight: isSelected ? 2.5 : 1,
                  }}
                  eventHandlers={{ click: () => setSelected(g) }}
                >
                  <Tooltip direction="top" offset={[0, -radius]} opacity={0.95}>
                    <div style={{ fontFamily: "sans-serif", fontSize: 12, lineHeight: 1.5 }}>
                      <strong>{g.building}</strong>
                      <br />
                      {g.comuna} · {g.region}
                      <br />
                      {g.total} equipo{g.total !== 1 ? "s" : ""} · {g.online} online
                      {g.problems > 0 ? ` · ⚠ ${g.problems} problema${g.problems !== 1 ? "s" : ""}` : ""}
                    </div>
                  </Tooltip>
                </CircleMarker>
              );
            })}
          </MapContainer>

          {/* Legend */}
          <div className="absolute bottom-4 left-4 z-[1000] rounded-xl border border-border bg-background/80 px-3 py-2 text-xs backdrop-blur">
            <div className="mb-1 font-medium text-foreground">Estado</div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-emerald-500" />
                <span className="text-muted-foreground">Todos online</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-amber-500" />
                <span className="text-muted-foreground">Parcial</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-rose-500" />
                <span className="text-muted-foreground">Con problemas</span>
              </div>
            </div>
          </div>
        </div>

        {/* Side panel */}
        <div className="flex flex-col gap-3 overflow-y-auto">
          {selected ? (
            <div className="rounded-2xl border border-border bg-card/60 p-4 backdrop-blur">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <div className="text-base font-semibold leading-tight">{selected.building}</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    {selected.comuna} · {selected.region}
                  </div>
                  {selected.address && (
                    <div className="mt-0.5 text-xs text-muted-foreground">{selected.address}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent/30"
                >
                  ✕
                </button>
              </div>

              {/* Stats row */}
              <div className="mb-4 grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-border bg-muted/20 p-2 text-center">
                  <div className="text-lg font-bold">{selected.total}</div>
                  <div className="text-[11px] text-muted-foreground">Total</div>
                </div>
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-center">
                  <div className="text-lg font-bold text-emerald-300">{selected.online}</div>
                  <div className="text-[11px] text-emerald-400">Online</div>
                </div>
                <div className={cn(
                  "rounded-lg border p-2 text-center",
                  selected.problems > 0
                    ? "border-rose-500/30 bg-rose-500/10"
                    : "border-border bg-muted/20"
                )}>
                  <div className={cn("text-lg font-bold", selected.problems > 0 ? "text-rose-300" : "")}>
                    {selected.problems}
                  </div>
                  <div className={cn("text-[11px]", selected.problems > 0 ? "text-rose-400" : "text-muted-foreground")}>
                    Problemas
                  </div>
                </div>
              </div>

              {/* Asset list */}
              <div className="space-y-1.5">
                {selected.assets
                  .slice()
                  .sort((a, b) => {
                    const score = (x: MapAsset) =>
                      x.connectivity_status === "Crítico" ? 3 :
                      x.connectivity_status === "Offline" ? 2 : 0;
                    return score(b) - score(a);
                  })
                  .map((a) => (
                    <Link
                      key={a.id}
                      href={`/app/assets/${a.id}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/40 px-3 py-2 text-sm transition-colors hover:bg-accent/20"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{a.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {a.asset_type}
                          {a.floor ? ` · Piso ${a.floor}` : ""}
                          {a.room ? ` · ${a.room}` : ""}
                        </div>
                      </div>
                      <AssetConnectivityBadge status={a.connectivity_status} compact />
                    </Link>
                  ))}
              </div>
            </div>
          ) : (
            /* Region summary list */
            <div className="space-y-2">
              <div className="px-1 text-xs font-medium text-muted-foreground">
                {groups.length} sedes con equipos — haz clic en un punto del mapa
              </div>
              {groups.map((g) => {
                const color = markerColor(g);
                return (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => setSelected(g)}
                    className="w-full rounded-xl border border-border bg-card/40 px-4 py-3 text-left transition-colors hover:bg-accent/20"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span className="truncate text-sm font-medium">{g.building}</span>
                      <div className="ml-auto flex shrink-0 items-center gap-2">
                        {g.problems > 0 && (
                          <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-300 text-[10px]">
                            ⚠ {g.problems}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px]">
                          {g.total} eq.
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-0.5 pl-4 text-xs text-muted-foreground">
                      {g.comuna} · {g.region}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
