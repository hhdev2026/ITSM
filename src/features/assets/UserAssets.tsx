"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Asset, Profile } from "@/lib/types";
import { supabase } from "@/lib/supabaseBrowser";
import { PageHeader } from "@/components/layout/PageHeader";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import Link from "next/link";
import { Laptop, MessageCircle, RefreshCcw, ShieldCheck } from "lucide-react";

type AssignedAsset = Pick<Asset, "id" | "name" | "serial_number" | "asset_type" | "connectivity_status" | "updated_at" | "mesh_node_id">;
type AssignmentRow = { id: string; role: string; assigned_at: string; asset: AssignedAsset | null };

function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") return (e as { message: string }).message;
  return "Error";
}

export function UserAssets({ profile }: { profile: Profile }) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AssignmentRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("asset_assignments")
        .select("id,role,assigned_at,asset:assets(id,name,serial_number,asset_type,connectivity_status,updated_at,mesh_node_id)")
        .eq("user_id", profile.id)
        .is("ended_at", null)
        .order("assigned_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      setRows((data ?? []) as unknown as AssignmentRow[]);
    } catch (e) {
      setError(errorMessage(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [profile.id]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`rt-assets-user-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "asset_assignments", filter: `user_id=eq.${profile.id}` }, () => void load())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [load, profile.id]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return rows;
    return rows.filter((r) => {
      const a = r.asset;
      const blob = `${a?.name ?? ""} ${a?.serial_number ?? ""} ${a?.asset_type ?? ""}`.toLowerCase();
      return blob.includes(qq);
    });
  }, [q, rows]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Mis equipos"
        description="Equipos asociados a tu cuenta (onboarding + inventario)."
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/app/connect-device">
                <Laptop className="h-4 w-4" />
                Conectar mi PC
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/app/messages">
                <MessageCircle className="h-4 w-4" />
                Chat soporte
              </Link>
            </Button>
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCcw className="h-4 w-4" />
              Actualizar
            </Button>
          </div>
        }
      />

      {error ? <InlineAlert variant="error" title="No se pudo cargar tus equipos" description={error} /> : null}

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card className="tech-border">
          <CardHeader>
            <CardTitle>Estado</CardTitle>
            <CardDescription>Tu registro se crea automáticamente cuando instalas el agente.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-2xl border border-border bg-background/40 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <ShieldCheck className="h-4 w-4 text-[hsl(var(--brand-cyan))]" />
                Registro automático
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Si tu PC no aparece, genera el link en “Conectar mi PC” y espera 1–2 minutos luego de instalar.
              </div>
            </div>

            <label className="block">
              <div className="text-xs text-muted-foreground">Buscar</div>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej: Laptop, serial, tipo…" />
            </label>
          </CardContent>
        </Card>

        <Card className="tech-border">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Mis activos</CardTitle>
              <CardDescription>{loading ? "Cargando…" : `Mostrando ${filtered.length}`}</CardDescription>
            </div>
            <Badge variant="outline">{rows.length}</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                title="Aún no hay equipos"
                description="Conecta tu PC para que aparezca aquí y soporte pueda ayudarte más rápido."
                icon={<Laptop className="h-5 w-5" />}
              />
            ) : (
              <div className="space-y-2">
                {filtered.map((r) => {
                  const a = r.asset;
                  if (!a) return null;
                  const managed = !!a.mesh_node_id;
                  return (
                    <Link
                      key={a.id}
                      href={`/app/assets/${a.id}`}
                      className={cn("block rounded-2xl border border-border bg-card/40 p-4 transition-[background,box-shadow] hover:bg-card/70 hover:shadow-sm")}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            {a.asset_type ? <Badge variant="outline">{a.asset_type}</Badge> : null}
                            <Badge variant="outline" className="border">
                              {a.connectivity_status}
                            </Badge>
                            {managed ? <Badge className="bg-[hsl(var(--brand-cyan))]/12 text-[hsl(var(--brand-cyan))] ring-1 ring-[hsl(var(--brand-cyan))]/25">MeshCentral</Badge> : null}
                          </div>
                          <div className="mt-2 truncate text-base font-semibold">{a.name}</div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                            {a.serial_number ? <span className="font-mono">SN: {a.serial_number}</span> : null}
                            <span className="text-xs">Asignado: {new Date(r.assigned_at).toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-xs text-muted-foreground">
                          <div>Actualizado</div>
                          <div className="mt-0.5">{new Date(a.updated_at).toLocaleString()}</div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

