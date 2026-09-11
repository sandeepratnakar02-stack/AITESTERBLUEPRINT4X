"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UPTIME_TARGET_PCT } from "@/lib/constants";
import { formatDate, formatWeekday } from "@/lib/format";
import type { UptimePoint } from "@/types";

interface TooltipProps {
  active?: boolean;
  payload?: { payload?: UptimePoint }[];
}

function UptimeTooltip({ active, payload }: TooltipProps) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 shadow-card">
      <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        {formatDate(point.date)}
      </p>
      <p className="mt-1 text-sm font-semibold tabular">{point.uptimePct.toFixed(2)}%</p>
      <p className="mt-0.5 text-2xs text-muted-foreground tabular">
        {point.checks - point.failedChecks} / {point.checks} checks passed
      </p>
    </div>
  );
}

export interface UptimeChartProps {
  points: UptimePoint[];
  target?: number;
  title?: string;
  description?: string;
  height?: number;
}

/** Daily availability with the 99.9% target line. */
export function UptimeChart({
  points,
  target = UPTIME_TARGET_PCT,
  title = "Uptime — Last 7 Days",
  description = "Daily availability percentage against the 99.9% target.",
  height = 260,
}: UptimeChartProps) {
  const domain = React.useMemo<[number, number]>(() => {
    const lowest = Math.min(...points.map((point) => point.uptimePct), target);
    const floor = Math.max(0, Math.floor((lowest - 0.15) * 10) / 10);
    return [floor, 100];
  }, [points, target]);

  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between">
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          <span className="h-px w-4 border-t border-dashed border-status-degraded" aria-hidden />
          Target {target}%
        </span>
      </CardHeader>

      <div className="px-2 py-4" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 18, right: 16, bottom: 4, left: 4 }} barCategoryGap="28%">
            <CartesianGrid stroke="#EEF2F6" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(value: string) => formatWeekday(value)}
              tick={{ fontSize: 11, fill: "#64748B" }}
              axisLine={{ stroke: "#E2E8F0" }}
              tickLine={false}
            />
            <YAxis
              domain={domain}
              tick={{ fontSize: 11, fill: "#64748B" }}
              axisLine={false}
              tickLine={false}
              width={52}
              tickFormatter={(value: number) => `${value.toFixed(1)}%`}
            />
            <Tooltip content={<UptimeTooltip />} cursor={{ fill: "rgba(148, 163, 184, 0.10)" }} />
            <ReferenceLine
              y={target}
              stroke="#D97706"
              strokeDasharray="4 4"
              strokeOpacity={0.7}
              label={{
                value: `Target ${target}%`,
                position: "insideTopLeft",
                style: { fontSize: 10, fill: "#B45309" },
              }}
            />
            <Bar dataKey="uptimePct" radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={44}>
              {points.map((point) => (
                <Cell
                  key={point.date}
                  fill={point.uptimePct >= target ? "#16A34A" : "#D97706"}
                  fillOpacity={0.85}
                />
              ))}
              <LabelList
                dataKey="uptimePct"
                position="top"
                formatter={(value: number) => `${value.toFixed(2)}%`}
                style={{ fontSize: 10, fill: "#475569" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
