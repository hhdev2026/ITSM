"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useProfile, useSession } from "@/lib/hooks";
import { ServiceCatalog } from "@/features/catalog/ServiceCatalog";
import { AppBootScreen, AppNoticeScreen } from "@/components/layout/AppStates";

function CatalogPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error } = useProfile(session?.user.id);

  useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  if (sessionLoading || profileLoading) return <AppBootScreen label="Cargando catálogo…" />;
  if (!session) return null;
  if (error) return <AppNoticeScreen variant="error" title="No se pudo cargar el perfil" description={error} />;
  if (!profile) return null;

  if (!profile.department_id && profile.role !== "admin") {
    return (
      <AppShell profile={profile}>
        <div className="tech-border rounded-2xl p-[1px]">
          <div className="glass-surface rounded-2xl p-6">
            <div className="text-lg font-semibold">Falta asignar departamento</div>
            <div className="mt-2 text-sm text-muted-foreground">
              Tu usuario no tiene <code className="text-foreground">department_id</code>. Un admin debe asignarlo en la tabla{" "}
              <code className="text-foreground">profiles</code>.
            </div>
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
    <Suspense fallback={<AppBootScreen label="Cargando catálogo…" />}>
      <CatalogPageInner />
    </Suspense>
  );
}
