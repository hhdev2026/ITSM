import * as crypto from "crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { z } from "zod";
import type express from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env";
import { requireAuth, requireRole, type AuthedRequest } from "./auth";
import { listDevices, normalizeNodeId, runCommand, runMeshCtrl, runMeshCtrlJson, type MeshDeviceNode, type MeshCtrlEnv, loadMeshCtrlEnv } from "./meshctrl";

const require = createRequire(import.meta.url);

type MeshCentralEvent = {
  action: string;
  nodeId: string | null;
  raw: unknown;
  receivedAt: string;
};

type AssetUpsertEvent = {
  nodeId: string;
  serialNumber: string;
  assetId: string | null;
  receivedAt: string;
};

type ScanResult = { hostname?: string; serial_number?: string; manufacturer?: string; model?: string; os?: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function parseKeyValueOutput(output: string): ScanResult {
  const res: ScanResult = {};
  const lines = output
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!value) continue;
    if (key === "hostname") res.hostname = value;
    if (key === "serial_number") res.serial_number = value;
    if (key === "manufacturer") res.manufacturer = value;
    if (key === "model") res.model = value;
    if (key === "os") res.os = value;
  }

  return res;
}

function inferPlatform(node: MeshDeviceNode) {
  const s = `${node.osdesc ?? ""} ${String(node.platform ?? "")} ${String(node.os ?? "")}`.toLowerCase();
  if (s.includes("windows")) return "windows" as const;
  if (s.includes("mac") || s.includes("os x") || s.includes("darwin")) return "mac" as const;
  if (s.includes("linux")) return "linux" as const;
  return "unknown" as const;
}

function scanCommandFor(node: MeshDeviceNode) {
  const platform = inferPlatform(node);
  if (platform === "windows") {
    const ps = [
      "$ErrorActionPreference='SilentlyContinue';",
      "$bios=Get-CimInstance Win32_BIOS;",
      "$cs=Get-CimInstance Win32_ComputerSystem;",
      "$os=Get-CimInstance Win32_OperatingSystem;",
      "$serial=($bios.SerialNumber | Out-String).Trim();",
      "$man=($cs.Manufacturer | Out-String).Trim();",
      "$model=($cs.Model | Out-String).Trim();",
      "$host=$env:COMPUTERNAME;",
      "$oscap=($os.Caption | Out-String).Trim();",
      "Write-Output (\"hostname=\" + $host);",
      "if ($serial) { Write-Output (\"serial_number=\" + $serial) }",
      "if ($man) { Write-Output (\"manufacturer=\" + $man) }",
      "if ($model) { Write-Output (\"model=\" + $model) }",
      "if ($oscap) { Write-Output (\"os=\" + $oscap) }",
    ].join(" ");
    return { command: ps, powershell: true, platform };
  }

  if (platform === "mac") {
    const sh = [
      "host=$(scutil --get ComputerName 2>/dev/null || hostname);",
      "serial=$(system_profiler SPHardwareDataType 2>/dev/null | awk -F': ' '/Serial Number/{print $2;exit}');",
      "model=$(system_profiler SPHardwareDataType 2>/dev/null | awk -F': ' '/Model Name/{print $2;exit}');",
      "os=$(sw_vers -productName 2>/dev/null)\" \"$(sw_vers -productVersion 2>/dev/null);",
      "echo \"hostname=$host\";",
      "[ -n \"$serial\" ] && echo \"serial_number=$serial\";",
      "echo \"manufacturer=Apple\";",
      "[ -n \"$model\" ] && echo \"model=$model\";",
      "[ -n \"$os\" ] && echo \"os=$os\";",
    ].join(" ");
    return { command: sh, powershell: false, platform };
  }

  const sh = [
    "host=$(hostname 2>/dev/null);",
    "serial=$(cat /sys/class/dmi/id/product_serial 2>/dev/null | tr -d '\\r');",
    "man=$(cat /sys/class/dmi/id/sys_vendor 2>/dev/null | tr -d '\\r');",
    "model=$(cat /sys/class/dmi/id/product_name 2>/dev/null | tr -d '\\r');",
    "os=$( ( . /etc/os-release 2>/dev/null; echo \"$PRETTY_NAME\" ) 2>/dev/null );",
    "echo \"hostname=$host\";",
    "[ -n \"$serial\" ] && echo \"serial_number=$serial\";",
    "[ -n \"$man\" ] && echo \"manufacturer=$man\";",
    "[ -n \"$model\" ] && echo \"model=$model\";",
    "[ -n \"$os\" ] && echo \"os=$os\";",
  ].join(" ");
  return { command: sh, powershell: false, platform };
}

async function resolveDepartmentIdByName(supabase: SupabaseClient, name: string) {
  const { data, error } = await supabase.from("departments").select("id,name,created_at").order("created_at", { ascending: true }).limit(50);
  if (error) throw error;
  const list = (data ?? []) as Array<{ id: string; name: string }>;
  const exact = list.find((d) => d.name.toLowerCase() === name.toLowerCase());
  return exact?.id ?? list[0]?.id ?? null;
}

function mergeMetadata(existing: unknown, nextMeshcentral: Record<string, unknown>) {
  const base = isRecord(existing) ? { ...existing } : {};
  const prevMesh = isRecord(base.meshcentral) ? { ...(base.meshcentral as Record<string, unknown>) } : {};
  return { ...base, meshcentral: { ...prevMesh, ...nextMeshcentral } };
}

async function upsertAssetFromScan(opts: {
  supabaseAdmin: SupabaseClient;
  departmentId: string;
  node: MeshDeviceNode;
  nodeId: string;
  scan: ScanResult;
  platform: string;
}) {
  type ExistingAssetRow = { id: string; metadata: unknown };
  type UpsertResRow = { id: string };
  const now = new Date().toISOString();
  const serial = opts.scan.serial_number?.trim() ? opts.scan.serial_number.trim() : null;

  let existingRow: ExistingAssetRow | null = null;
  if (serial) {
    const { data: existing, error: exErr } = await opts.supabaseAdmin
      .from("assets")
      .select("id,metadata")
      .eq("department_id", opts.departmentId)
      .eq("serial_number", serial)
      .maybeSingle();
    if (exErr) throw exErr;
    existingRow = (existing as ExistingAssetRow | null) ?? null;
  } else {
    const { data: existing, error: exErr } = await opts.supabaseAdmin
      .from("assets")
      .select("id,metadata")
      .eq("department_id", opts.departmentId)
      .eq("mesh_node_id", opts.nodeId)
      .maybeSingle();
    if (exErr) throw exErr;
    existingRow = (existing as ExistingAssetRow | null) ?? null;
  }

  const meshcentralMeta: Record<string, unknown> = {
    node_id: opts.nodeId,
    node_db_id: opts.node._id,
    group_id: opts.node.meshid ?? null,
    group_name: opts.node.groupname ?? null,
    osdesc: opts.node.osdesc ?? null,
    ip: typeof opts.node.ip === "string" ? opts.node.ip : null,
    last_sync_at: now,
    last_scan: opts.scan,
  };

  const merged = mergeMetadata(existingRow?.metadata ?? null, meshcentralMeta);
  const name = opts.scan.hostname?.trim() || opts.node.name || opts.nodeId;

  const row = {
    department_id: opts.departmentId,
    serial_number: serial,
    name,
    manufacturer: opts.scan.manufacturer ?? null,
    model: opts.scan.model ?? null,
    asset_type:
      opts.platform === "windows" ? "Windows" : opts.platform === "mac" ? "Mac" : opts.platform === "linux" ? "Linux" : (null as string | null),
    connectivity_status: "Online",
    last_seen_at: now,
    last_ip: typeof opts.node.ip === "string" ? opts.node.ip : null,
    last_hostname: opts.scan.hostname ?? null,
    mesh_node_id: opts.nodeId,
    metadata: merged,
  };

  const { data, error } = await opts.supabaseAdmin
    .from("assets")
    .upsert(row, { onConflict: serial ? "department_id,serial_number" : "department_id,mesh_node_id" })
    .select("id")
    .maybeSingle();
  if (error) throw error;
  const out = (data as UpsertResRow | null) ?? null;
  return out?.id ?? null;
}

function extractEventAction(obj: unknown): string | null {
  if (!isRecord(obj)) return null;
  const event = obj.event;
  if (isRecord(event) && typeof event.action === "string") return event.action;
  if (typeof obj.action === "string") return obj.action;
  return null;
}

function extractNodeId(obj: unknown): string | null {
  if (!isRecord(obj)) return null;
  const event = isRecord(obj.event) ? obj.event : null;
  const candidates = [obj.nodeid, obj.nodeId, event?.nodeid, event?.nodeId, event?.node, event?.id, event?.node_id];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return normalizeNodeId(c.trim());
  }
  return null;
}

function getMeshCtrlPath() {
  return require.resolve("meshcentral/meshctrl.js");
}

type MeshDeviceGroup = { _id: string; name: string };

async function ensureDeviceGroupExists(groupName: string) {
  const groups = await runMeshCtrlJson<MeshDeviceGroup[]>("listdevicegroups", ["--json"]);
  if (groups.some((g) => (g.name ?? "").toLowerCase() === groupName.toLowerCase())) return;
  const created = await runMeshCtrl("adddevicegroup", ["--name", groupName]);
  if (created.exitCode !== 0) {
    const msg = (created.stderr || created.stdout).trim();
    throw new Error(`meshcentral_adddevicegroup_failed:${msg || "unknown"}`);
  }
}

function parseUserIdFromDeviceGroupName(groupName: string | null | undefined) {
  if (!groupName) return null;
  const raw = groupName.trim();
  const m = /^usr-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(raw);
  return m?.[1] ?? null;
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
    notes: "Auto-asignado por MeshCentral (enrolamiento del usuario).",
  });
  if (insErr) throw insErr;
}

function spawnMeshCtrlShowEvents(env: MeshCtrlEnv, filter: string) {
  const meshctrlPath = getMeshCtrlPath();
  const argv = [
    meshctrlPath,
    "showevents",
    "--filter",
    filter,
    "--url",
    env.MESHCENTRAL_URL,
    "--loginuser",
    env.MESHCENTRAL_USER,
    "--loginpass",
    env.MESHCENTRAL_PASS,
  ];
  if (env.MESHCENTRAL_TOKEN) argv.push("--token", env.MESHCENTRAL_TOKEN);

  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  if (env.MESHCENTRAL_INSECURE_TLS) childEnv.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  return spawn(process.execPath, argv, { env: childEnv });
}

function createJsonBlockParser(onObject: (obj: unknown) => void) {
  let buffer = "";
  let depth = 0;
  let inString = false;
  let escape = false;
  let started = false;

  function feed(chunk: string) {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      buffer += ch;

      if (!started) {
        if (ch === "{") {
          started = true;
          depth = 1;
        } else {
          buffer = "";
        }
        continue;
      }

      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === "\\") {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === "{") depth++;
      if (ch === "}") depth--;

      if (started && depth === 0) {
        const json = buffer.trim();
        buffer = "";
        started = false;
        inString = false;
        escape = false;
        depth = 0;
        if (!json) continue;
        try {
          onObject(JSON.parse(json));
        } catch {
          // ignore malformed
        }
      }
    }
  }

  return { feed };
}

type ServiceState = {
  running: boolean;
  lastEventAt: string | null;
  lastError: string | null;
};

class MeshCentralAutoSyncService {
  private bus = new EventEmitter();
  private child: ChildProcessWithoutNullStreams | null = null;
  private state: ServiceState = { running: false, lastEventAt: null, lastError: null };
  private starting = false;
  private departmentId: string | null = null;

  constructor(private opts: { env: Env; supabaseAdmin: SupabaseClient }) {}

  getStatus() {
    return { ...this.state };
  }

  onEvent(listener: (e: MeshCentralEvent) => void) {
    this.bus.on("event", listener);
    return () => this.bus.off("event", listener);
  }

  onAssetUpserted(listener: (e: AssetUpsertEvent) => void) {
    this.bus.on("asset_upserted", listener);
    return () => this.bus.off("asset_upserted", listener);
  }

  private setState(next: Partial<ServiceState>) {
    this.state = { ...this.state, ...next };
    this.bus.emit("status", this.state);
  }

  async start() {
    if (this.state.running || this.starting) return;
    this.starting = true;
    try {
      const env = this.opts.env;
      if (!env.MESHCENTRAL_URL || !env.MESHCENTRAL_USER || !env.MESHCENTRAL_PASS) {
        this.setState({ running: false, lastError: "meshcentral_env_missing" });
        return;
      }

      if (!this.departmentId) {
        this.departmentId = await resolveDepartmentIdByName(this.opts.supabaseAdmin, env.MESHCENTRAL_DEFAULT_DEPARTMENT_NAME);
      }
      if (!this.departmentId) throw new Error("department_not_found");

      const meshEnv = loadMeshCtrlEnv();
      const filter = "nodeconnect,changenode";
      const child = spawnMeshCtrlShowEvents(meshEnv, filter);
      this.child = child;
      this.setState({ running: true, lastError: null });

      const parser = createJsonBlockParser((obj) => void this.handleRawEvent(obj));
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (d) => parser.feed(d));
      child.stderr.on("data", (d) => {
        const msg = String(d).trim();
        if (msg) this.setState({ lastError: msg });
      });
      child.on("close", () => {
        this.child = null;
        this.setState({ running: false });
        setTimeout(() => void this.start(), 2000);
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "meshcentral_autosync_start_failed";
      this.setState({ running: false, lastError: msg });
    } finally {
      this.starting = false;
    }
  }

  private async handleRawEvent(obj: unknown) {
    const action = extractEventAction(obj);
    const nodeId = extractNodeId(obj);
    const receivedAt = new Date().toISOString();

    if (action) {
      this.setState({ lastEventAt: receivedAt });
      this.bus.emit("event", { action, nodeId, raw: obj, receivedAt });
    }

    if (action === "nodeconnect" && nodeId && this.departmentId) {
      try {
        const groupName = this.opts.env.MESHCENTRAL_DEVICEGROUP_NAME;
        let nodes: MeshDeviceNode[] = [];
        try {
          nodes = await listDevices({ groupName, filterIds: [nodeId] });
        } catch {
          nodes = await listDevices({ filterIds: [nodeId] });
        }
        const node = nodes[0] ?? ({ _id: `node/${nodeId}`, name: nodeId } as MeshDeviceNode);
        const normalized = normalizeNodeId(node._id);

        const { command, powershell, platform } = scanCommandFor(node);
        const raw = await runCommand(normalized, command, { powershell, reply: true, timeoutMs: 90_000 });
        const scan = parseKeyValueOutput(raw);
        const assetId = await upsertAssetFromScan({
          supabaseAdmin: this.opts.supabaseAdmin,
          departmentId: this.departmentId,
          node,
          nodeId: normalized,
          scan,
          platform,
        });

        const targetUserId = parseUserIdFromDeviceGroupName(node.groupname ?? null);
        if (assetId && targetUserId) {
          await ensureAssetAssignmentForUser(this.opts.supabaseAdmin, { assetId, userId: targetUserId });
        }

        const serial = scan.serial_number?.trim() ?? "";
        if (serial) this.bus.emit("asset_upserted", { nodeId: normalized, serialNumber: serial, assetId, receivedAt: new Date().toISOString() });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "meshcentral_autosync_failed";
        this.setState({ lastError: msg });
      }
    }
  }
}

let singleton: MeshCentralAutoSyncService | null = null;

function getService(opts: { env: Env; supabaseAdmin: SupabaseClient }) {
  if (!singleton) singleton = new MeshCentralAutoSyncService(opts);
  return singleton;
}

const InviteBodySchema = z.object({
  hours: z.coerce.number().int().min(0).max(24 * 30).default(24),
  flags: z.coerce.number().int().min(0).max(2).default(0),
});

const SelfInviteBodySchema = z.object({
  hours: z.coerce.number().int().min(1).max(24 * 7).default(24),
});

const TechOnboardingSchema = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  full_name: z.string().trim().min(2).max(120),
  role: z.enum(["agent", "supervisor"]).default("agent"),
  mesh_username: z.string().trim().min(2).max(120).optional(),
});

function tempPassword() {
  return crypto.randomBytes(18).toString("base64url");
}

async function ensureDepartmentMatches(req: AuthedRequest, expectedName: string) {
  if (req.auth.role === "admin") return true;
  if (!req.auth.departmentId) return false;
  const { data, error } = await req.supabase.from("departments").select("name").eq("id", req.auth.departmentId).maybeSingle();
  if (error || !data?.name) return false;
  return String(data.name).toLowerCase() === expectedName.toLowerCase();
}

export function registerMeshCentralOnboarding(app: express.Express, opts: { env: Env; supabaseAdmin: SupabaseClient | null }) {
  if (!opts.supabaseAdmin) return;

  const service = getService({ env: opts.env, supabaseAdmin: opts.supabaseAdmin });
  void service.start();

  // User self-enrollment: generate a per-user invite link so we can auto-assign the discovered asset to them.
  app.post("/api/meshcentral/invite/self", requireAuth, async (req, res) => {
    try {
      const authed = req as AuthedRequest;
      const parsed = SelfInviteBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
      if (!opts.env.MESHCENTRAL_URL || !opts.env.MESHCENTRAL_USER || !opts.env.MESHCENTRAL_PASS) return res.status(500).json({ error: "meshcentral_not_configured" });

      const groupName = `usr-${authed.auth.userId}`;
      const hours = parsed.data.hours;
      const flags = 0;

      await ensureDeviceGroupExists(groupName);

      const { stdout, exitCode, stderr } = await runMeshCtrl("generateinvitelink", ["--group", groupName, "--hours", String(hours), "--flags", String(flags)]);
      if (exitCode !== 0) return res.status(502).json({ error: "meshcentral_error", details: stderr.trim() || stdout.trim() });

      const url = stdout
        .split(/\r?\n/g)
        .map((l) => l.trim())
        .find((l) => /^https?:\/\//i.test(l));
      if (!url) return res.status(502).json({ error: "meshcentral_invalid_response" });

      res.setHeader("Cache-Control", "no-store");
      return res.json({ url, groupName, hours, flags });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "bad_request";
      res.status(400).json({ error: message });
    }
  });

  app.get("/api/meshcentral/status", requireAuth, requireRole(["agent", "supervisor", "admin"]), async (req, res) => {
    const authed = req as AuthedRequest;
    const ok = await ensureDepartmentMatches(authed, opts.env.MESHCENTRAL_DEFAULT_DEPARTMENT_NAME);
    if (!ok) return res.status(403).json({ error: "forbidden" });
    res.setHeader("Cache-Control", "no-store");
    return res.json({ ...service.getStatus() });
  });

  app.post("/api/meshcentral/invite", requireAuth, requireRole(["agent", "supervisor", "admin"]), async (req, res) => {
    try {
      const authed = req as AuthedRequest;
      const ok = await ensureDepartmentMatches(authed, opts.env.MESHCENTRAL_DEFAULT_DEPARTMENT_NAME);
      if (!ok) return res.status(403).json({ error: "forbidden" });

      const parsed = InviteBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
      if (!opts.env.MESHCENTRAL_URL || !opts.env.MESHCENTRAL_USER || !opts.env.MESHCENTRAL_PASS) return res.status(500).json({ error: "meshcentral_not_configured" });

      const groupName = opts.env.MESHCENTRAL_DEVICEGROUP_NAME;
      const { hours, flags } = parsed.data;

      await ensureDeviceGroupExists(groupName);

      const { stdout, exitCode, stderr } = await runMeshCtrl("generateinvitelink", ["--group", groupName, "--hours", String(hours), "--flags", String(flags)]);
      if (exitCode !== 0) return res.status(502).json({ error: "meshcentral_error", details: stderr.trim() || stdout.trim() });

      const url = stdout
        .split(/\r?\n/g)
        .map((l) => l.trim())
        .find((l) => /^https?:\/\//i.test(l));
      if (!url) return res.status(502).json({ error: "meshcentral_invalid_response" });

      res.setHeader("Cache-Control", "no-store");
      return res.json({ url, groupName, hours, flags });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "bad_request";
      res.status(400).json({ error: message });
    }
  });

  app.post("/api/onboarding/tech", requireAuth, requireRole(["admin"]), async (req, res) => {
    try {
      const parsed = TechOnboardingSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
      if (!opts.env.MESHCENTRAL_URL || !opts.env.MESHCENTRAL_USER || !opts.env.MESHCENTRAL_PASS) return res.status(500).json({ error: "meshcentral_not_configured" });

      const { email, full_name, role, mesh_username } = parsed.data;
      const username = mesh_username?.trim() || email.split("@")[0]!;

      const deptId = await resolveDepartmentIdByName(opts.supabaseAdmin!, opts.env.MESHCENTRAL_DEFAULT_DEPARTMENT_NAME);
      if (!deptId) return res.status(500).json({ error: "department_not_found" });

      const created = await opts.supabaseAdmin!.auth.admin.inviteUserByEmail(email, { data: { full_name } });
      if (created.error) return res.status(502).json({ error: created.error.message });
      const userId = created.data.user?.id ?? null;
      if (!userId) return res.status(502).json({ error: "could_not_create_user" });

      const { error: profErr } = await opts.supabaseAdmin!
        .from("profiles")
        .upsert({ id: userId, email, full_name, role, department_id: deptId }, { onConflict: "id" });
      if (profErr) return res.status(502).json({ error: profErr.message });

      const password = tempPassword();
      const groupName = opts.env.MESHCENTRAL_DEVICEGROUP_NAME;

      await ensureDeviceGroupExists(groupName);

      const addUser = await runMeshCtrl("adduser", ["--user", username, "--pass", password, "--email", email, "--realname", full_name, "--resetpass"]);
      if (addUser.exitCode !== 0) return res.status(502).json({ error: "meshcentral_adduser_failed", details: addUser.stderr.trim() || addUser.stdout.trim() });

      const addToGroup = await runMeshCtrl("addusertodevicegroup", ["--group", groupName, "--userid", username, "--fullrights"]);
      if (addToGroup.exitCode !== 0)
        return res.status(502).json({ error: "meshcentral_group_rights_failed", details: addToGroup.stderr.trim() || addToGroup.stdout.trim() });

      res.setHeader("Cache-Control", "no-store");
      return res.json({
        itsm: { userId, email, full_name, role, department_id: deptId },
        meshcentral: { username, tempPassword: password, groupName },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "bad_request";
      res.status(400).json({ error: message });
    }
  });
}
