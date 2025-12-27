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
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { IconAnalytics, IconApprovals, IconCatalog, IconKb, IconSla, IconTickets } from "@/components/icons/nav-icons";
import { motion } from "framer-motion";

export default function HomePage() {
  const router = useRouter();
  const { loading, session } = useSession();
  const loginTo = (path: string) => `/login?next=${encodeURIComponent(path)}`;

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
              Portal de Soporte
            </Badge>
          </div>

          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <Link href="#inicio" className="hover:text-foreground">
              Inicio
            </Link>
            <Link href="#como-funciona" className="hover:text-foreground">
              Cómo funciona
            </Link>
            <Link href="#beneficios" className="hover:text-foreground">
              Beneficios
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/login">Ingresar</Link>
            </Button>
            <Button asChild className="hidden sm:inline-flex">
              <Link href={loginTo("/app/catalog")}>
                Nueva solicitud <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-10 px-6 py-10 md:py-14">
        <section id="inicio" className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="relative space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-[hsl(var(--brand-cyan))]/30 bg-[hsl(var(--brand-cyan))]/10 text-[hsl(var(--brand-cyan))]">
                <Sparkles className="h-3.5 w-3.5" />
                Soporte claro y rápido
              </Badge>
              <Badge variant="outline">Catálogo de servicios</Badge>
              <Badge variant="outline">Seguimiento</Badge>
              <Badge variant="outline">Aprobaciones</Badge>
            </div>

            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
              Un portal de soporte{" "}
              <span className="text-[hsl(var(--brand-cyan))]">profesional</span> para tus solicitudes.
            </h1>
            <p className="max-w-2xl text-base text-muted-foreground md:text-lg">
              Elige un servicio, completa la información necesaria y sigue el avance con estados claros, responsables y trazabilidad. Menos vueltas, más solución.
            </p>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button asChild size="lg">
                <Link href="/login">
                  Ingresar <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href={loginTo("/app/catalog")}>Nueva solicitud</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="sm:hidden">
                <Link href={loginTo("/app/kb")}>Centro de ayuda</Link>
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: "Nueva solicitud", value: "Servicios guiados y formularios inteligentes.", icon: IconCatalog, href: loginTo("/app/catalog") },
                { label: "Mis solicitudes", value: "Estados, actividad y trazabilidad.", icon: IconTickets, href: loginTo("/app") },
                { label: "Centro de ayuda", value: "Resuelve más rápido con autoservicio.", icon: IconKb, href: loginTo("/app/kb") },
              ].map((k) => {
                const Icon = k.icon;
                return (
                  <Link key={k.label} href={k.href} className="group">
                    <div className="rounded-2xl glass-surface p-4 transition-colors hover:tech-glow">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="grid h-8 w-8 place-items-center rounded-xl bg-[hsl(var(--brand-cyan))]/10 text-[hsl(var(--brand-cyan))]">
                          <Icon className="h-4 w-4" />
                        </span>
                        {k.label}
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">{k.value}</div>
                      <div className="mt-3 text-xs text-[hsl(var(--brand-cyan))] opacity-0 transition-opacity group-hover:opacity-100">
                        Abrir <ArrowRight className="inline h-3.5 w-3.5" />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>

            <motion.div
              aria-hidden
              className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[hsl(var(--brand-violet))]/15 blur-3xl"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
            />
            <motion.div
              aria-hidden
              className="pointer-events-none absolute -left-24 -bottom-24 h-64 w-64 rounded-full bg-[hsl(var(--brand-cyan))]/15 blur-3xl"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.7, ease: "easeOut", delay: 0.1 }}
            />
          </div>

          <motion.div
            className="tech-border rounded-3xl p-[1px]"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
          >
            <div className="relative overflow-hidden rounded-3xl glass-surface p-5">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Seguimiento del caso</div>
                <Badge variant="outline">Estado</Badge>
              </div>
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl glass-surface p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">VPN no conecta</div>
                      <div className="mt-1 text-xs text-muted-foreground">Prioridad Alta · En revisión</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="border-[hsl(var(--brand-cyan))]/30 bg-[hsl(var(--brand-cyan))]/10 text-[hsl(var(--brand-cyan))]">
                        En tiempo
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
                    { title: "Aprobaciones", desc: "Cuando aplica, aprueba desde un panel simple.", icon: IconApprovals },
                    { title: "Centro de ayuda", desc: "Encuentra respuestas antes de abrir un caso.", icon: IconKb },
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
            </div>
          </motion.div>
        </section>

        <section id="como-funciona" className="space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-2xl font-semibold tracking-tight">Cómo funciona</div>
              <div className="mt-1 text-sm text-muted-foreground">Un flujo simple para pedir ayuda y obtener respuesta.</div>
            </div>
            <Button asChild variant="outline">
              <Link href={loginTo("/app/catalog")}>Nueva solicitud</Link>
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {[
              { title: "1) Elige un servicio", desc: "Selecciona la solicitud correcta y evita idas y vueltas.", icon: IconCatalog },
              { title: "2) Completa el formulario", desc: "Campos claros y contexto para resolver más rápido.", icon: IconTickets },
              { title: "3) Aprobación (si aplica)", desc: "Manager/Owner decide y libera la ejecución.", icon: IconApprovals },
              { title: "4) Seguimiento", desc: "Estados, comentarios y trazabilidad en un solo lugar.", icon: IconAnalytics },
            ].map((f) => {
              const Icon = f.icon;
              return (
                <Card key={f.title} className={cn("tech-border transition-colors hover:tech-glow")}>
                  <CardHeader className="gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-[hsl(var(--brand-cyan))]/10 text-[hsl(var(--brand-cyan))]">
                        <Icon className="h-4 w-4" />
                      </span>
                      {f.title}
                    </CardTitle>
                    <CardDescription className="mt-2">{f.desc}</CardDescription>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </section>

        <section id="beneficios" className="space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-2xl font-semibold tracking-tight">Beneficios</div>
              <div className="mt-1 text-sm text-muted-foreground">Diseñado para que el usuario entienda, confíe y avance.</div>
            </div>
            <Button asChild variant="outline">
              <Link href="/login">Ingresar</Link>
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Card className="tech-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[hsl(var(--brand-cyan))]" />
                  Transparencia de punta a punta
                </CardTitle>
                <CardDescription>Siempre sabrás qué está pasando con tu solicitud.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-3">
                {[
                  { k: "Estados claros", v: "Qué falta y quién lo tiene." },
                  { k: "Trazabilidad", v: "Historial y decisiones visibles." },
                  { k: "Tiempos", v: "Compromisos por prioridad/servicio." },
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
                <CardTitle>Experiencia moderna, sin fricción</CardTitle>
                <CardDescription>Interfaz consistente, rápida y enfocada en la acción.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                {[
                  "Catálogo guiado para reducir errores.",
                  "Aprobaciones simples cuando son necesarias.",
                  "Autoservicio para resolver más rápido.",
                ].map((t) => (
                  <div key={t} className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-xl bg-[hsl(var(--brand-cyan))]/10 text-[hsl(var(--brand-cyan))]">
                      <CheckCircle2 className="h-4 w-4" />
                    </span>
                    {t}
                  </div>
                ))}
                <Button asChild className="w-full">
                  <Link href={loginTo("/app/catalog")}>Crear solicitud</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold tracking-tight">¿Eres parte del equipo de soporte?</div>
              <div className="mt-1 text-sm text-muted-foreground">Dashboards, KPIs y control operativo para supervisión.</div>
            </div>
            <Button asChild variant="outline">
              <Link href="/login">Entrar</Link>
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {[
              { title: "Operación", desc: "Gestión de tickets, estados y asignación.", icon: IconTickets },
              { title: "Niveles de servicio", desc: "SLA/OLA por servicio y prioridad.", icon: IconSla },
              { title: "Analítica", desc: "KPIs y tendencias para supervisión.", icon: IconAnalytics },
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
                    <Badge variant="outline">Pro</Badge>
                    <Link href="/login" className="text-sm text-[hsl(var(--brand-cyan))] hover:underline">
                      Abrir <ArrowRight className="inline h-4 w-4" />
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-background/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-6 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-muted-foreground">© {new Date().getFullYear()} Service Desk</div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <Link href="/login" className="hover:text-foreground">
              Ingresar
            </Link>
            <Link href={loginTo("/app/catalog")} className="hover:text-foreground">
              Catálogo
            </Link>
            <Link href={loginTo("/app/kb")} className="hover:text-foreground">
              Centro de ayuda
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
