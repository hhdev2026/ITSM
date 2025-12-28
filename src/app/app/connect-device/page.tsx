"use client";

import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { AppBootScreen, AppNoticeScreen } from "@/components/layout/AppStates";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/error";
import { useAccessToken, useProfile, useSession } from "@/lib/hooks";
import { supabase } from "@/lib/supabaseBrowser";
import type { Asset, Profile } from "@/lib/types";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Copy, Laptop, Link as LinkIcon, RefreshCcw } from "lucide-react";

type InviteResponse = { url: string; groupName: string; hours: number; flags: 0 | 1 | 2 };
type AssetLite = Pick<Asset, "id" | "name" | "serial_number" | "asset_type" | "connectivity_status" | "updated_at" | "mesh_node_id">;
type AssignmentRow = { id: string; assigned_at: string; asset: AssetLite | null };

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

function displayName(p: Pick<Profile, "full_name" | "email"> | null | undefined) {
  if (!p) return "—";
  return p.full_name?.trim() || p.email;
}

export default function ConnectDevicePage() {
  const token = useAccessToken();
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error: profileError } = useProfile(session?.user.id);

  const [inviteHours, setInviteHours] = useState(24);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteResponse | null>(null);

  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetLite[]>([]);

  const canUse = !!profile;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  }

  async function generateInvite() {
    if (!token) return;
    setInviteLoading(true);
    setInviteError(null);
    setInvite(null);
    try {
      const data = await apiFetch<InviteResponse>(token, "/api/meshcentral/invite/self", {
        method: "POST",
        body: JSON.stringify({ hours: inviteHours }),
      });
      setInvite(data);
    } catch (e: unknown) {
      setInviteError(e instanceof Error ? e.message : "No se pudo generar el enlace.");
    } finally {
      setInviteLoading(false);
    }
  }

  async function loadMyAssets() {
    if (!profile) return;
    setAssetsLoading(true);
    setAssetsError(null);
    try {
      const { data, error } = await supabase
        .from("asset_assignments")
        .select("id,assigned_at,asset:assets(id,name,serial_number,asset_type,connectivity_status,updated_at,mesh_node_id)")
        .eq("user_id", profile.id)
        .is("ended_at", null)
        .order("assigned_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      const list = ((data ?? []) as unknown as AssignmentRow[]).map((r) => r.asset).filter((a): a is AssetLite => !!a);
      setAssets(list);
    } catch (e) {
      setAssetsError(errorMessage(e));
      setAssets([]);
    } finally {
      setAssetsLoading(false);
    }
  }

  useEffect(() => {
    if (!profile) return;
    void loadMyAssets();
    const channel = supabase
      .channel(`rt-assets-user-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "asset_assignments", filter: `user_id=eq.${profile.id}` }, () => void loadMyAssets())
      .subscribe();
    return () => void supabase.removeChannel(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const hint = useMemo(() => {
    if (!invite?.groupName) return null;
    return `Tu link es personal. Al instalar el agente, el equipo quedará asociado a tu cuenta automáticamente.`;
  }, [invite?.groupName]);

  if (sessionLoading || profileLoading) return <AppBootScreen label="Preparando…" />;
  if (!session) return <AppNoticeScreen title="Inicia sesión" description="Debes iniciar sesión para registrar tu equipo." />;
  if (profileError) return <AppNoticeScreen variant="error" title="No se pudo cargar tu perfil" description={profileError} />;
  if (!profile) return <AppNoticeScreen title="Perfil no disponible" description="Espera unos segundos y recarga." />;

  if (!canUse) {
    return (
      <AppShell profile={profile}>
        <AppNoticeScreen variant="error" title="Acceso restringido" description="No se pudo validar tu cuenta." />
      </AppShell>
    );
  }

  return (
    <AppShell profile={profile}>
      <div className="space-y-5">
        <PageHeader
          title="Conectar mi PC"
          description="Registra tu equipo para inventario y soporte remoto (MeshCentral + Activos)."
          actions={
            <Button variant="outline" asChild>
              <Link href="/app/assets">Ver mis equipos</Link>
            </Button>
          }
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="tech-border rounded-3xl p-[1px]">
            <div className="rounded-3xl glass-surface">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LinkIcon className="h-4 w-4 text-[hsl(var(--brand-cyan))]" /> Enrolar equipo (MeshAgent)
                </CardTitle>
                <CardDescription>
                  Genera un link de instalación, instálalo en tu PC y quedará registrado. Si después necesitas ayuda, soporte podrá tomar control desde el chat.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {inviteError ? <InlineAlert variant="error" title="Error" description={inviteError} /> : null}

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-muted-foreground">
                    Cuenta: <span className="text-foreground">{displayName(profile)}</span>
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
                  <Button variant="outline" onClick={() => void loadMyAssets()} disabled={assetsLoading}>
                    <RefreshCcw className={cn("h-4 w-4", assetsLoading && "animate-spin")} />
                    Verificar
                  </Button>
                </div>

                {invite?.url ? (
                  <div className="rounded-2xl border border-border bg-background/40 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">Enlace de instalación</div>
                        <div className="mt-1 break-all text-sm">{invite.url}</div>
                        {hint ? <div className="mt-2 text-xs text-muted-foreground">{hint}</div> : null}
                      </div>
                      <Button size="icon" variant="outline" onClick={() => void copy(invite.url)} title="Copiar">
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div className="rounded-2xl border border-border bg-background/40 p-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2 text-foreground">
                    <Laptop className="h-4 w-4 text-muted-foreground" />
                    Pasos rápidos
                  </div>
                  <ol className="mt-2 list-decimal space-y-1 pl-5">
                    <li>Genera el link y ábrelo en tu PC.</li>
                    <li>Instala el agente y espera que termine.</li>
                    <li>Vuelve aquí y toca “Verificar” (o revisa “Mis equipos”).</li>
                  </ol>
                </div>
              </CardContent>
            </div>
          </Card>

          <Card className="tech-border rounded-3xl p-[1px]">
            <div className="rounded-3xl glass-surface">
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>Mis equipos detectados</CardTitle>
                  <CardDescription>Se actualiza cuando tu equipo queda asociado a tu cuenta.</CardDescription>
                </div>
                <Badge variant="outline">{assets.length}</Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {assetsError ? <InlineAlert variant="error" title="Error" description={assetsError} /> : null}

                {assetsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : assets.length === 0 ? (
                  <EmptyState title="Aún no hay equipos" description="Cuando instales el agente, aparecerá aquí automáticamente." icon={<Laptop className="h-5 w-5" />} />
                ) : (
                  <div className="space-y-2">
                    {assets.slice(0, 8).map((a) => (
                      <Link
                        key={a.id}
                        href={`/app/assets/${a.id}`}
                        className={cn("block rounded-2xl border border-border bg-background/30 p-3 transition-colors hover:bg-accent/40")}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{a.name}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {a.asset_type ?? "Equipo"} {a.serial_number ? `· S/N ${a.serial_number}` : ""}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <Badge variant="outline" className="border">
                              {a.connectivity_status}
                            </Badge>
                            {a.mesh_node_id ? (
                              <Badge className="bg-[hsl(var(--brand-cyan))]/12 text-[hsl(var(--brand-cyan))] ring-1 ring-[hsl(var(--brand-cyan))]/25">
                                MeshCentral
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
