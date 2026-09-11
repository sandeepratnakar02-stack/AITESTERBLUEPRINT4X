import type { Metadata } from "next";
import { CheckCircle2, Clock, RefreshCw, XCircle } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { RetryTimeline } from "@/components/dashboard/retry-timeline";
import { getIncidents, getRetryHistory } from "@/lib/api";
import { normalizeEnvironment } from "@/lib/environment";
import { formatClockWithSeconds, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Retry History" };

interface RetryHistoryPageProps {
  searchParams: Promise<{ env?: string }>;
}

const OUTCOME_STYLES: Record<string, string> = {
  failed: "text-status-down-strong",
  succeeded: "text-status-healthy-strong",
  scheduled: "text-status-info-strong",
  info: "text-muted-foreground",
};

export default async function RetryHistoryPage({ searchParams }: RetryHistoryPageProps) {
  const { env } = await searchParams;
  const environment = normalizeEnvironment(env);
  const [attempts, incidents] = await Promise.all([
    getRetryHistory(environment),
    getIncidents(environment),
  ]);

  const failed = attempts.filter((attempt) => attempt.outcome === "failed").length;
  const succeeded = attempts.filter((attempt) => attempt.outcome === "succeeded").length;
  const scheduled = attempts.filter((attempt) => attempt.outcome === "scheduled");
  const averageDelay = scheduled.length
    ? scheduled.reduce((sum, attempt) => sum + (attempt.scheduledDelaySeconds ?? 0), 0) / scheduled.length
    : 0;

  const retriedIncidents = incidents.filter((incident) => incident.timeline.length > 0).slice(0, 3);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Retry History"
        description={`Every automatic retry executed by the workflow for ${environment}, with the wait time applied before each attempt.`}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Retry Executions"
          value={attempts.length}
          hint="Tracked retry events"
          icon={RefreshCw}
          accent="info"
        />
        <MetricCard
          label="Failed Attempts"
          value={failed}
          hint="Retries that did not recover the service"
          icon={XCircle}
          accent={failed > 0 ? "down" : "healthy"}
        />
        <MetricCard
          label="Recovered by Retry"
          value={succeeded}
          hint="Service restored before escalation"
          icon={CheckCircle2}
          accent="healthy"
        />
        <MetricCard
          label="Average Wait"
          value={`${averageDelay.toFixed(0)} s`}
          hint="Delay between attempts"
          icon={Clock}
          accent="degraded"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        {retriedIncidents.map((incident) => (
          <div key={incident.id} className="min-w-0">
            <RetryTimeline
              events={incident.timeline}
              title={`${incident.id} · ${incident.serviceName}`}
              description={`${incident.retryAttempts} retry attempts · started ${formatClockWithSeconds(incident.startedAt)}`}
            />
          </div>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Retry Attempt Log</CardTitle>
          <CardDescription>
            Chronological retry events emitted by the health check and escalation nodes.
          </CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Time</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Incident</TableHead>
              <TableHead className="text-right">Attempt</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead className="text-right">Delay</TableHead>
              <TableHead>Message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {attempts.map((attempt) => (
              <TableRow key={attempt.id}>
                <TableCell className="font-mono text-2xs text-muted-foreground">
                  {formatDate(attempt.at)} · {formatClockWithSeconds(attempt.at)}
                </TableCell>
                <TableCell className="font-medium">{attempt.serviceName}</TableCell>
                <TableCell className="font-mono text-2xs text-muted-foreground">
                  {attempt.incidentId ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular">#{attempt.attempt}</TableCell>
                <TableCell className={`text-xs font-medium ${OUTCOME_STYLES[attempt.outcome] ?? ""}`}>
                  {attempt.outcome}
                </TableCell>
                <TableCell className="text-right tabular">
                  {attempt.scheduledDelaySeconds ? `${attempt.scheduledDelaySeconds} s` : "—"}
                </TableCell>
                <TableCell className="max-w-[22rem] truncate text-xs text-muted-foreground">
                  {attempt.message}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
