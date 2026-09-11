import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { STATUS_CLASSIFICATION } from "@/lib/constants";
import { cn } from "@/lib/utils";

const TONE_TEXT = {
  healthy: "bg-status-healthy",
  degraded: "bg-status-degraded",
  down: "bg-status-down",
  info: "bg-status-info",
  unknown: "bg-status-unknown",
} as const;

/** Reference legend explaining how the workflow classifies each health state. */
export function StatusClassification({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Status Classification</CardTitle>
        <CardDescription>How the n8n health checks classify each result.</CardDescription>
      </CardHeader>
      <ul className="divide-y divide-border/70">
        {STATUS_CLASSIFICATION.map((item) => (
          <li key={item.state} className="flex items-start gap-3 px-5 py-3">
            <span
              className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", TONE_TEXT[item.tone])}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <code className="text-2xs font-semibold tracking-wide text-foreground">
                  {item.label}
                </code>
                <StatusBadge status={item.state} />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
