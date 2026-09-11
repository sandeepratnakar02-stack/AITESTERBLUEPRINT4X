import * as React from "react";
import { AlertTriangle, BellRing, CalendarClock, CheckCircle2, Info, RotateCcw } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatClockWithSeconds } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TimelineEvent } from "@/types";

const KIND_STYLE = {
  failure: { dot: "bg-status-down", ring: "ring-status-down/20", text: "text-status-down-strong", icon: AlertTriangle },
  retry: { dot: "bg-status-degraded", ring: "ring-status-degraded/20", text: "text-status-degraded-strong", icon: RotateCcw },
  schedule: { dot: "bg-status-info", ring: "ring-status-info/20", text: "text-status-info-strong", icon: CalendarClock },
  incident: { dot: "bg-status-down", ring: "ring-status-down/20", text: "text-status-down-strong", icon: BellRing },
  recovery: { dot: "bg-status-healthy", ring: "ring-status-healthy/20", text: "text-status-healthy-strong", icon: CheckCircle2 },
  info: { dot: "bg-status-unknown", ring: "ring-status-unknown/20", text: "text-muted-foreground", icon: Info },
} as const;

export interface RetryTimelineProps {
  events: TimelineEvent[];
  title?: string;
  description?: string;
  /** Wraps the timeline in a Card when true (default). */
  contained?: boolean;
}

/**
 * Vertical retry timeline: initial failure → scheduled retry → final failure →
 * incident creation, exactly as recorded by the n8n execution.
 */
export function RetryTimeline({
  events,
  title = "Retry Activity",
  description = "Automatic retry sequence for the active incident.",
  contained = true,
}: RetryTimelineProps) {
  const body = (
    <ol className="relative space-y-4">
      <span className="absolute left-[7px] top-2 bottom-2 w-px bg-border" aria-hidden />
      {events.map((event) => {
        const style = KIND_STYLE[event.kind] ?? KIND_STYLE.info;
        const Icon = style.icon;

        return (
          <li key={event.id} className="relative flex gap-3 pl-0">
            <span
              className={cn(
                "relative z-10 mt-0.5 flex size-[15px] shrink-0 items-center justify-center rounded-full ring-4 ring-background",
                style.dot,
              )}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className={cn("flex items-center gap-1.5 text-xs font-medium", style.text)}>
                  <Icon className="size-3.5" aria-hidden />
                  {event.label}
                </p>
                <span className="font-mono text-2xs text-muted-foreground tabular">
                  {formatClockWithSeconds(event.at)}
                </span>
              </div>
              {event.detail ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{event.detail}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );

  if (!contained) return body;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <div className="px-5 py-4">{body}</div>
    </Card>
  );
}
