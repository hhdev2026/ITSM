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
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
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

// --------------------------------------------------------------------------------
// HIGH-END GAUGES & SPARKLINES (POWER BI / TREMOR STYLE)
// --------------------------------------------------------------------------------

export function RadialGauge({ value, color = "hsl(var(--brand-cyan))", label }: { value: number; color?: string; label: string }) {
  const data = [{ name: label, value: Math.max(0, Math.min(100, value)) }];
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center">
      <ResponsiveContainer width="100%" height={160}>
        <RadialBarChart cx="50%" cy="60%" innerRadius="70%" outerRadius="100%" barSize={12} data={data} startAngle={180} endAngle={0}>
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar background={{ fill: "hsl(var(--muted))" }} dataKey="value" cornerRadius={12} fill={color} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute left-1/2 top-[60%] -translate-x-1/2 -translate-y-[20%] text-center">
        <div className="text-3xl font-black tabular-nums tracking-tight" style={{ color }}>{value}%</div>
        <div className="mt-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

export function SparkLine({ data, dataKey, color }: { data: any[]; dataKey: string; color: string }) {
  return (
    <div className="h-10 w-24 opacity-80 mix-blend-screen filter drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id={`spark-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.5} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey={dataKey} stroke={color} fill={`url(#spark-${dataKey})`} strokeWidth={2.5} dot={false} isAnimationActive={false} connectNulls />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// --------------------------------------------------------------------------------
// ADVANCED MAIN CHARTS
// --------------------------------------------------------------------------------

export function VolumeSlaComposedChart({ data }: { data: Point[] }) {
  const chartData = React.useMemo(() => data.map((p) => ({ ...p, sla_pct: p.sla_pct ?? null })), [data]);

  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--brand-cyan))" stopOpacity={0.9} />
              <stop offset="100%" stopColor="hsl(var(--brand-cyan))" stopOpacity={0.2} />
            </linearGradient>
            <linearGradient id="barFillClosed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--brand-violet))" stopOpacity={0.8} />
              <stop offset="100%" stopColor="hsl(var(--brand-violet))" stopOpacity={0.1} />
            </linearGradient>
            <linearGradient id="slaArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(var(--border) / 0.4)" vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} minTickGap={30} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} dy={10} />
          <YAxis yAxisId="left" orientation="left" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
          <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card) / 0.9)",
              border: "1px solid hsl(var(--border))",
              borderRadius: 12,
              backdropFilter: "blur(20px) saturate(200%)",
              boxShadow: "0 10px 30px -10px rgba(0,0,0,0.5)",
            }}
            labelFormatter={(v) => `Periodo: ${formatBucketLabel(String(v))}`}
            cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
          />
          <Legend wrapperStyle={{ paddingTop: "20px" }} iconType="circle" />
          <Bar yAxisId="left" dataKey="created" name="Creados" fill="url(#barFill)" radius={[4, 4, 0, 0]} maxBarSize={30} />
          <Bar yAxisId="left" dataKey="closed" name="Cerrados" fill="url(#barFillClosed)" radius={[4, 4, 0, 0]} maxBarSize={30} />
          <Area yAxisId="right" connectNulls type="monotone" dataKey="sla_pct" name="SLA %" stroke="#10b981" fill="url(#slaArea)" strokeWidth={3} dot={false} activeDot={{ r: 6, strokeWidth: 0, fill: "#10b981" }} />
          <ReferenceLine yAxisId="right" y={90} stroke="hsl(var(--destructive))" strokeDasharray="4 4" strokeWidth={2} />
        </ComposedChart>
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
      <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground bg-muted/10">
        Sin datos de tiempos para este rango.
      </div>
    );
  }

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="respFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f97316" stopOpacity={0.4}/>
              <stop offset="100%" stopColor="#f97316" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="resolFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--brand-violet))" stopOpacity={0.5}/>
              <stop offset="100%" stopColor="hsl(var(--brand-violet))" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(var(--border) / 0.4)" vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="bucket" tickFormatter={formatBucketLabel} minTickGap={30} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} dy={10} />
          <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card) / 0.9)",
              border: "1px solid hsl(var(--border))",
              borderRadius: 12,
              backdropFilter: "blur(20px) saturate(200%)",
            }}
            labelFormatter={(v) => `Periodo: ${formatBucketLabel(String(v))}`}
          />
          <Legend wrapperStyle={{ paddingTop: "20px" }} iconType="circle" />
          <Area connectNulls type="monotone" dataKey="avg_response_hours" name="Tiempo Resp (h)" stroke="#f97316" fill="url(#respFill)" strokeWidth={3} dot={false} activeDot={{ r: 6, strokeWidth: 0 }} />
          <Area connectNulls type="monotone" dataKey="avg_resolution_hours" name="Tiempo Resol (h)" stroke="hsl(var(--brand-violet))" fill="url(#resolFill)" strokeWidth={3} dot={false} activeDot={{ r: 6, strokeWidth: 0 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PriorityPieChart({ data }: { data: { name: string; value: number; color: string }[] }) {
  const hasData = data.some((d) => d.value > 0);

  if (!hasData) {
    return (
      <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground bg-muted/10">
        No hay tickets pendientes.
      </div>
    );
  }

  return (
    <div className="h-72 relative">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card) / 0.9)",
              border: "1px solid hsl(var(--border))",
              borderRadius: 12,
              backdropFilter: "blur(20px) saturate(200%)",
            }}
            itemStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
          />
          <Legend verticalAlign="bottom" height={36} iconType="circle" />
          <Pie
            data={data}
            cx="50%"
            cy="45%"
            innerRadius={65}
            outerRadius={95}
            paddingAngle={8}
            dataKey="value"
            stroke="none"
            cornerRadius={6}
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} style={{ filter: `drop-shadow(0px 4px 6px ${entry.color}40)` }} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
