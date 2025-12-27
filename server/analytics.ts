import { z } from "zod";
import type { AuthedRequest } from "./auth";

const PeriodSchema = z.enum(["daily", "weekly", "monthly"]);
const BucketSchema = z.enum(["hour", "day", "week", "month"]);

export function parseAnalyticsQuery(query: unknown) {
  const QuerySchema = z.object({
    period: PeriodSchema.default("weekly"),
    agentId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    tz: z.string().default("UTC"),
  });
  return QuerySchema.parse(query);
}

export function dateRangeForPeriod(period: z.infer<typeof PeriodSchema>) {
  const end = new Date();
  const start = new Date(end);
  if (period === "daily") start.setDate(end.getDate() - 1);
  if (period === "weekly") start.setDate(end.getDate() - 7);
  if (period === "monthly") start.setMonth(end.getMonth() - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function getKpis(req: AuthedRequest, args: { period: "daily" | "weekly" | "monthly"; agentId?: string; categoryId?: string }) {
  const { start, end } = dateRangeForPeriod(args.period);
  const { data, error } = await req.supabase.rpc("kpi_dashboard", {
    p_start: start,
    p_end: end,
    p_agent_id: args.agentId ?? null,
    p_category_id: args.categoryId ?? null,
  });
  if (error) throw error;
  return data;
}

export async function getChatKpis(req: AuthedRequest, args: { period: "daily" | "weekly" | "monthly"; agentId?: string; categoryId?: string }) {
  const { start, end } = dateRangeForPeriod(args.period);
  const { data, error } = await req.supabase.rpc("kpi_chat_dashboard", {
    p_start: start,
    p_end: end,
    p_agent_id: args.agentId ?? null,
    p_category_id: args.categoryId ?? null,
  });
  if (error) throw error;
  return data;
}

export function parseTrendsQuery(query: unknown) {
  const QuerySchema = z.object({
    period: PeriodSchema.default("weekly"),
    bucket: BucketSchema.optional(),
    agentId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    tz: z.string().default("UTC"),
  });
  return QuerySchema.parse(query);
}

function defaultBucketForPeriod(period: z.infer<typeof PeriodSchema>) {
  if (period === "daily") return "hour";
  if (period === "weekly") return "day";
  return "day";
}

export async function getTrends(
  req: AuthedRequest,
  args: { period: "daily" | "weekly" | "monthly"; bucket?: z.infer<typeof BucketSchema>; agentId?: string; categoryId?: string }
) {
  const { start, end } = dateRangeForPeriod(args.period);
  const bucket = args.bucket ?? defaultBucketForPeriod(args.period);
  const { data, error } = await req.supabase.rpc("kpi_timeseries", {
    p_start: start,
    p_end: end,
    p_bucket: bucket,
    p_agent_id: args.agentId ?? null,
    p_category_id: args.categoryId ?? null,
  });
  if (error) throw error;
  return { bucket, start, end, points: data ?? [] };
}

export async function getChatTrends(
  req: AuthedRequest,
  args: { period: "daily" | "weekly" | "monthly"; bucket?: z.infer<typeof BucketSchema>; agentId?: string; categoryId?: string }
) {
  const { start, end } = dateRangeForPeriod(args.period);
  const bucket = args.bucket ?? defaultBucketForPeriod(args.period);
  const { data, error } = await req.supabase.rpc("kpi_chat_timeseries", {
    p_start: start,
    p_end: end,
    p_bucket: bucket,
    p_agent_id: args.agentId ?? null,
    p_category_id: args.categoryId ?? null,
  });
  if (error) throw error;
  return { bucket, start, end, points: data ?? [] };
}
