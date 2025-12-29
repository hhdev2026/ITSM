import * as crypto from "crypto";
import type express from "express";
import { z } from "zod";
import { SignJWT, jwtVerify } from "jose";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { Env } from "../env";
import { requireAuth, type AuthedRequest } from "../auth";

const EnrollBodySchema = z.object({
  hours: z.coerce.number().int().min(1).max(24 * 30).default(24),
  architecture: z.enum(["win-x64", "win-arm64", "linux-x64", "linux-arm64", "osx-x64", "osx-arm64"]),
  deviceName: z.string().trim().min(1).max(120).optional(),
});

const VerifyBodySchema = z.object({
  accessKey: z.string().trim().min(8).max(200),
  deviceName: z.string().trim().min(1).max(120).optional(),
});

const JWT_ISSUER = "geimser-itsm-api";
const JWT_AUDIENCE = "rmm-installer";

function textSecret(secret: string) {
  return new TextEncoder().encode(secret);
}

function apiPublicUrl(req: express.Request) {
  const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol ?? "http").split(",")[0]!.trim();
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost").split(",")[0]!.trim();
  return `${proto}://${host}`;
}

function enableInsecureTlsIfNeeded(env: Env) {
  if (!env.NETLOCK_INSECURE_TLS) return;
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") return;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  process.env.NODE_NO_WARNINGS = process.env.NODE_NO_WARNINGS ?? "1";
}

function netlockConfigured(env: Env) {
  return (
    !!env.NETLOCK_FILE_SERVER_URL &&
    !!env.NETLOCK_FILE_SERVER_API_KEY &&
    !!env.NETLOCK_PACKAGE_GUID &&
    !!env.NETLOCK_TENANT_GUID &&
    !!env.NETLOCK_LOCATION_GUID &&
    !!env.NETLOCK_COMMUNICATION_SERVERS &&
    !!env.NETLOCK_REMOTE_SERVERS &&
    !!env.NETLOCK_UPDATE_SERVERS &&
    !!env.NETLOCK_TRUST_SERVERS &&
    !!env.NETLOCK_FILE_SERVERS &&
    !!env.RMM_INSTALLER_JWT_SECRET
  );
}

function buildServerConfig(env: Env, opts: { architecture: string; accessKey: string }) {
  return {
    architecture: opts.architecture,
    ssl: env.NETLOCK_SSL,
    package_guid: env.NETLOCK_PACKAGE_GUID,
    communication_servers: env.NETLOCK_COMMUNICATION_SERVERS,
    remote_servers: env.NETLOCK_REMOTE_SERVERS,
    update_servers: env.NETLOCK_UPDATE_SERVERS,
    trust_servers: env.NETLOCK_TRUST_SERVERS,
    file_servers: env.NETLOCK_FILE_SERVERS,
    tenant_guid: env.NETLOCK_TENANT_GUID,
    location_guid: env.NETLOCK_LOCATION_GUID,
    language: env.NETLOCK_LANGUAGE,
    access_key: opts.accessKey,
    authorized: false,
  };
}

async function netlockFetch(env: Env, path: string, init?: RequestInit) {
  if (!env.NETLOCK_FILE_SERVER_URL) throw new Error("netlock_not_configured");
  if (!env.NETLOCK_FILE_SERVER_API_KEY) throw new Error("netlock_not_configured");

  enableInsecureTlsIfNeeded(env);

  const url = `${env.NETLOCK_FILE_SERVER_URL.replace(/\/+$/, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      "x-api-key": env.NETLOCK_FILE_SERVER_API_KEY,
    },
  });

  return res;
}

async function createInstaller(env: Env, body: { name: string; serverConfig: unknown }) {
  const res = await netlockFetch(env, "/admin/create_installer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: body.name, server_config: body.serverConfig }),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(`netlock_create_installer_failed:${res.status}`);
  const parsed = z.object({ guid: z.string().uuid() }).safeParse(data);
  if (!parsed.success) throw new Error("netlock_create_installer_invalid_response");
  return parsed.data;
}

async function listConnectedAccessKeys(env: Env) {
  const res = await netlockFetch(env, "/admin/devices/connected", { method: "GET" });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(`netlock_connected_failed:${res.status}`);
  const parsed = z.object({ access_keys: z.array(z.string()) }).safeParse(data);
  if (!parsed.success) throw new Error("netlock_connected_invalid_response");
  return parsed.data.access_keys;
}

async function downloadByGuid(env: Env, guid: string) {
  const qs = new URLSearchParams({ guid }).toString();
  return await netlockFetch(env, `/admin/files/download?${qs}`, { method: "GET" });
}

async function ensureAssetAssignmentForUser(supabaseAdmin: SupabaseClient, opts: { assetId: string; userId: string }) {
  const { data, error } = await supabaseAdmin
    .from("asset_assignments")
    .select("id")
    .eq("asset_id", opts.assetId)
    .eq("user_id", opts.userId)
    .is("ended_at", null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (data?.id) return;

  const { error: insErr } = await supabaseAdmin.from("asset_assignments").insert({
    asset_id: opts.assetId,
    user_id: opts.userId,
    role: "principal",
    notes: "Auto-asignado por NetLock RMM (enrolamiento del usuario).",
  });
  if (insErr) throw insErr;
}

async function upsertAssetForAccessKey(supabaseAdmin: SupabaseClient, opts: { departmentId: string; accessKey: string; name: string }) {
  const now = new Date().toISOString();
  const metadata = { netlock: { access_key: opts.accessKey, last_seen_at: now } };

  const row = {
    department_id: opts.departmentId,
    name: opts.name,
    mesh_node_id: opts.accessKey, // Reuse existing unique index (dept + mesh_node_id) as a generic RMM device key.
    connectivity_status: "Online",
    last_seen_at: now,
    metadata,
    updated_at: now,
  };

  const { data, error } = await supabaseAdmin
    .from("assets")
    .upsert(row, { onConflict: "department_id,mesh_node_id" })
    .select("id")
    .maybeSingle();
  if (error) throw error;
  const out = (data as { id: string } | null) ?? null;
  return out?.id ?? null;
}

async function issueInstallerToken(env: Env, claims: { v: 1; guid: string; accessKey: string; userId: string; departmentId: string; name: string }) {
  if (!env.RMM_INSTALLER_JWT_SECRET) throw new Error("rmm_installer_jwt_secret_required");
  const ttl = env.RMM_INSTALLER_TOKEN_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttl;
  const jwt = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(textSecret(env.RMM_INSTALLER_JWT_SECRET));
  return { token: jwt, expiresInSeconds: ttl };
}

async function verifyInstallerToken(env: Env, token: string) {
  if (!env.RMM_INSTALLER_JWT_SECRET) throw new Error("rmm_installer_jwt_secret_required");
  const res = await jwtVerify(token, textSecret(env.RMM_INSTALLER_JWT_SECRET), { issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
  const payload = res.payload as unknown;
  const schema = z.object({
    v: z.literal(1),
    guid: z.string().uuid(),
    accessKey: z.string().min(8),
    userId: z.string().uuid(),
    departmentId: z.string().uuid(),
    name: z.string().min(1).max(200),
  });
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new Error("invalid_installer_token");
  return parsed.data;
}

export function registerNetlockRmmRoutes(app: express.Express, opts: { env: Env; supabaseAdmin: SupabaseClient | null }) {
  // Status (agents/supervisors/admin only) - does not reveal secrets.
  app.get("/api/netlock/status", requireAuth, async (req, res) => {
    const authed = req as AuthedRequest;
    if (!["agent", "supervisor", "admin"].includes(authed.auth.role)) return res.status(403).json({ error: "forbidden" });

    const checkedAt = new Date().toISOString();
    const configured = netlockConfigured(opts.env);
    if (!configured) return res.json({ provider: "netlock", configured: false, connectivity: { ok: false, checkedAt, error: "netlock_not_configured" } });

    try {
      const accessKeys = await listConnectedAccessKeys(opts.env);
      return res.json({ provider: "netlock", configured: true, connectivity: { ok: true, checkedAt, error: null }, details: { connected: accessKeys.length } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "netlock_unreachable";
      return res.json({ provider: "netlock", configured: true, connectivity: { ok: false, checkedAt, error: msg } });
    }
  });

  // User self-enrollment: generate a one-click installer ZIP and return a short-lived download URL.
  app.post("/api/netlock/enroll/self", requireAuth, async (req, res) => {
    try {
      if (!opts.supabaseAdmin) return res.status(500).json({ error: "service_role_required" });
      const authed = req as AuthedRequest;
      if (!authed.auth.departmentId) return res.status(400).json({ error: "department_required" });

      const parsed = EnrollBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
      if (!netlockConfigured(opts.env)) return res.status(500).json({ error: "netlock_not_configured" });

      const accessKey = crypto.randomUUID();
      const serverConfig = buildServerConfig(opts.env, { architecture: parsed.data.architecture, accessKey });
      const name = `itsm-${authed.auth.userId}-${Date.now()}`;

      const created = await createInstaller(opts.env, { name, serverConfig });
      const issued = await issueInstallerToken(opts.env, {
        v: 1,
        guid: created.guid,
        accessKey,
        userId: authed.auth.userId,
        departmentId: authed.auth.departmentId,
        name: `${name}-${parsed.data.architecture}.zip`,
      });

      res.setHeader("Cache-Control", "no-store");
      return res.json({
        provider: "netlock",
        url: `${apiPublicUrl(req)}/api/netlock/installer/${issued.token}`,
        expiresInSeconds: issued.expiresInSeconds,
        correlationKey: accessKey,
        hint: "El link descarga un ZIP con el instalador. En Windows, descomprime y ejecuta como administrador; en macOS/Linux, hazlo ejecutable y corre con sudo.",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "bad_request";
      res.status(400).json({ error: message });
    }
  });

  // Public download endpoint (token-protected, no user session required).
  app.get("/api/netlock/installer/:token", async (req, res) => {
    try {
      const token = String(req.params.token ?? "").trim();
      if (!token) return res.status(400).send("invalid_token");
      if (!netlockConfigured(opts.env)) return res.status(500).send("netlock_not_configured");

      const claims = await verifyInstallerToken(opts.env, token);
      const dl = await downloadByGuid(opts.env, claims.guid);
      if (!dl.ok) return res.status(502).send("download_failed");

      const contentType = dl.headers.get("content-type") ?? "application/zip";
      const disp = dl.headers.get("content-disposition") ?? `attachment; filename="${claims.name}"`;
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", disp);
      res.setHeader("Cache-Control", "no-store");

      if (!dl.body) return res.status(502).send("empty_body");
      const webBody = dl.body as unknown as NodeReadableStream<Uint8Array>;
      Readable.fromWeb(webBody).pipe(res);
    } catch {
      res.status(401).send("unauthorized");
    }
  });

  // Verification: if the device is connected (access_key online), create/update the asset and assign it to the user.
  app.post("/api/netlock/verify/self", requireAuth, async (req, res) => {
    try {
      if (!opts.supabaseAdmin) return res.status(500).json({ error: "service_role_required" });
      const authed = req as AuthedRequest;
      if (!authed.auth.departmentId) return res.status(400).json({ error: "department_required" });

      const parsed = VerifyBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
      if (!netlockConfigured(opts.env)) return res.status(500).json({ error: "netlock_not_configured" });

      const connected = await listConnectedAccessKeys(opts.env);
      if (!connected.includes(parsed.data.accessKey)) {
        res.setHeader("Cache-Control", "no-store");
        return res.json({ ok: false, assetId: null, message: "Aún no aparece conectado. Revisa que el agente terminó de instalar y espera 10–30s." });
      }

      const name = parsed.data.deviceName?.trim() || `Equipo ${parsed.data.accessKey.slice(0, 8)}`;
      const assetId = await upsertAssetForAccessKey(opts.supabaseAdmin, { departmentId: authed.auth.departmentId, accessKey: parsed.data.accessKey, name });
      if (assetId) await ensureAssetAssignmentForUser(opts.supabaseAdmin, { assetId, userId: authed.auth.userId });

      res.setHeader("Cache-Control", "no-store");
      return res.json({ ok: true, assetId: assetId ?? null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "bad_request";
      res.status(400).json({ error: message });
    }
  });
}
