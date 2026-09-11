import type { Metadata } from "next";
import { Activity, Gauge, Timer, TrendingDown } from "lucide-react";
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
import { ResponseTimeChart } from "@/components/dashboard/response-time-chart";
import { getResponseTimeHistory, getServiceHealth } from "@/lib/api";
import { SLA_THRESHOLD_MS } from "@/lib/constants";
import { normalizeEnvironment } from "@/lib/environment";
import { formatResponseTime } from "@/lib/format";

export const metadata: Metadata = { title: "Response Times" };

interface ResponseTimesPageProps {
  searchParams: Promise<{ env?: string }>;
}

export default async function ResponseTimesPage({ searchParams }: ResponseTimesPageProps) {
  const { env } = await searchParams;
  const environment = normalizeEnvironment(env);
  const [metrics, services] = await Promise.all([
    getResponseTimeHistory(environment),
    getServiceHealth(environment),
  ]);

  const serviceNames = services.map((service) => service.name);

  // Aggregate per-service statistics for the 24h window.
  const stats = serviceNames.map((name) => {
    const values = metrics
      .filter((metric) => metric.serviceName === name)
      .map((metric) => metric.responseTimeMs)
      .sort((a, b) => a - b);

    const total = values.reduce((sum, value) => sum + value, 0);
    const average = values.length ? total / values.length : 0;
    const p95 = values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)] : 0;
    const max = values.length ? values[values.length - 1] : 0;
    const breaches = values.filter((value) => value > SLA_THRESHOLD_MS).length;

    return { name, average, p95, max, breaches, samples: values.length };
  });

  const overallAverage = stats.length
    ? stats.reduce((sum, item) => sum + item.average, 0) / stats.length
    : 0;
  const worst = [...stats].sort((a, b) => b.p95 - a.p95)[0];
  const totalBreaches = stats.reduce((sum, item) => sum + item.breaches, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Response Times"
        description={`Latency trends for ${environment} over the last 24 hours, measured against the ${SLA_THRESHOLD_MS} ms threshold.`}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Average Latency"
          value={formatResponseTime(overallAverage)}
          hint="Mean across all monitored services"
          icon={Timer}
          accent="info"
        />
        <MetricCard
          label="Slowest Service (p95)"
          value={worst ? formatResponseTime(worst.p95) : "—"}
          hint={worst?.name ?? "No samples"}
          icon={TrendingDown}
          accent="degraded"
        />
        <MetricCard
          label="Threshold Breaches"
          value={totalBreaches}
          hint={`Samples above ${SLA_THRESHOLD_MS} ms`}
          icon={Activity}
          accent={totalBreaches > 0 ? "degraded" : "healthy"}
        />
        <MetricCard
          label="Services Tracked"
          value={stats.length}
          hint="Series rendered on the chart"
          icon={Gauge}
          accent="neutral"
        />
      </section>

      <ResponseTimeChart
        metrics={metrics}
        thresholdMs={SLA_THRESHOLD_MS}
        title="Response Time — All Services (24h)"
        description={`Every monitored ${environment} service plotted against the SLA threshold.`}
        series={serviceNames}
        height={340}
      />

      <Card>
        <CardHeader>
          <CardTitle>Latency Summary</CardTitle>
          <CardDescription>24-hour statistics per service, derived from the check history.</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Service</TableHead>
              <TableHead className="text-right">Average</TableHead>
              <TableHead className="text-right">p95</TableHead>
              <TableHead className="text-right">Max</TableHead>
              <TableHead className="text-right">Breaches</TableHead>
              <TableHead className="text-right">Samples</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.map((item) => (
              <TableRow key={item.name}>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell className="text-right tabular">{formatResponseTime(item.average)}</TableCell>
                <TableCell
                  className={
                    item.p95 > SLA_THRESHOLD_MS
                      ? "text-right text-status-degraded-strong tabular"
                      : "text-right tabular"
                  }
                >
                  {formatResponseTime(item.p95)}
                </TableCell>
                <TableCell className="text-right tabular">{formatResponseTime(item.max)}</TableCell>
                <TableCell className="text-right tabular">{item.breaches}</TableCell>
                <TableCell className="text-right text-muted-foreground tabular">{item.samples}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
