"use client";

import { AppShell } from "@/components/AppShell";
import { AppBootScreen, AppNoticeScreen } from "@/components/layout/AppStates";
import { ChatAdminDashboard } from "@/features/chat/ChatAdminDashboard";
import { ChatsInbox } from "@/features/chat/ChatsInbox";
import { useProfile, useSession } from "@/lib/hooks";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ChatsPage() {
  const router = useRouter();
  const { loading: sessionLoading, session } = useSession();
  const { loading: profileLoading, profile, error } = useProfile(session?.user.id);

  useEffect(() => {
    if (!sessionLoading && !session) router.replace("/login");
  }, [sessionLoading, session, router]);

  useEffect(() => {
    if (sessionLoading || profileLoading) return;
    if (!session || !profile) return;
    if (profile.role === "user") router.replace("/app/chat");
  }, [profile, profileLoading, router, session, sessionLoading]);

  if (sessionLoading || profileLoading) return <AppBootScreen label="Cargando chats…" />;
  if (!session) return null;
  if (error) return <AppNoticeScreen variant="error" title="No se pudo cargar el perfil" description={error} />;
  if (!profile) return null;

  return (
    <AppShell profile={profile}>
      {profile.role === "admin" ? <ChatAdminDashboard profile={profile} /> : null}
      {profile.role !== "user" && profile.role !== "admin" ? <ChatsInbox profile={profile} /> : null}
    </AppShell>
  );
}
