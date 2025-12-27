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
import Link from "next/link";
import { useMemo, useState } from "react";

const LifecycleOptions: ComboboxOption[] = [
  { value: "Activo", label: "Activo" },
  { value: "En reparación", label: "En reparación" },
  { value: "Retirado", label: "Retirado" },
  { value: "Descartado", label: "Descartado" },
];

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

  const isValid = useMemo(() => name.trim().length >= 2, [name]);

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
              <Input value={assetType} onChange={(e) => setAssetType(e.target.value)} placeholder="Ej: Laptop, Impresora, Switch…" />
            </label>
            <label className="block">
              <div className="text-xs text-muted-foreground">Categoría</div>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ej: Hardware, Software, Licencia" />
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
                  <div className="text-xs text-muted-foreground">Edificio/Sucursal</div>
                  <Input value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="Ej: Torre A" />
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
