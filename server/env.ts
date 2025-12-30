import "./dotenv";
import { z } from "zod";

const BoolSchema = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return value;
  const s = value.trim().toLowerCase();
  if (["1", "true", "t", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "f", "no", "n", "off", ""].includes(s)) return false;
  return value;
}, z.boolean());

const OptionalUrl = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const s = value.trim();
  return s.length ? s : undefined;
}, z.string().url().optional());

const OptionalNonEmptyString = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const s = value.trim();
  return s.length ? s : undefined;
}, z.string().trim().min(1).optional());

const OptionalSecret = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const s = value.trim();
  return s.length ? s : undefined;
}, z.string().min(8).optional());

const EnvSchema = z.object({
  PORT: z.coerce.number().default(4000),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const s = value.trim();
    return s.length ? s : undefined;
  }, z.string().min(20).optional()),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  ASSETS_WEBHOOK_SECRET: OptionalSecret,

  // NetLock RMM (self-hosted)
  NETLOCK_FILE_SERVER_URL: OptionalUrl,
  NETLOCK_FILE_SERVER_API_KEY: OptionalSecret,
  NETLOCK_INSECURE_TLS: BoolSchema.default(false),
  // Optional: direct DB access for verification (recommended in dev to detect devices reliably).
  NETLOCK_MYSQL_URL: OptionalNonEmptyString,
  NETLOCK_AUTO_AUTHORIZE_ON_VERIFY: BoolSchema.default(true),
  // Used to generate server_config.json for the installer
  NETLOCK_SSL: BoolSchema.default(false),
  NETLOCK_PACKAGE_GUID: z.string().uuid().optional(),
  NETLOCK_TENANT_GUID: z.string().uuid().optional(),
  NETLOCK_LOCATION_GUID: z.string().uuid().optional(),
  NETLOCK_LANGUAGE: z.string().trim().min(2).max(10).default("es"),
  NETLOCK_COMMUNICATION_SERVERS: OptionalNonEmptyString,
  NETLOCK_REMOTE_SERVERS: OptionalNonEmptyString,
  NETLOCK_UPDATE_SERVERS: OptionalNonEmptyString,
  NETLOCK_TRUST_SERVERS: OptionalNonEmptyString,
  NETLOCK_FILE_SERVERS: OptionalNonEmptyString,

  // Ephemeral download tokens for installer links
  RMM_INSTALLER_JWT_SECRET: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const s = value.trim();
    return s.length ? s : undefined;
  }, z.string().min(32).optional()),
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
