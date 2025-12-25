"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseBrowser";
import type { Profile } from "./types";
import { isDemoMode } from "./demo";
import { clearDemoAuth, getDemoProfile } from "./demoAuth";

export function useSession() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<{ user: { id: string }; access_token: string } | null>(null);

  useEffect(() => {
    if (isDemoMode()) {
      const p = getDemoProfile();
      Promise.resolve().then(() => {
        setSession(p ? { user: { id: p.id }, access_token: "demo" } : null);
        setLoading(false);
      });
      return;
    }
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const s = data.session;
      setSession(s ? { user: { id: s.user.id }, access_token: s.access_token } : null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next ? { user: { id: next.user.id }, access_token: next.access_token } : null);
      setLoading(false);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { loading, session };
}

export function useProfile(sessionUserId: string | undefined) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isDemoMode()) {
      const p = getDemoProfile();
      Promise.resolve().then(() => {
        setProfile(p);
        setError(null);
        setLoading(false);
      });
      return;
    }
    if (!sessionUserId) {
      Promise.resolve().then(() => {
        setProfile(null);
        setError(null);
        setLoading(false);
      });
      return;
    }
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setLoading(true);
    });
    supabase
      .from("profiles")
      .select("id,email,full_name,role,department_id,points,rank")
      .eq("id", sessionUserId)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setError(error.message);
          setProfile(null);
        } else {
          setProfile(data as Profile);
          setError(null);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionUserId]);

  return { loading, profile, error };
}

export function useAccessToken() {
  const { session } = useSession();
  return useMemo(() => session?.access_token ?? null, [session?.access_token]);
}

export function signOut() {
  if (isDemoMode()) {
    clearDemoAuth();
    return Promise.resolve();
  }
  return supabase.auth.signOut();
}
