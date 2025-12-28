import "../dotenv";

import { z } from "zod";
import { createSupabaseAdmin } from "../supabase";
import { listDevices, normalizeNodeId, runCommand, type MeshDeviceNode } from "../meshctrl";

const EnvSchema = z.object({
  MESHCENTRAL_DEVICEGROUP_NAME: z.string().trim().min(1).optional(),
  MESHCENTRAL_DEFAULT_DEPARTMENT_NAME: z.string().trim().min(1).default("TI"),
  MESHCENTRAL_SYNC_INTERVAL_MS: z.coerce.number().int().min(10_000).max(86_400_000).default(300_000),
  MESHCENTRAL_ONLY_ONLINE: z.coerce.boolean().default(true),
});

type Env = z.infer<typeof EnvSchema>;

type ScanResult = {
  hostname?: string;
  serial_number?: string;
  manufacturer?: string;
  model?: string;
  os?: string;
};

type ScannedNode = {
  nodeId: string;
  node: MeshDeviceNode;
  scan: ScanResult;
  raw: string;
  serial_number: string | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function inferPlatform(node: MeshDeviceNode) {
  const s = `${node.osdesc ?? ""} ${node.platform ?? ""} ${node.os ?? ""}`.toLowerCase();
  if (s.includes("windows")) return "windows" as const;
  if (s.includes("mac") || s.includes("os x") || s.includes("darwin")) return "mac" as const;
  if (s.includes("linux")) return "linux" as const;
  return "unknown" as const;
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
    return { command: ps, powershell: true };
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
    return { command: sh, powershell: false };
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
  return { command: sh, powershell: false };
}

async function resolveDepartmentIdByName(supabase: ReturnType<typeof createSupabaseAdmin>, name: string) {
  const { data, error } = await supabase.from("departments").select("id,name,created_at").order("created_at", { ascending: true }).limit(50);
  if (error) throw error;
  const list = (data ?? []) as Array<{ id: string; name: string }>;
  const exact = list.find((d) => d.name.toLowerCase() === name.toLowerCase());
  return exact?.id ?? list[0]?.id ?? null;
}

type ExistingAsset = { id: string; serial_number: string | null; mesh_node_id: string | null; metadata: unknown };

async function loadExistingMetadataBySerial(supabase: ReturnType<typeof createSupabaseAdmin>, departmentId: string, serials: string[]) {
  const map = new Map<string, ExistingAsset>();
  for (const batch of chunk(serials, 200)) {
    const { data, error } = await supabase
      .from("assets")
      .select("id,serial_number,mesh_node_id,metadata")
      .eq("department_id", departmentId)
      .in("serial_number", batch);
    if (error) throw error;
    for (const a of (data ?? []) as ExistingAsset[]) {
      if (a.serial_number) map.set(a.serial_number, a);
    }
  }
  return map;
}

async function loadExistingMetadataByMeshNodeId(supabase: ReturnType<typeof createSupabaseAdmin>, departmentId: string, nodeIds: string[]) {
  const map = new Map<string, ExistingAsset>();
  for (const batch of chunk(nodeIds, 200)) {
    const { data, error } = await supabase
      .from("assets")
      .select("id,serial_number,mesh_node_id,metadata")
      .eq("department_id", departmentId)
      .in("mesh_node_id", batch);
    if (error) throw error;
    for (const a of (data ?? []) as ExistingAsset[]) {
      if (a.mesh_node_id) map.set(a.mesh_node_id, a);
    }
  }
  return map;
}

function mergeMetadata(existing: unknown, nextMeshcentral: Record<string, unknown>) {
  const base = isRecord(existing) ? { ...existing } : {};
  const prevMesh = isRecord(base.meshcentral) ? { ...(base.meshcentral as Record<string, unknown>) } : {};
  return { ...base, meshcentral: { ...prevMesh, ...nextMeshcentral } };
}

async function tick(supabase: ReturnType<typeof createSupabaseAdmin>, env: Env) {
  const departmentId = await resolveDepartmentIdByName(supabase, env.MESHCENTRAL_DEFAULT_DEPARTMENT_NAME);
  if (!departmentId) throw new Error("department_not_found");

  const nodes = await listDevices({ groupName: env.MESHCENTRAL_DEVICEGROUP_NAME });
  const candidates = env.MESHCENTRAL_ONLY_ONLINE ? nodes.filter((n) => (n.conn ?? 0) !== 0) : nodes;

  const now = new Date().toISOString();

  const scanned: ScannedNode[] = [];

  for (const n of candidates) {
    const nodeId = normalizeNodeId(n._id);
    const { command, powershell } = scanCommandFor(n);
    try {
      const raw = await runCommand(nodeId, command, { powershell, reply: true, timeoutMs: 90_000 });
      const scan = parseKeyValueOutput(raw);
      const serial = scan.serial_number?.trim() ? scan.serial_number.trim() : null;
      scanned.push({ nodeId, node: n, scan, raw, serial_number: serial });
    } catch (e) {
      console.error(`[meshcentral-sync] scan failed node=${nodeId}`, e);
    }
  }

  const withSerial = scanned.filter((s) => typeof s.serial_number === "string" && s.serial_number.length > 0) as Array<ScannedNode & { serial_number: string }>;
  const withoutSerial = scanned.filter((s) => !s.serial_number) as Array<ScannedNode & { serial_number: null }>;

  const existingBySerial = withSerial.length ? await loadExistingMetadataBySerial(supabase, departmentId, withSerial.map((s) => s.serial_number)) : new Map();
  const existingByNode = withoutSerial.length ? await loadExistingMetadataByMeshNodeId(supabase, departmentId, withoutSerial.map((s) => s.nodeId)) : new Map();

  const rows = scanned.map((s) => {
    const scan = s.scan;
    const name = (scan.hostname?.trim() || s.node.name || s.nodeId).toString();
    const platform = inferPlatform(s.node);

    const meshcentralMeta = {
      node_id: s.nodeId,
      node_db_id: s.node._id,
      group_id: s.node.meshid ?? null,
      group_name: s.node.groupname ?? null,
      osdesc: s.node.osdesc ?? null,
      ip: typeof s.node.ip === "string" ? s.node.ip : null,
      last_sync_at: now,
      last_scan: scan,
    };

    const existing = s.serial_number ? existingBySerial.get(s.serial_number) : undefined;
    const fallback = existingByNode.get(s.nodeId);
    const merged = mergeMetadata((existing ?? fallback)?.metadata, meshcentralMeta);
    const conn = typeof s.node.conn === "number" ? (s.node.conn ?? 0) : 0;
    const connectivity_status = conn !== 0 ? "Online" : "Offline";

    return {
      department_id: departmentId,
      serial_number: s.serial_number,
      mesh_node_id: s.nodeId,
      name,
      manufacturer: scan.manufacturer ?? null,
      model: scan.model ?? null,
      asset_type: platform === "windows" ? "Windows" : platform === "mac" ? "Mac" : platform === "linux" ? "Linux" : null,
      connectivity_status,
      last_seen_at: now,
      last_ip: typeof s.node.ip === "string" ? s.node.ip : null,
      last_hostname: scan.hostname ?? null,
      metadata: merged,
    };
  });

  let upserted = 0;

  const rowsBySerial = rows.filter((r) => typeof r.serial_number === "string" && r.serial_number.length > 0);
  const rowsByNode = rows.filter((r) => !r.serial_number);

  for (const batch of chunk(rowsBySerial, 200)) {
    const { data, error } = await supabase.from("assets").upsert(batch, { onConflict: "department_id,serial_number" }).select("id");
    if (error) throw error;
    upserted += (data ?? []).length;
  }
  for (const batch of chunk(rowsByNode, 200)) {
    const { data, error } = await supabase.from("assets").upsert(batch, { onConflict: "department_id,mesh_node_id" }).select("id");
    if (error) throw error;
    upserted += (data ?? []).length;
  }

  const skipped = 0;
  return { departmentId, total: nodes.length, scanned: scanned.length, upserted, skippedNoSerial: skipped };
}

async function main() {
  const env = EnvSchema.parse(process.env);
  const supabase = createSupabaseAdmin();
  console.log(
    `[meshcentral-sync] starting group=${env.MESHCENTRAL_DEVICEGROUP_NAME ?? "(all)"} dept=${env.MESHCENTRAL_DEFAULT_DEPARTMENT_NAME} interval=${env.MESHCENTRAL_SYNC_INTERVAL_MS}ms`
  );

  while (true) {
    try {
      const r = await tick(supabase, env);
      console.log(
        `[meshcentral-sync] tick ok dept=${r.departmentId} total=${r.total} scanned=${r.scanned} upserted=${r.upserted} skipped_no_serial=${r.skippedNoSerial}`
      );
    } catch (e) {
      console.error("[meshcentral-sync] tick error", e);
    }
    await new Promise((r) => setTimeout(r, env.MESHCENTRAL_SYNC_INTERVAL_MS));
  }
}

void main();
