import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bell, Clock, ServerCrash } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailRow, DetailSection } from "@/components/ui/sheet";
import { PageHeader } from "@/components/dashboard/page-header";
import { RetryTimeline } from "@/components/dashboard/retry-timeline";
import { IncidentSeverityBadge, IncidentStatusBadge } from "@/components/dashboard/incident-table";
import { IncidentActions } from "@/components/dashboard/incident-actions";
import { getIncidentById } from "@/lib/api";
import { formatDate, formatDateTime, formatDuration } from "@/lib/format";

interface IncidentDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ env?: string }>;
}

export async function generateMetadata({ params }: IncidentDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: `Incident ${id.toUpperCase()}` };
}

export default async function IncidentDetailPage({ params, searchParams }: IncidentDetailPageProps) {
  const [{ id }, { env }] = await Promise.all([params, searchParams]);
  const incident = await getIncidentById(id);

  if (!incident) notFound();

  const environment = env ?? incident.environment;
  const resolved = incident.status === "Resolved" || incident.status === "Recovered";

  return (
    <div className="space-y-5">
      <Link
        href={`/incidents?env=${environment}`}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Back to incidents
      </Link>

      <PageHeader
        title={`${incident.id} · ${incident.serviceName}`}
        description={`Incident drill-down for the ${incident.environment} environment.`}
        actions={
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="flex items-center gap-2">
              <IncidentStatusBadge status={incident.status} />
              <IncidentSeverityBadge severity={incident.severity} />
            </div>
            <IncidentActions
              incidentId={incident.id}
              environment={incident.environment}
              serviceId={incident.serviceId}
              n8nExecutionId={incident.n8nExecutionId}
              resolved={resolved}
            />
          </div>
        }
      />

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Incident Summary</CardTitle>
              <CardDescription>Raised automatically by the VWO health check workflow.</CardDescription>
            </CardHeader>
            <div className="px-5 py-2">
              <DetailSection title="Identification">
                <DetailRow label="Incident ID">
                  <span className="font-mono text-2xs">{incident.id}</span>
                </DetailRow>
                <DetailRow label="Status">
                  <IncidentStatusBadge status={incident.status} />
                </DetailRow>
                <DetailRow label="Severity">
                  <IncidentSeverityBadge severity={incident.severity} />
                </DetailRow>
                <DetailRow label="Affected Service">{incident.serviceName}</DetailRow>
                <DetailRow label="Application">{incident.application}</DetailRow>
                <DetailRow label="Environment">{incident.environment}</DetailRow>
              </DetailSection>

              <DetailSection title="Timing">
                <DetailRow label="Detection Time">{formatDateTime(incident.detectedAt)}</DetailRow>
                <DetailRow label="Recovery Time">
                  {incident.recoveredAt ? (
                    formatDateTime(incident.recoveredAt)
                  ) : (
                    <span className="text-status-down-strong">Still open</span>
                  )}
                </DetailRow>
                <DetailRow label="Downtime Duration">
                  {formatDuration(incident.durationSeconds)}
                </DetailRow>
              </DetailSection>

              <DetailSection title="Failure">
                <DetailRow label="Failure Reason">{incident.failureReason}</DetailRow>
                <DetailRow label="Retry Attempts">{incident.retryAttempts}</DetailRow>
                <DetailRow label="n8n Execution ID">
                  <span className="font-mono text-2xs">{incident.n8nExecutionId}</span>
                </DetailRow>
              </DetailSection>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>HTTP Response</CardTitle>
              <CardDescription>Raw response captured on the final failed attempt.</CardDescription>
            </CardHeader>
            <div className="px-5 py-4">
              <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-2xs leading-relaxed text-foreground scrollbar-thin">
                {incident.httpResponse}
              </pre>
            </div>
          </Card>

          <RetryTimeline
            events={incident.timeline}
            title="Timeline"
            description={`${incident.timeline.length} events recorded during detection and escalation.`}
          />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>At a Glance</CardTitle>
              <CardDescription>Quick facts for triage.</CardDescription>
            </CardHeader>
            <ul className="divide-y divide-border/70">
              <li className="flex items-center gap-3 px-5 py-3">
                <Bell className="size-4 text-status-down" aria-hidden />
                <div>
                  <p className="text-xs font-medium">Detected {formatDate(incident.detectedAt)}</p>
                  <p className="text-2xs text-muted-foreground">
                    {incident.retryAttempts} automatic retries before escalation
                  </p>
                </div>
              </li>
              <li className="flex items-center gap-3 px-5 py-3">
                <Clock className="size-4 text-status-degraded" aria-hidden />
                <div>
                  <p className="text-xs font-medium">
                    Downtime {formatDuration(incident.durationSeconds)}
                  </p>
                  <p className="text-2xs text-muted-foreground">
                    {resolved ? "Service has recovered" : "Service still impacted"}
                  </p>
                </div>
              </li>
              <li className="flex items-center gap-3 px-5 py-3">
                <ServerCrash className="size-4 text-muted-foreground" aria-hidden />
                <div>
                  <p className="text-xs font-medium">{incident.serviceName}</p>
                  <p className="text-2xs text-muted-foreground">
                    {incident.environment} · {incident.severity} severity
                  </p>
                </div>
              </li>
            </ul>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Investigation</CardTitle>
              <CardDescription>What to check next.</CardDescription>
            </CardHeader>
            <div className="space-y-2 px-5 py-4 text-xs text-muted-foreground">
              <p>• Re-run the health check to confirm the current state.</p>
              <p>• Open the n8n execution to inspect the failing node output.</p>
              <p>• Compare with the response time chart for the service.</p>
              <p>• Confirm whether the failure is environmental or a real regression.</p>
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}
