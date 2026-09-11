import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { HealthState } from "@/types";

type Tone = "success" | "warning" | "danger" | "neutral" | "info";

/**
 * Maps the workflow's canonical health states onto the four badge styles
 * required by the QA dashboard (Healthy / Down / Degraded / Retrying / Unknown).
 */
const STATUS_META: Record<HealthState, { label: string; tone: Tone; hint: string; spinner?: boolean }> = {
  HEALTHY: {
    label: "Healthy",
    tone: "success",
    hint: "HTTP status and functional checks passed.",
  },
  SLOW: {
    label: "Degraded",
    tone: "warning",
    hint: "SLOW — request succeeded but the response time threshold was exceeded.",
  },
  FUNCTIONAL_FAILURE: {
    label: "Degraded",
    tone: "warning",
    hint: "FUNCTIONAL_FAILURE — HTTP succeeded but the expected content was missing.",
  },
  DOWN: {
    label: "Down",
    tone: "danger",
    hint: "Endpoint unavailable or returned an unexpected server response.",
  },
  RETRYING: {
    label: "Retrying",
    tone: "warning",
    hint: "Health check failed and automatic retries are in progress.",
    spinner: true,
  },
  UNKNOWN: { label: "Unknown", tone: "neutral", hint: "No check recorded for this service yet." },
};

const TONE_CLASSES: Record<Tone, { badge: string; dot: string }> = {
  success: { badge: "border-status-healthy-border bg-status-healthy-soft text-status-healthy-strong", dot: "bg-status-healthy" },
  warning: { badge: "border-status-degraded-border bg-status-degraded-soft text-status-degraded-strong", dot: "bg-status-degraded" },
  danger: { badge: "border-status-down-border bg-status-down-soft text-status-down-strong", dot: "bg-status-down" },
  info: { badge: "border-status-info-border bg-status-info-soft text-status-info-strong", dot: "bg-status-info" },
  neutral: { badge: "border-status-unknown-border bg-status-unknown-soft text-status-unknown-strong", dot: "bg-status-unknown" },
};

export interface StatusBadgeProps {
  status: HealthState;
  /** Show the canonical state (HEALTHY / SLOW / …) instead of the friendly label. */
  showRawState?: boolean;
  size?: "default" | "sm";
  className?: string;
}

export function StatusBadge({ status, showRawState, size, className }: StatusBadgeProps) {
  const meta = STATUS_META[status] ?? STATUS_META.UNKNOWN;
  const tone = TONE_CLASSES[meta.tone];

  return (
    <Badge
      variant="outline"
      size={size}
      title={meta.hint}
      className={cn("gap-1.5 whitespace-nowrap", tone.badge, className)}
    >
      {meta.spinner ? (
        <Loader2 className="size-3 animate-spin" aria-hidden />
      ) : (
        <span className={cn("size-1.5 rounded-full", tone.dot)} aria-hidden />
      )}
      {showRawState ? meta.label.toUpperCase().replace(" ", "_") : meta.label}
    </Badge>
  );
}

export { STATUS_META };
