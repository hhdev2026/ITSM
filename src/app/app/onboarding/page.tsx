"use client";

import * as React from "react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { AppBootScreen, AppNoticeScreen } from "@/components/layout/AppStates";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { apiFetch } from "@/lib/apiClient";
import { useAccessToken, useProfile, useSession } from "@/lib/hooks";
import { useRouter } from "next/navigation";
import { RefreshCcw, UserPlus } from "lucide-react";

type NetlockStatusResponse = {
  provider: "netlock";
  configured: boolean;
  connectivity: { ok: boolean; checkedAt: string; error: string | null } | null;
  details?: { connected?: number };
};
type TechResponse = {
  itsm: { userId: string; email: string; full_name: string; role: "agent" | "supervisor"; department_id: string };
};

export default function OnboardingPage() {
  const router = useRouter();
  const token = useAccessToken();
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error: profileError } = useProfile(session?.user.id);

  const [netlockLoading, setNetlockLoading] = React.useState(false);
  const [netlock, setNetlock] = React.useState<NetlockStatusResponse | null>(null);
  const [netlockError, setNetlockError] = React.useState<string | null>(null);

  const [techLoading, setTechLoading] = React.useState(false);
  const [techError, setTechError] = React.useState<string | null>(null);
  const [techRes, setTechRes] = React.useState<TechResponse | null>(null);

  const [techEmail, setTechEmail] = React.useState("");
  const [techName, setTechName] = React.useState("");
  const [techRole, setTechRole] = React.useState<"agent" | "supervisor">("agent");

  React.useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  const canUse = profile?.role === "agent" || profile?.role === "supervisor" || profile?.role === "admin";
  const isAdmin = profile?.role === "admin";

  async function loadNetlockStatus() {
    if (!token) return;
    setNetlockLoading(true);
    setNetlockError(null);
    try {
      const data = await apiFetch<NetlockStatusResponse>(token, "/api/agent/status");
      setNetlock(data);
    } catch (e: unknown) {
      setNetlock(null);
      setNetlockError(e instanceof Error ? e.message : "No se pudo consultar el estado del servicio de soporte remoto.");
    } finally {
      setNetlockLoading(false);
    }
  }

  async function createTech() {
    if (!token) return;
    setTechLoading(true);
    setTechError(null);
    setTechRes(null);
    try {
      const data = await apiFetch<TechResponse>(token, "/api/onboarding/tech", {
        method: "POST",
        body: JSON.stringify({
          email: techEmail,
          full_name: techName,
          role: techRole,
        }),
      });
      setTechRes(data);
      await loadNetlockStatus();
    } catch (e: unknown) {
      setTechError(e instanceof Error ? e.message : "No se pudo crear el técnico.");
    } finally {
      setTechLoading(false);
    }
  }

  if (sessionLoading || profileLoading) return <AppBootScreen label="Preparando onboarding…" />;
  if (!session) return null;
  if (profileError) return <AppNoticeScreen variant="error" title="No se pudo cargar el perfil" description={profileError} />;
  if (!profile) return <AppNoticeScreen title="Perfil no disponible" description="Espera unos segundos y recarga." />;
  if (!canUse) {
    return (
      <AppShell profile={profile}>
        <AppNoticeScreen variant="error" title="Acceso restringido" description="Esta vista es solo para agentes/supervisores/admin." />
      </AppShell>
    );
  }

  return (
    <AppShell profile={profile}>
      <PageHeader title="Onboarding" description="Incorpora técnicos y equipos con un flujo simple (soporte remoto + activos)." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="tech-border rounded-3xl p-[1px]">
          <div className="rounded-3xl glass-surface">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCcw className={cn("h-4 w-4 text-[hsl(var(--brand-cyan))]", netlockLoading && "animate-spin")} /> Estado soporte remoto
              </CardTitle>
              <CardDescription>Comprueba conectividad con el Files server (API key) para generación de instaladores y verificación.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {netlockError ? <InlineAlert variant="error" title="No se pudo consultar" description={netlockError} /> : null}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" onClick={loadNetlockStatus} disabled={!token || netlockLoading}>
                  Ver estado
                </Button>
              </div>

              {netlock ? (
                <div className="flex items-center justify-between rounded-2xl border border-border bg-background/40 px-3 py-2">
                  <div className="text-xs text-muted-foreground">Conectividad</div>
                  <Badge
                    variant="outline"
                    className={cn(
                      netlock.connectivity?.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-500/30 bg-amber-500/10 text-amber-100"
                    )}
                  >
                    {netlock.connectivity?.ok ? "OK" : "Revisar"}
                  </Badge>
                </div>
              ) : (
                <Badge variant="outline">Sin estado</Badge>
              )}

              {netlock?.connectivity?.error ? <div className="text-xs text-amber-200/90">Detalle: {netlock.connectivity.error}</div> : null}
              {typeof netlock?.details?.connected === "number" ? (
                <div className="text-xs text-muted-foreground">Conectados: {netlock.details.connected}</div>
              ) : null}
            </CardContent>
          </div>
        </Card>

        <Card className="tech-border rounded-3xl p-[1px]">
          <div className="rounded-3xl glass-surface">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-[hsl(var(--brand-cyan))]" /> Incorporar técnico
              </CardTitle>
              <CardDescription>Crea el usuario en ITSM y lo deja listo con rol y departamento.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!isAdmin ? (
                <InlineAlert variant="info" title="Solo admin" description="Para incorporar técnicos necesitas rol admin en ITSM." />
              ) : null}
              {techError ? <InlineAlert variant="error" title="Error" description={techError} /> : null}

              <div className="grid gap-2 sm:grid-cols-2">
                <Input value={techEmail} onChange={(e) => setTechEmail(e.target.value)} placeholder="correo@empresa.com" disabled={!isAdmin} />
                <Input value={techName} onChange={(e) => setTechName(e.target.value)} placeholder="Nombre completo" disabled={!isAdmin} />
                <div className="flex gap-2">
                  <Button variant={techRole === "agent" ? "default" : "outline"} className="w-full" onClick={() => setTechRole("agent")} disabled={!isAdmin}>
                    Agent
                  </Button>
                  <Button
                    variant={techRole === "supervisor" ? "default" : "outline"}
                    className="w-full"
                    onClick={() => setTechRole("supervisor")}
                    disabled={!isAdmin}
                  >
                    Supervisor
                  </Button>
                </div>
              </div>

              <Button onClick={createTech} disabled={!isAdmin || !token || techLoading}>
                {techLoading ? "Creando…" : "Crear técnico"}
              </Button>

              {techRes ? (
                <div className="rounded-2xl border border-border bg-background/40 p-3 space-y-2">
                  <div className="text-sm font-semibold">Listo</div>
                  <div className="text-xs text-muted-foreground">ITSM: {techRes.itsm.email}</div>
                  <div className="text-xs text-muted-foreground">El usuario recibirá un email de invitación para activar su cuenta.</div>
                </div>
              ) : null}
            </CardContent>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
