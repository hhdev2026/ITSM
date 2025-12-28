import type { Server } from "http";
import * as crypto from "crypto";
import * as net from "net";
import { SignJWT, jwtVerify } from "jose";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";
import { z } from "zod";
import type express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env";
import { requireAuth, requireRole, type AuthedRequest } from "./auth";

type EncryptedCredentials = {
  v: 1;
  alg: "aes-256-gcm";
  iv: string; // base64
  tag: string; // base64
  ciphertext: string; // base64
};

type RemoteDeviceProtocol = "rdp" | "vnc";

type RemoteDeviceRow = {
  id: string;
  name: string;
  department_id: string;
  mesh_node_id: string | null;
  protocol: RemoteDeviceProtocol;
  credentials: EncryptedCredentials;
};

type PlainCredentials =
  | { protocol: "rdp"; hostname: string; port?: number; username: string; password: string; domain?: string }
  | { protocol: "vnc"; hostname: string; port?: number; password: string };

type TunnelTokenClaims = {
  v: 1;
  deviceId: string;
  departmentId: string;
  role: AuthedRequest["auth"]["role"];
};

const TokenRequestSchema = z.object({
  deviceId: z.string().uuid(),
});

const JWT_ISSUER = "geimser-itsm-api";
const JWT_AUDIENCE = "remote-tunnel";

function textSecret(secret: string) {
  return new TextEncoder().encode(secret);
}

function parseAes256KeyBase64(base64: string) {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("REMOTE_CREDENTIALS_KEY must be base64 for 32 bytes (AES-256)");
  return key;
}

function decryptCredentials(env: Env, encrypted: EncryptedCredentials): PlainCredentials {
  if (!env.REMOTE_CREDENTIALS_KEY) throw new Error("REMOTE_CREDENTIALS_KEY required");
  if (!encrypted || encrypted.v !== 1 || encrypted.alg !== "aes-256-gcm") throw new Error("invalid_credentials_cipher");

  const key = parseAes256KeyBase64(env.REMOTE_CREDENTIALS_KEY);
  const iv = Buffer.from(encrypted.iv, "base64");
  const tag = Buffer.from(encrypted.tag, "base64");
  const ciphertext = Buffer.from(encrypted.ciphertext, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(plaintext) as unknown;

  const schema = z.discriminatedUnion("protocol", [
    z.object({
      protocol: z.literal("rdp"),
      hostname: z.string().min(1),
      port: z.number().int().min(1).max(65535).optional(),
      username: z.string().min(1),
      password: z.string().min(1),
      domain: z.string().min(1).optional(),
    }),
    z.object({
      protocol: z.literal("vnc"),
      hostname: z.string().min(1),
      port: z.number().int().min(1).max(65535).optional(),
      password: z.string().min(1),
    }),
  ]);

  return schema.parse(parsed);
}

function encodeInstruction(elements: string[]) {
  const parts: string[] = [];
  for (const el of elements) parts.push(`${el.length}.${el}`);
  return `${parts.join(",")};`;
}

function decodeInstruction(instruction: string) {
  const elements: string[] = [];
  let i = 0;

  while (i < instruction.length) {
    const dot = instruction.indexOf(".", i);
    if (dot === -1) throw new Error("incomplete_instruction");
    const len = Number.parseInt(instruction.slice(i, dot), 10);
    if (!Number.isFinite(len) || len < 0) throw new Error("invalid_instruction_length");
    const start = dot + 1;
    const end = start + len;
    if (end > instruction.length) throw new Error("incomplete_instruction");
    const value = instruction.slice(start, end);
    elements.push(value);
    const term = instruction.slice(end, end + 1);
    if (term === ";") break;
    if (term !== ",") throw new Error("invalid_instruction_terminator");
    i = end + 1;
  }

  return elements;
}

function wsCloseWithStatus(ws: WebSocket, statusCode: number) {
  try {
    ws.close(1008, String(statusCode));
  } catch {
    // ignore
  }
}

const usedJtis = new Map<string, number>();
function markJtiUsed(jti: string, expSeconds: number) {
  usedJtis.set(jti, expSeconds);
  const now = Math.floor(Date.now() / 1000);
  for (const [k, exp] of usedJtis) if (exp <= now) usedJtis.delete(k);
}

async function issueTunnelToken(env: Env, claims: TunnelTokenClaims, subjectUserId: string) {
  if (!env.REMOTE_TUNNEL_JWT_SECRET) throw new Error("REMOTE_TUNNEL_JWT_SECRET required");
  const ttl = env.REMOTE_TUNNEL_TOKEN_TTL_SECONDS;
  const expSeconds = Math.floor(Date.now() / 1000) + ttl;
  const jti = crypto.randomUUID();

  const token = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expSeconds)
    .setJti(jti)
    .setSubject(subjectUserId)
    .sign(textSecret(env.REMOTE_TUNNEL_JWT_SECRET));

  return { token, expiresInSeconds: ttl, expSeconds, jti };
}

async function verifyTunnelToken(env: Env, token: string) {
  if (!env.REMOTE_TUNNEL_JWT_SECRET) throw new Error("REMOTE_TUNNEL_JWT_SECRET required");
  const res = await jwtVerify(token, textSecret(env.REMOTE_TUNNEL_JWT_SECRET), {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
  const payload = res.payload as unknown as TunnelTokenClaims & { sub?: string; jti?: string; exp?: number };
  const schema = z.object({
    v: z.literal(1),
    deviceId: z.string().uuid(),
    departmentId: z.string().uuid(),
    role: z.enum(["user", "agent", "supervisor", "admin"]),
    sub: z.string().uuid(),
    jti: z.string().min(1),
    exp: z.number().int(),
  });
  return schema.parse(payload);
}

function buildGuacdParameterMap(
  device: Pick<RemoteDeviceRow, "protocol">,
  creds: PlainCredentials,
  opts: { width: number; height: number; dpi: number }
): Record<string, string> {
  if (device.protocol === "rdp") {
    if (creds.protocol !== "rdp") throw new Error("credentials_protocol_mismatch");
    return {
      hostname: creds.hostname,
      port: String(creds.port ?? 3389),
      username: creds.username,
      password: creds.password,
      domain: creds.domain ?? "",
      width: String(opts.width),
      height: String(opts.height),
      dpi: String(opts.dpi),
      "ignore-cert": "true",
      security: "nla",
      "enable-wallpaper": "false",
      "enable-font-smoothing": "true",
      "enable-themes": "false",
      "resize-method": "display-update",
    };
  }

  if (creds.protocol !== "vnc") throw new Error("credentials_protocol_mismatch");
  return {
    hostname: creds.hostname,
    port: String(creds.port ?? 5900),
    password: creds.password,
    width: String(opts.width),
    height: String(opts.height),
    dpi: String(opts.dpi),
  };
}

export function registerRemoteRoutes(app: express.Express, opts: { env: Env; supabaseAdmin: SupabaseClient | null }) {
  app.post("/api/remote/tunnel", requireAuth, requireRole(["agent", "supervisor", "admin"]), async (req, res) => {
    try {
      if (!opts.supabaseAdmin) return res.status(500).json({ error: "service_role_required" });
      if (!opts.env.REMOTE_TUNNEL_JWT_SECRET) return res.status(500).json({ error: "remote_tunnel_jwt_secret_required" });

      const parsed = TokenRequestSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

      const authed = req as AuthedRequest;
      const { deviceId } = parsed.data;

      const { data: device, error } = await authed.supabase
        .from("remote_devices")
        .select("id,department_id")
        .eq("id", deviceId)
        .maybeSingle();
      if (error) throw error;
      if (!device) return res.status(404).json({ error: "device_not_found" });

      const { token, expiresInSeconds } = await issueTunnelToken(
        opts.env,
        { v: 1, deviceId, departmentId: String(device.department_id), role: authed.auth.role },
        authed.auth.userId
      );

      res.setHeader("Cache-Control", "no-store");
      return res.json({ token, expiresInSeconds });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "bad_request";
      res.status(400).json({ error: message });
    }
  });
}

export function attachRemoteTunnelWs(server: Server, opts: { env: Env; supabaseAdmin: SupabaseClient | null }) {
  const wss = new WebSocketServer({ noServer: true, clientTracking: false });

  server.on("upgrade", (req, socket, head) => {
    try {
      const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
      if (url.pathname !== "/api/remote/tunnel") return;

      const origin = String(req.headers.origin ?? "").trim();
      const allowed = opts.env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);
      if (origin && allowed.length && !allowed.includes(origin)) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    } catch {
      // ignore
    }
  });

  wss.on("connection", async (ws, req) => {
    if (!opts.supabaseAdmin) return wsCloseWithStatus(ws, 0x0200 /* SERVER_ERROR */);
    if (!opts.env.REMOTE_TUNNEL_JWT_SECRET) return wsCloseWithStatus(ws, 0x0200 /* SERVER_ERROR */);
    if (!opts.env.REMOTE_CREDENTIALS_KEY) return wsCloseWithStatus(ws, 0x0200 /* SERVER_ERROR */);

    const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
    const token = url.searchParams.get("token") ?? "";
    if (!token) return wsCloseWithStatus(ws, 0x0301 /* CLIENT_UNAUTHORIZED */);

    let tokenData: Awaited<ReturnType<typeof verifyTunnelToken>>;
    try {
      tokenData = await verifyTunnelToken(opts.env, token);
    } catch {
      return wsCloseWithStatus(ws, 0x0301 /* CLIENT_UNAUTHORIZED */);
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (tokenData.exp <= nowSeconds) return wsCloseWithStatus(ws, 0x020A /* SESSION_TIMEOUT */);
    if (usedJtis.has(tokenData.jti)) return wsCloseWithStatus(ws, 0x0303 /* CLIENT_FORBIDDEN */);
    markJtiUsed(tokenData.jti, tokenData.exp);

    const width = Math.max(320, Math.min(3840, Number.parseInt(url.searchParams.get("w") ?? "", 10) || 1280));
    const height = Math.max(240, Math.min(2160, Number.parseInt(url.searchParams.get("h") ?? "", 10) || 720));
    const dpi = Math.max(72, Math.min(300, Number.parseInt(url.searchParams.get("dpi") ?? "", 10) || 96));

    const { data: device, error } = await opts.supabaseAdmin
      .from("remote_devices")
      .select("id,name,department_id,mesh_node_id,protocol,credentials")
      .eq("id", tokenData.deviceId)
      .maybeSingle();
    if (error || !device) return wsCloseWithStatus(ws, 0x0303 /* CLIENT_FORBIDDEN */);
    const row = device as unknown as RemoteDeviceRow;
    if (row.department_id !== tokenData.departmentId) return wsCloseWithStatus(ws, 0x0303 /* CLIENT_FORBIDDEN */);

    let creds: PlainCredentials;
    try {
      creds = decryptCredentials(opts.env, row.credentials);
    } catch {
      return wsCloseWithStatus(ws, 0x0200 /* SERVER_ERROR */);
    }

    const paramMap = buildGuacdParameterMap(row, creds, { width, height, dpi });

    const guacd = net.createConnection({ host: opts.env.GUACD_HOST, port: opts.env.GUACD_PORT });
    guacd.setNoDelay(true);

    let guacdBuffer = "";
    let handshakeDone = false;
    let closed = false;
    const pendingToGuacd: string[] = [];

    function safeCloseAll() {
      if (closed) return;
      closed = true;
      try {
        ws.close();
      } catch {
        // ignore
      }
      try {
        guacd.destroy();
      } catch {
        // ignore
      }
    }

    function flushPending() {
      if (!handshakeDone) return;
      while (pendingToGuacd.length) {
        const msg = pendingToGuacd.shift();
        if (!msg) continue;
        guacd.write(msg);
      }
    }

    function sendToBrowser(chunk: string) {
      if (closed) return;
      if (!chunk) return;
      try {
        ws.send(chunk);
      } catch {
        safeCloseAll();
      }
    }

    function handleGuacdData(data: Buffer) {
      if (closed) return;
      guacdBuffer += data.toString("utf8");

      const lastTerminator = guacdBuffer.lastIndexOf(";");
      if (lastTerminator === -1) return;

      const complete = guacdBuffer.slice(0, lastTerminator + 1);
      guacdBuffer = guacdBuffer.slice(lastTerminator + 1);

      if (handshakeDone) {
        sendToBrowser(complete);
        return;
      }

      let remaining = complete;
      while (remaining.length) {
        const end = remaining.indexOf(";");
        if (end === -1) break;
        const instr = remaining.slice(0, end + 1);
        remaining = remaining.slice(end + 1);

        let elements: string[];
        try {
          elements = decodeInstruction(instr);
        } catch {
          wsCloseWithStatus(ws, 0x0200 /* SERVER_ERROR */);
          safeCloseAll();
          return;
        }

        const opcode = elements[0] ?? "";
        if (opcode === "args") {
          const args = elements.slice(1);
          const values = args.map((k) => (k in paramMap ? paramMap[k] : ""));
          guacd.write(encodeInstruction(["connect", ...values]));
          handshakeDone = true;
          flushPending();
          if (remaining) sendToBrowser(remaining);
          return;
        }

        if (opcode === "error") {
          wsCloseWithStatus(ws, 0x0200 /* SERVER_ERROR */);
          safeCloseAll();
          return;
        }
      }
    }

    guacd.on("connect", () => {
      try {
        guacd.write(encodeInstruction(["select", row.protocol]));
      } catch {
        wsCloseWithStatus(ws, 0x0200 /* SERVER_ERROR */);
        safeCloseAll();
      }
    });

    guacd.on("data", handleGuacdData);
    guacd.on("error", () => {
      wsCloseWithStatus(ws, 0x0200 /* SERVER_ERROR */);
      safeCloseAll();
    });
    guacd.on("close", () => safeCloseAll());

    ws.on("message", (raw) => {
      if (closed) return;
      const msg = typeof raw === "string" ? raw : raw.toString("utf8");
      if (!msg.endsWith(";")) return;

      try {
        const elements = decodeInstruction(msg);
        if (elements[0] === "" && elements[1] === "ping") {
          ws.send(msg);
          return;
        }
      } catch {
        // ignore decoding errors; treat as bad type
        wsCloseWithStatus(ws, 0x030F /* CLIENT_BAD_TYPE */);
        safeCloseAll();
        return;
      }

      if (!handshakeDone) {
        pendingToGuacd.push(msg);
        return;
      }
      guacd.write(msg);
    });

    ws.on("close", () => safeCloseAll());
    ws.on("error", () => safeCloseAll());
  });
}
