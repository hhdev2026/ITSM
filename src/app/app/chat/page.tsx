"use client";

import { AppShell } from "@/components/AppShell";
import { AppBootScreen, AppNoticeScreen } from "@/components/layout/AppStates";
import { UserChat } from "@/features/chat/UserChat";
import { useProfile, useSession } from "@/lib/hooks";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function ChatPage() {
  const router = useRouter();
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error } = useProfile(session?.user.id);

  useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  if (sessionLoading || profileLoading) return <AppBootScreen label="Cargando chat…" />;
  if (!session) return null;
  if (error) return <AppNoticeScreen variant="error" title="No se pudo cargar el perfil" description={error} />;
  if (!profile) return null;

  return (
    <AppShell profile={profile}>
      {profile.role === "user" ? (
        <UserChat profile={profile} />
      ) : (
        <div className="space-y-3">
          <div className="text-xl font-semibold">Chat</div>
          <div className="text-sm text-muted-foreground">El chat de solicitantes está disponible solo para rol user.</div>
          <Link href="/app/chats" className="inline-flex text-sm text-[hsl(var(--brand-cyan))] hover:underline">
            Ir a bandeja de chats
          </Link>
        </div>
      )}
    </AppShell>
  );
}

