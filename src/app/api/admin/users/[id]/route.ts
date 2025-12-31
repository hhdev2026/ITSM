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

function rankForPoints(points: number) {
  if (points >= 2000) return "Diamante";
  if (points >= 1000) return "Platino";
  if (points >= 500) return "Oro";
  if (points >= 200) return "Plata";
  return "Bronce";
}

const PasswordSchema = z
  .string()
  .min(8)
  .max(200)
  .refine((s) => /[a-z]/.test(s), { message: "Must include a lowercase letter" })
  .refine((s) => /[A-Z]/.test(s), { message: "Must include an uppercase letter" })
  .refine((s) => /[0-9]/.test(s), { message: "Must include a number" });

async function requireAdmin(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : null;
  if (!token) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as NextResponse };
  }

  const { data, error } = await supabaseAnon.auth.getUser(token);
  if (error || !data.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as NextResponse };
  }

  const { data: p, error: pErr } = await supabaseAdmin.from("profiles").select("id,role").eq("id", data.user.id).maybeSingle();
  if (pErr || !p || p.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) as NextResponse };
  }

  return { userId: data.user.id };
}

const PatchBodySchema = z.object({
  full_name: z.string().trim().min(2).max(120).optional().nullable(),
  role: z.enum(["user", "agent", "supervisor", "admin"]).optional(),
  department_id: z.string().uuid().optional().nullable(),
  manager_id: z.string().uuid().optional().nullable(),
  points: z.coerce.number().int().min(0).max(100000).optional(),
  disabled: z.coerce.boolean().optional(),
  password: PasswordSchema.optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if ("error" in guard) return guard.error;

  const { id } = await params;
  if (!id || !z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = PatchBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  const patch = parsed.data;

  if (typeof patch.disabled === "boolean") {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(id, {
      ban_duration: patch.disabled ? "87600h" : "none",
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (typeof patch.password === "string") {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(id, { password: patch.password });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const profileUpdate: Record<string, unknown> = {};
  if ("full_name" in patch) profileUpdate.full_name = patch.full_name ?? null;
  if (patch.role) profileUpdate.role = patch.role;
  if ("department_id" in patch) profileUpdate.department_id = patch.department_id ?? null;
  if ("manager_id" in patch) profileUpdate.manager_id = patch.manager_id ?? null;
  if (typeof patch.points === "number") {
    profileUpdate.points = patch.points;
    profileUpdate.rank = rankForPoints(patch.points);
  }

  if (Object.keys(profileUpdate).length > 0) {
    const { error: pErr } = await supabaseAdmin.from("profiles").update(profileUpdate).eq("id", id);
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
