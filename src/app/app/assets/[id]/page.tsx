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
import { useProfile, useSession } from "@/lib/hooks";
import { supabase } from "@/lib/supabaseBrowser";
import type { Asset, AssetAlert, AssetAssignment, AssetManufacturer, AssetModel, AssetSubcategory, Profile } from "@/lib/types";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCcw } from "lucide-react";

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

export default function AssetDetailPage() {
  const params = useParams<{ id: string }>();
  const assetId = params?.id;

  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error: profileError } = useProfile(session?.user.id);

  const canManage = profile?.role === "admin" || profile?.role === "supervisor";

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [asset, setAsset] = useState<Asset | null>(null);
  const [assignments, setAssignments] = useState<AssetAssignment[]>([]);
  const [events, setEvents] = useState<ConnectivityEvent[]>([]);
  const [alerts, setAlerts] = useState<AssetAlert[]>([]);
  const [profiles, setProfiles] = useState<Array<Pick<Profile, "id" | "email" | "full_name" | "role">>>([]);

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

      const { data: ps, error: psErr } = await supabase
        .from("profiles")
        .select("id,email,full_name,role")
        .eq("department_id", profile.department_id)
        .limit(2000);
      if (psErr) throw psErr;

      const assetRow = a as unknown as Asset;
      setAsset(assetRow);
      setAssignments((asg ?? []) as unknown as AssetAssignment[]);
      setEvents((ev ?? []) as unknown as ConnectivityEvent[]);
      setAlerts((al ?? []) as unknown as AssetAlert[]);
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
                    <Button asChild variant="outline">
                      <Link href="/app/assets/map">Abrir mapa</Link>
                    </Button>
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
