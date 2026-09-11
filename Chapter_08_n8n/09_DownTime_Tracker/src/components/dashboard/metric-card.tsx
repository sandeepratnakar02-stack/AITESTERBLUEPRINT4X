import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Accent = "healthy" | "down" | "degraded" | "info" | "neutral";

const ACCENT_STYLES: Record<Accent, { icon: string; value: string; rail: string }> = {
  healthy: {
    icon: "bg-status-healthy-soft text-status-healthy-strong",
    value: "text-status-healthy-strong",
    rail: "bg-status-healthy",
  },
  down: {
    icon: "bg-status-down-soft text-status-down-strong",
    value: "text-status-down-strong",
    rail: "bg-status-down",
  },
  degraded: {
    icon: "bg-status-degraded-soft text-status-degraded-strong",
    value: "text-status-degraded-strong",
    rail: "bg-status-degraded",
  },
  info: {
    icon: "bg-status-info-soft text-status-info-strong",
    value: "text-foreground",
    rail: "bg-status-info",
  },
  neutral: {
    icon: "bg-status-unknown-soft text-status-unknown-strong",
    value: "text-foreground",
    rail: "bg-status-unknown",
  },
};

export interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon: LucideIcon;
  accent?: Accent;
  /** Small trend/detail chip rendered under the value. */
  meta?: React.ReactNode;
  className?: string;
}

/** Compact KPI tile used across the dashboard summary strip. */
export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = "neutral",
  meta,
  className,
}: MetricCardProps) {
  const styles = ACCENT_STYLES[accent];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-border bg-card p-4 shadow-card",
        className,
      )}
    >
      <span className={cn("absolute inset-x-0 top-0 h-0.5", styles.rail)} aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <span className={cn("flex size-7 items-center justify-center rounded-md", styles.icon)}>
          <Icon className="size-3.5" aria-hidden />
        </span>
      </div>
      <p className={cn("mt-2 text-2xl font-semibold tracking-tight tabular", styles.value)}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      {meta ? <div className="mt-2">{meta}</div> : null}
    </div>
  );
}
