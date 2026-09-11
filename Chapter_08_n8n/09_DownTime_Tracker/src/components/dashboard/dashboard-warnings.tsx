import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardSnapshot } from "@/types";

export interface DashboardWarningsProps {
  snapshot: Pick<
    DashboardSnapshot,
    "ok" | "source" | "warnings" | "sources" | "durationMs" | "generatedAt"
  >;
  className?: string;
}

/**
 * Degraded-state strip shown when one or more upstream n8n sources failed.
 *
 * Two distinct states, because they mean different things to the person reading
 * the page:
 *
 *   - every source failed → "Live data unavailable" (nothing on the page is real)
 *   - some sources failed → "Partial data" (what is shown is real, so is the gap)
 *
 * Deliberately additive: it reuses the existing status tokens and typography, so
 * it slots in above the summary cards without changing the page's layout or
 * visual language. When everything succeeded it renders nothing.
 */
export function DashboardWarnings({ snapshot, className }: DashboardWarningsProps) {
  if (snapshot.ok) return null;

  const total = snapshot.sources.length;
  const failed = snapshot.warnings.length;
  const allFailed = total > 0 && failed === total;

  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-status-degraded-border bg-status-degraded-soft px-4 py-3",
        className,
      )}
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-status-degraded-strong" aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-semibold text-status-degraded-strong">
          {allFailed ? "Live data unavailable" : `Partial data — ${failed} of ${total} sources unavailable`}
          <span className="ml-2 font-normal text-muted-foreground">
            ({snapshot.source} mode · {snapshot.durationMs} ms)
          </span>
        </p>
        <ul className="space-y-0.5">
          {snapshot.warnings.map((warning) => (
            <li key={warning} className="text-2xs text-status-degraded-strong/90">
              • {warning}
            </li>
          ))}
        </ul>
        <p className="text-2xs text-muted-foreground">
          {allFailed
            ? "No monitoring data was returned, and nothing was replaced with sample values. Use Refresh, or check the n8n workflow and its executions."
            : "Failed sections are shown empty rather than substituted with sample data. Use Refresh, or check the n8n workflow and its executions."}
        </p>
      </div>
    </div>
  );
}
