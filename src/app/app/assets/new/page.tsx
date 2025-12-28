"use client";

import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { AppBootScreen, AppNoticeScreen } from "@/components/layout/AppStates";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { errorMessage } from "@/lib/error";
import { useProfile, useSession } from "@/lib/hooks";
import { supabase } from "@/lib/supabaseBrowser";
import type { AssetSite } from "@/lib/types";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Crosshair } from "lucide-react";

const LifecycleOptions: ComboboxOption[] = [
  { value: "Activo", label: "Activo" },
  { value: "En reparación", label: "En reparación" },
  { value: "Retirado", label: "Retirado" },
  { value: "Descartado", label: "Descartado" },
];

const AssetTypeOptions: ComboboxOption[] = [
  { value: "Laptop", label: "Laptop", keywords: "notebook portatil portátil" },
  { value: "Desktop", label: "Desktop", keywords: "pc torre workstation" },
  { value: "Monitor", label: "Monitor" },
  { value: "Impresora", label: "Impresora", keywords: "printer" },
  { value: "Scanner", label: "Scanner" },
  { value: "Router", label: "Router" },
  { value: "Switch", label: "Switch" },
  { value: "AP WiFi", label: "AP WiFi", keywords: "access point punto de acceso" },
  { value: "Servidor", label: "Servidor", keywords: "server" },
  { value: "UPS", label: "UPS", keywords: "no-break nobreak" },
  { value: "Teléfono", label: "Teléfono", keywords: "telefono teléfono IP voip" },
  { value: "Tablet", label: "Tablet" },
  { value: "Licencia", label: "Licencia", keywords: "software subscription suscripción" },
  { value: "Cuenta", label: "Cuenta", keywords: "acceso usuario" },
  { value: "Suscripción", label: "Suscripción", keywords: "subscription software" },
  { value: "Otro", label: "Otro" },
];

const AssetCategoryOptions: ComboboxOption[] = [
  { value: "Hardware", label: "Hardware" },
  { value: "Software", label: "Software" },
  { value: "Otro", label: "Otro" },
];

function suggestCategoryForType(assetType: string) {
  const t = assetType.trim().toLowerCase();
  if (!t) return "";
  const software = ["licencia", "suscripción", "suscripcion", "cuenta", "software", "aplicación", "aplicacion"];
  if (software.some((k) => t.includes(k))) return "Software";
  const hardware = [
    "laptop",
    "notebook",
    "desktop",
    "pc",
    "workstation",
    "monitor",
    "impresora",
    "scanner",
    "router",
    "switch",
    "wifi",
    "access point",
    "ap",
    "servidor",
    "server",
    "ups",
    "teléfono",
    "telefono",
    "tablet",
  ];
  if (hardware.some((k) => t.includes(k))) return "Hardware";
  return "Otro";
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371e3;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const x = s1 * s1 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * s2 * s2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export default function NewAssetPage() {
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error: profileError } = useProfile(session?.user.id);

  const canManage = profile?.role === "admin" || profile?.role === "supervisor";

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [serial, setSerial] = useState("");
  const [assetType, setAssetType] = useState("");
  const [category, setCategory] = useState("");
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [subcategory, setSubcategory] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [lifecycle, setLifecycle] = useState("Activo");
  const [region, setRegion] = useState("");
  const [comuna, setComuna] = useState("");
  const [siteId, setSiteId] = useState<string>("");
  const [sites, setSites] = useState<AssetSite[]>([]);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");
  const [room, setRoom] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [description, setDescription] = useState("");
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoNote, setGeoNote] = useState<string | null>(null);

  const isValid = useMemo(() => name.trim().length >= 2, [name]);

  useEffect(() => {
    const suggested = suggestCategoryForType(assetType);
    if (!suggested) return;
    if (!categoryTouched) setCategory(suggested);
  }, [assetType, categoryTouched]);

  useEffect(() => {
    let alive = true;
    async function loadSites() {
      if (!profile?.department_id) return;
      setSitesError(null);
      const { data, error } = await supabase
        .from("asset_sites")
        .select("id,department_id,name,region,comuna,address,latitude,longitude,radius_m,metadata,created_at,updated_at")
        .eq("department_id", profile.department_id)
        .order("name")
        .limit(2000);
      if (!alive) return;
      if (error) {
        setSites([]);
        setSitesError(error.message);
        return;
      }
      setSites((data ?? []) as unknown as AssetSite[]);
    }
    void loadSites();
    return () => {
      alive = false;
    };
  }, [profile?.department_id]);

  const siteOptions = useMemo<ComboboxOption[]>(
    () => sites.map((s) => ({ value: s.id, label: s.name, description: [s.comuna, s.region].filter(Boolean).join(" · ") })),
    [sites]
  );

  function applySite(s: AssetSite) {
    setSiteId(s.id);
    setGeoNote(null);
    if (s.region) setRegion(s.region);
    if (s.comuna) setComuna(s.comuna);
    if (s.address) setAddress(s.address);
    if (s.latitude != null) setLat(String(s.latitude));
    if (s.longitude != null) setLng(String(s.longitude));
  }

  async function onGeolocate() {
    setGeoLoading(true);
    setGeoNote(null);
    setError(null);
    try {
      if (!navigator.geolocation) throw new Error("Geolocalización no disponible en este dispositivo.");
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 });
      });
      const nextLat = Number(pos.coords.latitude);
      const nextLng = Number(pos.coords.longitude);
      if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) throw new Error("No se pudo leer tu ubicación.");

      setLat(nextLat.toFixed(6));
      setLng(nextLng.toFixed(6));

      const res = await fetch(`/api/geocode/reverse?lat=${encodeURIComponent(String(nextLat))}&lng=${encodeURIComponent(String(nextLng))}`);
      const body = (await res.json()) as { region?: string | null; comuna?: string | null; address?: string | null; error?: string };
      if (!res.ok) throw new Error(body?.error ?? "No se pudo traducir la ubicación.");

      if (typeof body.region === "string") setRegion(body.region);
      if (typeof body.comuna === "string") setComuna(body.comuna);
      if (typeof body.address === "string") setAddress(body.address);

      const candidates = sites
        .map((s) => {
          if (s.latitude == null || s.longitude == null) return null;
          const radius = Number.isFinite(s.radius_m) ? s.radius_m : 250;
          const d = distanceMeters(nextLat, nextLng, Number(s.latitude), Number(s.longitude));
          return { site: s, d, radius };
        })
        .filter(Boolean) as Array<{ site: AssetSite; d: number; radius: number }>;
      candidates.sort((a, b) => a.d - b.d);
      const best = candidates.find((c) => c.d <= c.radius) ?? null;
      if (best) {
        setSiteId(best.site.id);
        setGeoNote(`Sucursal detectada: ${best.site.name} (${Math.round(best.d)}m)`);
      } else {
        setGeoNote("Ubicación guardada. No se detectó una sucursal cercana.");
      }
    } catch (e: unknown) {
      setGeoNote(e instanceof Error ? e.message : "No se pudo geolocalizar.");
    } finally {
      setGeoLoading(false);
    }
  }

  async function onCreate() {
    if (!profile) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        department_id: profile.department_id,
        name: name.trim(),
        serial_number: serial.trim() || null,
        asset_type: assetType.trim() || null,
        category: category.trim() || null,
        subcategory: subcategory.trim() || null,
        manufacturer: manufacturer.trim() || null,
        model: model.trim() || null,
        lifecycle_status: lifecycle,
        region: region.trim() || null,
        comuna: comuna.trim() || null,
        site_id: siteId.trim() || null,
        building: building.trim() || null,
        floor: floor.trim() || null,
        room: room.trim() || null,
        address: address.trim() || null,
        latitude: lat.trim() ? Number(lat) : null,
        longitude: lng.trim() ? Number(lng) : null,
        description: description.trim() || null,
      };

      const { data, error } = await supabase.from("assets").insert(payload).select("id").single();
      if (error) throw error;
      window.location.href = `/app/assets/${data.id}`;
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  }

  if (sessionLoading || profileLoading) return <AppBootScreen />;
  if (!session) return <AppNoticeScreen title="Inicia sesión" description="Debes iniciar sesión para crear activos." />;
  if (!profile) return <AppNoticeScreen title="No se pudo cargar tu perfil" description={profileError ?? "Intenta nuevamente."} />;
  if (!canManage) return <AppNoticeScreen title="Sin permisos" description="Solo supervisor/admin puede crear activos." />;
  if (!profile.department_id) return <AppNoticeScreen title="Área requerida" description="Tu usuario debe tener un área/departamento asignado." />;

  return (
    <AppShell profile={profile}>
      <div className="space-y-5">
        <PageHeader
          kicker={
            <Link href="/app/assets" className="hover:underline">
              ← Volver a activos
            </Link>
          }
          title="Nuevo activo"
          description="Registra un activo manualmente. Luego podrás asignarlo a un usuario y verlo en el mapa."
          actions={
            <>
              <Button asChild variant="outline">
                <Link href="/app/assets/import">Importar CSV</Link>
              </Button>
              <Button onClick={onCreate} disabled={!isValid || saving}>
                {saving ? "Creando…" : "Crear"}
              </Button>
            </>
          }
        />

        {error ? <InlineAlert variant="error" title="No se pudo crear el activo" description={error} /> : null}

        <Card className="tech-border">
          <CardHeader>
            <CardTitle>Datos del activo</CardTitle>
            <CardDescription>Completa al menos el nombre. Serial y ubicación ayudan a trazabilidad y mapa.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            <label className="block">
              <div className="text-xs text-muted-foreground">Nombre *</div>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder='Ej: "Laptop-Santiago-001"' />
            </label>
            <label className="block">
              <div className="text-xs text-muted-foreground">Serial</div>
              <Input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Ej: ABC123XYZ" />
            </label>
            <label className="block">
              <div className="text-xs text-muted-foreground">Tipo</div>
              <Combobox
                value={assetType.trim() ? assetType : null}
                onValueChange={(v) => setAssetType(v ?? "")}
                options={AssetTypeOptions}
                allowCustom
                placeholder="Ej: Laptop, Impresora, Switch…"
                searchPlaceholder="Buscar tipo…"
              />
            </label>
            <label className="block">
              <div className="text-xs text-muted-foreground">Categoría</div>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Combobox
                    value={category.trim() ? category : null}
                    onValueChange={(v) => {
                      setCategory(v ?? "");
                      setCategoryTouched(true);
                    }}
                    options={AssetCategoryOptions}
                    allowCustom
                    placeholder="Hardware / Software / Otro"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!categoryTouched}
                  onClick={() => {
                    setCategoryTouched(false);
                    setCategory(suggestCategoryForType(assetType));
                  }}
                >
                  Auto
                </Button>
              </div>
            </label>
            <label className="block">
              <div className="text-xs text-muted-foreground">Subcategoría</div>
              <Input value={subcategory} onChange={(e) => setSubcategory(e.target.value)} placeholder="Ej: Dell, HP, Kyocera…" />
            </label>
            <label className="block">
              <div className="text-xs text-muted-foreground">Estado (ciclo de vida)</div>
              <Combobox value={lifecycle} onValueChange={(v) => setLifecycle(v ?? "Activo")} options={LifecycleOptions} />
            </label>
            <label className="block">
              <div className="text-xs text-muted-foreground">Marca</div>
              <Input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="Ej: Dell" />
            </label>
            <label className="block">
              <div className="text-xs text-muted-foreground">Modelo</div>
              <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Ej: XPS 13" />
            </label>

            <div className="lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">Ubicación</div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" onClick={onGeolocate} disabled={geoLoading}>
                    <Crosshair className="h-4 w-4" />
                    {geoLoading ? "Ubicando…" : "Geolocalizar"}
                  </Button>
                </div>
              </div>
              {geoNote ? <div className="mt-2 text-sm text-muted-foreground">{geoNote}</div> : null}
              {sitesError ? <div className="mt-2 text-xs text-muted-foreground">Sucursales: {sitesError}</div> : null}
              <div className="grid gap-4 lg:grid-cols-3">
                <label className="block">
                  <div className="text-xs text-muted-foreground">Región</div>
                  <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Ej: Metropolitana" />
                </label>
                <label className="block">
                  <div className="text-xs text-muted-foreground">Comuna</div>
                  <Input value={comuna} onChange={(e) => setComuna(e.target.value)} placeholder="Ej: Santiago" />
                </label>
                <label className="block">
                  <div className="text-xs text-muted-foreground">Sucursal/Local</div>
                  <Combobox
                    value={siteId.trim() ? siteId : null}
                    onValueChange={(v) => {
                      const next = v ?? "";
                      setSiteId(next);
                      const s = sites.find((x) => x.id === next) ?? null;
                      if (s) applySite(s);
                    }}
                    options={siteOptions}
                    placeholder={siteOptions.length ? "Seleccionar…" : "Sin sucursales"}
                    disabled={!siteOptions.length}
                  />
                </label>
                <label className="block">
                  <div className="text-xs text-muted-foreground">Piso</div>
                  <Input value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="Ej: 3" />
                </label>
                <label className="block">
                  <div className="text-xs text-muted-foreground">Sala/Cubículo</div>
                  <Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Ej: 301-B" />
                </label>
                <label className="block">
                  <div className="text-xs text-muted-foreground">Dirección</div>
                  <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Ej: Av. Siempre Viva 123" />
                </label>
                <label className="block">
                  <div className="text-xs text-muted-foreground">Edificio/Detalle</div>
                  <Input value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="Ej: Torre A" />
                </label>
                <label className="block">
                  <div className="text-xs text-muted-foreground">Latitud</div>
                  <Input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-33.44" />
                </label>
                <label className="block">
                  <div className="text-xs text-muted-foreground">Longitud</div>
                  <Input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-70.65" />
                </label>
              </div>
            </div>

            <label className="block lg:col-span-2">
              <div className="text-xs text-muted-foreground">Descripción</div>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Notas de identificación, contexto, etc." />
            </label>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
