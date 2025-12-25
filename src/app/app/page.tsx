"use client";

import { AppShell } from "@/components/AppShell";
import { useProfile, useSession } from "@/lib/hooks";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { UserDashboard } from "@/features/user/UserDashboard";
import { AgentKanban } from "@/features/agent/AgentKanban";
import { SupervisorDashboard } from "@/features/supervisor/SupervisorDashboard";

export default function AppPage() {
  const router = useRouter();
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error } = useProfile(session?.user.id);

  useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  if (sessionLoading || profileLoading) {
    return <div className="p-6 text-sm text-zinc-300">Cargando...</div>;
  }

  if (!session) return null;

  if (error) {
    return <div className="p-6 text-sm text-rose-200">No se pudo cargar el perfil: {error}</div>;
  }

  if (!profile) {
    return (
      <div className="p-6 text-sm text-zinc-300">
        Perfil no disponible todavía. Si acabas de registrarte, espera unos segundos y recarga.
      </div>
    );
  }

  if (!profile.department_id && profile.role !== "admin") {
    return (
      <AppShell profile={profile}>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="text-lg font-semibold">Falta asignar departamento</div>
          <div className="mt-2 text-sm text-zinc-300">
            Tu usuario no tiene <code className="text-zinc-100">department_id</code>. Un admin debe asignarlo en la tabla{" "}
            <code className="text-zinc-100">profiles</code>.
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
