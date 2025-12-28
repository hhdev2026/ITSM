"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AppBootScreen, AppNoticeScreen } from "@/components/layout/AppStates";
import { PageHeader } from "@/components/layout/PageHeader";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { useProfile, useSession } from "@/lib/hooks";
import { supabase } from "@/lib/supabaseBrowser";
import { CalendarClock, Plus, RefreshCcw, Trash2 } from "lucide-react";

type BusinessCalendar = {
  id: string;
  department_id: string | null;
  name: string;
  timezone: string;
  work_start: string;
  work_end: string;
  work_days: number[];
  is_active: boolean;
  updated_at: string;
};

type BusinessHoliday = {
  calendar_id: string;
  holiday_date: string;
  name: string | null;
  is_working: boolean;
  created_at: string;
};

function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") return (e as { message: string }).message;
  return "Error";
}

const DOW: Array<{ iso: number; label: string }> = [
  { iso: 1, label: "Lun" },
  { iso: 2, label: "Mar" },
  { iso: 3, label: "Mié" },
  { iso: 4, label: "Jue" },
  { iso: 5, label: "Vie" },
  { iso: 6, label: "Sáb" },
  { iso: 7, label: "Dom" },
];

function timeShort(t: string) {
  return t?.slice(0, 5) || t;
}

export default function BusinessHoursSettingsPage() {
  const router = useRouter();
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error: profileError } = useProfile(session?.user.id);

  const canUse = profile?.role === "supervisor" || profile?.role === "admin";
  const deptId = profile?.department_id ?? null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [calendar, setCalendar] = useState<BusinessCalendar | null>(null);
  const [holidays, setHolidays] = useState<BusinessHoliday[]>([]);

  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("Horario estándar");
  const [timezone, setTimezone] = useState("America/Santiago");
  const [workStart, setWorkStart] = useState("08:00");
  const [workEnd, setWorkEnd] = useState("18:00");
  const [workDays, setWorkDays] = useState<number[]>([1, 2, 3, 4, 5]);

  const [newDate, setNewDate] = useState<string>("");
  const [newHolidayName, setNewHolidayName] = useState<string>("");
  const [newIsWorking, setNewIsWorking] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  async function load() {
    if (!deptId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: dept, error: dErr } = await supabase.from("departments").select("id,business_calendar_id").eq("id", deptId).maybeSingle();
      if (dErr) throw dErr;
      const calendarId = (dept as { business_calendar_id?: string | null } | null)?.business_calendar_id ?? null;
      if (!calendarId) throw new Error("No hay calendario asignado al departamento.");

      const { data: cal, error: cErr } = await supabase
        .from("business_calendars")
        .select("id,department_id,name,timezone,work_start,work_end,work_days,is_active,updated_at")
        .eq("id", calendarId)
        .maybeSingle();
      if (cErr) throw cErr;
      const c = (cal ?? null) as BusinessCalendar | null;
      setCalendar(c);
      if (c) {
        setName(c.name ?? "Horario estándar");
        setTimezone(c.timezone ?? "America/Santiago");
        setWorkStart(timeShort(c.work_start ?? "08:00"));
        setWorkEnd(timeShort(c.work_end ?? "18:00"));
        setWorkDays(Array.isArray(c.work_days) ? c.work_days : [1, 2, 3, 4, 5]);
      }

      const { data: hols, error: hErr } = await supabase
        .from("business_holidays")
        .select("calendar_id,holiday_date,name,is_working,created_at")
        .eq("calendar_id", calendarId)
        .order("holiday_date", { ascending: false })
        .limit(200);
      if (hErr) throw hErr;
      setHolidays((hols ?? []) as BusinessHoliday[]);
    } catch (e: unknown) {
      setError(errorMessage(e));
      setCalendar(null);
      setHolidays([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!profile || !deptId) return;
    if (!canUse) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUse, deptId, profile?.id]);

  const daysLabel = useMemo(() => {
    const set = new Set(workDays);
    return DOW.filter((d) => set.has(d.iso))
      .map((d) => d.label)
      .join(", ");
  }, [workDays]);

  async function save() {
    if (!calendar) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim() || "Horario estándar",
        timezone: timezone.trim() || "America/Santiago",
        work_start: `${workStart}:00`,
        work_end: `${workEnd}:00`,
        work_days: workDays.length ? workDays : [1, 2, 3, 4, 5],
      };
      const { error } = await supabase.from("business_calendars").update(payload).eq("id", calendar.id);
      if (error) throw error;
      await load();
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function addHoliday() {
    if (!calendar) return;
    const d = newDate.trim();
    if (!d) return;
    setAdding(true);
    setError(null);
    try {
      const { error } = await supabase.from("business_holidays").upsert({
        calendar_id: calendar.id,
        holiday_date: d,
        name: newHolidayName.trim() || null,
        is_working: newIsWorking,
      });
      if (error) throw error;
      setNewDate("");
      setNewHolidayName("");
      setNewIsWorking(false);
      await load();
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setAdding(false);
    }
  }

  async function removeHoliday(h: BusinessHoliday) {
    if (!calendar) return;
    const ok = window.confirm(`¿Eliminar la excepción del ${h.holiday_date}?`);
    if (!ok) return;
    try {
      const { error } = await supabase.from("business_holidays").delete().eq("calendar_id", calendar.id).eq("holiday_date", h.holiday_date);
      if (error) throw error;
      await load();
    } catch (e: unknown) {
      setError(errorMessage(e));
    }
  }

  if (sessionLoading || profileLoading) return <AppBootScreen label="Cargando configuración…" />;
  if (!session) return null;
  if (profileError) return <AppNoticeScreen variant="error" title="No se pudo cargar el perfil" description={profileError} />;
  if (!profile) return null;

  if (!canUse) {
    return (
      <AppShell profile={profile}>
        <AppNoticeScreen variant="error" title="Acceso restringido" description="Esta sección es solo para supervisor/admin." />
      </AppShell>
    );
  }

  return (
    <AppShell profile={profile}>
      <div className="space-y-6">
        <PageHeader
          title="Horario laboral"
          description="Controla el horario hábil y feriados. Esto afecta cómo se calculan los vencimientos (SLA/OLA)."
          actions={
            <div className="flex items-center gap-2">
              <Button asChild variant="outline">
                <Link href="/app/settings">Volver</Link>
              </Button>
              <Button variant="outline" onClick={() => void load()} disabled={loading}>
                <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
                Actualizar
              </Button>
            </div>
          }
        />

        {error ? <InlineAlert variant="error" description={error} /> : null}

        <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
          <Card className="tech-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-[hsl(var(--brand-cyan))]" />
                Calendario del departamento
              </CardTitle>
              <CardDescription>Define zona horaria, horario y días hábiles.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : !calendar ? (
                <InlineAlert variant="error" description="No se encontró un calendario activo para este departamento." />
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <div className="text-xs text-muted-foreground">Nombre</div>
                      <Input value={name} onChange={(e) => setName(e.target.value)} />
                    </label>
                    <label className="block">
                      <div className="text-xs text-muted-foreground">Zona horaria</div>
                      <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/Santiago" />
                    </label>
                    <label className="block">
                      <div className="text-xs text-muted-foreground">Inicio</div>
                      <Input type="time" value={workStart} onChange={(e) => setWorkStart(e.target.value)} />
                    </label>
                    <label className="block">
                      <div className="text-xs text-muted-foreground">Término</div>
                      <Input type="time" value={workEnd} onChange={(e) => setWorkEnd(e.target.value)} />
                    </label>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Días hábiles</div>
                    <div className="flex flex-wrap gap-2">
                      {DOW.map((d) => {
                        const checked = workDays.includes(d.iso);
                        return (
                          <button
                            key={d.iso}
                            onClick={() => {
                              setWorkDays((prev) => (prev.includes(d.iso) ? prev.filter((x) => x !== d.iso) : [...prev, d.iso].sort((a, b) => a - b)));
                            }}
                            className={cn(
                              "rounded-xl border px-3 py-2 text-sm transition-colors",
                              checked
                                ? "border-[hsl(var(--brand-cyan))]/35 bg-[hsl(var(--brand-cyan))]/10 text-foreground"
                                : "border-border bg-background/30 text-muted-foreground hover:bg-accent/40"
                            )}
                            type="button"
                          >
                            {d.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="text-xs text-muted-foreground">Actual: {daysLabel || "—"}</div>
                  </div>

                  <div className="flex items-center justify-between rounded-2xl border border-border bg-background/40 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Última actualización</div>
                    <Badge variant="outline">{new Date(calendar.updated_at).toLocaleString()}</Badge>
                  </div>

                  <Button onClick={() => void save()} disabled={saving}>
                    {saving ? "Guardando…" : "Guardar cambios"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="tech-border">
            <CardHeader>
              <CardTitle>Feriados y excepciones</CardTitle>
              <CardDescription>Agrega días no hábiles o marca un fin de semana como hábil.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2">
                <label className="block">
                  <div className="text-xs text-muted-foreground">Fecha</div>
                  <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
                </label>
                <label className="block">
                  <div className="text-xs text-muted-foreground">Nombre (opcional)</div>
                  <Input value={newHolidayName} onChange={(e) => setNewHolidayName(e.target.value)} placeholder="Ej: Feriado local" />
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={newIsWorking} onChange={(e) => setNewIsWorking(e.target.checked)} />
                  Marcar como día hábil
                </label>
                <Button onClick={() => void addHoliday()} disabled={adding || !calendar || !newDate}>
                  <Plus className="h-4 w-4" />
                  {adding ? "Agregando…" : "Agregar"}
                </Button>
              </div>

              <div className="h-px bg-border" />

              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : holidays.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">Sin excepciones configuradas.</div>
              ) : (
                <div className="space-y-2">
                  {holidays.slice(0, 30).map((h) => (
                    <div key={`${h.calendar_id}-${h.holiday_date}`} className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-background/30 p-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{h.holiday_date}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{h.name ?? "—"}</div>
                        <Badge variant="outline" className={cn("mt-2", h.is_working ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-rose-500/30 bg-rose-500/10 text-rose-200")}>
                          {h.is_working ? "Hábil" : "No hábil"}
                        </Badge>
                      </div>
                      <Button variant="outline" size="icon" onClick={() => void removeHoliday(h)} title="Eliminar">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

