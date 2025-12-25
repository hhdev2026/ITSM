import type { NextFunction, Request, Response } from "express";
import { createSupabaseFromBearer, getBearerToken } from "./supabase";

export type AuthedRequest = Request & {
  auth: {
    userId: string;
    email: string | null;
    role: "user" | "agent" | "supervisor" | "admin";
    departmentId: string | null;
  };
  supabase: ReturnType<typeof createSupabaseFromBearer>;
};

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: "missing_bearer_token" });

  const supabase = createSupabaseFromBearer(token);
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData.user) return res.status(401).json({ error: "invalid_token" });

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("id,email,role,department_id")
    .eq("id", userData.user.id)
    .single();

  if (profErr || !profile) return res.status(403).json({ error: "profile_not_ready" });

  (req as AuthedRequest).auth = {
    userId: profile.id,
    email: profile.email ?? null,
    role: profile.role,
    departmentId: profile.department_id ?? null,
  };
  (req as AuthedRequest).supabase = supabase;
  return next();
}

export function requireRole(roles: Array<AuthedRequest["auth"]["role"]>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authed = req as AuthedRequest;
    if (!authed.auth) return res.status(401).json({ error: "unauthorized" });
    if (!roles.includes(authed.auth.role)) return res.status(403).json({ error: "forbidden" });
    return next();
  };
}

