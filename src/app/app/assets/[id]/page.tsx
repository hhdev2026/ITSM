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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { formatAssetTag } from "@/lib/assetTag";
import { errorMessage } from "@/lib/error";
import { useAccessToken, useProfile, useSession } from "@/lib/hooks";
import { supabase } from "@/lib/supabaseBrowser";
import type { Asset, AssetAlert, AssetAssignment, AssetManufacturer, AssetModel, AssetSubcategory, Profile } from "@/lib/types";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { apiFetch } from "@/lib/apiClient";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { NetlockRemotePanel } from "@/components/netlock/NetlockRemotePanel";

type ConnectivityEvent = {
  id: string;
  asset_id: string;
  status: Asset["connectivity_status"];
  occurred_at: string;
  ip: string | null;
  mac: string | null;
  hostname: string | null;
  network_type: string | null;
};

const LifecycleOptions: ComboboxOption[] = [
  { value: "Activo", label: "Activo" },
  { value: "En reparación", label: "En reparación" },
  { value: "Retirado", label: "Retirado" },
  { value: "Descartado", label: "Descartado" },
];

function profileLabel(p: { full_name: string | null; email: string }) {
  return p.full_name?.trim() || p.email;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function getNetlockMeta(asset: Asset) {
  const meta = (asset as unknown as { metadata?: unknown }).metadata;
  if (!isRecord(meta)) return null;
  const netlock = meta.netlock;
  if (!isRecord(netlock)) return null;
  return netlock;
}

type RmmSnapshotRow = {
  kind: string;
  source_ts: string | null;
  payload: unknown;
  updated_at: string;
};

type NetlockApp = {
  name: string;
  vendor: string | null;
  version: string | null;
  installed_date: string | null;
  installation_path: string | null;
};

type NetlockEvent = {
  id: number | null;
  date: string | null;
  severity: number | null;
  type: number | null;
  reported_by: string | null;
  description: string | null;
};

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseNetlockApps(payload: unknown): NetlockApp[] {
  if (!payload) return [];
  const raw = isRecord(payload) ? payload.apps : payload;
  if (!Array.isArray(raw)) return [];
  const out: NetlockApp[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) continue;
    out.push({
      name,
      vendor: typeof item.vendor === "string" && item.vendor.trim() ? item.vendor.trim() : null,
      version: typeof item.version === "string" && item.version.trim() ? item.version.trim() : null,
      installed_date: typeof item.installed_date === "string" && item.installed_date.trim() ? item.installed_date.trim() : null,
      installation_path: typeof item.installation_path === "string" && item.installation_path.trim() ? item.installation_path.trim() : null,
    });
  }
  return out;
}

function parseNetlockEvents(payload: unknown): NetlockEvent[] {
  if (!payload || !isRecord(payload)) return [];
  const raw = payload.events;
  if (!Array.isArray(raw)) return [];
  const out: NetlockEvent[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    out.push({
      id: typeof item.id === "number" ? item.id : typeof item.id === "string" ? toNumber(item.id) : null,
      date: typeof item.date === "string" && item.date.trim() ? item.date.trim() : null,
      severity: typeof item.severity === "number" ? item.severity : typeof item.severity === "string" ? toNumber(item.severity) : null,
      type: typeof item.type === "number" ? item.type : typeof item.type === "string" ? toNumber(item.type) : null,
      reported_by: typeof item.reported_by === "string" && item.reported_by.trim() ? item.reported_by.trim() : null,
      description: typeof item.description === "string" && item.description.trim() ? item.description.trim() : null,
    });
  }
  return out;
}

function severityLabel(sev: number | null) {
  if (sev == null) return { label: "info", className: "bg-sky-500/10 text-sky-200 ring-1 ring-sky-500/20" };
  if (sev >= 3) return { label: "crítico", className: "bg-rose-500/15 text-rose-200 ring-1 ring-rose-500/25" };
  if (sev >= 2) return { label: "advertencia", className: "bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/25" };
  return { label: "info", className: "bg-sky-500/10 text-sky-200 ring-1 ring-sky-500/20" };
}

function pickString(obj: unknown, keys: string[]) {
  if (!isRecord(obj)) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function pickNumber(obj: unknown, keys: string[]) {
  if (!isRecord(obj)) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

export default function AssetDetailPage() {
  const params = useParams<{ id: string }>();
  const assetId = params?.id;
  const token = useAccessToken();

  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error: profileError } = useProfile(session?.user.id);

  const canManage = profile?.role === "admin" || profile?.role === "supervisor";
  const canManageRmm = profile?.role === "admin" || profile?.role === "supervisor" || profile?.role === "agent";

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [asset, setAsset] = useState<Asset | null>(null);
  const [assignments, setAssignments] = useState<AssetAssignment[]>([]);
  const [events, setEvents] = useState<ConnectivityEvent[]>([]);
  const [alerts, setAlerts] = useState<AssetAlert[]>([]);
  const [rmmSnapshots, setRmmSnapshots] = useState<RmmSnapshotRow[]>([]);
  const [profiles, setProfiles] = useState<Array<Pick<Profile, "id" | "email" | "full_name" | "role">>>([]);

  const canCaptureLocation = useMemo(() => {
    if (!profile) return false;
    if (canManage) return true;
    const open = assignments.filter((a) => !a.ended_at);
    return open.some((a) => a.user_id === profile.id);
  }, [assignments, canManage, profile]);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [serial, setSerial] = useState("");
  const [assetType, setAssetType] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [lifecycle, setLifecycle] = useState("Activo");
  const [region, setRegion] = useState("");
  const [comuna, setComuna] = useState("");
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");
  const [room, setRoom] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [description, setDescription] = useState("");
  const [adminNotes, setAdminNotes] = useState("");

  const [manufacturers, setManufacturers] = useState<AssetManufacturer[]>([]);
  const [models, setModels] = useState<AssetModel[]>([]);
  const [subcategories, setSubcategories] = useState<AssetSubcategory[]>([]);
  const [picklistsError, setPicklistsError] = useState<string | null>(null);

  const [appsQuery, setAppsQuery] = useState("");
  const [appsExpanded, setAppsExpanded] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false);

  const assigneeByRole = useMemo(() => {
    const open = assignments.filter((a) => !a.ended_at);
    const map = new Map<string, string>();
    for (const a of open) map.set(a.role, a.user_id);
    return map;
  }, [assignments]);

  const userOptions = useMemo<ComboboxOption[]>(() => {
    const base: ComboboxOption[] = [{ value: "__none__", label: "Sin asignar" }];
    const list = profiles
      .slice()
      .sort((a, b) => profileLabel(a).localeCompare(profileLabel(b)))
      .map((p) => ({ value: p.id, label: `${profileLabel(p)} · ${p.role}` }));
    return base.concat(list);
  }, [profiles]);

  const load = useCallback(async () => {
    if (!assetId || !profile) return;
    setLoading(true);
    setError(null);
    setGeoError(null);
    try {
      const { data: a, error: aErr } = await supabase.from("assets").select("*").eq("id", assetId).single();
      if (aErr) throw aErr;

      const { data: asg, error: asgErr } = await supabase
        .from("asset_assignments")
        .select("id,asset_id,user_id,role,assigned_by,assigned_at,ended_at,notes")
        .eq("asset_id", assetId)
        .order("assigned_at", { ascending: false })
        .limit(200);
      if (asgErr) throw asgErr;

      const { data: ev, error: evErr } = await supabase
        .from("asset_connectivity_events")
        .select("id,asset_id,status,occurred_at,ip,mac,hostname,network_type")
        .eq("asset_id", assetId)
        .order("occurred_at", { ascending: false })
        .limit(50);
      if (evErr) throw evErr;

      const { data: al, error: alErr } = await supabase
        .from("asset_alerts")
        .select("id,asset_id,kind,severity,status,title,message,opened_at,resolved_at")
        .eq("asset_id", assetId)
        .order("opened_at", { ascending: false })
        .limit(50);
      if (alErr) throw alErr;

      const profilesQuery = supabase.from("profiles").select("id,email,full_name,role").limit(2000);
      const { data: ps, error: psErr } = profile.department_id ? await profilesQuery.eq("department_id", profile.department_id) : await profilesQuery;
      // If profiles RLS is misconfigured, don't break the whole asset page.
      if (psErr) {
        setProfiles([]);
      }

      const { data: snaps, error: snapErr } = await supabase
        .from("rmm_snapshots")
        .select("kind,source_ts,payload,updated_at")
        .eq("asset_id", assetId)
        .eq("provider", "netlock")
        .in("kind", ["device", "hardware", "apps_installed", "events_recent"])
        .order("updated_at", { ascending: false })
        .limit(20);
      if (snapErr) throw snapErr;

      const assetRow = a as unknown as Asset;
      setAsset(assetRow);
      setAssignments((asg ?? []) as unknown as AssetAssignment[]);
      setEvents((ev ?? []) as unknown as ConnectivityEvent[]);
      setAlerts((al ?? []) as unknown as AssetAlert[]);
      setRmmSnapshots((snaps ?? []) as unknown as RmmSnapshotRow[]);
      setProfiles((ps ?? []) as unknown as Array<Pick<Profile, "id" | "email" | "full_name" | "role">>);

      setName(assetRow.name ?? "");
      setSerial(assetRow.serial_number ?? "");
      setAssetType(assetRow.asset_type ?? "");
      setCategory(assetRow.category ?? "");
      setSubcategory(assetRow.subcategory ?? "");
      setManufacturer((assetRow as unknown as { manufacturer?: string | null }).manufacturer ?? "");
      setModel((assetRow as unknown as { model?: string | null }).model ?? "");
      setLifecycle(assetRow.lifecycle_status ?? "Activo");
      setRegion(assetRow.region ?? "");
      setComuna(assetRow.comuna ?? "");
      setBuilding(assetRow.building ?? "");
      setFloor(assetRow.floor ?? "");
      setRoom(assetRow.room ?? "");
      setAddress(assetRow.address ?? "");
      setLat(assetRow.latitude != null ? String(assetRow.latitude) : "");
      setLng(assetRow.longitude != null ? String(assetRow.longitude) : "");
      setDescription((assetRow as unknown as { description?: string | null }).description ?? "");
      setAdminNotes((assetRow as unknown as { admin_notes?: string | null }).admin_notes ?? "");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [assetId, profile]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    async function loadPicklists() {
      if (!profile?.department_id) return;
      setPicklistsError(null);

      const [mRes, moRes, scRes] = await Promise.all([
        supabase
          .from("asset_manufacturers")
          .select("id,department_id,name,metadata,created_at,updated_at")
          .eq("department_id", profile.department_id)
          .order("name")
          .limit(5000),
        supabase
          .from("asset_models")
          .select("id,department_id,manufacturer,name,metadata,created_at,updated_at")
          .eq("department_id", profile.department_id)
          .order("name")
          .limit(5000),
        supabase
          .from("asset_subcategories")
          .select("id,department_id,asset_type,category,name,metadata,created_at,updated_at")
          .eq("department_id", profile.department_id)
          .order("name")
          .limit(5000),
      ]);

      if (!alive) return;
      if (mRes.error || moRes.error || scRes.error) {
        setManufacturers([]);
        setModels([]);
        setSubcategories([]);
        setPicklistsError((mRes.error ?? moRes.error ?? scRes.error)?.message ?? "No se pudieron cargar catálogos.");
        return;
      }
      setManufacturers((mRes.data ?? []) as unknown as AssetManufacturer[]);
      setModels((moRes.data ?? []) as unknown as AssetModel[]);
      setSubcategories((scRes.data ?? []) as unknown as AssetSubcategory[]);
    }
    void loadPicklists();
    return () => {
      alive = false;
    };
  }, [profile?.department_id]);

  const manufacturerOptions = useMemo<ComboboxOption[]>(
    () => manufacturers.map((m) => ({ value: m.name, label: m.name })),
    [manufacturers]
  );

  const modelOptions = useMemo<ComboboxOption[]>(() => {
    const mfg = manufacturer.trim().toLowerCase();
    const filtered = mfg ? models.filter((x) => (x.manufacturer ?? "").trim().toLowerCase() === mfg || !x.manufacturer) : models;
    return filtered.map((m) => ({ value: m.name, label: m.name, description: m.manufacturer ? `Marca: ${m.manufacturer}` : null }));
  }, [manufacturer, models]);

  const subcategoryOptions = useMemo<ComboboxOption[]>(() => {
    const t = assetType.trim().toLowerCase();
    const c = category.trim().toLowerCase();
    const filtered = subcategories.filter((s) => {
      const st = (s.asset_type ?? "").trim().toLowerCase();
      const sc = (s.category ?? "").trim().toLowerCase();
      if (st && t && st !== t) return false;
      if (sc && c && sc !== c) return false;
      return true;
    });
    return filtered.map((s) => ({ value: s.name, label: s.name }));
  }, [assetType, category, subcategories]);

  const profileById = useMemo(() => {
    const m = new Map<string, Pick<Profile, "email" | "full_name" | "role">>();
    for (const p of profiles) m.set(p.id, p);
    return m;
  }, [profiles]);

  async function authorizeNetlock(accessKey: string) {
    if (!token || !accessKey) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch<{ ok: boolean }>(token, "/api/agent/authorize", { method: "POST", body: JSON.stringify({ accessKey }) });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function captureLocation() {
    if (!token || !assetId) return;
    if (!navigator.geolocation) {
      setGeoError("Este navegador no soporta geolocalización.");
      return;
    }

    setGeoBusy(true);
    setGeoError(null);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 });
      });
      const latNum = pos.coords.latitude;
      const lngNum = pos.coords.longitude;
      const geocode = await fetch(`/api/geocode/reverse?lat=${encodeURIComponent(latNum)}&lng=${encodeURIComponent(lngNum)}`, { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => null);

      const regionOut = geocode && typeof geocode.region === "string" ? geocode.region : undefined;
      const comunaOut = geocode && typeof geocode.comuna === "string" ? geocode.comuna : undefined;
      const addressOut = geocode && typeof geocode.address === "string" ? geocode.address : undefined;

      await apiFetch<{ ok: boolean }>(token, `/api/assets/${assetId}/location/self`, {
        method: "POST",
        body: JSON.stringify({ lat: latNum, lng: lngNum, region: regionOut, comuna: comunaOut, address: addressOut }),
      });

      setLat(String(latNum));
      setLng(String(lngNum));
      if (regionOut) setRegion(regionOut);
      if (comunaOut) setComuna(comunaOut);
      if (addressOut) setAddress(addressOut);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e && typeof (e as { message?: unknown }).message === "string"
          ? String((e as { message: string }).message)
          : "No se pudo capturar la ubicación.";
      setGeoError(msg);
    } finally {
      setGeoBusy(false);
    }
  }

  async function learnPicklists() {
    if (!profile?.department_id) return;
    const dept = profile.department_id;

    const promises: Array<Promise<unknown>> = [];
    if (manufacturer.trim()) {
      promises.push(
        (async () => {
          await supabase
            .from("asset_manufacturers")
            .upsert({ department_id: dept, name: manufacturer.trim() }, { onConflict: "department_id,name_norm" });
        })()
      );
    }
    if (model.trim()) {
      promises.push(
        (async () => {
          await supabase
            .from("asset_models")
            .upsert({ department_id: dept, manufacturer: manufacturer.trim() || null, name: model.trim() }, { onConflict: "department_id,manufacturer_norm,name_norm" });
        })()
      );
    }
    if (subcategory.trim()) {
      promises.push(
        (async () => {
          await supabase
            .from("asset_subcategories")
            .upsert(
              { department_id: dept, asset_type: assetType.trim() || null, category: category.trim() || null, name: subcategory.trim() },
              { onConflict: "department_id,asset_type_norm,category_norm,name_norm" }
            );
        })()
      );
    }

    if (promises.length) {
      await Promise.allSettled(promises);
    }
  }

  async function onSave() {
    if (!assetId) return;
    setSaving(true);
    setError(null);
    try {
      const patch = {
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
        building: building.trim() || null,
        floor: floor.trim() || null,
        room: room.trim() || null,
        address: address.trim() || null,
        latitude: lat.trim() ? Number(lat) : null,
        longitude: lng.trim() ? Number(lng) : null,
        description: description.trim() || null,
        admin_notes: adminNotes.trim() || null,
      };
      const { data, error } = await supabase.from("assets").update(patch).eq("id", assetId).select("*").single();
      if (error) throw error;
      setAsset(data as unknown as Asset);
      await learnPicklists();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function setAssignment(role: "principal" | "responsable", userId: string) {
    if (!assetId || !profile) return;
    setError(null);
    try {
      const current = assignments.find((a) => a.role === role && !a.ended_at) ?? null;
      if (current && current.user_id === userId) return;

      if (current) {
        const { error } = await supabase.from("asset_assignments").update({ ended_at: new Date().toISOString() }).eq("id", current.id);
        if (error) throw error;
      }

      if (userId !== "__none__") {
        const { error } = await supabase.from("asset_assignments").insert({
          asset_id: assetId,
          user_id: userId,
          role,
          assigned_by: profile.id,
        });
        if (error) throw error;
      }

      const { data: asg, error: asgErr } = await supabase
        .from("asset_assignments")
        .select("id,asset_id,user_id,role,assigned_by,assigned_at,ended_at,notes")
        .eq("asset_id", assetId)
        .order("assigned_at", { ascending: false })
        .limit(200);
      if (asgErr) throw asgErr;
      setAssignments((asg ?? []) as unknown as AssetAssignment[]);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (sessionLoading || profileLoading) return <AppBootScreen />;
  if (!session) return <AppNoticeScreen title="Inicia sesión" description="Debes iniciar sesión para ver activos." />;
  if (!profile) return <AppNoticeScreen title="No se pudo cargar tu perfil" description={profileError ?? "Intenta nuevamente."} />;
  if (!assetId) return <AppNoticeScreen title="Activo inválido" description="No se encontró el id del activo." />;

  return (
    <AppShell profile={profile}>
      <div className="space-y-5">
        <PageHeader
          kicker={
            <Link href="/app/assets" className="hover:underline">
              ← Volver a activos
            </Link>
          }
          title={asset ? asset.name : "Activo"}
          description="Ficha de activo: ubicación, asignación, conectividad y alertas."
          actions={
            <>
              <Button variant="outline" onClick={() => void load()} disabled={loading}>
                <RefreshCcw className="h-4 w-4" />
                Actualizar
              </Button>
              {canManage ? (
                <Button onClick={onSave} disabled={saving || name.trim().length < 2}>
                  {saving ? "Guardando…" : "Guardar"}
                </Button>
              ) : null}
            </>
          }
        />

        {error ? <InlineAlert variant="error" title="Error" description={error} /> : null}
        {picklistsError ? <InlineAlert variant="info" title="Catálogos" description={picklistsError} /> : null}

        {loading && !asset ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !asset ? (
          <AppNoticeScreen title="No se encontró el activo" description="Puede que no tengas permisos o el activo ya no exista." />
        ) : (
          <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
            <div className="space-y-5">
              <Card className="tech-border">
                <CardHeader>
                  <CardTitle>Resumen</CardTitle>
                  <CardDescription>Identificación y estado actual.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="default" className="font-mono">
                      {formatAssetTag(asset.asset_tag) ?? `AST-${asset.asset_tag}`}
                    </Badge>
                    {asset.asset_type ? <Badge variant="outline">{asset.asset_type}</Badge> : null}
                    <AssetLifecycleBadge status={asset.lifecycle_status} />
                    <AssetConnectivityBadge status={asset.connectivity_status} />
                    {asset.failure_risk_pct >= 80 ? (
                      <Badge className="bg-rose-500/15 text-rose-200 ring-1 ring-rose-500/25">Riesgo {asset.failure_risk_pct}%</Badge>
                    ) : (
                      <Badge className="bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/20">Riesgo {asset.failure_risk_pct}%</Badge>
                    )}
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <label className="block">
                      <div className="text-xs text-muted-foreground">Nombre</div>
                      <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} />
                    </label>
                    <label className="block">
                      <div className="text-xs text-muted-foreground">Serial</div>
                      <Input value={serial} onChange={(e) => setSerial(e.target.value)} disabled={!canManage} />
                    </label>
                    <label className="block">
                      <div className="text-xs text-muted-foreground">Tipo</div>
                      <Input value={assetType} onChange={(e) => setAssetType(e.target.value)} disabled={!canManage} />
                    </label>
                    <label className="block">
                      <div className="text-xs text-muted-foreground">Estado (ciclo de vida)</div>
                      <Combobox
                        value={lifecycle}
                        onValueChange={(v) => setLifecycle(v ?? "Activo")}
                        options={LifecycleOptions}
                        placeholder="Activo"
                        disabled={!canManage}
                      />
                    </label>
                    <label className="block">
                      <div className="text-xs text-muted-foreground">Categoría</div>
                      <Input value={category} onChange={(e) => setCategory(e.target.value)} disabled={!canManage} />
                    </label>
                    <label className="block">
                      <div className="text-xs text-muted-foreground">Subcategoría</div>
                      <Combobox
                        value={subcategory.trim() ? subcategory : null}
                        onValueChange={(v) => setSubcategory(v ?? "")}
                        options={subcategoryOptions}
                        allowCustom
                        disabled={!canManage}
                      />
                    </label>
                    <label className="block">
                      <div className="text-xs text-muted-foreground">Marca</div>
                      <Combobox
                        value={manufacturer.trim() ? manufacturer : null}
                        onValueChange={(v) => setManufacturer(v ?? "")}
                        options={manufacturerOptions}
                        allowCustom
                        disabled={!canManage}
                      />
                    </label>
                    <label className="block">
                      <div className="text-xs text-muted-foreground">Modelo</div>
                      <Combobox
                        value={model.trim() ? model : null}
                        onValueChange={(v) => setModel(v ?? "")}
                        options={modelOptions}
                        allowCustom
                        disabled={!canManage}
                      />
                    </label>
                  </div>

                  <label className="block">
                    <div className="text-xs text-muted-foreground">Descripción</div>
                    <Textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canManage} />
                  </label>
                  {canManage ? (
                    <label className="block">
                      <div className="text-xs text-muted-foreground">Notas internas</div>
                      <Textarea value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} />
                    </label>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="tech-border">
                <CardHeader>
                  <CardTitle>Ubicación</CardTitle>
                  <CardDescription>Campos jerárquicos para mapa y reportería.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 lg:grid-cols-2">
                  {geoError ? <InlineAlert variant="error" title="Ubicación" description={geoError} /> : null}
                  <label className="block">
                    <div className="text-xs text-muted-foreground">Región</div>
                    <Input value={region} onChange={(e) => setRegion(e.target.value)} disabled={!canManage} />
                  </label>
                  <label className="block">
                    <div className="text-xs text-muted-foreground">Comuna</div>
                    <Input value={comuna} onChange={(e) => setComuna(e.target.value)} disabled={!canManage} />
                  </label>
                  <label className="block">
                    <div className="text-xs text-muted-foreground">Edificio/Sucursal</div>
                    <Input value={building} onChange={(e) => setBuilding(e.target.value)} disabled={!canManage} />
                  </label>
                  <label className="block">
                    <div className="text-xs text-muted-foreground">Piso</div>
                    <Input value={floor} onChange={(e) => setFloor(e.target.value)} disabled={!canManage} />
                  </label>
                  <label className="block">
                    <div className="text-xs text-muted-foreground">Sala/Cubículo</div>
                    <Input value={room} onChange={(e) => setRoom(e.target.value)} disabled={!canManage} />
                  </label>
                  <label className="block">
                    <div className="text-xs text-muted-foreground">Dirección</div>
                    <Input value={address} onChange={(e) => setAddress(e.target.value)} disabled={!canManage} />
                  </label>
                  <label className="block">
                    <div className="text-xs text-muted-foreground">Latitud</div>
                    <Input value={lat} onChange={(e) => setLat(e.target.value)} disabled={!canManage} />
                  </label>
                  <label className="block">
                    <div className="text-xs text-muted-foreground">Longitud</div>
                    <Input value={lng} onChange={(e) => setLng(e.target.value)} disabled={!canManage} />
                  </label>
                  <div className="lg:col-span-2">
                    <div className="flex flex-wrap gap-2">
                      <Button asChild variant="outline">
                        <Link href="/app/assets/map">Abrir mapa</Link>
                      </Button>
                      {canCaptureLocation ? (
                        <Button variant="outline" onClick={() => void captureLocation()} disabled={!token || geoBusy}>
                          {geoBusy ? "Capturando…" : "Usar mi ubicación (GPS)"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="tech-border">
                <CardHeader>
                  <CardTitle>Conectividad (últimos eventos)</CardTitle>
                  <CardDescription>Se alimenta por agente/heartbeat o integraciones.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {events.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                      Sin eventos de conectividad aún.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {events.slice(0, 12).map((e) => (
                        <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/10 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <AssetConnectivityBadge status={e.status} />
                            <div className="text-sm text-muted-foreground">{new Date(e.occurred_at).toLocaleString()}</div>
                            {e.hostname ? <div className="text-sm text-muted-foreground">Host: {e.hostname}</div> : null}
                            {e.ip ? <div className="text-sm text-muted-foreground font-mono">{e.ip}</div> : null}
                          </div>
                          <div className="text-xs text-muted-foreground">{[e.network_type, e.mac].filter(Boolean).join(" · ")}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-5">
              {(() => {
                const n = getNetlockMeta(asset);
                const hasRmm = !!asset.mesh_node_id || !!n;
                if (!hasRmm) return null;
                const consoleUrl = process.env.NEXT_PUBLIC_NETLOCK_CONSOLE_URL?.trim() || "";
                const lastAccess = typeof n?.last_access === "string" ? n.last_access : null;
                const hardware = rmmSnapshots.find((s) => s.kind === "hardware") ?? null;
                const apps = rmmSnapshots.find((s) => s.kind === "apps_installed") ?? null;
                const recent = rmmSnapshots.find((s) => s.kind === "events_recent") ?? null;
                const authorized = typeof n?.authorized === "number" ? n.authorized : null;

                const hw = hardware?.payload;
                const hwDeviceFields = isRecord(hw) ? (hw.device_fields as unknown) : null;
                const ramGb =
                  pickNumber(hwDeviceFields, ["ram", "ram_gb", "total_gb"]) ??
                  pickNumber(isRecord(hw) ? hw.ram : null, ["total_gb", "gb", "total"]) ??
                  (typeof n?.ram_gb === "number" ? n.ram_gb : null);
                const cpuLabel =
                  pickString(isRecord(hw) ? hw.cpu : null, ["model", "name", "cpu", "processor"]) ??
                  pickString(hwDeviceFields, ["cpu", "model", "name"]) ??
                  null;
                const diskCount = (() => {
                  if (!isRecord(hw)) return null;
                  const raw = hw.disks;
                  if (Array.isArray(raw)) return raw.length;
                  if (isRecord(raw) && Array.isArray(raw.disks)) return raw.disks.length;
                  return null;
                })();

                const appsList = parseNetlockApps(apps?.payload);
                const eventsList = parseNetlockEvents(recent?.payload);
                const filteredApps = (() => {
                  const q = appsQuery.trim().toLowerCase();
                  if (!q) return appsList;
                  return appsList.filter((a) => [a.name, a.vendor, a.version, a.installation_path].some((s) => (s ?? "").toLowerCase().includes(q)));
                })();
                const appsToShow = appsExpanded ? filteredApps : filteredApps.slice(0, 40);

                const hwGeneral = isRecord(hw) ? (hw.general as unknown) : null;
                const hwGeneralJson = isRecord(hwGeneral) ? (hwGeneral as Record<string, unknown>).json : null;
                const hwid = pickString(hwGeneralJson, ["hwid"]);
                const firewall = pickString(hwGeneralJson, ["firewall_status"]);
                const cpuUsage = toNumber(isRecord(hw) ? (hw.cpu as Record<string, unknown>)?.usage : null);
                const ramUsagePct = toNumber(pickString(hwGeneralJson, ["ram_usage"]));
                const disksList = (() => {
                  if (!isRecord(hw)) return [];
                  const raw = hw.disks;
                  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.disks) ? raw.disks : [];
                  return (list as unknown[]).filter(isRecord).map((d) => {
                    const mount = pickString(d, ["letter", "mount", "name"]) ?? "—";
                    const fmt = pickString(d, ["drive_format", "format"]);
                    const capacityGb = toNumber((d as Record<string, unknown>).capacity);
                    const usedPct = toNumber((d as Record<string, unknown>).usage);
                    const model = pickString(d, ["model"]);
                    const type = pickString(d, ["drive_type"]);
                    return { mount, fmt, capacityGb, usedPct, model, type };
                  });
                })();
                return (
                  <Card className="tech-border">
                    <CardHeader>
                      <CardTitle>Soporte remoto</CardTitle>
                      <CardDescription>Inventario y telemetría sincronizada desde el agente remoto.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="grid gap-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-muted-foreground">Device key</div>
                          <div className="font-mono">{asset.mesh_node_id ?? "—"}</div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-muted-foreground">Plataforma</div>
                          <div>{(typeof n?.platform === "string" && n.platform) || "—"}</div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-muted-foreground">OS</div>
                          <div className="text-right">{(typeof n?.operating_system === "string" && n.operating_system) || "—"}</div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-muted-foreground">Agente</div>
                          <div>{(typeof n?.agent_version === "string" && n.agent_version) || "—"}</div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-muted-foreground">IP (int/ext)</div>
                          <div className="text-right">
                            {[
                              typeof n?.ip_internal === "string" ? n.ip_internal : null,
                              typeof n?.ip_external === "string" ? n.ip_external : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-muted-foreground">Último acceso</div>
                          <div>{lastAccess ? new Date(lastAccess).toLocaleString() : "—"}</div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-muted-foreground">Inventario hardware</div>
                          <div>{hardware?.source_ts ? new Date(hardware.source_ts).toLocaleString() : "Pendiente"}</div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-muted-foreground">CPU</div>
                          <div className="text-right">{cpuLabel ?? "—"}</div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-muted-foreground">RAM</div>
                          <div>{ramGb != null ? `${ramGb} GB` : "—"}</div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-muted-foreground">Discos</div>
                          <div>{diskCount != null ? `${diskCount}` : "—"}</div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-muted-foreground">Software instalado</div>
                          <div>{appsList.length ? `${appsList.length} apps` : apps?.source_ts ? "Disponible" : "—"}</div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-muted-foreground">Eventos recientes</div>
                          <div>{eventsList.length ? `${eventsList.length} eventos` : recent?.source_ts ? "Disponible" : "—"}</div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-muted-foreground">Autorizado</div>
                          <div>
                            {authorized != null ? <Badge variant="outline">{authorized ? "Sí" : "No"}</Badge> : "—"}
                          </div>
                        </div>
                      </div>

                      {authorized === 0 ? (
                        <InlineAlert
                          variant="info"
                          title="Equipo pendiente de autorización"
                          description="Mientras el equipo esté sin autorización, el agente remoto puede no ejecutar políticas (inventario/historial). Puedes autorizarlo desde aquí (si tienes rol agente/supervisor/admin)."
                        />
                      ) : null}

                      {authorized === 0 && canManageRmm && asset.mesh_node_id ? (
                        <Button variant="outline" onClick={() => void authorizeNetlock(asset.mesh_node_id!)} disabled={saving}>
                          {saving ? "Autorizando…" : "Autorizar equipo"}
                        </Button>
                      ) : null}

                      <div className="space-y-3">
                        {hwid ? (
                          <div className="rounded-xl border border-border bg-muted/10 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                              <div className="text-muted-foreground">HWID</div>
                              <div className="font-mono">{hwid}</div>
                            </div>
                          </div>
                        ) : null}

                        <div className="rounded-xl border border-border bg-muted/10 p-3">
                          <div className="text-sm font-medium">Hardware</div>
                          <div className="mt-2 grid gap-2 text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-muted-foreground">CPU</div>
                              <div className="text-right">{cpuLabel ?? "—"}</div>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-muted-foreground">Uso CPU</div>
                              <div>
                                {cpuUsage != null ? `${Math.max(0, Math.min(100, Math.round(cpuUsage > 100 ? cpuUsage / 10 : cpuUsage)))}%` : "—"}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-muted-foreground">RAM</div>
                              <div>
                                {ramGb != null ? `${ramGb} GB` : "—"}
                                {ramUsagePct != null ? <span className="text-muted-foreground"> · {Math.round(ramUsagePct)}% en uso</span> : null}
                              </div>
                            </div>
                            {disksList.length ? (
                              <div className="mt-1 space-y-2">
                                {disksList.slice(0, 5).map((d, idx) => (
                                  <div key={`${d.mount}-${idx}`} className="rounded-lg border border-border bg-background/20 p-2 text-xs">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="font-mono">{d.mount}</div>
                                      <div className="text-muted-foreground">{[d.type, d.fmt].filter(Boolean).join(" · ") || "—"}</div>
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                                      <div className="text-muted-foreground">{d.model ?? "—"}</div>
                                      <div>
                                        {d.capacityGb != null ? `${d.capacityGb} GB` : "—"}
                                        {d.usedPct != null ? <span className="text-muted-foreground"> · {d.usedPct}% usado</span> : null}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="rounded-xl border border-border bg-muted/10 p-3">
                          <div className="text-sm font-medium">Seguridad & estado</div>
                          <div className="mt-2 grid gap-2 text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-muted-foreground">Firewall</div>
                              <div>
                                {firewall ? (
                                  <Badge variant="outline">{firewall.toLowerCase() === "true" ? "Activo" : firewall}</Badge>
                                ) : (
                                  "—"
                                )}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-muted-foreground">Actualizaciones pendientes</div>
                              <div>{typeof n?.update_pending === "number" ? (n.update_pending ? "Sí" : "No") : "—"}</div>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-muted-foreground">Usuario activo</div>
                              <div className="text-right">
                                {typeof n?.last_active_user === "string" && n.last_active_user.trim() ? n.last_active_user.trim() : "—"}
                              </div>
                            </div>
                          </div>
                        </div>

                        <details className="rounded-xl border border-border bg-muted/10 p-3" open>
                          <summary className="cursor-pointer text-sm font-medium">
                            Software instalado <span className="text-muted-foreground">({appsList.length})</span>
                          </summary>
                          <div className="mt-3 space-y-2">
                            <Input
                              value={appsQuery}
                              onChange={(e) => setAppsQuery(e.target.value)}
                              placeholder="Buscar por nombre, vendor, versión o ruta…"
                            />
                            {filteredApps.length === 0 ? (
                              <div className="text-xs text-muted-foreground">Sin resultados.</div>
                            ) : (
                              <div className="max-h-72 overflow-auto rounded-lg border border-border">
                                <div className="divide-y divide-border">
                                  {appsToShow.map((a) => (
                                    <div key={`${a.name}-${a.installation_path ?? ""}`} className="p-2 text-xs">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="font-medium">{a.name}</div>
                                        <div className="text-muted-foreground">{[a.vendor, a.version].filter(Boolean).join(" · ") || "—"}</div>
                                      </div>
                                      {a.installation_path ? <div className="mt-1 font-mono text-[11px] text-muted-foreground">{a.installation_path}</div> : null}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {filteredApps.length > 40 ? (
                              <Button variant="outline" size="sm" onClick={() => setAppsExpanded((v) => !v)}>
                                {appsExpanded ? "Ver menos" : `Ver más (${filteredApps.length - 40})`}
                              </Button>
                            ) : null}
                          </div>
                        </details>

                        <details className="rounded-xl border border-border bg-muted/10 p-3">
                          <summary className="cursor-pointer text-sm font-medium">
                            Eventos recientes <span className="text-muted-foreground">({eventsList.length})</span>
                          </summary>
                          <div className="mt-3 space-y-2">
                            {eventsList.length === 0 ? (
                              <div className="text-xs text-muted-foreground">Sin eventos recientes.</div>
                            ) : (
                              <div className="max-h-64 overflow-auto space-y-2">
                                {eventsList.slice(0, 30).map((ev) => {
                                  const s = severityLabel(ev.severity);
                                  const when = ev.date ? new Date(ev.date).toLocaleString() : "—";
                                  return (
                                    <div key={`${ev.id ?? when}`} className="rounded-lg border border-border bg-background/20 p-2 text-xs">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <Badge className={cn("px-2 py-0.5", s.className)}>{s.label}</Badge>
                                        <div className="text-muted-foreground">{when}</div>
                                      </div>
                                      <div className="mt-1">{ev.description ?? "—"}</div>
                                      {ev.reported_by ? <div className="mt-1 text-muted-foreground">Reportado por: {ev.reported_by}</div> : null}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </details>

                        <details className="rounded-xl border border-border bg-muted/10 p-3">
                          <summary className="cursor-pointer text-sm font-medium">Datos crudos (avanzado)</summary>
                          <pre className="mt-2 max-h-72 overflow-auto text-xs text-muted-foreground">
                            {JSON.stringify({ hardware: hardware?.payload, apps: apps?.payload, events: recent?.payload }, null, 2)}
                          </pre>
                        </details>
                      </div>

                      {consoleUrl ? (
                        <div className="flex flex-wrap gap-2">
                          {canManageRmm && asset.mesh_node_id ? (
                            <Button onClick={() => setRemoteOpen(true)}>
                              Tomar control remoto
                            </Button>
                          ) : null}
                          <Button variant="outline" asChild>
                            <a href={consoleUrl} target="_blank" rel="noreferrer">
                              Abrir consola de soporte remoto
                            </a>
                          </Button>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })()}

              <Dialog open={remoteOpen} onOpenChange={setRemoteOpen}>
                <DialogContent className="max-w-6xl p-0">
                  <div className="space-y-4 p-5">
                    <NetlockRemotePanel accessKey={asset?.mesh_node_id ?? null} />
                  </div>
                </DialogContent>
              </Dialog>

              <Card className="tech-border">
                <CardHeader>
                  <CardTitle>Asignación</CardTitle>
                  <CardDescription>Usuario asignado + responsable técnico.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <label className="block">
                    <div className="text-xs text-muted-foreground">Usuario asignado</div>
                    <Combobox
                      value={assigneeByRole.get("principal") ?? "__none__"}
                      onValueChange={(v) => void setAssignment("principal", v ?? "__none__")}
                      options={userOptions}
                      disabled={!canManage}
                      placeholder="Sin asignar"
                    />
                  </label>
                  <label className="block">
                    <div className="text-xs text-muted-foreground">Responsable</div>
                    <Combobox
                      value={assigneeByRole.get("responsable") ?? "__none__"}
                      onValueChange={(v) => void setAssignment("responsable", v ?? "__none__")}
                      options={userOptions}
                      disabled={!canManage}
                      placeholder="Sin asignar"
                    />
                  </label>

                  <div className="rounded-xl border border-border bg-muted/20 p-3 text-sm">
                    <div className="font-medium">Historial</div>
                    <div className="mt-2 space-y-2">
                      {assignments.slice(0, 12).map((a) => {
                        const p = profileById.get(a.user_id) ?? null;
                        return (
                          <div key={a.id} className={cn("flex flex-wrap items-center justify-between gap-2", a.ended_at ? "text-muted-foreground" : "text-foreground")}>
                            <div className="min-w-0">
                              <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-xs">{a.role}</span>{" "}
                              <span className="truncate">{p ? profileLabel(p) : a.user_id}</span>
                            </div>
                            <div className="text-xs">
                              {new Date(a.assigned_at).toLocaleDateString()} {a.ended_at ? `→ ${new Date(a.ended_at).toLocaleDateString()}` : "· activo"}
                            </div>
                          </div>
                        );
                      })}
                      {assignments.length === 0 ? <div className="text-muted-foreground">Sin historial.</div> : null}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="tech-border">
                <CardHeader>
                  <CardTitle>Alertas</CardTitle>
                  <CardDescription>Incidentes predictivos y estado del inventario.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {alerts.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Sin alertas.</div>
                  ) : (
                    <div className="space-y-2">
                      {alerts.slice(0, 10).map((a) => (
                        <div key={a.id} className="rounded-xl border border-border bg-muted/10 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-medium">{a.title}</div>
                            <Badge variant="default" className={cn(a.severity === "critical" ? "bg-rose-500/15 text-rose-200" : a.severity === "warning" ? "bg-amber-500/15 text-amber-200" : "bg-sky-500/10 text-sky-200")}>
                              {a.severity}
                            </Badge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {a.kind} · {a.status} · {new Date(a.opened_at).toLocaleString()}
                          </div>
                          {a.message ? <div className="mt-2 text-sm text-muted-foreground">{a.message}</div> : null}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
