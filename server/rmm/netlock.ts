import * as crypto from "crypto";
import type express from "express";
import { z } from "zod";
import { SignJWT, jwtVerify } from "jose";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { Env } from "../env";
import { requireAuth, type AuthedRequest } from "../auth";

type NetlockDeviceRow = {
  id: number;
  access_key: string;
  device_name: string | null;
  platform: string | null;
  authorized: number | null;
  last_access: Date | string | null;
};

const EnrollBodySchema = z.object({
  hours: z.coerce.number().int().min(1).max(24 * 30).default(24),
  architecture: z.enum(["win-x64", "win-arm64", "linux-x64", "linux-arm64", "osx-x64", "osx-arm64"]),
  deviceName: z.string().trim().min(1).max(120).optional(),
});

const VerifyBodySchema = z.object({
  accessKey: z.string().trim().min(8).max(200),
  deviceName: z.string().trim().min(1).max(120).optional(),
});

const AuthorizeBodySchema = z.object({
  accessKey: z.string().trim().min(8).max(200),
});

const JWT_ISSUER = "geimser-itsm-api";
const JWT_AUDIENCE = "rmm-installer";

function textSecret(secret: string) {
  return new TextEncoder().encode(secret);
}

function safeErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return "bad_request";
}

function apiPublicUrl(req: express.Request) {
  const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol ?? "http").split(",")[0]!.trim();
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost").split(",")[0]!.trim();
  return `${proto}://${host}`;
}

function setDownloadHeaders(res: express.Response, opts: { filename: string; contentType: string }) {
  res.setHeader("Content-Type", opts.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${opts.filename}"`);
  res.setHeader("Cache-Control", "no-store");
}

function enableInsecureTlsIfNeeded(env: Env) {
  if (!env.NETLOCK_INSECURE_TLS) return;
  // Only relevant for HTTPS targets. (Avoids noisy Node warning in local HTTP setups.)
  if (!env.NETLOCK_FILE_SERVER_URL?.toLowerCase().startsWith("https://")) return;
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
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        "x-api-key": env.NETLOCK_FILE_SERVER_API_KEY,
      },
    });
  } catch {
    // NetLock not ready / restarting / not reachable.
    throw new Error("netlock_unreachable");
  }

  return res;
}

async function createInstaller(env: Env, body: { name: string; serverConfig: unknown }) {
  const res = await netlockFetch(env, "/admin/create_installer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: body.name, server_config: body.serverConfig }),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`netlock_create_installer_failed:${res.status}`);
  if (!text.trim()) {
    // This typically means NetLock has no installer.package.* loaded (members portal key not set / packages missing).
    throw new Error("netlock_installer_packages_missing");
  }
  const data: unknown = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })();
  const parsed = z.object({ guid: z.string().uuid() }).safeParse(data);
  if (!parsed.success) throw new Error("netlock_create_installer_invalid_response");
  return parsed.data;
}

async function checkFileServerConnectivity(env: Env) {
  // No side effects; validates the file-server role API + key.
  const res = await netlockFetch(env, "/admin/files/index/base1337", { method: "POST" });
  if (!res.ok) throw new Error(`netlock_files_index_failed:${res.status}`);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function listConnectedAccessKeys(env: Env) {
  // NetLock does not expose a stable "connected devices" endpoint in the file-server API.
  // We use the base file index as a best-effort signal: when an agent connects, it typically creates a folder keyed by `access_key`.
  const res = await netlockFetch(env, "/admin/files/index/base1337", { method: "POST" });
  if (!res.ok) throw new Error(`netlock_files_index_failed:${res.status}`);

  const data: unknown = await res.json().catch(() => null);
  const parsed = z
    .object({
      index: z.array(z.object({ name: z.string() })).default([]),
    })
    .safeParse(data);
  if (!parsed.success) throw new Error("netlock_files_index_invalid_response");

  return parsed.data.index.map((item) => item.name).filter((name) => isUuid(name));
}

async function getDeviceByAccessKeyFromMysql(env: Env, accessKey: string): Promise<NetlockDeviceRow | null> {
  if (!env.NETLOCK_MYSQL_URL) return null;

  const mysql2 = await import("mysql2/promise");
  const url = new URL(env.NETLOCK_MYSQL_URL);

  let connection: Awaited<ReturnType<(typeof mysql2)["createConnection"]>>;
  try {
    connection = await mysql2.createConnection({
      host: url.hostname,
      port: url.port ? Number(url.port) : 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, "") || "netlock",
    });
  } catch {
    throw new Error("netlock_mysql_unreachable");
  }

  try {
    const [rows] = await connection.execute(
      "SELECT id, access_key, device_name, platform, authorized, last_access FROM devices WHERE access_key = ? LIMIT 1",
      [accessKey],
    );
    const list = rows as unknown as NetlockDeviceRow[];
    return list?.[0] ?? null;
  } finally {
    await connection.end().catch(() => undefined);
  }
}

async function authorizeDeviceInMysql(env: Env, accessKey: string): Promise<boolean> {
  if (!env.NETLOCK_MYSQL_URL) return false;
  const mysql2 = await import("mysql2/promise");
  const url = new URL(env.NETLOCK_MYSQL_URL);

  const connection = await mysql2.createConnection({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, "") || "netlock",
  });

  try {
    const [result] = await connection.execute("UPDATE devices SET authorized = 1 WHERE access_key = ? AND (authorized IS NULL OR authorized = 0)", [
      accessKey,
    ]);
    const info = result as unknown as { affectedRows?: number };
    return (info.affectedRows ?? 0) > 0;
  } finally {
    await connection.end().catch(() => undefined);
  }
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

  // Avoid relying on ON CONFLICT (PostgREST may not accept partial unique indexes).
  const { data: existing, error: selErr } = await supabaseAdmin
    .from("assets")
    .select("id")
    .eq("department_id", opts.departmentId)
    .eq("mesh_node_id", opts.accessKey)
    .limit(1)
    .maybeSingle();
  if (selErr) throw selErr;

  const existingId = (existing as { id: string } | null)?.id ?? null;
  if (existingId) {
    const { error: updErr } = await supabaseAdmin.from("assets").update(row).eq("id", existingId);
    if (updErr) throw updErr;
    return existingId;
  }

  const { data: inserted, error: insErr } = await supabaseAdmin.from("assets").insert(row).select("id").maybeSingle();
  if (insErr) throw insErr;
  const out = (inserted as { id: string } | null) ?? null;
  return out?.id ?? null;
}

async function issueInstallerToken(
  env: Env,
  claims: { v: 1; guid: string; accessKey: string; userId: string; departmentId: string; name: string; serverConfigJson?: string },
) {
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
    serverConfigJson: z.string().min(2).max(20_000).optional(),
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
      await checkFileServerConnectivity(opts.env);
      return res.json({ provider: "netlock", configured: true, connectivity: { ok: true, checkedAt, error: null } });
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
        serverConfigJson: JSON.stringify(serverConfig),
      });

      res.setHeader("Cache-Control", "no-store");
      return res.json({
        provider: "netlock",
        url: `${apiPublicUrl(req)}/api/netlock/installer/${issued.token}`,
        configUrl: `${apiPublicUrl(req)}/api/netlock/server-config/${issued.token}`,
        expiresInSeconds: issued.expiresInSeconds,
        correlationKey: accessKey,
        hint:
          "Tip: en macOS/Linux usa el “Instalador automático” (recomendado). Alternativa avanzada: ZIP + `server_config.json` y ejecutar `NetLock_RMM_Agent_Installer clean server_config.json`.",
      });
    } catch (err: unknown) {
      res.status(400).json({ error: safeErrorMessage(err) });
    }
  });

  // Authorize a device in NetLock (agent/supervisor/admin only).
  app.post("/api/netlock/authorize", requireAuth, async (req, res) => {
    try {
      const authed = req as AuthedRequest;
      if (!["agent", "supervisor", "admin"].includes(authed.auth.role)) return res.status(403).json({ error: "forbidden" });

      const parsed = AuthorizeBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
      if (!opts.env.NETLOCK_MYSQL_URL) return res.status(500).json({ error: "netlock_mysql_not_configured" });

      const device = await getDeviceByAccessKeyFromMysql(opts.env, parsed.data.accessKey);
      if (!device) return res.status(404).json({ error: "device_not_found" });

      const changed = await authorizeDeviceInMysql(opts.env, parsed.data.accessKey);
      res.setHeader("Cache-Control", "no-store");
      return res.json({ ok: true, changed });
    } catch (err: unknown) {
      res.status(400).json({ error: safeErrorMessage(err) });
    }
  });

  // Download server_config.json for installers that require CLI arguments (macOS often blocks unsigned embedded-config one-click binaries).
  app.get("/api/netlock/server-config/:token", async (req, res) => {
    try {
      const token = String(req.params.token ?? "").trim();
      if (!token) return res.status(400).send("invalid_token");
      if (!netlockConfigured(opts.env)) return res.status(500).send("netlock_not_configured");

      const claims = await verifyInstallerToken(opts.env, token);
      if (!claims.serverConfigJson) return res.status(404).send("missing_server_config");

      setDownloadHeaders(res, { contentType: "application/json; charset=utf-8", filename: "server_config.json" });
      return res.send(claims.serverConfigJson);
    } catch {
      res.status(401).send("unauthorized");
    }
  });

  // Convenience: generates a small install script that downloads the ZIP + server_config.json and runs the installer.
  app.get("/api/netlock/install-script/macos/:token", async (req, res) => {
    try {
      const token = String(req.params.token ?? "").trim();
      if (!token) return res.status(400).send("invalid_token");
      if (!netlockConfigured(opts.env)) return res.status(500).send("netlock_not_configured");

      await verifyInstallerToken(opts.env, token);
      const base = apiPublicUrl(req);
      const script = `#!/bin/bash
set -euo pipefail

API_BASE="${base}"
TOKEN="${token}"
DEST="$HOME/Downloads/NetLock-ITSM"
ZIP="$DEST/netlock-installer.zip"
CFG="$DEST/server_config.json"
AGENT_ROOT="/usr/local/bin/0x101_Cyber_Security/NetLock_RMM"

mkdir -p "$DEST"
echo "[1/4] Descargando instalador..."
curl -fL "$API_BASE/api/netlock/installer/$TOKEN" -o "$ZIP"
echo "[2/4] Descargando server_config.json..."
curl -fL "$API_BASE/api/netlock/server-config/$TOKEN" -o "$CFG"
echo "[3/4] Descomprimiendo..."
rm -rf "$DEST/pkg"
mkdir -p "$DEST/pkg"
unzip -oq "$ZIP" -d "$DEST/pkg"

INSTALLER="$(find "$DEST/pkg" -maxdepth 3 -type f -name 'NetLock_RMM_Agent_Installer*' | head -n 1 || true)"
if [ -z "$INSTALLER" ]; then
  echo "No encontré NetLock_RMM_Agent_Installer dentro del ZIP."
  echo "Ruta: $DEST/pkg"
  exit 1
fi

echo "[4/4] Instalando (pedirá contraseña de administrador)..."
chmod +x "$INSTALLER" || true
xattr -dr com.apple.quarantine "$DEST/pkg" 2>/dev/null || true
codesign --force --sign - --no-strict "$INSTALLER" 2>/dev/null || true
sudo "$INSTALLER" clean "$CFG"

echo "[post] Firmando binarios del agente (requerido en Apple Silicon)..."
if [ -d "$AGENT_ROOT" ]; then
  sudo xattr -dr com.apple.quarantine "$AGENT_ROOT" 2>/dev/null || true
  sudo codesign --force --sign - --no-strict "$AGENT_ROOT"/*_Agent/NetLock_RMM_Agent_* 2>/dev/null || true
  sudo launchctl kickstart -k system/com.netlock.rmm.agentcomm 2>/dev/null || true
  sudo launchctl kickstart -k system/com.netlock.rmm.agentremote 2>/dev/null || true
  sudo launchctl kickstart -k system/com.netlock.rmm.agenthealth 2>/dev/null || true
fi

echo "Listo. Vuelve a la app y presiona “Verificar”."
read -n 1 -s -r -p "Presiona cualquier tecla para cerrar..."
echo
`;

      setDownloadHeaders(res, { contentType: "application/x-sh; charset=utf-8", filename: "Install-NetLock.command" });
      return res.send(script);
    } catch {
      res.status(401).send("unauthorized");
    }
  });

  app.get("/api/netlock/install-script/linux/:token", async (req, res) => {
    try {
      const token = String(req.params.token ?? "").trim();
      if (!token) return res.status(400).send("invalid_token");
      if (!netlockConfigured(opts.env)) return res.status(500).send("netlock_not_configured");

      await verifyInstallerToken(opts.env, token);
      const base = apiPublicUrl(req);
      const script = `#!/bin/bash
set -euo pipefail

API_BASE="${base}"
TOKEN="${token}"
DEST="$HOME/Downloads/netlock-itsm"
ZIP="$DEST/netlock-installer.zip"
CFG="$DEST/server_config.json"

mkdir -p "$DEST"
echo "[1/4] Descargando instalador..."
curl -fL "$API_BASE/api/netlock/installer/$TOKEN" -o "$ZIP"
echo "[2/4] Descargando server_config.json..."
curl -fL "$API_BASE/api/netlock/server-config/$TOKEN" -o "$CFG"
echo "[3/4] Descomprimiendo..."
rm -rf "$DEST/pkg"
mkdir -p "$DEST/pkg"
unzip -oq "$ZIP" -d "$DEST/pkg"

INSTALLER="$(find "$DEST/pkg" -maxdepth 3 -type f -name 'NetLock_RMM_Agent_Installer*' | head -n 1 || true)"
if [ -z "$INSTALLER" ]; then
  echo "No encontré NetLock_RMM_Agent_Installer dentro del ZIP."
  echo "Ruta: $DEST/pkg"
  exit 1
fi

echo "[4/4] Instalando (pedirá contraseña si aplica)..."
chmod +x "$INSTALLER" || true
sudo "$INSTALLER" clean "$CFG"

echo "Listo. Vuelve a la app y presiona “Verificar”."
`;

      setDownloadHeaders(res, { contentType: "application/x-sh; charset=utf-8", filename: "install-netlock.sh" });
      return res.send(script);
    } catch {
      res.status(401).send("unauthorized");
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

      let device: NetlockDeviceRow | null = null;
      try {
        device = await getDeviceByAccessKeyFromMysql(opts.env, parsed.data.accessKey);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "netlock_mysql_unreachable";
        if (msg === "netlock_mysql_unreachable") {
          res.setHeader("Cache-Control", "no-store");
          return res.json({
            ok: false,
            assetId: null,
            message:
              "No pude conectar a NetLock MySQL para verificar el equipo. En dev: reinicia `docker compose up -d` (docker-compose.yml expone 127.0.0.1:3307) y revisa `NETLOCK_MYSQL_URL`.",
          });
        }
        throw e;
      }
      if (!device) {
        const connected = await listConnectedAccessKeys(opts.env);
        if (!connected.includes(parsed.data.accessKey)) {
          res.setHeader("Cache-Control", "no-store");
          return res.json({
            ok: false,
            assetId: null,
            message:
              "Aún no aparece registrado en NetLock. Espera 10–60s y reintenta. Si persiste, revisa que el agente esté corriendo (LaunchDaemons) y que el server esté accesible.",
          });
        }
      }

      // Auto-authorize device on first verification (enables inventory/policies in most NetLock setups).
      if (device && opts.env.NETLOCK_AUTO_AUTHORIZE_ON_VERIFY && (device.authorized ?? 0) === 0) {
        await authorizeDeviceInMysql(opts.env, parsed.data.accessKey).catch(() => undefined);
      }

      const name =
        parsed.data.deviceName?.trim() || device?.device_name?.trim() || `Equipo ${parsed.data.accessKey.slice(0, 8)}`;
      const assetId = await upsertAssetForAccessKey(opts.supabaseAdmin, { departmentId: authed.auth.departmentId, accessKey: parsed.data.accessKey, name });
      if (assetId) await ensureAssetAssignmentForUser(opts.supabaseAdmin, { assetId, userId: authed.auth.userId });

      res.setHeader("Cache-Control", "no-store");
      return res.json({ ok: true, assetId: assetId ?? null });
    } catch (err: unknown) {
      res.status(400).json({ error: safeErrorMessage(err) });
    }
  });
}
