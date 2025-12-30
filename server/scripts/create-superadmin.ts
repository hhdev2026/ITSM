import "../dotenv";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

type Database = {
  public: {
    Tables: {
      departments: {
        Row: { id: string; name: string; description: string | null };
        Insert: { name: string; description?: string | null };
        Update: { name?: string; description?: string | null };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          role: string;
          department_id: string | null;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          role: string;
          department_id: string | null;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          role?: string;
          department_id?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPERADMIN_EMAIL: z.string().email(),
  SUPERADMIN_PASSWORD: z
    .string()
    .min(12)
    .max(200)
    .refine((s) => /[a-z]/.test(s), { message: "Must include a lowercase letter" })
    .refine((s) => /[A-Z]/.test(s), { message: "Must include an uppercase letter" })
    .refine((s) => /[0-9]/.test(s), { message: "Must include a number" })
    .refine((s) => /[^A-Za-z0-9]/.test(s), { message: "Must include a symbol" }),
  SUPERADMIN_FULL_NAME: z.string().default("Super Admin"),
  SUPERADMIN_DEPARTMENT_ID: z.string().uuid().optional(),
});

type Env = z.infer<typeof EnvSchema>;
type SupabaseAdmin = ReturnType<typeof createClient<Database>>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.format());
    throw new Error("Missing/invalid env for seed:superadmin");
  }
  return parsed.data;
}

async function ensureDepartmentId(supabase: SupabaseAdmin, env: Env) {
  if (env.SUPERADMIN_DEPARTMENT_ID) return env.SUPERADMIN_DEPARTMENT_ID;

  const { data: existing } = await supabase.from("departments").select("id,name").eq("name", "TI").maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: inserted, error } = await supabase
    .from("departments")
    .insert({ name: "TI", description: "Departamento de Tecnología" })
    .select("id")
    .single();
  if (error) throw error;
  return inserted.id as string;
}

async function findUserIdByEmail(supabase: SupabaseAdmin, email: string) {
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const user = data.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (user) return user.id;
    if (data.users.length < perPage) break;
  }
  return null;
}

async function main() {
  const env = loadEnv();
  const supabase = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const departmentId = await ensureDepartmentId(supabase, env);

  let userId: string | null = null;
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: env.SUPERADMIN_EMAIL,
    password: env.SUPERADMIN_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: env.SUPERADMIN_FULL_NAME },
  });

  if (createErr) {
    userId = await findUserIdByEmail(supabase, env.SUPERADMIN_EMAIL);
    if (!userId) throw createErr;
  } else {
    userId = created.user?.id ?? null;
  }

  if (!userId) throw new Error("Could not resolve superadmin user id");

  const { error: upsertErr } = await supabase.from("profiles").upsert(
    {
      id: userId,
      email: env.SUPERADMIN_EMAIL,
      full_name: env.SUPERADMIN_FULL_NAME,
      role: "admin",
      department_id: departmentId,
    },
    { onConflict: "id" }
  );
  if (upsertErr) throw upsertErr;

  console.log("[seed:superadmin] OK");
  console.log(`- email: ${env.SUPERADMIN_EMAIL}`);
  console.log(`- role: admin`);
  console.log(`- department_id: ${departmentId}`);
}

main().catch((e) => {
  console.error("[seed:superadmin] FAILED");
  console.error(e);
  process.exit(1);
});
