import "dotenv/config";
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

app.listen(env.PORT, () => {
  console.log(`[api] listening on :${env.PORT}`);
});
