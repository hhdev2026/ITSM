"use client";

import { AppShell } from "@/components/AppShell";
import { useProfile, useSession } from "@/lib/hooks";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { UserAdmin } from "@/features/admin/UserAdmin";
import { InlineAlert } from "@/components/feedback/InlineAlert";
import { AppBootScreen, AppNoticeScreen } from "@/components/layout/AppStates";

export default function AdminUsersPage() {
  const router = useRouter();
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error } = useProfile(session?.user.id);

  useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  if (sessionLoading || profileLoading) return <AppBootScreen label="Cargando administración…" />;
  if (!session) return null;
  if (error) return <AppNoticeScreen variant="error" title="No se pudo cargar el perfil" description={error} />;
  if (!profile) return null;

  if (profile.role !== "admin") {
    return (
      <AppShell profile={profile}>
        <InlineAlert variant="error" title="Acceso denegado" description="No tienes permisos para administrar usuarios." />
      </AppShell>
    );
  }

  return (
    <AppShell profile={profile}>
      <UserAdmin adminProfile={profile} />
    </AppShell>
  );
}
