import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  CheckCircle2,
  Server,
  Timer,
  TrendingUp,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ServiceHealthTable } from "@/components/dashboard/service-health-table";
import { ResponseTimeChart } from "@/components/dashboard/response-time-chart";
import { UptimeChart } from "@/components/dashboard/uptime-chart";
import { IncidentTable } from "@/components/dashboard/incident-table";
import { RetryTimeline } from "@/components/dashboard/retry-timeline";
import { StatusClassification } from "@/components/dashboard/status-classification";
import { DashboardWarnings } from "@/components/dashboard/dashboard-warnings";
import { STATUS_META } from "@/components/dashboard/status-badge";
import { getDashboardSnapshot } from "@/lib/dashboard";
import { SLA_THRESHOLD_MS, UPTIME_TARGET_PCT } from "@/lib/constants";
import { normalizeEnvironment } from "@/lib/environment";
import { formatPercent, formatResponseTime } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * The dashboard is the heaviest route. Declared here as well as on the root
 * layout so the budget does not depend on layout propagation — a cold n8n Cloud
 * instance measured ~13 s.
 */
export const maxDuration = 60;

interface DashboardPageProps {
  searchParams: Promise<{ env?: string }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { env } = await searchParams;
  const environment = normalizeEnvironment(env);

  // One aggregated source: `GET /api/dashboard` (same builder) resolves every
  // upstream n8n call server-side with capped concurrency, so the page no longer
  // fans out to five webhooks itself.
  const snapshot = await getDashboardSnapshot(environment);

  const { services, incidents, responseTimes, uptime } = snapshot;
  const activeIncident = incidents.find((incident) => incident.status === "Open") ?? incidents[0];
  // `overallStatus` comes from n8n, so never index STATUS_META without a fallback.
  const overall = STATUS_META[snapshot.overallStatus] ?? STATUS_META.UNKNOWN;
  const uptimeHealthy = snapshot.uptimePercent >= UPTIME_TARGET_PCT;

  /**
   * An environment with no monitored services reports `HEALTHY` upstream, which
   * would read as an all-clear. Show that there is nothing to report on instead.
   */
  const noMonitoringData = snapshot.servicesMonitored === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="VWO Service Health"
        description="Real-time availability and functional monitoring for VWO QA services."
      />

      <DashboardWarnings snapshot={snapshot} />

      {/* Summary strip */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
        <MetricCard
          label="Overall Status"
          value={noMonitoringData ? "No monitoring data" : overall.label}
          hint={
            noMonitoringData
              ? `No services are monitored in ${environment} yet`
              : `Availability vs ${UPTIME_TARGET_PCT}% SLA target`
          }
          icon={Activity}
          accent={
            noMonitoringData
              ? "neutral"
              : snapshot.overallStatus === "HEALTHY"
                ? "healthy"
                : snapshot.overallStatus === "DOWN"
                  ? "down"
                  : "degraded"
          }
        />
        <MetricCard
          label="Services Monitored"
          value={snapshot.servicesMonitored}
          hint="Across the selected environment"
          icon={Server}
          accent="info"
        />
        <MetricCard
          label="Healthy Services"
          value={snapshot.healthyServices}
          hint="Passing HTTP + functional checks"
          icon={CheckCircle2}
          accent="healthy"
        />
        <MetricCard
          label="Failed Services"
          value={snapshot.failedServices}
          hint={snapshot.failedServices > 0 ? "Requires attention" : "No failures detected"}
          icon={XCircle}
          accent={snapshot.failedServices > 0 ? "down" : "healthy"}
        />
        <MetricCard
          label="Active Incidents"
          value={snapshot.activeIncidents}
          hint={activeIncident ? `Latest: ${activeIncident.id}` : "No open incidents"}
          icon={TriangleAlert}
          accent={snapshot.activeIncidents > 0 ? "degraded" : "healthy"}
        />
        <MetricCard
          label="Average Response Time"
          value={formatResponseTime(snapshot.averageResponseTimeMs)}
          hint={`SLA threshold ${SLA_THRESHOLD_MS} ms`}
          icon={Timer}
          accent="info"
        />
        <MetricCard
          label="Uptime"
          value={formatPercent(snapshot.uptimePercent)}
          hint={`Target ${UPTIME_TARGET_PCT}%`}
          icon={TrendingUp}
          accent={uptimeHealthy ? "healthy" : "degraded"}
        />
      </section>

      {/* Service grid */}
      <ServiceHealthTable services={services} />

      {/* Charts */}
      <section className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <ResponseTimeChart metrics={responseTimes} thresholdMs={SLA_THRESHOLD_MS} />
        </div>
        <UptimeChart points={uptime} />
      </section>

      {/* Incidents + retry monitor */}
      <section className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <IncidentTable
            incidents={incidents.slice(0, 4)}
            footer={
              <Link
                href={`/incidents?env=${environment}`}
                className="font-medium text-status-info hover:underline"
              >
                View all incidents →
              </Link>
            }
          />
        </div>
        <RetryTimeline
          events={activeIncident?.timeline ?? []}
          description={
            activeIncident
              ? `Retry sequence for ${activeIncident.id} · ${activeIncident.serviceName}`
              : "No retry activity in the current window."
          }
        />
      </section>

      <StatusClassification />
    </div>
  );
}
