import type { Metadata } from "next";
import { CheckCircle2, Clock, ListChecks, XCircle } from "lucide-react";
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
import { StatusBadge } from "@/components/dashboard/status-badge";
import { getHealthChecks } from "@/lib/api";
import { normalizeEnvironment } from "@/lib/environment";
import { formatClockWithSeconds, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Health Checks" };

interface HealthChecksPageProps {
  searchParams: Promise<{ env?: string }>;
}

export default async function HealthChecksPage({ searchParams }: HealthChecksPageProps) {
  const { env } = await searchParams;
  const environment = normalizeEnvironment(env);
  const checks = await getHealthChecks(environment);

  const passed = checks.filter((check) => check.status === "HEALTHY").length;
  const failed = checks.filter((check) => check.status === "DOWN" || check.status === "FUNCTIONAL_FAILURE").length;
  const withRetries = checks.filter((check) => check.attempt > 1).length;
  const recent = checks.slice(0, 40);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Health Checks"
        description={`Raw check history recorded by the workflow for ${environment} — including every retry attempt.`}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Checks (24h)" value={checks.length} icon={ListChecks} accent="info" />
        <MetricCard
          label="Passed"
          value={passed}
          hint={`${((passed / Math.max(checks.length, 1)) * 100).toFixed(1)}% success rate`}
          icon={CheckCircle2}
          accent="healthy"
        />
        <MetricCard
          label="Failed"
          value={failed}
          hint="DOWN or FUNCTIONAL_FAILURE"
          icon={XCircle}
          accent={failed > 0 ? "down" : "healthy"}
        />
        <MetricCard
          label="Required Retries"
          value={withRetries}
          hint="Checks that needed more than one attempt"
          icon={Clock}
          accent={withRetries > 0 ? "degraded" : "healthy"}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Check History</CardTitle>
          <CardDescription>Most recent 40 checks across all monitored services.</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Timestamp</TableHead>
              <TableHead>Service</TableHead>
              <TableHead className="text-right">Attempt</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">HTTP</TableHead>
              <TableHead className="text-right">Response</TableHead>
              <TableHead>n8n Execution</TableHead>
              <TableHead>Message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.map((check) => (
              <TableRow key={check.id}>
                <TableCell className="font-mono text-2xs text-muted-foreground">
                  {formatDate(check.checkedAt)} · {formatClockWithSeconds(check.checkedAt)}
                </TableCell>
                <TableCell className="font-medium">{check.serviceName}</TableCell>
                <TableCell className="text-right tabular">
                  {check.attempt}
                  <span className="text-muted-foreground">/{check.maxAttempts}</span>
                </TableCell>
                <TableCell>
                  <StatusBadge status={check.status} size="sm" />
                </TableCell>
                <TableCell className="text-right tabular">{check.httpStatus ?? "—"}</TableCell>
                <TableCell className="text-right tabular">{check.responseTimeMs} ms</TableCell>
                <TableCell className="font-mono text-2xs text-muted-foreground">
                  {check.n8nExecutionId}
                </TableCell>
                <TableCell className="max-w-[22rem] truncate text-xs text-muted-foreground">
                  {check.message}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
