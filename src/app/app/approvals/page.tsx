"use client";

import { AppShell } from "@/components/AppShell";
import { ApprovalsInbox } from "@/features/approvals/ApprovalsInbox";
import { useProfile, useSession } from "@/lib/hooks";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppBootScreen, AppNoticeScreen } from "@/components/layout/AppStates";

export default function ApprovalsPage() {
  const router = useRouter();
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error } = useProfile(session?.user.id);

  useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  if (sessionLoading || profileLoading) return <AppBootScreen label="Cargando aprobaciones…" />;
  if (!session) return null;
  if (error) return <AppNoticeScreen variant="error" title="No se pudo cargar el perfil" description={error} />;
  if (!profile) return null;

  return (
    <AppShell profile={profile}>
      <ApprovalsInbox profile={profile} />
    </AppShell>
  );
}
