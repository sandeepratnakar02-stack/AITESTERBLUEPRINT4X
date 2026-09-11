"use client";

import * as React from "react";
import { ExternalLink, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DetailRow, DetailSection, Sheet } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { triggerHealthCheck } from "@/lib/client-api";
import { formatDateTime, formatResponseTime, formatTime } from "@/lib/format";
import { n8nUiUrl } from "@/lib/n8n-ui";
import type { Service } from "@/types";

export interface HealthCheckDrawerProps {
  service: Service | null;
  onClose: () => void;
}

/**
 * Health check detail drawer — every field the n8n check node evaluates for the
 * selected service, including the retry policy that produced the retries.
 */
export function HealthCheckDrawer({ service, onClose }: HealthCheckDrawerProps) {
  const open = Boolean(service);

  const passed = service ? service.status === "HEALTHY" || service.status === "SLOW" : false;
  const workflowUrl = n8nUiUrl();
  // Defensive: a producer may omit the retry policy entirely.
  const retryPolicy = service?.retryPolicy ?? { maxAttempts: 3, delaysSeconds: [20, 30] };

  const [isRunning, setIsRunning] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  // Reset the transient notice whenever a different service is opened.
  React.useEffect(() => {
    setNotice(null);
    setIsRunning(false);
  }, [service?.id]);

  const handleRerun = async () => {
    if (!service) return;
    setIsRunning(true);
    try {
      const result = await triggerHealthCheck(service.environment);
      setNotice(result.message ?? `Check queued • ${result.executionId}`);
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          {service?.name ?? "Service"}
          {service ? <StatusBadge status={service.status} /> : null}
        </span>
      }
      description="Health check definition and latest observed result"
      footer={
        <>
          {notice ? (
            <span className="mr-auto rounded-md border border-status-info-border bg-status-info-soft px-2.5 py-1 text-2xs font-medium text-status-info-strong">
              {notice}
            </span>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={!workflowUrl}
            title={workflowUrl ? undefined : "Set NEXT_PUBLIC_N8N_UI_URL to enable this link"}
            onClick={() => {
              if (workflowUrl) window.open(workflowUrl, "_blank", "noopener");
            }}
          >
            <ExternalLink />
            Open n8n Execution
          </Button>
          <Button size="sm" onClick={handleRerun} disabled={isRunning}>
            {isRunning ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            Re-run Check
          </Button>
        </>
      }
    >
      {service ? (
        <div className="space-y-1">
          <DetailSection title="Target">
            <DetailRow label="Service Name">{service.name}</DetailRow>
            <DetailRow label="Application">{service.application}</DetailRow>
            <DetailRow label="Environment">{service.environment}</DetailRow>
            <DetailRow label="Check Type">{service.checkType}</DetailRow>
            <DetailRow label="URL">
              <span className="font-mono text-2xs text-status-info-strong">{service.url}</span>
            </DetailRow>
            <DetailRow label="HTTP Method">{service.httpMethod}</DetailRow>
            <DetailRow label="Critical">
              <Badge variant={service.critical ? "danger" : "neutral"} size="sm">
                {service.critical ? "Yes" : "No"}
              </Badge>
            </DetailRow>
          </DetailSection>

          <DetailSection title="Assertions">
            <DetailRow label="Expected Status">{service.expectedStatus}</DetailRow>
            <DetailRow label="Actual Status">
              <span className={passed ? "text-status-healthy-strong" : "text-status-down-strong"}>
                {service.httpStatus ?? "—"}
              </span>
            </DetailRow>
            <DetailRow label="Expected Text">
              {service.expectedText ? (
                <span className="font-mono text-2xs">{service.expectedText}</span>
              ) : (
                <span className="text-muted-foreground">optional</span>
              )}
            </DetailRow>
            <DetailRow label="Response Time Threshold">
              {service.responseTimeThresholdMs} ms
            </DetailRow>
            <DetailRow label="Actual Response Time">
              <span
                className={
                  service.responseTimeMs > service.responseTimeThresholdMs
                    ? "text-status-degraded-strong"
                    : "text-status-healthy-strong"
                }
              >
                {formatResponseTime(service.responseTimeMs)}
              </span>
            </DetailRow>
          </DetailSection>

          <DetailSection title="Latest result">
            <DetailRow label="Status">
              <span className="inline-flex items-center gap-2">
                <StatusBadge status={service.status} showRawState />
              </span>
            </DetailRow>
            <DetailRow label="Attempts">
              {service.attempts} / {retryPolicy.maxAttempts}
            </DetailRow>
            <DetailRow label="Consecutive slow checks">{service.consecutiveSlowChecks ?? 0}</DetailRow>
            <DetailRow label="Last Checked">
              {formatTime(service.lastCheckedAt)} · {formatDateTime(service.lastCheckedAt)}
            </DetailRow>
          </DetailSection>

          <DetailSection
            title="Retry Policy"
            description="Delay applied before the retry attempt that follows it."
          >
            <DetailRow label="Maximum Attempts">{retryPolicy.maxAttempts}</DetailRow>
            {retryPolicy.delaysSeconds.map((delay, index) => (
              <DetailRow key={delay} label={`Retry #${index + 2} Delay`}>
                {delay} seconds
              </DetailRow>
            ))}
          </DetailSection>
        </div>
      ) : null}
    </Sheet>
  );
}
