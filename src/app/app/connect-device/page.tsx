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
import { apiFetch } from "@/lib/apiClient";
import { errorMessage } from "@/lib/error";
import { useAccessToken, useProfile, useSession } from "@/lib/hooks";
import { supabase } from "@/lib/supabaseBrowser";
import type { Asset, Profile } from "@/lib/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Copy, Laptop, Link as LinkIcon, RefreshCcw } from "lucide-react";

type NetlockEnrollResponse = { url: string; configUrl?: string; expiresInSeconds: number; correlationKey: string; hint?: string | null };
type NetlockVerifyResponse = { ok: boolean; assetId: string | null; message?: string | null };
type AssetLite = Pick<Asset, "id" | "name" | "serial_number" | "asset_type" | "connectivity_status" | "updated_at" | "mesh_node_id">;
type AssignmentRow = { id: string; assigned_at: string; asset: AssetLite | null };

type Architecture = "win-x64" | "win-arm64" | "linux-x64" | "linux-arm64" | "osx-x64" | "osx-arm64";

const ArchitectureOptions: Array<{ value: Architecture; label: string }> = [
  { value: "win-x64", label: "Windows x64" },
  { value: "win-arm64", label: "Windows ARM64" },
  { value: "osx-x64", label: "macOS x64" },
  { value: "osx-arm64", label: "macOS ARM64" },
  { value: "linux-x64", label: "Linux x64" },
  { value: "linux-arm64", label: "Linux ARM64" },
];

function architectureLabel(arch: Architecture) {
  return ArchitectureOptions.find((o) => o.value === arch)?.label ?? arch;
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
  const [invite, setInvite] = useState<{ url: string; configUrl?: string | null; hint?: string | null; correlationKey?: string | null } | null>(null);

  const [deviceName, setDeviceName] = useState("");
  const [arch, setArch] = useState<Architecture>("win-x64");
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [accessKey, setAccessKey] = useState("");

  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetLite[]>([]);

  const canUse = !!profile;

  useEffect(() => {
    // Sensible default: avoid shipping macOS as default for Windows users.
    // Best-effort detection (no hard dependency on User-Agent Client Hints).
    try {
      const ua = (navigator.userAgent ?? "").toLowerCase();
      const platform = String(((navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "")).toLowerCase();
      const isMac = platform.includes("mac") || ua.includes("mac os");
      const isWindows = platform.includes("win") || ua.includes("windows");
      const isLinux = platform.includes("linux") || ua.includes("linux");
      const isArm = ua.includes("aarch64") || ua.includes("arm64") || ua.includes(" arm");

      const guessed: Architecture = isMac ? (isArm ? "osx-arm64" : "osx-x64") : isWindows ? (isArm ? "win-arm64" : "win-x64") : isLinux ? (isArm ? "linux-arm64" : "linux-x64") : "win-x64";

      setArch((prev) => (prev === "win-x64" ? guessed : prev));
    } catch {
      // ignore
    }
  }, []);

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
    setVerifyMsg(null);
    setInvite(null);
    try {
      const data = await apiFetch<NetlockEnrollResponse>(token, "/api/netlock/enroll/self", {
        method: "POST",
        body: JSON.stringify({ hours: inviteHours, architecture: arch, deviceName: deviceName.trim() || undefined }),
      });
      setInvite({ url: data.url, configUrl: data.configUrl ?? null, hint: data.hint ?? null, correlationKey: data.correlationKey });
      setAccessKey(data.correlationKey);
      try {
        localStorage.setItem("netlock_last_access_key", data.correlationKey);
      } catch {
        // ignore
      }
    } catch (e: unknown) {
      setInviteError(e instanceof Error ? e.message : "No se pudo generar el enlace.");
    } finally {
      setInviteLoading(false);
    }
  }

  async function verify() {
    if (!token) return;
    setAssetsError(null);
    setVerifyMsg(null);

    const key = accessKey.trim() || invite?.correlationKey?.trim() || "";
    if (!key) {
      setVerifyMsg("Primero prepara el instalador (o pega el código de verificación).");
      await loadMyAssets();
      return;
    }

    if (key) {
      try {
        const data = await apiFetch<NetlockVerifyResponse>(token, "/api/netlock/verify/self", {
          method: "POST",
          body: JSON.stringify({ accessKey: key, deviceName: deviceName.trim() || undefined }),
        });
        setVerifyMsg(data.ok ? "Listo: equipo detectado y asociado." : (data.message ?? "Aún no aparece conectado."));
      } catch (e: unknown) {
        setAssetsError(e instanceof Error ? e.message : "No se pudo verificar.");
      }
    }

    await loadMyAssets();
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

  useEffect(() => {
    try {
      const last = localStorage.getItem("netlock_last_access_key");
      if (last && !accessKey) setAccessKey(last);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hint = useMemo(() => invite?.hint ?? null, [invite?.hint]);
  const installScriptUrl = useMemo(() => {
    if (!invite?.url) return null;
    if (arch.startsWith("osx-")) return invite.url.replace("/api/netlock/installer/", "/api/netlock/install-script/macos/");
    if (arch.startsWith("linux-")) return invite.url.replace("/api/netlock/installer/", "/api/netlock/install-script/linux/");
    return null;
  }, [invite?.url, arch]);

  function download(url: string) {
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noreferrer";
    a.click();
  }

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
          description="Registra tu equipo para inventario y soporte remoto (NetLock RMM + Activos)."
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
                  <LinkIcon className="h-4 w-4 text-[hsl(var(--brand-cyan))]" /> Enrolar equipo (NetLock Agent)
                </CardTitle>
                <CardDescription>
                  Genera un link de instalación, instálalo en tu PC y quedará registrado. Si después necesitas ayuda, soporte podrá tomar control desde el chat.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {inviteError ? <InlineAlert variant="error" title="Error" description={inviteError} /> : null}
                {verifyMsg ? <InlineAlert variant="info" title="Verificación" description={verifyMsg} /> : null}
                {arch === "win-arm64" ? (
                  <InlineAlert
                    variant="warning"
                    title="Windows ARM64"
                    description="Si falla la generación del instalador, prueba con Windows x64 (muchos entornos ARM64 ejecutan x64 por emulación y algunos RMM no publican binario ARM nativo)."
                  />
                ) : null}

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

                <div className="grid gap-2 sm:grid-cols-2">
                  <Input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="Nombre del equipo (opcional)" />
                  <div className="flex items-center gap-2 rounded-xl border border-border bg-background/30 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Arquitectura</div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            "ml-auto inline-flex h-8 items-center gap-2 rounded-md px-2 text-sm text-foreground",
                            "bg-background/60 ring-1 ring-border transition-colors hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-cyan))]"
                          )}
                        >
                          <span className="truncate">{architectureLabel(arch)}</span>
                          <ChevronDown className="h-4 w-4 opacity-70" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[14rem]">
                        {ArchitectureOptions.map((o) => {
                          const active = o.value === arch;
                          return (
                            <DropdownMenuItem key={o.value} onSelect={() => setArch(o.value)} className={cn(active && "bg-accent")}>
                              <span className="inline-flex h-4 w-4 items-center justify-center">{active ? <Check className="h-4 w-4" /> : null}</span>
                              <span>{o.label}</span>
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    value={accessKey}
                    onChange={(e) => setAccessKey(e.target.value)}
                    placeholder="Código de verificación (se autocompleta)"
                    spellCheck={false}
                  />
                  <Button variant="outline" onClick={() => void copy(accessKey)} disabled={!accessKey.trim()}>
                    <Copy className="h-4 w-4" />
                    Copiar código
                  </Button>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button onClick={generateInvite} disabled={!token || inviteLoading}>
                    {inviteLoading ? "Preparando…" : "Preparar instalador"}
                  </Button>
                  <Button variant="outline" onClick={() => void verify()} disabled={assetsLoading}>
                    <RefreshCcw className={cn("h-4 w-4", assetsLoading && "animate-spin")} />
                    Verificar
                  </Button>
                </div>

                {invite?.url ? (
                  <div className="rounded-2xl border border-border bg-background/40 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">Descargas</div>
                        <div className="mt-1 text-sm text-foreground">Listo. Descarga y ejecuta el instalador (1 archivo).</div>
                      </div>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => void copy(invite.correlationKey ? `Código: ${invite.correlationKey}` : invite.url)}
                        title="Copiar código"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <Button variant="default" onClick={() => download(invite.url)}>
                        Descargar ZIP
                      </Button>
                      {installScriptUrl ? (
                        <Button variant="outline" onClick={() => download(installScriptUrl)}>
                          {arch.startsWith("osx-") ? "Instalador automático (macOS)" : "Instalador automático (Linux)"}
                        </Button>
                      ) : null}
                      {invite.configUrl ? (
                        <Button variant="outline" onClick={() => download(invite.configUrl!)}>
                          Descargar server_config.json
                        </Button>
                      ) : null}
                    </div>

                    {accessKey.trim() ? (
                      <div className="mt-3 rounded-xl border border-border bg-background/30 px-3 py-2 text-xs">
                        <span className="text-muted-foreground">Código de verificación: </span>
                        <span className="font-mono text-foreground">{accessKey.trim()}</span>
                      </div>
                    ) : null}

                    {hint ? <div className="mt-2 text-xs text-muted-foreground">{hint}</div> : null}
                  </div>
                ) : null}

                <div className="rounded-2xl border border-border bg-background/40 p-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2 text-foreground">
                    <Laptop className="h-4 w-4 text-muted-foreground" />
                    Pasos rápidos
                  </div>
                  <ol className="mt-2 list-decimal space-y-1 pl-5">
                    <li>Toca “Preparar instalador”.</li>
                    <li>Descarga y ejecuta el instalador (o el “Instalador automático”).</li>
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
                                NetLock RMM
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
