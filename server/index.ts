import "./dotenv";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { loadEnv } from "./env";
import { requireAuth, requireRole, type AuthedRequest } from "./auth";
import { getChatKpis, getChatTrends, getKpis, getTrends, parseAnalyticsQuery, parseTrendsQuery } from "./analytics";

const env = loadEnv();

const app = express();
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(pinoHttp());

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/me", requireAuth, (req, res) => {
  const authed = req as AuthedRequest;
  res.json({ userId: authed.auth.userId, role: authed.auth.role, departmentId: authed.auth.departmentId, email: authed.auth.email });
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

app.get("/api/tickets/export.csv", requireAuth, requireRole(["supervisor", "admin"]), async (req, res) => {
  try {
    const authed = req as AuthedRequest;
    const deptId = authed.auth.departmentId;
    if (!deptId) return res.status(400).json({ error: "department_required" });

    const start = typeof req.query.start === "string" ? req.query.start : null;
    const end = typeof req.query.end === "string" ? req.query.end : null;

    let q = authed.supabase
      .from("tickets_sla_live")
      .select(
        [
          "id",
          "department_id",
          "type",
          "title",
          "status",
          "priority",
          "metadata",
          "category_id",
          "subcategory_id",
          "requester_id",
          "assignee_id",
          "created_at",
          "updated_at",
          "first_response_at",
          "resolved_at",
          "closed_at",
          "solution_type",
          "solution_notes",
          "response_deadline",
          "sla_deadline",
          "sla_remaining_minutes",
          "sla_pct_used",
          "sla_traffic_light",
          "sla_excluded",
          "sla_exclusion_reason",
          "planned_at",
          "planned_for_at",
          "canceled_at",
          "canceled_reason",
        ].join(",")
      )
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

app.listen(env.PORT, () => {
  console.log(`[api] listening on :${env.PORT}`);
});
