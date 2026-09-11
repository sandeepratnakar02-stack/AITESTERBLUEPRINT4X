"use client";

import * as React from "react";
import { CheckCircle2, ExternalLink, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveIncidentRequest, triggerHealthCheck } from "@/lib/client-api";
import { n8nUiUrl } from "@/lib/n8n-ui";
import type { Environment } from "@/types";

export interface IncidentActionsProps {
  incidentId: string;
  environment: Environment;
  serviceId: string;
  /** Execution id recorded by the workflow; used for the n8n deep link. */
  n8nExecutionId?: string;
  resolved: boolean;
}

/**
 * Action bar for the incident drill-down page.
 * All three actions go through same-origin routes (`/api/*`), so n8n needs no
 * CORS configuration and the webhook credentials stay server-side.
 */
export function IncidentActions({
  incidentId,
  environment,
  n8nExecutionId,
  resolved,
}: IncidentActionsProps) {
  const [busy, setBusy] = React.useState<"rerun" | "resolve" | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [isResolved, setIsResolved] = React.useState(resolved);

  const executionUrl = n8nUiUrl(n8nExecutionId);

  React.useEffect(() => {
    setIsResolved(resolved);
  }, [resolved]);

  const handleRerun = async () => {
    setBusy("rerun");
    try {
      const result = await triggerHealthCheck(environment);
      setNotice(result.message ?? `Check re-queued • ${result.executionId}`);
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleResolve = async () => {
    setBusy("resolve");
    try {
      await resolveIncidentRequest(incidentId);
      setIsResolved(true);
      setNotice(`${incidentId} marked as resolved`);
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {notice ? (
        <span className="rounded-md border border-status-info-border bg-status-info-soft px-2.5 py-1 text-2xs font-medium text-status-info-strong">
          {notice}
        </span>
      ) : null}

      <Button
        variant="outline"
        size="sm"
        disabled={!executionUrl}
        title={executionUrl ? undefined : "Set NEXT_PUBLIC_N8N_UI_URL to enable this link"}
        onClick={() => {
          if (executionUrl) window.open(executionUrl, "_blank", "noopener");
        }}
      >
        <ExternalLink />
        Open n8n Execution
      </Button>

      <Button variant="outline" size="sm" onClick={handleRerun} disabled={busy !== null}>
        {busy === "rerun" ? <Loader2 className="animate-spin" /> : <RotateCcw />}
        Re-run Check
      </Button>

      <Button size="sm" onClick={handleResolve} disabled={busy !== null || isResolved}>
        {busy === "resolve" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
        {isResolved ? "Resolved" : "Resolve Incident"}
      </Button>
    </div>
  );
}
