import "./dotenv";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().default(4000),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  ASSETS_WEBHOOK_SECRET: z.string().min(8).optional(),

  // NetLock RMM (self-hosted)
  NETLOCK_FILE_SERVER_URL: z.string().url().optional(),
  NETLOCK_FILE_SERVER_API_KEY: z.string().min(8).optional(),
  NETLOCK_INSECURE_TLS: z.coerce.boolean().default(false),
  // Used to generate server_config.json for the installer
  NETLOCK_SSL: z.coerce.boolean().default(false),
  NETLOCK_PACKAGE_GUID: z.string().uuid().optional(),
  NETLOCK_TENANT_GUID: z.string().uuid().optional(),
  NETLOCK_LOCATION_GUID: z.string().uuid().optional(),
  NETLOCK_LANGUAGE: z.string().trim().min(2).max(10).default("es"),
  NETLOCK_COMMUNICATION_SERVERS: z.string().trim().min(1).optional(),
  NETLOCK_REMOTE_SERVERS: z.string().trim().min(1).optional(),
  NETLOCK_UPDATE_SERVERS: z.string().trim().min(1).optional(),
  NETLOCK_TRUST_SERVERS: z.string().trim().min(1).optional(),
  NETLOCK_FILE_SERVERS: z.string().trim().min(1).optional(),

  // Ephemeral download tokens for installer links
  RMM_INSTALLER_JWT_SECRET: z.string().min(32).optional(),
  RMM_INSTALLER_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(24 * 60 * 60).default(10 * 60),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse({
    ...process.env,
    SUPABASE_URL: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!parsed.success) {
    console.error(parsed.error.format());
    throw new Error("Invalid environment variables for server");
  }
  return parsed.data;
}
