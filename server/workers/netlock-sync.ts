import "../dotenv";
import { createSupabaseAdmin } from "../supabase";
import { z } from "zod";

type NetlockHistoryRow = { device_id: number; date: Date | string | null; json: string | null };
type NetlockGeneralHistoryRow = {
  device_id: number;
  date: Date | string | null;
  policy_name: string | null;
  ip_address_internal: string | null;
  ip_address_external: string | null;
  network_adapters: string | null;
  json: string | null;
};
type NetlockEventRow = {
  id: number;
  device_id: number | null;
  device_name: string | null;
  date: Date | string | null;
  severity: number | null;
  type: number | null;
  reported_by: string | null;
  description: string | null;
  _event: string | null;
};

type NetlockDevice = {
  id: number;
  access_key: string | null;
  device_name: string | null;
  platform: "Windows" | "Linux" | "MacOS" | string | null;
  agent_version: string | null;
  authorized: number | null;
  last_access: Date | string | null;
  ip_address_internal: string | null;
  ip_address_external: string | null;
  operating_system: string | null;
  architecture: string | null;
  cpu: string | null;
  ram: string | null;
  disks: string | null;
  network_adapters: string | null;
  antivirus_products: string | null;
  firewall_status: string | null;
  update_pending: number | null;
  last_active_user: string | null;
  tenant_id: number | null;
  tenant_name: string | null;
  location_id: number | null;
  location_name: string | null;
  group_id: number | null;
  group_name: string | null;
};

type AssetRow = {
  id: string;
  department_id: string;
  name: string;
  mesh_node_id: string | null;
  last_seen_at: string | null;
  connectivity_status: "Online" | "Offline" | "Durmiente" | "Desconocido" | "Crítico";
  serial_number: string | null;
  asset_type: string | null;
  category: string | null;
  subcategory: string | null;
  manufacturer: string | null;
  model: string | null;
  metadata: unknown;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function safeJsonParse(value: string | null) {
  if (!value) return null;
  const s = value.trim();
  if (!s) return null;
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return s;
  }
}

function parseDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

function statusForLastSeen(lastSeenAt: Date | null) {
  if (!lastSeenAt) return "Desconocido" as const;
  const ageMs = Date.now() - lastSeenAt.getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return "Desconocido" as const;
  const minutes = ageMs / 60000;
  if (minutes <= 5) return "Online" as const;
  if (minutes <= 240) return "Offline" as const;
  return "Crítico" as const;
}

function mergeMetadata(existing: unknown, patch: Record<string, unknown>) {
  const base = isRecord(existing) ? { ...existing } : {};
  const nextNetlock = { ...(isRecord(base.netlock) ? (base.netlock as Record<string, unknown>) : {}), ...patch };
  return { ...base, netlock: nextNetlock };
}

function pickString(obj: unknown, key: string) {
  if (!isRecord(obj)) return null;
  const v = obj[key];
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

function looksLikeHardwareId(value: string | null) {
  if (!value) return false;
  const v = value.trim();
  if (!v) return false;
  if (v.toLowerCase() === "n/a") return false;
  return /^[0-9a-f]{8,}$/i.test(v);
}

const EnvSchema = z.object({
  NETLOCK_MYSQL_URL: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const s = value.trim();
    return s.length ? s : undefined;
  }, z.string().trim().min(1).optional()),
  NETLOCK_SYNC_INTERVAL_MS: z.coerce.number().int().min(10_000).max(24 * 60 * 60 * 1000).default(5 * 60_000),
  NETLOCK_SYNC_DEVICE_LIMIT: z.coerce.number().int().min(1).max(50_000).default(10_000),
  NETLOCK_SYNC_ENABLED: z.preprocess((v) => {
    if (typeof v === "string") return !["0", "false", "off", "no"].includes(v.trim().toLowerCase());
    if (typeof v === "number") return v !== 0;
    if (typeof v === "boolean") return v;
    return v;
  }, z.boolean()).default(true),
});

async function createMysqlPool(mysqlUrl: string) {
  const mysql2 = await import("mysql2/promise");
  return mysql2.createPool({
    uri: mysqlUrl,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
  });
}

function placeholders(count: number) {
  return Array.from({ length: count }, () => "?").join(",");
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function runWithConcurrency(tasks: Array<() => Promise<void>>, concurrency: number) {
  const pending = tasks.slice();
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (pending.length) {
      const next = pending.shift();
      if (!next) return;
      await next();
    }
  });
  await Promise.all(workers);
}

async function fetchLatestJsonHistoryByDeviceId(
  pool: Awaited<ReturnType<typeof createMysqlPool>>,
  table: string,
  deviceIds: number[],
): Promise<Map<number, { sourceTs: Date | null; payload: unknown }>> {
  const out = new Map<number, { sourceTs: Date | null; payload: unknown }>();
  if (deviceIds.length === 0) return out;
  for (const ids of chunk(deviceIds, 500)) {
    const sql = `
      SELECT device_id, date, json
      FROM (
        SELECT device_id, date, json,
          ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY date DESC, id DESC) AS rn
        FROM ${table}
        WHERE device_id IN (${placeholders(ids.length)})
      ) t
      WHERE rn = 1
    `;
    const [rows] = await pool.query(sql, ids);
    for (const r of rows as unknown as NetlockHistoryRow[]) {
      const did = Number(r.device_id);
      out.set(did, { sourceTs: parseDate(r.date), payload: safeJsonParse(r.json) });
    }
  }
  return out;
}

async function fetchLatestGeneralHistoryByDeviceId(
  pool: Awaited<ReturnType<typeof createMysqlPool>>,
  deviceIds: number[],
): Promise<Map<number, { sourceTs: Date | null; payload: unknown }>> {
  const out = new Map<number, { sourceTs: Date | null; payload: unknown }>();
  if (deviceIds.length === 0) return out;
  for (const ids of chunk(deviceIds, 500)) {
    const sql = `
      SELECT device_id, date, policy_name, ip_address_internal, ip_address_external, network_adapters, json
      FROM (
        SELECT device_id, date, policy_name, ip_address_internal, ip_address_external, network_adapters, json,
          ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY date DESC, id DESC) AS rn
        FROM device_information_general_history
        WHERE device_id IN (${placeholders(ids.length)})
      ) t
      WHERE rn = 1
    `;
    const [rows] = await pool.query(sql, ids);
    for (const r of rows as unknown as NetlockGeneralHistoryRow[]) {
      const did = Number(r.device_id);
      out.set(did, {
        sourceTs: parseDate(r.date),
        payload: {
          policy_name: r.policy_name ?? null,
          ip_address_internal: r.ip_address_internal ?? null,
          ip_address_external: r.ip_address_external ?? null,
          network_adapters: safeJsonParse(r.network_adapters) ?? r.network_adapters ?? null,
          json: safeJsonParse(r.json),
        },
      });
    }
  }
  return out;
}

async function fetchRecentEventsByDeviceId(
  pool: Awaited<ReturnType<typeof createMysqlPool>>,
  deviceIds: number[],
  opts: { days: number; perDevice: number },
): Promise<Map<number, { latestTs: Date | null; events: unknown[] }>> {
  const out = new Map<number, { latestTs: Date | null; events: unknown[] }>();
  if (deviceIds.length === 0) return out;
  for (const ids of chunk(deviceIds, 300)) {
    const sql = `
      SELECT id, device_id, device_name, date, severity, type, reported_by, description, _event
      FROM (
        SELECT id, device_id, device_name, date, severity, type, reported_by, description, _event,
          ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY date DESC, id DESC) AS rn
        FROM events
        WHERE device_id IN (${placeholders(ids.length)})
          AND date >= DATE_SUB(NOW(), INTERVAL ${Math.max(1, Math.min(365, opts.days))} DAY)
      ) t
      WHERE rn <= ${Math.max(1, Math.min(200, opts.perDevice))}
      ORDER BY device_id, date DESC, id DESC
    `;
    const [rows] = await pool.query(sql, ids);
    const list = rows as unknown as NetlockEventRow[];
    for (const r of list) {
      const did = Number(r.device_id ?? 0);
      if (!did) continue;
      const arr = out.get(did)?.events ?? [];
      arr.push({
        id: r.id,
        device_id: r.device_id,
        device_name: r.device_name ?? null,
        date: parseDate(r.date)?.toISOString() ?? null,
        severity: r.severity ?? null,
        type: r.type ?? null,
        reported_by: r.reported_by ?? null,
        description: r.description ?? null,
        event: safeJsonParse(r._event) ?? r._event ?? null,
      });
      const latest = out.get(did)?.latestTs ?? null;
      const ts = parseDate(r.date);
      const nextLatest = ts && (!latest || ts > latest) ? ts : latest;
      out.set(did, { events: arr, latestTs: nextLatest });
    }
  }
  return out;
}

async function tick(opts: {
  supabase: ReturnType<typeof createSupabaseAdmin>;
  pool: Awaited<ReturnType<typeof createMysqlPool>>;
  deviceLimit: number;
}) {
  try {
    const [rows] = await opts.pool.query(
      `SELECT
        id, access_key, device_name, platform, agent_version, authorized, last_access,
        ip_address_internal, ip_address_external, operating_system, architecture,
        cpu, ram, disks, network_adapters, antivirus_products, firewall_status, update_pending, last_active_user,
        tenant_id, tenant_name, location_id, location_name, group_id, group_name
      FROM devices
      ORDER BY id DESC
      LIMIT ?`,
      [opts.deviceLimit],
    );
    const devices = (rows as unknown as NetlockDevice[]).filter((d) => !!d.access_key);
    const accessKeys = Array.from(new Set(devices.map((d) => String(d.access_key))));
    if (accessKeys.length === 0) return { devices: 0, matched: 0, updatedAssets: 0, snapshots: 0 };

    const deviceIds = devices.map((d) => d.id).filter((id) => Number.isFinite(id));
    const [generalById, cpuById, ramById, disksById, netAdaptersById, appsById, eventsById] = await Promise.all([
      fetchLatestGeneralHistoryByDeviceId(opts.pool, deviceIds),
      fetchLatestJsonHistoryByDeviceId(opts.pool, "device_information_cpu_history", deviceIds),
      fetchLatestJsonHistoryByDeviceId(opts.pool, "device_information_ram_history", deviceIds),
      fetchLatestJsonHistoryByDeviceId(opts.pool, "device_information_disks_history", deviceIds),
      fetchLatestJsonHistoryByDeviceId(opts.pool, "device_information_network_adapters_history", deviceIds),
      fetchLatestJsonHistoryByDeviceId(opts.pool, "applications_installed_history", deviceIds),
      fetchRecentEventsByDeviceId(opts.pool, deviceIds, { days: 14, perDevice: 25 }),
    ]);

    const assetsByKey = new Map<string, AssetRow>();
    for (const keys of chunk(accessKeys, 200)) {
      const { data, error } = await opts.supabase
        .from("assets")
        .select("id,department_id,name,mesh_node_id,last_seen_at,connectivity_status,serial_number,asset_type,category,subcategory,manufacturer,model,metadata")
        .in("mesh_node_id", keys)
        .limit(5000);
      if (error) throw error;
      for (const row of (data ?? []) as unknown as AssetRow[]) {
        if (row.mesh_node_id) assetsByKey.set(row.mesh_node_id, row);
      }
    }

    let updatedAssets = 0;
    let snapshots = 0;
    const tasks: Array<() => Promise<void>> = [];

    async function upsertOrResolveAlert(opts2: {
      assetId: string;
      kind: string;
      shouldOpen: boolean;
      severity: "info" | "warning" | "critical";
      title: string;
      message: string;
      meta: Record<string, unknown>;
    }) {
      const { data: existing, error: selErr } = await opts.supabase
        .from("asset_alerts")
        .select("id,status")
        .eq("asset_id", opts2.assetId)
        .eq("kind", opts2.kind)
        .eq("status", "open")
        .limit(1)
        .maybeSingle();
      if (selErr) throw selErr;

      const existingId = (existing as { id: string } | null)?.id ?? null;
      const nowIso = new Date().toISOString();

      if (opts2.shouldOpen) {
        if (existingId) {
          const { error: updErr } = await opts.supabase
            .from("asset_alerts")
            .update({ severity: opts2.severity, title: opts2.title, message: opts2.message, meta: opts2.meta, updated_at: nowIso })
            .eq("id", existingId);
          if (updErr) throw updErr;
          return;
        }
        const { error: insErr } = await opts.supabase.from("asset_alerts").insert({
          asset_id: opts2.assetId,
          kind: opts2.kind,
          severity: opts2.severity,
          status: "open",
          title: opts2.title,
          message: opts2.message,
          opened_at: nowIso,
          meta: opts2.meta,
        });
        if (insErr) throw insErr;
        return;
      }

      if (existingId) {
        const { error: resErr } = await opts.supabase
          .from("asset_alerts")
          .update({ status: "resolved", resolved_at: nowIso, updated_at: nowIso })
          .eq("id", existingId);
        if (resErr) throw resErr;
      }
    }

    for (const d of devices) {
      const accessKey = String(d.access_key);
      const asset = assetsByKey.get(accessKey);
      if (!asset) continue;

      const general = generalById.get(d.id) ?? null;
      const cpu = cpuById.get(d.id) ?? null;
      const ram = ramById.get(d.id) ?? null;
      const disks = disksById.get(d.id) ?? null;
      const netAdapters = netAdaptersById.get(d.id) ?? null;
      const apps = appsById.get(d.id) ?? null;
      const recentEvents = eventsById.get(d.id) ?? null;

      const lastAccess = parseDate(d.last_access);
      const lastSeenAtIso = lastAccess ? lastAccess.toISOString() : null;
      const nextStatus = statusForLastSeen(lastAccess);
      const generalJson = isRecord(general?.payload) ? (general?.payload as Record<string, unknown>).json : null;
      const hwid = pickString(generalJson, "hwid");
      const timezone = pickString(generalJson, "timezone");
      const lastBoot = pickString(generalJson, "last_boot");
      const osFromGeneral = pickString(generalJson, "operating_system");

      const metadata = mergeMetadata(asset.metadata, {
        provider: "netlock",
        device_id: d.id,
        access_key: accessKey,
        device_name: d.device_name ?? null,
        platform: d.platform ?? null,
        agent_version: d.agent_version ?? null,
        authorized: d.authorized ?? null,
        last_access: lastSeenAtIso,
        ip_internal: d.ip_address_internal ?? null,
        ip_external: d.ip_address_external ?? null,
        operating_system: d.operating_system ?? null,
        architecture: d.architecture ?? null,
        last_active_user: d.last_active_user ?? null,
        update_pending: d.update_pending ?? null,
        antivirus: safeJsonParse(d.antivirus_products) ?? d.antivirus_products ?? null,
        firewall_status: d.firewall_status ?? null,
        tenant: d.tenant_name ?? null,
        location: d.location_name ?? null,
        group: d.group_name ?? null,
        hwid: looksLikeHardwareId(hwid) ? hwid : null,
        timezone: timezone ?? null,
        last_boot: lastBoot ?? null,
        operating_system_general: osFromGeneral ?? null,
        synced_at: new Date().toISOString(),
      });

      const patch = {
        last_seen_at: lastSeenAtIso,
        last_ip: d.ip_address_internal ?? d.ip_address_external ?? null,
        last_hostname: d.device_name ?? null,
        // Let assets-monitor refine status; but set a best-effort status too.
        connectivity_status: nextStatus,
        metadata,
        // Best-effort auto-fill (only if empty)
        serial_number: asset.serial_number?.trim() ? undefined : looksLikeHardwareId(hwid) ? hwid : undefined,
        manufacturer: asset.manufacturer?.trim() ? undefined : d.platform === "MacOS" ? "Apple" : undefined,
        model:
          asset.model?.trim()
            ? undefined
            : (() => {
                const name = (d.device_name ?? "").toLowerCase();
                if (name.includes("macbook") && name.includes("pro")) return "MacBook Pro";
                if (name.includes("macbook") && name.includes("air")) return "MacBook Air";
                if (name.includes("macbook")) return "MacBook";
                if (name.includes("imac")) return "iMac";
                if (name.includes("mac mini") || name.includes("macmini")) return "Mac mini";
                return d.platform === "MacOS" ? "Mac" : null;
              })(),
        asset_type: asset.asset_type?.trim() ? undefined : "Equipo",
        category: asset.category?.trim() ? undefined : "Computador",
        subcategory:
          asset.subcategory?.trim()
            ? undefined
            : (() => {
                const name = (d.device_name ?? "").toLowerCase();
                if (name.includes("macbook") || name.includes("book")) return "Notebook";
                if (name.includes("server")) return "Servidor";
                return "Desktop";
              })(),
        updated_at: new Date().toISOString(),
      };

      const doUpdate = async () => {
        const cleaned = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
        const { error: updErr } = await opts.supabase.from("assets").update(cleaned).eq("id", asset.id);
        if (updErr) throw updErr;
        updatedAssets += 1;

        const deviceSnapshotPayload = {
          id: d.id,
          access_key: accessKey,
          device_name: d.device_name,
          platform: d.platform,
          agent_version: d.agent_version,
          authorized: d.authorized,
          last_access: lastSeenAtIso,
          ip_address_internal: d.ip_address_internal,
          ip_address_external: d.ip_address_external,
          operating_system: d.operating_system,
          architecture: d.architecture,
          tenant: { id: d.tenant_id, name: d.tenant_name },
          location: { id: d.location_id, name: d.location_name },
          group: { id: d.group_id, name: d.group_name },
        };

        const { error: snapErr } = await opts.supabase.from("rmm_snapshots").upsert(
          {
            provider: "netlock",
            kind: "device",
            asset_id: asset.id,
            device_key: accessKey,
            source_ts: lastSeenAtIso,
            payload: deviceSnapshotPayload,
          },
          { onConflict: "provider,kind,asset_id" },
        );

        if (!snapErr) {
          snapshots += 1;
        } else if (!String(snapErr.message ?? "").includes("relation") && !String(snapErr.message ?? "").includes("rmm_snapshots")) {
          throw snapErr;
        }

        const hardwarePayload = {
          device_id: d.id,
          access_key: accessKey,
          device_fields: {
            cpu: safeJsonParse(d.cpu) ?? d.cpu ?? null,
            ram: safeJsonParse(d.ram) ?? d.ram ?? null,
            disks: safeJsonParse(d.disks) ?? d.disks ?? null,
            network_adapters: safeJsonParse(d.network_adapters) ?? d.network_adapters ?? null,
            antivirus_products: safeJsonParse(d.antivirus_products) ?? d.antivirus_products ?? null,
            firewall_status: d.firewall_status ?? null,
            update_pending: d.update_pending ?? null,
            last_active_user: d.last_active_user ?? null,
          },
          general: general?.payload ?? null,
          cpu: cpu?.payload ?? null,
          ram: ram?.payload ?? null,
          disks: disks?.payload ?? null,
          network_adapters: netAdapters?.payload ?? null,
        };
        const hardwareTs = [general?.sourceTs, cpu?.sourceTs, ram?.sourceTs, disks?.sourceTs, netAdapters?.sourceTs].filter(
          (x): x is Date => !!x,
        );
        const hardwareSource = hardwareTs.length ? new Date(Math.max(...hardwareTs.map((x) => x.getTime()))).toISOString() : null;
        const { error: hwErr } = await opts.supabase.from("rmm_snapshots").upsert(
          {
            provider: "netlock",
            kind: "hardware",
            asset_id: asset.id,
            device_key: accessKey,
            source_ts: hardwareSource,
            payload: hardwarePayload,
          },
          { onConflict: "provider,kind,asset_id" },
        );
        if (!hwErr) snapshots += 1;

        const appsPayload = { device_id: d.id, access_key: accessKey, apps: apps?.payload ?? null };
        const { error: appsErr } = await opts.supabase.from("rmm_snapshots").upsert(
          {
            provider: "netlock",
            kind: "apps_installed",
            asset_id: asset.id,
            device_key: accessKey,
            source_ts: apps?.sourceTs?.toISOString() ?? null,
            payload: appsPayload,
          },
          { onConflict: "provider,kind,asset_id" },
        );
        if (!appsErr) snapshots += 1;

        const eventsPayload = { device_id: d.id, access_key: accessKey, events: recentEvents?.events ?? [] };
        const { error: evErr } = await opts.supabase.from("rmm_snapshots").upsert(
          {
            provider: "netlock",
            kind: "events_recent",
            asset_id: asset.id,
            device_key: accessKey,
            source_ts: recentEvents?.latestTs?.toISOString() ?? null,
            payload: eventsPayload,
          },
          { onConflict: "provider,kind,asset_id" },
        );
        if (!evErr) snapshots += 1;

        // Derive high-level alerts from recent events (best-effort; schema may evolve).
        const recent = (recentEvents?.events ?? []) as Array<Record<string, unknown>>;
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const since24h = recent.filter((e) => {
          const dt = typeof e.date === "string" ? new Date(e.date).getTime() : NaN;
          return Number.isFinite(dt) && dt >= cutoff;
        });
        const bySeverity = (min: number) =>
          since24h.filter((e) => (typeof e.severity === "number" ? e.severity : -1) >= min);

        const critical = bySeverity(3);
        const warning = bySeverity(2).filter((e) => !critical.includes(e));

        const summarize = (list: Array<Record<string, unknown>>) =>
          list
            .slice(0, 3)
            .map((e) => (typeof e.description === "string" ? e.description.trim() : ""))
            .filter(Boolean)
            .join(" | ");

        await upsertOrResolveAlert({
          assetId: asset.id,
          kind: "netlock_events_critical_24h",
          shouldOpen: critical.length > 0,
          severity: "critical",
          title: "NetLock: eventos críticos (24h)",
          message: critical.length ? `${critical.length} evento(s). ${summarize(critical)}` : "",
          meta: { source: "netlock-sync", windowHours: 24, count: critical.length },
        });

        await upsertOrResolveAlert({
          assetId: asset.id,
          kind: "netlock_events_warning_24h",
          shouldOpen: warning.length > 0,
          severity: "warning",
          title: "NetLock: eventos de advertencia (24h)",
          message: warning.length ? `${warning.length} evento(s). ${summarize(warning)}` : "",
          meta: { source: "netlock-sync", windowHours: 24, count: warning.length },
        });
      };

      tasks.push(doUpdate);
    }

    await runWithConcurrency(tasks, 10);
    return { devices: devices.length, matched: assetsByKey.size, updatedAssets, snapshots };
  } finally {
    // pool is managed by caller
  }
}

async function main() {
  const env = EnvSchema.parse(process.env);
  if (!env.NETLOCK_SYNC_ENABLED) {
    console.log("[netlock-sync] disabled (NETLOCK_SYNC_ENABLED=false)");
    return;
  }
  if (!env.NETLOCK_MYSQL_URL) {
    console.log("[netlock-sync] NETLOCK_MYSQL_URL missing; skipping");
    return;
  }

  const supabase = createSupabaseAdmin();
  const pool = await createMysqlPool(env.NETLOCK_MYSQL_URL);
  console.log(`[netlock-sync] starting (interval=${env.NETLOCK_SYNC_INTERVAL_MS}ms limit=${env.NETLOCK_SYNC_DEVICE_LIMIT})`);

  while (true) {
    try {
      const r = await tick({ supabase, pool, deviceLimit: env.NETLOCK_SYNC_DEVICE_LIMIT });
      console.log(`[netlock-sync] tick ok devices=${r.devices} matchedAssets=${r.matched} updatedAssets=${r.updatedAssets} snapshots=${r.snapshots}`);
    } catch (e) {
      console.error("[netlock-sync] tick error", e);
    }
    await new Promise((r) => setTimeout(r, env.NETLOCK_SYNC_INTERVAL_MS));
  }
}

void main();
