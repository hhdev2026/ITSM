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
import { isDemoMode } from "@/lib/demo";
import { createSla as demoCreateSla, listSlas as demoListSlas, toggleSla as demoToggleSla } from "@/lib/demoStore";

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
    if (isDemoMode()) {
      setSlas((demoListSlas(p.department_id!) as unknown) as Sla[]);
      setLoading(false);
      return;
    }
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
      if (isDemoMode()) {
        demoCreateSla({
          department_id: p.department_id!,
          priority,
          response_time_hours: response,
          resolution_time_hours: resolution,
          is_active: active,
        });
        await load(p);
        return;
      }
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
    if (isDemoMode()) {
      demoToggleSla(id, is_active);
      if (profile) await load(profile);
      return;
    }
    await supabase.from("slas").update({ is_active }).eq("id", id);
    if (profile) await load(profile);
  }

  if (sessionLoading || profileLoading) return <div className="p-6 text-sm text-zinc-300">Cargando...</div>;
  if (!session || !profile) return null;

  return (
    <AppShell profile={profile}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xl font-semibold">SLAs</div>
            <div className="mt-1 text-sm text-zinc-400">Definición de tiempos de respuesta y resolución por prioridad.</div>
          </div>
          <Link href="/app" className="rounded-xl bg-white/5 px-3 py-2 text-sm text-white ring-1 ring-white/10 hover:bg-white/10">
            Volver
          </Link>
        </div>

        {!canWrite && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-zinc-300">
            Solo <code className="text-zinc-100">supervisor</code> o <code className="text-zinc-100">admin</code> puede modificar SLAs.
          </div>
        )}

        {canWrite && (
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm font-medium">Nuevo SLA (por departamento)</div>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <label className="block">
                <div className="text-xs text-zinc-400">Prioridad</div>
                <select value={priority} onChange={(e) => setPriority(e.target.value as (typeof TicketPriorities)[number])} className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-white/20">
                  {TicketPriorities.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <div className="text-xs text-zinc-400">Respuesta (hrs)</div>
                <input type="number" min={0} value={response} onChange={(e) => setResponse(Number(e.target.value))} className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-white/20" />
              </label>
              <label className="block">
                <div className="text-xs text-zinc-400">Resolución (hrs)</div>
                <input type="number" min={0} value={resolution} onChange={(e) => setResolution(Number(e.target.value))} className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-white/20" />
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-300 md:mt-6">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                Activo
              </label>
              {error && <div className="rounded-xl bg-rose-500/15 px-3 py-2 text-xs text-rose-200 ring-1 ring-rose-500/25 md:col-span-4">{error}</div>}
              <div className="md:col-span-4">
                <button disabled={!canCreate || saving} onClick={() => void create(profile)} className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50">
                  {saving ? "Guardando..." : "Crear SLA"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">Lista</div>
            <button onClick={() => void load(profile)} className="rounded-xl bg-white/5 px-3 py-2 text-xs text-white ring-1 ring-white/10 hover:bg-white/10">
              Actualizar
            </button>
          </div>
          {loading ? (
            <div className="mt-4 text-sm text-zinc-400">Cargando...</div>
          ) : slas.length === 0 ? (
            <div className="mt-4 text-sm text-zinc-400">No hay SLAs.</div>
          ) : (
            <div className="mt-4 divide-y divide-white/10">
              {slas.map((s) => (
                <div key={s.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-sm font-medium">
                      {s.priority} {s.department_id ? "" : "(Global)"}
                    </div>
                    <div className="mt-1 text-xs text-zinc-400">
                      Respuesta: {s.response_time_hours}h · Resolución: {s.resolution_time_hours}h
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-zinc-300 ring-1 ring-white/10">{s.is_active ? "Activo" : "Inactivo"}</span>
                    {canWrite && (
                      <button
                        onClick={() => void toggleActive(s.id, !s.is_active)}
                        className="rounded-xl bg-white/5 px-3 py-2 text-xs text-white ring-1 ring-white/10 hover:bg-white/10"
                      >
                        {s.is_active ? "Desactivar" : "Activar"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
