"use client";

import { AppShell } from "@/components/AppShell";
import { useProfile, useSession } from "@/lib/hooks";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { UserDashboard } from "@/features/user/UserDashboard";
import { AgentKanban } from "@/features/agent/AgentKanban";
import { SupervisorDashboard } from "@/features/supervisor/SupervisorDashboard";
import { AppBootScreen, AppNoticeScreen } from "@/components/layout/AppStates";

export default function AppPage() {
  const router = useRouter();
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error } = useProfile(session?.user.id);

  useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  if (sessionLoading || profileLoading) {
    return <AppBootScreen label="Preparando tu sesión…" />;
  }

  if (!session) return null;

  if (error) {
    return <AppNoticeScreen variant="error" title="No se pudo cargar el perfil" description={error} />;
  }

  if (!profile) {
    return (
      <AppNoticeScreen
        title="Perfil no disponible"
        description="Si acabas de registrarte, espera unos segundos y recarga."
      />
    );
  }

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
      {profile.role === "user" && <UserDashboard profile={profile} />}
      {profile.role === "agent" && <AgentKanban profile={profile} />}
      {(profile.role === "supervisor" || profile.role === "admin") && <SupervisorDashboard profile={profile} />}
    </AppShell>
  );
}
