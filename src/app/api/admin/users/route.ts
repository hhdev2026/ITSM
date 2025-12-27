import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const runtime = "nodejs";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? env("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env("SUPABASE_SERVICE_ROLE_KEY");

const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  department_id: string | null;
  manager_id?: string | null;
  points: number;
  rank: string;
  created_at?: string;
  updated_at?: string;
};

function rankForPoints(points: number) {
  if (points >= 2000) return "Diamante";
  if (points >= 1000) return "Platino";
  if (points >= 500) return "Oro";
  if (points >= 200) return "Plata";
  return "Bronce";
}

async function requireAdmin(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : null;
  if (!token || token === "demo") {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as NextResponse };
  }

  const { data, error } = await supabaseAnon.auth.getUser(token);
  if (error || !data.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as NextResponse };
  }

  const { data: p, error: pErr } = await supabaseAdmin
    .from("profiles")
    .select("id,role,department_id")
    .eq("id", data.user.id)
    .maybeSingle();
  if (pErr || !p || p.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) as NextResponse };
  }

  return { userId: data.user.id, departmentId: (p.department_id as string | null) ?? null };
}

const QuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  role: z.enum(["user", "agent", "supervisor", "admin"]).optional(),
  department_id: z.string().uuid().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if ("error" in guard) return guard.error;

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  const { q, role, department_id, offset, limit } = parsed.data;

  let query = supabaseAdmin
    .from("profiles")
    .select("id,email,full_name,role,department_id,manager_id,points,rank,created_at,updated_at")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (q) {
    const like = `%${q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    query = query.or(`email.ilike.${like},full_name.ilike.${like}`);
  }
  if (role) query = query.eq("role", role);
  if (department_id) query = query.eq("department_id", department_id);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const profiles = ((data ?? []) as unknown) as ProfileRow[];
  const now = Date.now();

  const authUsers = await Promise.all(
    profiles.map(async (p) => {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(p.id);
      if (error || !data.user) {
        return { id: p.id, is_disabled: null as boolean | null, banned_until: null as string | null, last_sign_in_at: null as string | null, email_confirmed_at: null as string | null };
      }
      const bannedUntilRaw = ((data.user as unknown) as { banned_until?: string | null }).banned_until ?? null;
      const bannedUntil = bannedUntilRaw ? new Date(bannedUntilRaw).toISOString() : null;
      const disabled = bannedUntil ? new Date(bannedUntil).getTime() > now : false;
      return {
        id: p.id,
        is_disabled: disabled,
        banned_until: bannedUntil,
        last_sign_in_at: data.user.last_sign_in_at ?? null,
        email_confirmed_at: data.user.email_confirmed_at ?? null,
      };
    })
  );

  const authById = new Map(authUsers.map((u) => [u.id, u]));

  return NextResponse.json({
    users: profiles.map((p) => {
      const a = authById.get(p.id);
      return {
        ...p,
        is_disabled: a?.is_disabled ?? null,
        banned_until: a?.banned_until ?? null,
        last_sign_in_at: a?.last_sign_in_at ?? null,
        email_confirmed_at: a?.email_confirmed_at ?? null,
      };
    }),
  });
}

const CreateBodySchema = z
  .object({
    email: z.string().email().transform((s) => s.trim().toLowerCase()),
    full_name: z.string().trim().min(2).max(120).optional().nullable(),
    role: z.enum(["user", "agent", "supervisor", "admin"]),
    department_id: z.string().uuid().optional().nullable(),
    manager_id: z.string().uuid().optional().nullable(),
    invite: z.coerce.boolean().default(true),
    password: z.string().min(8).max(200).optional().nullable(),
    points: z.coerce.number().int().min(0).max(100000).optional(),
  })
  .refine((v) => v.invite || (!!v.password && v.password.length >= 8), {
    message: "Password is required when invite=false",
    path: ["password"],
  });

async function findUserIdByEmail(email: string) {
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const user = data.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (user) return user.id;
    if (data.users.length < perPage) break;
  }
  return null;
}

async function resolveDefaultDepartmentId() {
  const { data } = await supabaseAdmin.from("departments").select("id,name,created_at").order("created_at", { ascending: true });
  const list = (data ?? []) as Array<{ id: string; name: string }>;
  const ti = list.find((d) => d.name === "TI");
  return ti?.id ?? list[0]?.id ?? null;
}

export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if ("error" in guard) return guard.error;

  const body = await request.json().catch(() => null);
  const parsed = CreateBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });

  const { email, full_name, role, department_id, manager_id, invite, password, points } = parsed.data;

  let userId: string | null = null;
  if (invite) {
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: full_name ? { full_name } : undefined,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    userId = data.user?.id ?? null;
    if (!userId) userId = await findUserIdByEmail(email);
  } else {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: password ?? undefined,
      email_confirm: true,
      user_metadata: full_name ? { full_name } : undefined,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    userId = data.user?.id ?? null;
    if (!userId) userId = await findUserIdByEmail(email);
  }

  if (!userId) return NextResponse.json({ error: "Could not resolve user id" }, { status: 500 });

  const deptId = department_id ?? (await resolveDefaultDepartmentId());
  const safePoints = typeof points === "number" ? points : 0;
  const rank = rankForPoints(safePoints);

  const { error: upsertErr } = await supabaseAdmin.from("profiles").upsert(
    {
      id: userId,
      email,
      full_name: full_name ?? null,
      role,
      department_id: deptId,
      manager_id: manager_id ?? null,
      points: safePoints,
      rank,
    },
    { onConflict: "id" }
  );
  if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: userId });
}
