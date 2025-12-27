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

  const [priority, setPriority] = useState<(typeof TicketPriorities)[number]>("Media");
  const [response, setResponse] = useState(4);
  const [resolution, setResolution] = useState(24);
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
    const { data, error } = await supabase
      .from("slas")
      .select("id,department_id,priority,response_time_hours,resolution_time_hours,is_active,updated_at")
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
  }, [profile]);

  async function create(p: Profile) {
    if (!canCreate) return;
    setSaving(true);
    setError(null);
    try {
      const { error } = await supabase.from("slas").insert({
        department_id: p.department_id,
        priority,
        response_time_hours: response,
        resolution_time_hours: resolution,
        is_active: active,
      });
      if (error) throw error;
      await load(p);
    } catch (e: unknown) {
      setError(errorMessage(e) ?? "No se pudo crear SLA");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(id: string, is_active: boolean) {
    if (!canWrite) return;
    await supabase.from("slas").update({ is_active }).eq("id", id);
    if (profile) await load(profile);
  }

  if (sessionLoading || profileLoading) return <AppBootScreen label="Cargando SLAs…" />;
  if (!session || !profile) return null;

  return (
    <AppShell profile={profile}>
      <div className="space-y-6">
        <PageHeader
          title="SLAs"
          description="Definición de tiempos de respuesta y resolución por prioridad."
          actions={
            <Button asChild variant="outline">
              <Link href="/app">Volver</Link>
            </Button>
          }
        />

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
              <CardTitle>Nuevo SLA</CardTitle>
              <CardDescription>Configura tiempos para tu departamento (o usa global).</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-4">
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
              <label className="flex items-center gap-2 text-sm text-muted-foreground md:mt-6">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                Activo
              </label>
              {error ? (
                <div className="md:col-span-4">
                  <InlineAlert variant="error" description={error} />
                </div>
              ) : null}
              <div className="md:col-span-4">
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
              <CardDescription>SLAs globales y de departamento.</CardDescription>
            </div>
            <Button variant="outline" onClick={() => void load(profile)}>
              Actualizar
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground">Cargando…</div>
            ) : slas.length === 0 ? (
              <EmptyState title="Sin SLAs" description="Crea un SLA para tu departamento o usa el global." icon={<Clock className="h-5 w-5" />} />
            ) : (
              <div className="divide-y divide-border">
                {slas.map((s) => (
                  <div key={s.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span>{s.priority}</span>
                        <Badge variant="outline">{s.department_id ? "Depto" : "Global"}</Badge>
                        <Badge variant="outline">{s.is_active ? "Activo" : "Inactivo"}</Badge>
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
