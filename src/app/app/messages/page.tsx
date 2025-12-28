"use client";

import { AppShell } from "@/components/AppShell";
import { AppBootScreen, AppNoticeScreen } from "@/components/layout/AppStates";
import { SupportMessages } from "@/features/chat/SupportMessages";
import { useProfile, useSession } from "@/lib/hooks";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MessagesPage() {
  const router = useRouter();
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error } = useProfile(session?.user.id);

  useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  if (sessionLoading || profileLoading) return <AppBootScreen label="Cargando mensajes…" />;
  if (!session) return null;
  if (error) return <AppNoticeScreen variant="error" title="No se pudo cargar el perfil" description={error} />;
  if (!profile) return null;

  return (
    <AppShell profile={profile}>
      <SupportMessages profile={profile} />
    </AppShell>
  );
}

