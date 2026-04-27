"use client";

import * as React from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
  LineChart,
  Line,
  Legend,
  ComposedChart,
  Bar,
  ReferenceLine,
  PieChart,
  Pie,
  Cell,
} from "recharts";

type Point = {
  bucket: string;
  created: number;
  closed: number;
  avg_response_hours?: number | null;
  avg_resolution_hours?: number | null;
  sla_pct?: number | null;
  avg_first_response_minutes?: number | null;
  avg_resolution_minutes?: number | null;
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
          <Area connectNulls={true} type="monotone" dataKey="created" name="Creados" stroke="hsl(var(--brand-cyan))" fill="url(#createdFill)" strokeWidth={3} />
          <Area connectNulls={true} type="monotone" dataKey="closed" name="Cerrados" stroke="hsl(var(--brand-violet))" fill="url(#closedFill)" strokeWidth={3} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function VolumeSlaComposedChart({ data }: { data: Point[] }) {
  const chartData = React.useMemo(() => data.map((p) => ({ ...p, sla_pct: p.sla_pct ?? null })), [data]);

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 6, right: 10, left: -18, bottom: 6 }}>
          <defs>
            <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--brand-cyan))" stopOpacity={0.8} />
              <stop offset="100%" stopColor="hsl(var(--brand-cyan))" stopOpacity={0.3} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(var(--border) / 0.6)" vertical={false} />
          <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} minTickGap={28} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
          <YAxis yAxisId="left" orientation="left" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
          <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card) / 0.8)",
              border: "1px solid hsl(var(--border) / 0.6)",
              borderRadius: 14,
              backdropFilter: "blur(18px) saturate(150%)",
            }}
            labelFormatter={(v) => `Periodo: ${formatBucketLabel(String(v))}`}
          />
          <Legend />
          <Bar yAxisId="left" dataKey="created" name="Volumen (Creados)" fill="url(#barFill)" radius={[6, 6, 0, 0]} maxBarSize={40} />
          <Line connectNulls={true} yAxisId="right" type="monotone" dataKey="sla_pct" name="SLA %" stroke="hsl(var(--brand-violet))" strokeWidth={4} dot={false} activeDot={{ r: 6 }} />
          <ReferenceLine yAxisId="right" y={90} stroke="hsl(var(--destructive))" strokeDasharray="3 3" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SlaLineChart({ data }: { data: Point[] }) {
  const chartData = React.useMemo(() => data.map((p) => ({ ...p, sla_pct: p.sla_pct ?? null })), [data]);
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 6, right: 10, left: -18, bottom: 6 }}>
          <defs>
            <linearGradient id="slaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--brand-cyan))" stopOpacity={0.4}/>
              <stop offset="95%" stopColor="hsl(var(--brand-cyan))" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(var(--border) / 0.6)" vertical={false} />
          <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} minTickGap={28} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card) / 0.8)",
              border: "1px solid hsl(var(--border) / 0.6)",
              borderRadius: 14,
              backdropFilter: "blur(18px) saturate(150%)",
            }}
            formatter={(v: unknown) => [`${formatNumber(v)}%`, "SLA"]}
            labelFormatter={(v) => `Periodo: ${formatBucketLabel(String(v))}`}
          />
          <ReferenceLine y={90} stroke="hsl(var(--destructive))" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: 'Objetivo SLA (90%)', fill: 'hsl(var(--destructive))', fontSize: 10 }} />
          <Area connectNulls={true} type="monotone" dataKey="sla_pct" name="SLA %" stroke="hsl(var(--brand-cyan))" fill="url(#slaFill)" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TimeLineChart({ data }: { data: Point[] }) {
  const hasAny = React.useMemo(
    () =>
      data.some((p) => {
        const resp = p.avg_response_hours;
        const resol = p.avg_resolution_hours;
        return (typeof resp === "number" && Number.isFinite(resp)) || (typeof resol === "number" && Number.isFinite(resol));
      }),
    [data]
  );

  if (!hasAny) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
        Sin datos de tiempos para este rango.
      </div>
    );
  }

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 10, left: -18, bottom: 6 }}>
          <defs>
            <linearGradient id="respFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--brand-blue))" stopOpacity={0.4}/>
              <stop offset="95%" stopColor="hsl(var(--brand-blue))" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="resolFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--brand-violet))" stopOpacity={0.4}/>
              <stop offset="95%" stopColor="hsl(var(--brand-violet))" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(var(--border) / 0.6)" vertical={false} />
          <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} minTickGap={28} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
          <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card) / 0.8)",
              border: "1px solid hsl(var(--border) / 0.6)",
              borderRadius: 14,
              backdropFilter: "blur(18px) saturate(150%)",
            }}
            labelFormatter={(v) => `Periodo: ${formatBucketLabel(String(v))}`}
          />
          <Legend />
          <Area connectNulls={true} type="monotone" dataKey="avg_response_hours" name="Resp (h)" stroke="hsl(var(--brand-blue))" fill="url(#respFill)" strokeWidth={3} dot={false} activeDot={{ r: 5 }} />
          <Area connectNulls={true} type="monotone" dataKey="avg_resolution_hours" name="Resol (h)" stroke="hsl(var(--brand-violet))" fill="url(#resolFill)" strokeWidth={3} dot={false} activeDot={{ r: 5 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChatTimeLineChart({ data }: { data: Point[] }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 10, left: -18, bottom: 6 }}>
          <defs>
            <linearGradient id="cRespFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--brand-blue))" stopOpacity={0.4}/>
              <stop offset="95%" stopColor="hsl(var(--brand-blue))" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="cResolFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--brand-violet))" stopOpacity={0.4}/>
              <stop offset="95%" stopColor="hsl(var(--brand-violet))" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(var(--border) / 0.6)" vertical={false} />
          <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} minTickGap={28} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
          <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card) / 0.8)",
              border: "1px solid hsl(var(--border) / 0.6)",
              borderRadius: 14,
              backdropFilter: "blur(18px) saturate(150%)",
            }}
            labelFormatter={(v) => `Periodo: ${formatBucketLabel(String(v))}`}
          />
          <Legend />
          <Area connectNulls={true} type="monotone" dataKey="avg_first_response_minutes" name="Primera resp (min)" stroke="hsl(var(--brand-blue))" fill="url(#cRespFill)" strokeWidth={3} dot={false} />
          <Area connectNulls={true} type="monotone" dataKey="avg_resolution_minutes" name="Resolución (min)" stroke="hsl(var(--brand-violet))" fill="url(#cResolFill)" strokeWidth={3} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PriorityPieChart({ data }: { data: { name: string; value: number; color: string }[] }) {
  const hasData = data.some(d => d.value > 0);
  
  if (!hasData) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
        No hay tickets pendientes.
      </div>
    );
  }

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip 
            contentStyle={{
              background: "hsl(var(--card) / 0.9)",
              border: "1px solid hsl(var(--border) / 0.6)",
              borderRadius: 14,
              backdropFilter: "blur(18px) saturate(150%)",
            }}
            itemStyle={{ color: "hsl(var(--foreground))", fontWeight: 500 }}
          />
          <Legend verticalAlign="bottom" height={36} iconType="circle" />
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={65}
            outerRadius={85}
            paddingAngle={6}
            dataKey="value"
            stroke="none"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
