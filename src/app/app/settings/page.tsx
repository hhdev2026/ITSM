"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { AppBootScreen, AppNoticeScreen } from "@/components/layout/AppStates";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { useProfile, useSession } from "@/lib/hooks";
import { supabase } from "@/lib/supabaseBrowser";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Clock, HardDrive, Settings2, Users } from "lucide-react";

export default function SettingsPage() {
  const router = useRouter();
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error } = useProfile(session?.user.id);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ slas: number; olas: number; categories: number; holidays: number } | null>(null);

  useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  const canUse = profile?.role === "supervisor" || profile?.role === "admin";
  const deptId = profile?.department_id ?? null;

  useEffect(() => {
    if (!profile || !deptId) return;
    if (!canUse) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);

    async function load() {
      try {
        const [slas, olas, cats, cals] = await Promise.all([
          supabase.from("slas").select("id", { count: "exact", head: true }).or(`department_id.is.null,department_id.eq.${deptId}`),
          supabase.from("olas").select("id", { count: "exact", head: true }).or(`department_id.is.null,department_id.eq.${deptId}`),
          supabase.from("categories").select("id", { count: "exact", head: true }).eq("department_id", deptId),
          supabase.from("business_calendars").select("id").or(`department_id.is.null,department_id.eq.${deptId}`).eq("is_active", true).limit(10),
        ]);

        const ids = (cals.data ?? []).map((r) => (r as { id: string }).id);
        const hols = ids.length
          ? await supabase.from("business_holidays").select("calendar_id", { count: "exact", head: true }).in("calendar_id", ids)
          : { count: 0 };

        const next = {
          slas: slas.count ?? 0,
          olas: olas.count ?? 0,
          categories: cats.count ?? 0,
          holidays: hols.count ?? 0,
        };
        if (!cancelled) setCounts(next);
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "No se pudo cargar configuración.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [canUse, deptId, profile]);

  if (sessionLoading || profileLoading) return <AppBootScreen label="Cargando configuración…" />;
  if (!session) return null;
  if (error) return <AppNoticeScreen variant="error" title="No se pudo cargar el perfil" description={error} />;
  if (!profile) return null;

  if (!canUse) {
    return (
      <AppShell profile={profile}>
        <AppNoticeScreen variant="error" title="Acceso restringido" description="Esta sección es solo para supervisor/admin." />
      </AppShell>
    );
  }

  const tiles = [
    {
      title: "SLA / OLA",
      description: "SLA = lo que prometes al usuario. OLA = cómo se organiza el equipo internamente para cumplirlo (por prioridad).",
      href: "/app/slas",
      icon: <Clock className="h-4 w-4 text-[hsl(var(--brand-cyan))]" />,
      meta: counts ? `${counts.slas} SLA · ${counts.olas} OLA` : null,
    },
    {
      title: "Horario laboral y feriados",
      description: "Define horario hábil, zona horaria y excepciones (feriados / días hábiles especiales).",
      href: "/app/settings/business-hours",
      icon: <CalendarClock className="h-4 w-4 text-[hsl(var(--brand-cyan))]" />,
      meta: counts ? `${counts.holidays} excepciones` : null,
    },
    {
      title: "Categorías de soporte",
      description: "Personaliza categorías y subcategorías que usan tickets y chat.",
      href: "/app/settings/categories",
      icon: <Settings2 className="h-4 w-4 text-[hsl(var(--brand-cyan))]" />,
      meta: counts ? `${counts.categories} categorías` : null,
    },
    {
      title: "Usuarios y roles",
      description: "Gestiona usuarios, roles y acceso.",
      href: "/app/admin/users",
      icon: <Users className="h-4 w-4 text-[hsl(var(--brand-cyan))]" />,
      meta: null,
    },
    {
      title: "Activos y onboarding",
      description: "Configura inventario y el flujo de enrolamiento (agente remoto).",
      href: "/app/onboarding",
      icon: <HardDrive className="h-4 w-4 text-[hsl(var(--brand-cyan))]" />,
      meta: null,
    },
  ];

  return (
    <AppShell profile={profile}>
      <div className="space-y-6">
        <PageHeader
          title="Configuración"
          description="Personaliza cómo opera el ITSM: tiempos, horarios, categorías, usuarios y onboarding."
          actions={
            <Button asChild variant="outline">
              <Link href="/app">Volver</Link>
            </Button>
          }
        />

        {err ? <InlineAlert variant="error" description={err} /> : null}

        <div className="grid gap-4 lg:grid-cols-2">
          {tiles.map((t) => (
            <Card key={t.href} className="tech-border">
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2">
                    {t.icon}
                    {t.title}
                  </CardTitle>
                  <CardDescription className="mt-2">{t.description}</CardDescription>
                </div>
                {loading ? <Badge variant="outline">…</Badge> : t.meta ? <Badge variant="outline">{t.meta}</Badge> : null}
              </CardHeader>
              <CardContent>
                <Button asChild className="w-full">
                  <Link href={t.href}>Abrir</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
