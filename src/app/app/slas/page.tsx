"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useProfile, useSession } from "@/lib/hooks";
import { supabase } from "@/lib/supabaseBrowser";
import { TicketPriorities } from "@/lib/constants";
import type { Profile } from "@/lib/types";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { errorMessage } from "@/lib/error";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Clock } from "lucide-react";
import { AppBootScreen } from "@/components/layout/AppStates";

type Sla = {
  id: string;
  department_id: string | null;
  priority: (typeof TicketPriorities)[number];
  response_time_hours: number;
  resolution_time_hours: number;
  time_basis?: "business" | "calendar";
  is_active: boolean;
  updated_at: string;
};

export default function SlasPage() {
  const router = useRouter();
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile } = useProfile(session?.user.id);

  const [slas, setSlas] = useState<Sla[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<"SLA" | "OLA">("SLA");
  const [priority, setPriority] = useState<(typeof TicketPriorities)[number]>("Media");
  const [response, setResponse] = useState(2);
  const [resolution, setResolution] = useState(8);
  const [basis, setBasis] = useState<"business" | "calendar">("business");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const canWrite = profile?.role === "supervisor" || profile?.role === "admin";
  const canCreate = useMemo(() => canWrite && response >= 0 && resolution >= 0, [canWrite, response, resolution]);

  useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  async function load(p: Profile) {
    setLoading(true);
    setError(null);
    const table = mode === "SLA" ? "slas" : "olas";
    const { data, error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(table as any)
      .select("id,department_id,priority,response_time_hours,resolution_time_hours,time_basis,is_active,updated_at")
      .or(`department_id.is.null,department_id.eq.${p.department_id}`)
      .order("priority", { ascending: true })
      .order("updated_at", { ascending: false });
    if (error) setError(error.message);
    setSlas((data ?? []) as Sla[]);
    setLoading(false);
  }

  useEffect(() => {
    if (!profile) return;
    void load(profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, mode]);

  async function create(p: Profile) {
    if (!canCreate) return;
    setSaving(true);
    setError(null);
    try {
      const table = mode === "SLA" ? "slas" : "olas";
      const { error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from(table as any)
        .insert({
        department_id: p.department_id,
        priority,
        response_time_hours: response,
        resolution_time_hours: resolution,
        time_basis: basis,
        is_active: active,
      });
      if (error) throw error;
      await load(p);
    } catch (e: unknown) {
      setError(errorMessage(e) ?? `No se pudo crear ${mode}`);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(id: string, is_active: boolean) {
    if (!canWrite) return;
    const table = mode === "SLA" ? "slas" : "olas";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from(table as any).update({ is_active }).eq("id", id);
    if (profile) await load(profile);
  }

  if (sessionLoading || profileLoading) return <AppBootScreen label="Cargando SLAs…" />;
  if (!session || !profile) return null;

  return (
    <AppShell profile={profile}>
      <div className="space-y-6">
        <PageHeader
          title="SLAs / OLAs"
          description="Configura tiempos oficiales (MDA + operación) por prioridad."
          actions={
            <Button asChild variant="outline">
              <Link href="/app">Volver</Link>
            </Button>
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={mode === "SLA" ? "secondary" : "outline"}
            onClick={() => {
              setMode("SLA");
              setResponse(2);
              setResolution(8);
              setBasis("business");
            }}
          >
            SLA (MDA)
          </Button>
          <Button
            variant={mode === "OLA" ? "secondary" : "outline"}
            onClick={() => {
              setMode("OLA");
              setResponse(1);
              setResolution(2);
              setBasis("business");
            }}
          >
            OLA (Operación)
          </Button>
          <Badge variant="outline">Horario hábil: lun-vie 08:00–18:00</Badge>
        </div>

        {!canWrite ? (
          <Card className="tech-border">
            <CardHeader>
              <CardTitle>Solo lectura</CardTitle>
              <CardDescription>Solo supervisor/admin puede modificar SLAs.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Card className="tech-border tech-glow">
            <CardHeader>
              <CardTitle>Nuevo {mode}</CardTitle>
              <CardDescription>
                {mode === "SLA"
                  ? "MDA: Respuesta máx 2h y resolución remota máx 8h (horas hábiles)."
                  : "Operación: Nivel 1 (1h) + escalamiento nivel 2 (1h adicional) (horas hábiles)."}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-5">
              <label className="block">
                <div className="text-xs text-muted-foreground">Prioridad</div>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as (typeof TicketPriorities)[number])}
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                >
                  {TicketPriorities.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <div className="text-xs text-muted-foreground">Respuesta (hrs)</div>
                <Input type="number" min={0} value={response} onChange={(e) => setResponse(Number(e.target.value))} />
              </label>
              <label className="block">
                <div className="text-xs text-muted-foreground">Resolución (hrs)</div>
                <Input type="number" min={0} value={resolution} onChange={(e) => setResolution(Number(e.target.value))} />
              </label>
              <label className="block">
                <div className="text-xs text-muted-foreground">Base</div>
                <select
                  value={basis}
                  onChange={(e) => setBasis(e.target.value as "business" | "calendar")}
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                >
                  <option value="business">Horas hábiles</option>
                  <option value="calendar">Horas corridas</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-muted-foreground md:mt-6">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                Activo
              </label>
              {error ? (
                <div className="md:col-span-5">
                  <InlineAlert variant="error" description={error} />
                </div>
              ) : null}
              <div className="md:col-span-5">
                <Button disabled={!canCreate || saving} onClick={() => void create(profile)}>
                  {saving ? "Guardando…" : "Crear SLA"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="tech-border">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Lista</CardTitle>
              <CardDescription>{mode === "SLA" ? "SLAs (MDA) globales y de departamento." : "OLAs (operación) globales y de departamento."}</CardDescription>
            </div>
            <Button variant="outline" onClick={() => void load(profile)}>
              Actualizar
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground">Cargando…</div>
            ) : slas.length === 0 ? (
              <EmptyState title={`Sin ${mode}s`} description={`Crea un ${mode} para tu departamento o usa el global.`} icon={<Clock className="h-5 w-5" />} />
            ) : (
              <div className="divide-y divide-border">
                {slas.map((s) => (
                  <div key={s.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span>{s.priority}</span>
                        <Badge variant="outline">{s.department_id ? "Depto" : "Global"}</Badge>
                        <Badge variant="outline">{s.is_active ? "Activo" : "Inactivo"}</Badge>
                        <Badge variant="outline">{(s.time_basis ?? "business") === "calendar" ? "Corridas" : "Hábiles"}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Respuesta: {s.response_time_hours}h · Resolución: {s.resolution_time_hours}h
                      </div>
                    </div>
                    {canWrite ? (
                      <Button variant="outline" onClick={() => void toggleActive(s.id, !s.is_active)}>
                        {s.is_active ? "Desactivar" : "Activar"}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
