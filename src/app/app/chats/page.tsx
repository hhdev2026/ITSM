"use client";

import { AppShell } from "@/components/AppShell";
import { AppBootScreen, AppNoticeScreen } from "@/components/layout/AppStates";
import { ChatsInbox } from "@/features/chat/ChatsInbox";
import { useProfile, useSession } from "@/lib/hooks";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function ChatsPage() {
  const router = useRouter();
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error } = useProfile(session?.user.id);

  useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  if (sessionLoading || profileLoading) return <AppBootScreen label="Cargando chats…" />;
  if (!session) return null;
  if (error) return <AppNoticeScreen variant="error" title="No se pudo cargar el perfil" description={error} />;
  if (!profile) return null;

  return (
    <AppShell profile={profile}>
      {profile.role === "user" ? (
        <div className="space-y-3">
          <div className="text-xl font-semibold">Bandeja de chats</div>
          <div className="text-sm text-muted-foreground">Esta vista es para mesa de ayuda (roles agent/supervisor/admin).</div>
          <Link href="/app/chat" className="inline-flex text-sm text-[hsl(var(--brand-cyan))] hover:underline">
            Ir a mi chat
          </Link>
        </div>
      ) : (
        <ChatsInbox profile={profile} />
      )}
    </AppShell>
  );
}

