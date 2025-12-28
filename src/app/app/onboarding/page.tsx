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
import { useAccessToken, useProfile, useSession } from "@/lib/hooks";
import { useRouter } from "next/navigation";
import { Copy, Link as LinkIcon, RefreshCcw, UserPlus } from "lucide-react";

type InviteResponse = { url: string; groupName: string; hours: number; flags: 0 | 1 | 2 };
type StatusResponse = { running: boolean; lastEventAt: string | null; lastError: string | null };
type TechResponse = {
  itsm: { userId: string; email: string; full_name: string; role: "agent" | "supervisor"; department_id: string };
  meshcentral: { username: string; tempPassword: string; groupName: string };
};

function apiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function extractApiError(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const err = data["error"];
  if (typeof err === "string" && err.trim()) return err;
  return null;
}

async function apiFetch<T>(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = extractApiError(data) ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

function obfuscatePassword(pw: string) {
  if (pw.length <= 6) return "••••••";
  return `${pw.slice(0, 2)}••••••••${pw.slice(-2)}`;
}

export default function OnboardingPage() {
  const router = useRouter();
  const token = useAccessToken();
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error: profileError } = useProfile(session?.user.id);

  const [statusLoading, setStatusLoading] = React.useState(false);
  const [status, setStatus] = React.useState<StatusResponse | null>(null);
  const [statusError, setStatusError] = React.useState<string | null>(null);

  const [inviteLoading, setInviteLoading] = React.useState(false);
  const [inviteError, setInviteError] = React.useState<string | null>(null);
  const [invite, setInvite] = React.useState<InviteResponse | null>(null);
  const [inviteHours, setInviteHours] = React.useState(24);

  const [techLoading, setTechLoading] = React.useState(false);
  const [techError, setTechError] = React.useState<string | null>(null);
  const [techRes, setTechRes] = React.useState<TechResponse | null>(null);

  const [techEmail, setTechEmail] = React.useState("");
  const [techName, setTechName] = React.useState("");
  const [techRole, setTechRole] = React.useState<"agent" | "supervisor">("agent");
  const [meshUsername, setMeshUsername] = React.useState("");

  React.useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  const canUse = profile?.role === "agent" || profile?.role === "supervisor" || profile?.role === "admin";
  const isAdmin = profile?.role === "admin";

  async function loadStatus() {
    if (!token) return;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const data = await apiFetch<StatusResponse>(token, "/api/meshcentral/status");
      setStatus(data);
    } catch (e: unknown) {
      setStatus(null);
      setStatusError(e instanceof Error ? e.message : "No se pudo consultar el estado.");
    } finally {
      setStatusLoading(false);
    }
  }

  async function generateInvite() {
    if (!token) return;
    setInviteLoading(true);
    setInviteError(null);
    setInvite(null);
    try {
      const data = await apiFetch<InviteResponse>(token, "/api/meshcentral/invite", {
        method: "POST",
        body: JSON.stringify({ hours: inviteHours, flags: 0 }),
      });
      setInvite(data);
      await loadStatus();
    } catch (e: unknown) {
      setInviteError(e instanceof Error ? e.message : "No se pudo generar el enlace.");
    } finally {
      setInviteLoading(false);
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
          mesh_username: meshUsername.trim() || undefined,
        }),
      });
      setTechRes(data);
      await loadStatus();
    } catch (e: unknown) {
      setTechError(e instanceof Error ? e.message : "No se pudo crear el técnico.");
    } finally {
      setTechLoading(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
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
      <PageHeader title="Onboarding" description="Incorpora técnicos y equipos con un flujo simple (MeshCentral + activos)." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="tech-border rounded-3xl p-[1px]">
          <div className="rounded-3xl glass-surface">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LinkIcon className="h-4 w-4 text-[hsl(var(--brand-cyan))]" /> Enrolar equipo (MeshAgent)
              </CardTitle>
              <CardDescription>Genera un enlace de instalación. Al conectarse el agente, se registra el equipo en Activos automáticamente.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {inviteError ? <InlineAlert variant="error" title="Error" description={inviteError} /> : null}

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-muted-foreground">
                  Grupo MeshCentral: <span className="text-foreground">{invite?.groupName ?? "TI"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={String(inviteHours)}
                    onChange={(e) => setInviteHours(Number(e.target.value) || 24)}
                    className="h-9 w-24"
                    inputMode="numeric"
                    placeholder="24"
                  />
                  <div className="text-xs text-muted-foreground">horas</div>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={generateInvite} disabled={!token || inviteLoading}>
                  {inviteLoading ? "Generando…" : "Generar link"}
                </Button>
                <Button variant="outline" onClick={loadStatus} disabled={!token || statusLoading}>
                  <RefreshCcw className={cn("h-4 w-4", statusLoading && "animate-spin")} />
                  Estado MeshCentral
                </Button>
              </div>

              {invite?.url ? (
                <div className="rounded-2xl border border-border bg-background/40 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">Enlace de instalación</div>
                      <div className="mt-1 break-all text-sm">{invite.url}</div>
                    </div>
                    <Button size="icon" variant="outline" onClick={() => copy(invite.url)} title="Copiar">
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="flex items-center justify-between rounded-2xl border border-border bg-background/40 px-3 py-2">
                <div className="text-xs text-muted-foreground">Auto-sync al conectar</div>
                {status ? (
                  <Badge
                    variant="outline"
                    className={cn(
                      status.running ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-rose-500/30 bg-rose-500/10 text-rose-200"
                    )}
                  >
                    {status.running ? "Activo" : "Detenido"}
                  </Badge>
                ) : (
                  <Badge variant="outline">Sin estado</Badge>
                )}
              </div>

              {statusError ? <div className="text-xs text-rose-200/90">{statusError}</div> : null}
              {status?.lastError ? <div className="text-xs text-amber-200/90">Último error: {status.lastError}</div> : null}
              {status?.lastEventAt ? <div className="text-xs text-muted-foreground">Último evento: {new Date(status.lastEventAt).toLocaleString()}</div> : null}
            </CardContent>
          </div>
        </Card>

        <Card className="tech-border rounded-3xl p-[1px]">
          <div className="rounded-3xl glass-surface">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-[hsl(var(--brand-cyan))]" /> Incorporar técnico
              </CardTitle>
              <CardDescription>Crea el usuario en ITSM y en MeshCentral, y lo deja con acceso al grupo del departamento (TI).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!isAdmin ? (
                <InlineAlert variant="info" title="Solo admin" description="Para incorporar técnicos necesitas rol admin en ITSM." />
              ) : null}
              {techError ? <InlineAlert variant="error" title="Error" description={techError} /> : null}

              <div className="grid gap-2 sm:grid-cols-2">
                <Input value={techEmail} onChange={(e) => setTechEmail(e.target.value)} placeholder="correo@empresa.com" disabled={!isAdmin} />
                <Input value={techName} onChange={(e) => setTechName(e.target.value)} placeholder="Nombre completo" disabled={!isAdmin} />
                <Input value={meshUsername} onChange={(e) => setMeshUsername(e.target.value)} placeholder="MeshCentral username (opcional)" disabled={!isAdmin} />
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
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">MeshCentral</div>
                      <div className="mt-1 text-sm">
                        {techRes.meshcentral.username} · <span className="text-muted-foreground">{obfuscatePassword(techRes.meshcentral.tempPassword)}</span>
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => copy(`user=${techRes.meshcentral.username}\npass=${techRes.meshcentral.tempPassword}`)}
                      title="Copiar credenciales"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Grupo: <span className="text-foreground">{techRes.meshcentral.groupName}</span> · El usuario pedirá cambio de contraseña al primer login.
                  </div>
                </div>
              ) : null}
            </CardContent>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

