"use client";

import * as React from "react";
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, Tooltip, XAxis, YAxis, LineChart, Line, Legend } from "recharts";

type Point = {
  bucket: string;
  created: number;
  closed: number;
  avg_response_hours: number | null;
  avg_resolution_hours: number | null;
  sla_pct: number | null;
};

function formatBucketLabel(bucketIso: string) {
  const d = new Date(bucketIso);
  if (Number.isNaN(d.getTime())) return bucketIso;
  return d.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatNumber(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v.toFixed(2);
  return "—";
}

export function VolumeAreaChart({ data }: { data: Point[] }) {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 10, left: -18, bottom: 6 }}>
          <defs>
            <linearGradient id="createdFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--brand-cyan))" stopOpacity={0.32} />
              <stop offset="100%" stopColor="hsl(var(--brand-cyan))" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="closedFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--brand-violet))" stopOpacity={0.28} />
              <stop offset="100%" stopColor="hsl(var(--brand-violet))" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(var(--border) / 0.6)" vertical={false} />
          <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} minTickGap={28} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
          <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card) / 0.75)",
              border: "1px solid hsl(var(--border) / 0.6)",
              borderRadius: 14,
              backdropFilter: "blur(18px) saturate(150%)",
            }}
            labelFormatter={(v) => `Periodo: ${formatBucketLabel(String(v))}`}
          />
          <Legend />
          <Area type="monotone" dataKey="created" name="Creados" stroke="hsl(var(--brand-cyan))" fill="url(#createdFill)" strokeWidth={2} />
          <Area type="monotone" dataKey="closed" name="Cerrados" stroke="hsl(var(--brand-violet))" fill="url(#closedFill)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SlaLineChart({ data }: { data: Point[] }) {
  const chartData = React.useMemo(() => data.map((p) => ({ ...p, sla_pct: p.sla_pct ?? null })), [data]);
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 6, right: 10, left: -18, bottom: 6 }}>
          <CartesianGrid stroke="hsl(var(--border) / 0.6)" vertical={false} />
          <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} minTickGap={28} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card) / 0.75)",
              border: "1px solid hsl(var(--border) / 0.6)",
              borderRadius: 14,
              backdropFilter: "blur(18px) saturate(150%)",
            }}
            formatter={(v: unknown) => [`${formatNumber(v)}%`, "SLA"]}
            labelFormatter={(v) => `Periodo: ${formatBucketLabel(String(v))}`}
          />
          <Line type="monotone" dataKey="sla_pct" name="SLA %" stroke="hsl(var(--brand-cyan))" strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TimeLineChart({ data }: { data: Point[] }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 10, left: -18, bottom: 6 }}>
          <CartesianGrid stroke="hsl(var(--border) / 0.6)" vertical={false} />
          <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} minTickGap={28} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
          <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card) / 0.75)",
              border: "1px solid hsl(var(--border) / 0.6)",
              borderRadius: 14,
              backdropFilter: "blur(18px) saturate(150%)",
            }}
            labelFormatter={(v) => `Periodo: ${formatBucketLabel(String(v))}`}
          />
          <Legend />
          <Line type="monotone" dataKey="avg_response_hours" name="Resp (h)" stroke="hsl(var(--brand-blue))" strokeWidth={2.5} dot={false} />
          <Line type="monotone" dataKey="avg_resolution_hours" name="Resol (h)" stroke="hsl(var(--brand-violet))" strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

