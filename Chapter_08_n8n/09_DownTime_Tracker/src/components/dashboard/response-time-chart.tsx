"use client";

import * as React from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RESPONSE_TIME_CHART_SERVICES } from "@/lib/constants";
import type { ResponseTimeMetric } from "@/types";

/** Restrained, distinguishable series palette (blue / green / violet / teal / slate). */
export const SERIES_COLORS: Record<string, string> = {
  "VWO Main Application": "#2563EB",
  "VWO Login": "#16A34A",
  "VWO API": "#7C3AED",
  "VWO Campaign Dashboard": "#0D9488",
  "VWO Editor": "#64748B",
};

function pad(value: number) {
  return value < 10 ? `0${value}` : String(value);
}

function axisTime(iso: string) {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface TooltipProps {
  active?: boolean;
  label?: string;
  payload?: { name?: string; value?: number; color?: string }[];
}

function ChartTooltip({ active, label, payload }: TooltipProps) {
  if (!active || !payload?.length || !label) return null;

  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 shadow-card">
      <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        {axisTime(label)} h
      </p>
      <ul className="space-y-1">
        {payload.map((entry) => (
          <li key={entry.name} className="flex items-center gap-2 text-xs">
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: entry.color }}
              aria-hidden
            />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto font-medium tabular">{entry.value} ms</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface ResponseTimeChartProps {
  metrics: ResponseTimeMetric[];
  thresholdMs: number;
  title?: string;
  description?: string;
  /** Service names to draw. Defaults to the three headline services. */
  series?: readonly string[];
  height?: number;
}

export function ResponseTimeChart({
  metrics,
  thresholdMs,
  title = "Response Time — Last 24 Hours",
  description = "Per-service latency with the 3 000 ms SLA threshold.",
  series = RESPONSE_TIME_CHART_SERVICES,
  height = 288,
}: ResponseTimeChartProps) {
  const data = React.useMemo(() => {
    const allowed = new Set(series);
    const rows = new Map<string, Record<string, string | number>>();

    for (const metric of metrics) {
      if (!allowed.has(metric.serviceName)) continue;
      const row = rows.get(metric.timestamp) ?? { timestamp: metric.timestamp };
      row[metric.serviceName] = metric.responseTimeMs;
      rows.set(metric.timestamp, row);
    }

    return Array.from(rows.values()).sort((a, b) =>
      String(a.timestamp).localeCompare(String(b.timestamp)),
    );
  }, [metrics, series]);

  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between">
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          <span className="h-px w-4 border-t border-dashed border-status-down" aria-hidden />
          SLA {thresholdMs} ms
        </span>
      </CardHeader>

      <div className="px-2 py-4" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 24, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="#EEF2F6" vertical={false} />
            <XAxis
              dataKey="timestamp"
              tickFormatter={axisTime}
              tick={{ fontSize: 11, fill: "#64748B" }}
              axisLine={{ stroke: "#E2E8F0" }}
              tickLine={false}
              minTickGap={28}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#64748B" }}
              axisLine={false}
              tickLine={false}
              width={52}
              tickFormatter={(value: number) => `${value}`}
              label={{
                value: "milliseconds",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 10, fill: "#94A3B8" },
              }}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#CBD5E1", strokeDasharray: "3 3" }} />
            <Legend
              verticalAlign="top"
              align="right"
              height={28}
              iconType="plainline"
              wrapperStyle={{ fontSize: 11, color: "#64748B" }}
            />
            <ReferenceLine
              y={thresholdMs}
              stroke="#DC2626"
              strokeDasharray="4 4"
              strokeOpacity={0.75}
              label={{
                value: `SLA ${thresholdMs} ms`,
                position: "insideTopRight",
                style: { fontSize: 10, fill: "#B91C1C" },
              }}
            />
            {series.map((name) => (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                name={name}
                stroke={SERIES_COLORS[name] ?? "#2563EB"}
                strokeWidth={1.75}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
