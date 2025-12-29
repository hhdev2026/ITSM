import "./dotenv";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import * as http from "http";
import pinoHttp from "pino-http";
import { loadEnv } from "./env";
import { requireAuth, requireRole, type AuthedRequest } from "./auth";
import { getChatKpis, getChatTrends, getKpis, getTrends, parseAnalyticsQuery, parseTrendsQuery } from "./analytics";
import { createSupabaseAdmin } from "./supabase";
import { attachRemoteTunnelWs, registerRemoteRoutes } from "./remote";
import { registerMeshCentralOnboarding } from "./meshcentralAutoSync";
import { registerNetlockRmmRoutes } from "./rmm/netlock";

const env = loadEnv();
const supabaseAdmin = env.SUPABASE_SERVICE_ROLE_KEY ? createSupabaseAdmin() : null;

const app = express();
app.use(helmet());
const corsOrigins = env.CORS_ORIGIN.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors({ origin: corsOrigins.length ? corsOrigins : env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(pinoHttp());

app.get("/api/health", (_req, res) => res.json({ ok: true }));

registerRemoteRoutes(app, { env, supabaseAdmin });
registerMeshCentralOnboarding(app, { env, supabaseAdmin });
registerNetlockRmmRoutes(app, { env, supabaseAdmin });

function hasAssetsSecret(req: express.Request) {
  const header = req.header("x-assets-secret") ?? "";
  return !!env.ASSETS_WEBHOOK_SECRET && header.length > 0 && header === env.ASSETS_WEBHOOK_SECRET;
}

function requireAuthOrAssetsSecret(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (hasAssetsSecret(req)) return next();
  return requireAuth(req, res, next);
}

async function resolveSingleDepartmentId() {
  if (!supabaseAdmin) throw new Error("SUPABASE_SERVICE_ROLE_KEY required");
  const { data, error } = await supabaseAdmin.from("departments").select("id").order("created_at", { ascending: true }).limit(2);
  if (error) throw error;
  const list = (data ?? []) as Array<{ id: string }>;
  if (list.length === 1) return list[0].id;
  return null;
}

app.get("/api/me", requireAuth, (req, res) => {
  const authed = req as AuthedRequest;
  res.json({ userId: authed.auth.userId, role: authed.auth.role, departmentId: authed.auth.departmentId, email: authed.auth.email });
});

app.post("/api/assets/sync", requireAuthOrAssetsSecret, async (req, res) => {
  try {
    const isSecret = hasAssetsSecret(req);
    const body = (req.body ?? null) as unknown;
    const rows = Array.isArray(body)
      ? (body as unknown[])
      : body && typeof body === "object" && Array.isArray((body as { rows?: unknown }).rows)
        ? (((body as { rows: unknown }).rows ?? []) as unknown[])
        : null;
    if (!rows) return res.status(400).json({ error: "rows_required" });

    if (!isSecret) {
      const authed = req as AuthedRequest;
      if (authed.auth.role !== "supervisor" && authed.auth.role !== "admin") return res.status(403).json({ error: "forbidden" });
      const { data, error } = await authed.supabase.rpc("asset_upsert_many", { p_rows: rows });
      if (error) throw error;
      return res.json(data);
    }

    if (!supabaseAdmin) return res.status(500).json({ error: "service_role_required" });

    const deptFromBody =
      body && typeof body === "object" && typeof (body as { department_id?: unknown }).department_id === "string"
        ? String((body as { department_id: string }).department_id)
        : null;
    const deptId = deptFromBody ?? (await resolveSingleDepartmentId());
    if (!deptId) return res.status(400).json({ error: "department_required" });

    const errors: Array<{ row: number; error: string }> = [];
    const byTag: Array<Record<string, unknown>> = [];
    const bySerial: Array<Record<string, unknown>> = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r || typeof r !== "object") {
        errors.push({ row: i + 1, error: "row_must_be_object" });
        continue;
      }
      const rr = r as Record<string, unknown>;
      const name = typeof rr.name === "string" ? rr.name.trim() : "";
      if (!name) {
        errors.push({ row: i + 1, error: "name_required" });
        continue;
      }

      const payload: Record<string, unknown> = { ...rr, department_id: deptId, name };
      const assetTag = payload.asset_tag;
      const serial = typeof payload.serial_number === "string" ? payload.serial_number.trim() : "";

      if (assetTag != null && String(assetTag).trim().length > 0) byTag.push(payload);
      else if (serial) bySerial.push({ ...payload, serial_number: serial });
      else bySerial.push(payload);
    }

    if (byTag.length) {
      const { error } = await supabaseAdmin.from("assets").upsert(byTag, { onConflict: "asset_tag" });
      if (error) throw error;
    }
    if (bySerial.length) {
      const { error } = await supabaseAdmin.from("assets").upsert(bySerial, { onConflict: "department_id,serial_number" });
      if (error) throw error;
    }

    return res.json({ upserted: byTag.length + bySerial.length, errors });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "bad_request";
    res.status(400).json({ error: message });
  }
});

app.post("/api/assets/heartbeat", requireAuthOrAssetsSecret, async (req, res) => {
  try {
    const isSecret = hasAssetsSecret(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const assetTagRaw = body.asset_tag ?? null;
    const serialRaw = body.serial_number ?? null;
    const statusRaw = body.status ?? "Online";

    const occurredAt = typeof body.occurred_at === "string" ? body.occurred_at : new Date().toISOString();
    const ip = typeof body.ip === "string" ? body.ip : null;
    const mac = typeof body.mac === "string" ? body.mac : null;
    const hostname = typeof body.hostname === "string" ? body.hostname : null;
    const networkType = typeof body.network_type === "string" ? body.network_type : null;

    const status = typeof statusRaw === "string" ? statusRaw : "Online";
    if (!["Online", "Offline", "Durmiente", "Desconocido", "Crítico"].includes(status)) {
      return res.status(400).json({ error: "invalid_status" });
    }

    const findByTag = assetTagRaw != null && String(assetTagRaw).trim().length > 0;
    const findBySerial = typeof serialRaw === "string" && serialRaw.trim().length > 0;
    if (!findByTag && !findBySerial) return res.status(400).json({ error: "asset_tag_or_serial_required" });

    if (isSecret && !supabaseAdmin) return res.status(500).json({ error: "service_role_required" });

    const client = isSecret ? supabaseAdmin! : (req as AuthedRequest).supabase;
    const deptId = isSecret ? null : (req as AuthedRequest).auth.departmentId;

    let assetQuery = client.from("assets").select("id,asset_tag,department_id").limit(2);
    if (findByTag) {
      const n = Number(String(assetTagRaw).trim());
      if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: "invalid_asset_tag" });
      assetQuery = assetQuery.eq("asset_tag", Math.trunc(n));
    } else {
      assetQuery = assetQuery.eq("serial_number", String(serialRaw).trim());
    }
    if (deptId) assetQuery = assetQuery.eq("department_id", deptId);

    const { data: found, error: fErr } = await assetQuery;
    if (fErr) throw fErr;
    const list = (found ?? []) as Array<{ id: string; asset_tag: number; department_id: string }>;
    if (list.length === 0) return res.status(404).json({ error: "asset_not_found" });
    if (list.length > 1) return res.status(409).json({ error: "asset_not_unique" });
    const a = list[0];

    const { error: uErr } = await client
      .from("assets")
      .update({
        last_seen_at: occurredAt,
        connectivity_status: status,
        last_ip: ip,
        last_mac: mac,
        last_hostname: hostname,
        last_network_type: networkType,
        updated_at: new Date().toISOString(),
      })
      .eq("id", a.id);
    if (uErr) throw uErr;

    const { error: eErr } = await client.from("asset_connectivity_events").insert({
      asset_id: a.id,
      status,
      occurred_at: occurredAt,
      ip,
      mac,
      hostname,
      network_type: networkType,
      meta: {},
    });
    if (eErr) throw eErr;

    // Minimal alerting: open/resolve "offline_unexpected"
    if (status === "Offline" || status === "Crítico") {
      const { data: existing } = await client
        .from("asset_alerts")
        .select("id,status")
        .eq("asset_id", a.id)
        .eq("kind", "offline_unexpected")
        .eq("status", "open")
        .limit(1);
      if (!existing || existing.length === 0) {
        await client.from("asset_alerts").insert({
          asset_id: a.id,
          kind: "offline_unexpected",
          severity: status === "Crítico" ? "critical" : "warning",
          status: "open",
          title: "Activo sin conectividad",
          message: `Estado reportado: ${status}`,
          meta: { source: "heartbeat" },
        });
      }
    } else if (status === "Online") {
      await client
        .from("asset_alerts")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("asset_id", a.id)
        .eq("kind", "offline_unexpected")
        .eq("status", "open");
    }

    return res.json({ ok: true, asset_id: a.id, asset_tag: a.asset_tag });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "bad_request";
    res.status(400).json({ error: message });
  }
});

app.get("/api/analytics/kpis", requireAuth, requireRole(["supervisor", "admin"]), async (req, res) => {
  try {
    const q = parseAnalyticsQuery(req.query);
    const data = await getKpis(req as AuthedRequest, { period: q.period, agentId: q.agentId, categoryId: q.categoryId });
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "bad_request";
    res.status(400).json({ error: message });
  }
});

app.get("/api/analytics/chats/kpis", requireAuth, requireRole(["supervisor", "admin"]), async (req, res) => {
  try {
    const q = parseAnalyticsQuery(req.query);
    const data = await getChatKpis(req as AuthedRequest, { period: q.period, agentId: q.agentId, categoryId: q.categoryId });
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "bad_request";
    res.status(400).json({ error: message });
  }
});

app.get("/api/analytics/trends", requireAuth, requireRole(["supervisor", "admin"]), async (req, res) => {
  try {
    const q = parseTrendsQuery(req.query);
    const data = await getTrends(req as AuthedRequest, {
      period: q.period,
      bucket: q.bucket,
      agentId: q.agentId,
      categoryId: q.categoryId,
    });
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "bad_request";
    res.status(400).json({ error: message });
  }
});

app.get("/api/analytics/chats/trends", requireAuth, requireRole(["supervisor", "admin"]), async (req, res) => {
  try {
    const q = parseTrendsQuery(req.query);
    const data = await getChatTrends(req as AuthedRequest, {
      period: q.period,
      bucket: q.bucket,
      agentId: q.agentId,
      categoryId: q.categoryId,
    });
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "bad_request";
    res.status(400).json({ error: message });
  }
});

function csvEscape(value: unknown) {
  if (value == null) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function serviceIdFromMetadata(meta: unknown) {
  if (!meta || typeof meta !== "object") return null;
  const sc = (meta as { service_catalog?: unknown }).service_catalog;
  if (!sc || typeof sc !== "object") return null;
  const sid = (sc as { service_id?: unknown }).service_id;
  return typeof sid === "string" ? sid : null;
}

function getStringField(row: Record<string, unknown>, key: string) {
  const v = row[key];
  return typeof v === "string" ? v : "";
}

app.get("/api/assets/export.csv", requireAuth, requireRole(["supervisor", "admin"]), async (req, res) => {
  try {
    const authed = req as AuthedRequest;
    const deptId = authed.auth.departmentId;
    if (!deptId) return res.status(400).json({ error: "department_required" });

    const { data: assets, error } = await authed.supabase
      .from("assets")
      .select("*")
      .eq("department_id", deptId)
      .order("updated_at", { ascending: false })
      .limit(5000);
    if (error) throw error;
    const list = (assets ?? []) as Array<Record<string, unknown>>;
    const assetIds = list.map((a) => String(a.id));

    const { data: asg, error: asgErr } = assetIds.length
      ? await authed.supabase
          .from("asset_assignments")
          .select("asset_id,user_id,role,ended_at")
          .in("asset_id", assetIds)
          .is("ended_at", null)
      : { data: [] as unknown[], error: null };
    if (asgErr) throw asgErr;

    const userIds = new Set<string>();
    for (const a of (asg ?? []) as Array<Record<string, unknown>>) if (typeof a.user_id === "string") userIds.add(a.user_id);

    const { data: profs, error: pErr } = userIds.size
      ? await authed.supabase.from("profiles").select("id,email,full_name").in("id", Array.from(userIds))
      : { data: [] as unknown[], error: null };
    if (pErr) throw pErr;

    const profById = new Map<string, { email: string; full_name: string | null }>();
    for (const p of (profs ?? []) as Array<{ id: string; email: string; full_name: string | null }>) profById.set(p.id, { email: p.email, full_name: p.full_name });

    const principalByAsset = new Map<string, string>();
    const responsibleByAsset = new Map<string, string>();
    for (const a of (asg ?? []) as Array<{ asset_id: string; user_id: string; role: string }>) {
      const p = profById.get(a.user_id);
      const name = p?.full_name?.trim() || p?.email || a.user_id;
      if (a.role === "principal") principalByAsset.set(a.asset_id, name);
      if (a.role === "responsable") responsibleByAsset.set(a.asset_id, name);
    }

    const header = [
      "asset_tag",
      "name",
      "serial_number",
      "asset_type",
      "category",
      "subcategory",
      "lifecycle_status",
      "connectivity_status",
      "last_seen_at",
      "region",
      "comuna",
      "building",
      "floor",
      "room",
      "address",
      "latitude",
      "longitude",
      "failure_risk_pct",
      "usuario_asignado",
      "responsable",
      "created_at",
      "updated_at",
    ];

    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="activos-${deptId}.csv"`);
    res.write(header.map(csvEscape).join(",") + "\n");

    for (const a of list) {
      const id = String(a.id);
      const row = [
        a.asset_tag ?? "",
        getStringField(a, "name"),
        getStringField(a, "serial_number"),
        getStringField(a, "asset_type"),
        getStringField(a, "category"),
        getStringField(a, "subcategory"),
        getStringField(a, "lifecycle_status"),
        getStringField(a, "connectivity_status"),
        getStringField(a, "last_seen_at"),
        getStringField(a, "region"),
        getStringField(a, "comuna"),
        getStringField(a, "building"),
        getStringField(a, "floor"),
        getStringField(a, "room"),
        getStringField(a, "address"),
        a.latitude ?? "",
        a.longitude ?? "",
        a.failure_risk_pct ?? "",
        principalByAsset.get(id) ?? "",
        responsibleByAsset.get(id) ?? "",
        getStringField(a, "created_at"),
        getStringField(a, "updated_at"),
      ];
      res.write(row.map(csvEscape).join(",") + "\n");
    }
    res.end();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "bad_request";
    res.status(400).json({ error: message });
  }
});

app.get("/api/tickets/export.csv", requireAuth, requireRole(["supervisor", "admin"]), async (req, res) => {
  try {
    const authed = req as AuthedRequest;
    const deptId = authed.auth.departmentId;
    if (!deptId) return res.status(400).json({ error: "department_required" });

    const start = typeof req.query.start === "string" ? req.query.start : null;
    const end = typeof req.query.end === "string" ? req.query.end : null;

    let q = authed.supabase
      .from("tickets_sla_live")
      // Use `*` so exports don't break on DBs that haven't applied optional columns yet (e.g. `ticket_number`).
      .select("*")
      .eq("department_id", deptId)
      .order("created_at", { ascending: false })
      .limit(5000);

    if (start) q = q.gte("created_at", start);
    if (end) q = q.lt("created_at", end);

    const { data: rows, error } = await q;
    if (error) throw error;

    const tickets = (rows ?? []) as unknown as Array<Record<string, unknown>>;

    const requesterIds = new Set<string>();
    const assigneeIds = new Set<string>();
    const categoryIds = new Set<string>();
    const subcategoryIds = new Set<string>();
    const serviceIds = new Set<string>();

    for (const t of tickets) {
      if (typeof t.requester_id === "string") requesterIds.add(t.requester_id);
      if (typeof t.assignee_id === "string") assigneeIds.add(t.assignee_id);
      if (typeof t.category_id === "string") categoryIds.add(t.category_id);
      if (typeof t.subcategory_id === "string") subcategoryIds.add(t.subcategory_id);
      const sid = serviceIdFromMetadata(t.metadata);
      if (sid) serviceIds.add(sid);
    }

    const profileIds = Array.from(new Set([...requesterIds, ...assigneeIds]));
    const [profilesRes, catsRes, subsRes, servicesRes] = await Promise.all([
      profileIds.length
        ? authed.supabase.from("profiles").select("id,email,full_name").in("id", profileIds)
        : Promise.resolve({ data: [] as Array<{ id: string; email: string; full_name: string | null }>, error: null }),
      categoryIds.size ? authed.supabase.from("categories").select("id,name").in("id", Array.from(categoryIds)) : Promise.resolve({ data: [], error: null }),
      subcategoryIds.size
        ? authed.supabase.from("subcategories").select("id,name").in("id", Array.from(subcategoryIds))
        : Promise.resolve({ data: [], error: null }),
      serviceIds.size
        ? authed.supabase.from("service_catalog_items").select("id,name,tier1,tier2,tier3,tier4,ticket_type").in("id", Array.from(serviceIds))
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (profilesRes.error) throw profilesRes.error;
    if (catsRes.error) throw catsRes.error;
    if (subsRes.error) throw subsRes.error;
    if (servicesRes.error) throw servicesRes.error;

    const profileById = new Map<string, { email: string; full_name: string | null }>();
    for (const p of (profilesRes.data ?? []) as Array<{ id: string; email: string; full_name: string | null }>) {
      profileById.set(p.id, { email: p.email, full_name: p.full_name });
    }
    const catById = new Map<string, string>();
    for (const c of (catsRes.data ?? []) as Array<{ id: string; name: string }>) catById.set(c.id, c.name);
    const subById = new Map<string, string>();
    for (const s of (subsRes.data ?? []) as Array<{ id: string; name: string }>) subById.set(s.id, s.name);
    const serviceById = new Map<
      string,
      { name: string; ticket_type: string; tier1: string | null; tier2: string | null; tier3: string | null; tier4: string | null }
    >();
    for (const s of (servicesRes.data ?? []) as Array<{
      id: string;
      name: string;
      ticket_type: string;
      tier1: string | null;
      tier2: string | null;
      tier3: string | null;
      tier4: string | null;
    }>) {
      serviceById.set(s.id, { name: s.name, ticket_type: s.ticket_type, tier1: s.tier1, tier2: s.tier2, tier3: s.tier3, tier4: s.tier4 });
    }

    const header = [
      "id",
      "ticket_number",
      "title",
      "type",
      "status",
      "priority",
      "service_id",
      "service_name",
      "tier1",
      "tier2",
      "tier3",
      "tier4",
      "created_at",
      "updated_at",
      "first_response_at",
      "resolved_at",
      "closed_at",
      "solution_type",
      "solution_notes",
      "closure_code",
      "response_deadline",
      "sla_deadline",
      "sla_traffic_light",
      "sla_pct_used",
      "sla_remaining_minutes",
      "sla_excluded",
      "sla_exclusion_reason",
      "planned_at",
      "planned_for_at",
      "canceled_at",
      "canceled_reason",
      "requester_name",
      "requester_email",
      "assignee_name",
      "assignee_email",
      "category",
      "subcategory",
    ];

    const lines: string[] = [];
    lines.push(header.join(","));

    for (const t of tickets) {
      const requester = typeof t.requester_id === "string" ? profileById.get(t.requester_id) : null;
      const assignee = typeof t.assignee_id === "string" ? profileById.get(t.assignee_id) : null;
      const category = typeof t.category_id === "string" ? catById.get(t.category_id) : null;
      const subcategory = typeof t.subcategory_id === "string" ? subById.get(t.subcategory_id) : null;
      const serviceId = serviceIdFromMetadata(t.metadata);
      const svc = serviceId ? serviceById.get(serviceId) ?? null : null;

      const row = [
        t.id,
        (t as { ticket_number?: unknown }).ticket_number ?? "",
        t.title,
        t.type,
        t.status,
        t.priority,
        serviceId ?? "",
        svc?.name ?? "",
        svc?.tier1 ?? "",
        svc?.tier2 ?? "",
        svc?.tier3 ?? "",
        svc?.tier4 ?? "",
        t.created_at,
        t.updated_at,
        t.first_response_at,
        t.resolved_at,
        t.closed_at,
        getStringField(t, "solution_type"),
        getStringField(t, "solution_notes"),
        getStringField(t, "closure_code"),
        t.response_deadline,
        t.sla_deadline,
        t.sla_traffic_light,
        t.sla_pct_used,
        t.sla_remaining_minutes,
        t.sla_excluded,
        t.sla_exclusion_reason,
        t.planned_at,
        t.planned_for_at,
        t.canceled_at,
        t.canceled_reason,
        requester?.full_name ?? requester?.email ?? "",
        requester?.email ?? "",
        assignee?.full_name ?? assignee?.email ?? "",
        assignee?.email ?? "",
        category ?? "",
        subcategory ?? "",
      ];

      lines.push(row.map(csvEscape).join(","));
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="tickets-${deptId}.csv"`);
    res.send(lines.join("\n"));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "bad_request";
    res.status(400).json({ error: message });
  }
});

const server = http.createServer(app);
attachRemoteTunnelWs(server, { env, supabaseAdmin });

server.listen(env.PORT, () => {
  console.log(`[api] listening on :${env.PORT}`);
});
