"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/hooks";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { ArrowRight, Lock, Sparkles } from "lucide-react";
import { IconAnalytics, IconApprovals, IconCatalog, IconKb, IconSla, IconTickets } from "@/components/icons/nav-icons";

export default function HomePage() {
  const router = useRouter();
  const { loading, session } = useSession();

  useEffect(() => {
    if (!loading && session) router.replace("/app");
  }, [loading, session, router]);

  return (
    <div className="min-h-dvh tech-app-bg">
      <header className="sticky top-0 z-40 border-b border-border bg-background/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <Logo />
            <Badge variant="outline" className="hidden sm:inline-flex">
              ITSM · ITIL
            </Badge>
          </div>

          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <Link href="#plataforma" className="hover:text-foreground">
              Plataforma
            </Link>
            <Link href="#modulos" className="hover:text-foreground">
              Módulos
            </Link>
            <Link href="#seguridad" className="hover:text-foreground">
              Seguridad
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/login">Ingresar</Link>
            </Button>
            <Button asChild className="hidden sm:inline-flex">
              <Link href="/login">
                Crear cuenta <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-10 px-6 py-10 md:py-14">
        <section id="plataforma" className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-[hsl(var(--brand-cyan))]/30 bg-[hsl(var(--brand-cyan))]/10 text-[hsl(var(--brand-cyan))]">
                <Sparkles className="h-3.5 w-3.5" />
                CRM-grade service desk
              </Badge>
              <Badge variant="outline">Catálogo</Badge>
              <Badge variant="outline">Aprobaciones</Badge>
              <Badge variant="outline">SLA/OLA</Badge>
            </div>

            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
              Service Desk moderno, <span className="text-[hsl(var(--brand-cyan))]">rápido</span> y auditable.
            </h1>
            <p className="max-w-2xl text-base text-muted-foreground md:text-lg">
              Diseñado como un CRM profesional: catálogo de servicios con formularios dinámicos, aprobaciones multi‑nivel, SLAs/OLAs por servicio y autoservicio para reducir volumen.
            </p>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button asChild size="lg">
                <Link href="/login">
                  Entrar <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/app/catalog">Ver catálogo</Link>
              </Button>
              <div className="text-xs text-muted-foreground">
                Demo local disponible desde <Link className="text-[hsl(var(--brand-cyan))] hover:underline" href="/login">/login</Link>.
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: "Service Catalog", value: "Formularios + metadata", icon: IconCatalog },
                { label: "Aprobaciones", value: "Manager/Owner", icon: IconApprovals },
                { label: "SLA/OLA", value: "Por servicio y prioridad", icon: IconSla },
              ].map((k) => {
                const Icon = k.icon;
                return (
                  <div key={k.label} className="rounded-2xl glass-surface p-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="grid h-8 w-8 place-items-center rounded-xl bg-[hsl(var(--brand-cyan))]/10 text-[hsl(var(--brand-cyan))]">
                        <Icon className="h-4 w-4" />
                      </span>
                      {k.label}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">{k.value}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="tech-border rounded-3xl p-[1px]">
            <div className="relative overflow-hidden rounded-3xl glass-surface p-5">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Vista ejecutiva</div>
                <Badge variant="outline">Live</Badge>
              </div>
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl glass-surface p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">VPN no conecta · Incidente</div>
                      <div className="mt-1 text-xs text-muted-foreground">Prioridad Alta · Pendiente Aprobación</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="border-[hsl(var(--brand-cyan))]/30 bg-[hsl(var(--brand-cyan))]/10 text-[hsl(var(--brand-cyan))]">
                        SLA OK
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2">
                    <div className="h-2 w-10/12 rounded-full bg-foreground/10" />
                    <div className="h-2 w-8/12 rounded-full bg-foreground/10" />
                    <div className="h-2 w-9/12 rounded-full bg-foreground/10" />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    { title: "Aprobaciones", desc: "Decide y libera el ticket.", icon: IconApprovals },
                    { title: "Centro de ayuda", desc: "Deflection con KB.", icon: IconKb },
                  ].map((x) => {
                    const Icon = x.icon;
                    return (
                      <div key={x.title} className="rounded-2xl glass-surface p-4">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Icon className="h-4 w-4 text-[hsl(var(--brand-cyan))]" />
                          {x.title}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">{x.desc}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[hsl(var(--brand-violet))]/15 blur-3xl" />
              <div className="pointer-events-none absolute -left-24 -bottom-24 h-64 w-64 rounded-full bg-[hsl(var(--brand-cyan))]/15 blur-3xl" />
            </div>
          </div>
        </section>

        <section id="modulos" className="space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-2xl font-semibold tracking-tight">Módulos core</div>
              <div className="mt-1 text-sm text-muted-foreground">Lenguaje, navegación y UX pensados para mesa de ayuda enterprise.</div>
            </div>
            <Button asChild variant="outline">
              <Link href="/login">Entrar</Link>
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {[
              { title: "Gestión de tickets", desc: "Ciclos de vida, actividad, asignación y trazabilidad.", icon: IconTickets },
              { title: "Catálogo de servicios", desc: "Solicitudes estandarizadas con campos dinámicos.", icon: IconCatalog },
              { title: "Aprobaciones", desc: "Manager/Owner y multi‑nivel por servicio.", icon: IconApprovals },
              { title: "SLA/OLA", desc: "Tiempos por servicio/prioridad, badges y vencimientos.", icon: IconSla },
              { title: "Centro de ayuda", desc: "Knowledge Base para autoservicio y reducción de tickets.", icon: IconKb },
              { title: "Indicadores", desc: "KPIs operacionales para supervisión y capacidad.", icon: IconAnalytics },
            ].map((f) => {
              const Icon = f.icon;
              return (
                <Card key={f.title} className={cn("tech-border transition-colors hover:tech-glow")}>
                  <CardHeader className="gap-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[hsl(var(--brand-cyan))]/10 text-[hsl(var(--brand-cyan))]">
                            <Icon className="h-4 w-4" />
                          </span>
                          {f.title}
                        </CardTitle>
                        <CardDescription className="mt-2">{f.desc}</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between">
                    <Badge variant="outline">UX ready</Badge>
                    <Link href="/login" className="text-sm text-[hsl(var(--brand-cyan))] hover:underline">
                      Abrir <ArrowRight className="inline h-4 w-4" />
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <section id="seguridad" className="grid gap-3 md:grid-cols-3">
          <Card className="tech-border md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-[hsl(var(--brand-cyan))]" />
                Seguridad y auditoría
              </CardTitle>
              <CardDescription>Diseñado para operar por departamentos y roles.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              {[
                { k: "RLS", v: "Políticas por rol/depto." },
                { k: "Audit", v: "Decisiones y timestamps." },
                { k: "Supabase", v: "Auth + DB + Storage." },
              ].map((x) => (
                <div key={x.k} className="rounded-2xl glass-surface p-4">
                  <div className="text-sm font-semibold">{x.k}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{x.v}</div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="tech-border">
            <CardHeader>
              <CardTitle>Listo para operar</CardTitle>
              <CardDescription>UX consistente, accesible y rápida.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-[hsl(var(--brand-cyan))]/10 text-[hsl(var(--brand-cyan))]">
                  <Sparkles className="h-4 w-4" />
                </span>
                Diseño tech profesional (dark/light).
              </div>
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-[hsl(var(--brand-cyan))]/10 text-[hsl(var(--brand-cyan))]">
                  <ArrowRight className="h-4 w-4" />
                </span>
                Flujo “solicitante → aprobaciones → ejecución”.
              </div>
              <Button asChild className="w-full">
                <Link href="/login">Empezar</Link>
              </Button>
            </CardContent>
          </Card>
        </section>
      </main>

      <footer className="border-t border-border bg-background/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-6 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-muted-foreground">© {new Date().getFullYear()} Service Desk · ITSM</div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <Link href="/login" className="hover:text-foreground">
              Login
            </Link>
            <Link href="/app/catalog" className="hover:text-foreground">
              Catálogo
            </Link>
            <Link href="/app/kb" className="hover:text-foreground">
              Centro de ayuda
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
