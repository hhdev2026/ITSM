"use client";

import { AppShell } from "@/components/AppShell";
import { ApprovalsInbox } from "@/features/approvals/ApprovalsInbox";
import { useProfile, useSession } from "@/lib/hooks";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ApprovalsPage() {
  const router = useRouter();
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error } = useProfile(session?.user.id);

  useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  if (sessionLoading || profileLoading) return <div className="p-6 text-sm text-muted-foreground">Cargando...</div>;
  if (!session) return null;
  if (error) return <div className="p-6 text-sm text-destructive-foreground">No se pudo cargar el perfil: {error}</div>;
  if (!profile) return null;

  return (
    <AppShell profile={profile}>
      <ApprovalsInbox profile={profile} />
    </AppShell>
  );
}

