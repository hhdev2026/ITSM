"use client";

import { AppShell } from "@/components/AppShell";
import { useProfile, useSession } from "@/lib/hooks";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { UserAdmin } from "@/features/admin/UserAdmin";

export default function AdminUsersPage() {
  const router = useRouter();
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error } = useProfile(session?.user.id);

  useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  if (sessionLoading || profileLoading) return <div className="p-6 text-sm text-muted-foreground">Cargando…</div>;
  if (!session) return null;
  if (error) return <div className="p-6 text-sm text-destructive-foreground">No se pudo cargar el perfil: {error}</div>;
  if (!profile) return null;

  if (profile.role !== "admin") {
    return (
      <AppShell profile={profile}>
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
          No tienes permisos para administrar usuarios.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell profile={profile}>
      <UserAdmin adminProfile={profile} />
    </AppShell>
  );
}

