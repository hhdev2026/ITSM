import "dotenv/config";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPERADMIN_EMAIL: z.string().email(),
  SUPERADMIN_PASSWORD: z.string().min(8),
  SUPERADMIN_FULL_NAME: z.string().default("Super Admin"),
  SUPERADMIN_DEPARTMENT_ID: z.string().uuid().optional(),
});

type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.format());
    throw new Error("Missing/invalid env for seed:superadmin");
  }
  return parsed.data;
}

async function ensureDepartmentId(supabase: ReturnType<typeof createClient>, env: Env) {
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

async function findUserIdByEmail(supabase: ReturnType<typeof createClient>, email: string) {
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
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
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

