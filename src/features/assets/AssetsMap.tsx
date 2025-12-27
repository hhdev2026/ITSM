"use client";

import dynamic from "next/dynamic";
import * as React from "react";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { supabase } from "@/lib/supabaseBrowser";
import type { Asset } from "@/lib/types";
import { formatAssetTag } from "@/lib/assetTag";
import { AssetConnectivityBadge, AssetLifecycleBadge } from "@/components/assets/AssetBadges";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import Link from "next/link";
import { cn } from "@/lib/cn";

const MapContainer = dynamic(() => import("react-leaflet").then((m) => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then((m) => m.TileLayer), { ssr: false });
const Marker = dynamic(() => import("react-leaflet").then((m) => m.Marker), { ssr: false });
const Popup = dynamic(() => import("react-leaflet").then((m) => m.Popup), { ssr: false });

type MapAsset = Pick<
  Asset,
  | "id"
  | "asset_tag"
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
  | "address"
  | "latitude"
  | "longitude"
  | "lifecycle_status"
  | "connectivity_status"
  | "last_seen_at"
>;

function uniqueOptions(values: Array<string | null | undefined>, allLabel: string): ComboboxOption[] {
  const set = new Set<string>();
  for (const v of values) {
    const s = typeof v === "string" ? v.trim() : "";
    if (s) set.add(s);
  }
  return [{ value: "__all__", label: allLabel }, ...Array.from(set).sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }))];
}

export function AssetsMap() {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [assets, setAssets] = React.useState<MapAsset[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [conn, setConn] = React.useState<string>("__all__");
  const [region, setRegion] = React.useState<string>("__all__");
  const [comuna, setComuna] = React.useState<string>("__all__");

  const selected = React.useMemo(() => assets.find((a) => a.id === selectedId) ?? null, [assets, selectedId]);

  React.useEffect(() => {
    let alive = true;
    import("leaflet").then((mod) => {
      if (!alive) return;
      const L = mod.default ?? mod;
      (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl = undefined;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: markerIcon2x.src,
        iconUrl: markerIcon.src,
        shadowUrl: markerShadow.src,
      });
    });
    return () => {
      alive = false;
    };
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from("assets")
        .select(
          "id,asset_tag,name,serial_number,asset_type,category,subcategory,region,comuna,building,floor,room,address,latitude,longitude,lifecycle_status,connectivity_status,last_seen_at"
        )
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .limit(5000);

      const qq = q.trim();
      if (qq) {
        const like = `%${qq.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
        query = query.or(`name.ilike.${like},serial_number.ilike.${like},asset_type.ilike.${like},category.ilike.${like},subcategory.ilike.${like}`);
      }
      if (conn !== "__all__") query = query.eq("connectivity_status", conn);
      if (region !== "__all__") query = query.eq("region", region);
      if (comuna !== "__all__") query = query.eq("comuna", comuna);

      const { data, error } = await query;
      if (error) throw error;
      setAssets((data ?? []) as unknown as MapAsset[]);
      if (selectedId && !(data ?? []).some((a) => (a as { id: string }).id === selectedId)) setSelectedId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el mapa");
    } finally {
      setLoading(false);
    }
  }, [q, conn, region, comuna, selectedId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const regionOptions = React.useMemo(() => uniqueOptions(assets.map((a) => a.region), "Todas"), [assets]);
  const comunaOptions = React.useMemo(() => uniqueOptions(assets.map((a) => a.comuna), "Todas"), [assets]);
  const connOptions = React.useMemo(() => uniqueOptions(assets.map((a) => a.connectivity_status), "Todos"), [assets]);

  const center = React.useMemo(() => {
    if (selected?.latitude != null && selected?.longitude != null) return [selected.latitude, selected.longitude] as [number, number];
    return [-33.45, -70.66] as [number, number];
  }, [selected]);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
      <div className="rounded-2xl border border-border bg-card/30 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-[240px] flex-1">
            <div className="text-xs text-muted-foreground">Buscar</div>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej: Laptop, ABC123, Impresora…" />
          </label>
          <label className="block min-w-[180px]">
            <div className="text-xs text-muted-foreground">Conectividad</div>
            <Combobox value={conn} onValueChange={(v) => setConn(v ?? "__all__")} options={connOptions} placeholder="Todos" />
          </label>
          <label className="block min-w-[200px]">
            <div className="text-xs text-muted-foreground">Región</div>
            <Combobox value={region} onValueChange={(v) => setRegion(v ?? "__all__")} options={regionOptions} placeholder="Todas" />
          </label>
          <label className="block min-w-[200px]">
            <div className="text-xs text-muted-foreground">Comuna</div>
            <Combobox value={comuna} onValueChange={(v) => setComuna(v ?? "__all__")} options={comunaOptions} placeholder="Todas" />
          </label>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? "Cargando…" : "Actualizar"}
          </Button>
        </div>

        {error ? <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}

        <div className="mt-3 h-[68vh] overflow-hidden rounded-2xl border border-border">
          <MapContainer center={center} zoom={12} scrollWheelZoom className="h-full w-full">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {assets.map((a) => {
              if (a.latitude == null || a.longitude == null) return null;
              return (
                <Marker
                  key={a.id}
                  position={[a.latitude, a.longitude]}
                  eventHandlers={{
                    click: () => setSelectedId(a.id),
                  }}
                >
                  <Popup>
                    <div className="space-y-1">
                      <div className="font-semibold">{a.name}</div>
                      <div className="text-xs text-muted-foreground">{formatAssetTag(a.asset_tag) ?? `AST-${a.asset_tag}`}</div>
                      <div className="flex flex-wrap gap-2">
                        <AssetLifecycleBadge status={a.lifecycle_status} />
                        <AssetConnectivityBadge status={a.connectivity_status} />
                      </div>
                      <div className="pt-1">
                        <Link href={`/app/assets/${a.id}`} className="text-sm underline">
                          Ver detalle
                        </Link>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card/30 p-4">
        <div className="text-lg font-semibold">Detalle</div>
        <div className="text-sm text-muted-foreground">Selecciona un marcador para ver información y acciones.</div>

        {selected ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-full border border-border bg-muted/30 px-2 py-1 font-mono text-xs">
                {formatAssetTag(selected.asset_tag) ?? `AST-${selected.asset_tag}`}
              </div>
              {selected.asset_type ? <div className="rounded-full border border-border bg-muted/30 px-2 py-1 text-xs">{selected.asset_type}</div> : null}
              <AssetLifecycleBadge status={selected.lifecycle_status} />
              <AssetConnectivityBadge status={selected.connectivity_status} />
            </div>
            <div className="text-base font-semibold">{selected.name}</div>
            <div className="text-sm text-muted-foreground">
              {[selected.region, selected.comuna, selected.building, selected.floor ? `Piso ${selected.floor}` : null, selected.room]
                .filter(Boolean)
                .join(" · ") || "Sin ubicación"}
            </div>
            {selected.address ? <div className="text-sm text-muted-foreground">{selected.address}</div> : null}
            {selected.serial_number ? <div className="text-sm text-muted-foreground">Serial: <span className="font-mono">{selected.serial_number}</span></div> : null}
            {selected.last_seen_at ? (
              <div className="text-sm text-muted-foreground">Última conexión: {new Date(selected.last_seen_at).toLocaleString()}</div>
            ) : (
              <div className="text-sm text-muted-foreground">Sin telemetría</div>
            )}
            <div className="flex items-center gap-2">
              <Button asChild>
                <Link href={`/app/assets/${selected.id}`}>Abrir ficha</Link>
              </Button>
              <Button variant="outline" onClick={() => setSelectedId(null)}>
                Limpiar
              </Button>
            </div>
          </div>
        ) : (
          <div className={cn("mt-4 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground")}>
            No hay activo seleccionado.
          </div>
        )}
      </div>
    </div>
  );
}
