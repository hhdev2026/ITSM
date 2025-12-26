"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useProfile, useSession } from "@/lib/hooks";
import { ServiceCatalog } from "@/features/catalog/ServiceCatalog";

function CatalogPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error } = useProfile(session?.user.id);

  useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  if (sessionLoading || profileLoading) return <div className="p-6 text-sm text-muted-foreground">Cargando...</div>;
  if (!session) return null;
  if (error) return <div className="p-6 text-sm text-destructive-foreground">No se pudo cargar el perfil: {error}</div>;
  if (!profile) return null;

  if (!profile.department_id && profile.role !== "admin") {
    return (
      <AppShell profile={profile}>
        <div className="rounded-2xl border border-border bg-card/50 p-6">
          <div className="text-lg font-semibold">Falta asignar departamento</div>
          <div className="mt-2 text-sm text-muted-foreground">
            Tu usuario no tiene <code className="text-foreground">department_id</code>. Un admin debe asignarlo en la tabla{" "}
            <code className="text-foreground">profiles</code>.
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell profile={profile}>
      {profile.role === "user" ? (
        <ServiceCatalog profile={profile} initialQuery={searchParams.get("q") ?? undefined} />
      ) : (
        <div className="space-y-3">
          <div className="text-xl font-semibold">Catálogo</div>
          <div className="text-sm text-muted-foreground">El catálogo está pensado para solicitantes (rol user).</div>
          <Link href="/app" className="inline-flex text-sm text-[hsl(var(--brand-cyan))] hover:underline">
            Volver
          </Link>
        </div>
      )}
    </AppShell>
  );
}

export default function CatalogPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Cargando...</div>}>
      <CatalogPageInner />
    </Suspense>
  );
}
