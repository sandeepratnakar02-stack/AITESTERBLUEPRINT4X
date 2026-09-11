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
import { STATUS_META } from "@/components/dashboard/status-badge";
import {
  getDashboardSummary,
  getIncidents,
  getResponseTimeHistory,
  getServiceHealth,
  getUptimeHistory,
} from "@/lib/api";
import { SLA_THRESHOLD_MS, UPTIME_TARGET_PCT } from "@/lib/constants";
import { normalizeEnvironment } from "@/lib/environment";
import { formatPercent, formatResponseTime } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * The dashboard is the heaviest route (5 parallel n8n calls). Declared here as
 * well as on the root layout so the budget does not depend on layout
 * propagation — a cold n8n Cloud instance measured ~13 s.
 */
export const maxDuration = 60;

interface DashboardPageProps {
  searchParams: Promise<{ env?: string }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { env } = await searchParams;
  const environment = normalizeEnvironment(env);

  const [summary, services, incidents, responseTimes, uptime] = await Promise.all([
    getDashboardSummary(environment),
    getServiceHealth(environment),
    getIncidents(environment),
    getResponseTimeHistory(environment),
    getUptimeHistory(environment),
  ]);

  const activeIncident = incidents.find((incident) => incident.status === "Open") ?? incidents[0];
  // `overallStatus` comes from n8n, so never index STATUS_META without a fallback.
  const overall = STATUS_META[summary.overallStatus] ?? STATUS_META.UNKNOWN;
  const uptimeHealthy = summary.uptimePct >= UPTIME_TARGET_PCT;

  return (
    <div className="space-y-5">
      <PageHeader
        title="VWO Service Health"
        description="Real-time availability and functional monitoring for VWO QA services."
      />

      {/* Summary strip */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
        <MetricCard
          label="Overall Status"
          value={overall.label}
          hint={`Availability vs ${UPTIME_TARGET_PCT}% SLA target`}
          icon={Activity}
          accent={summary.overallStatus === "HEALTHY" ? "healthy" : summary.overallStatus === "DOWN" ? "down" : "degraded"}
        />
        <MetricCard
          label="Services Monitored"
          value={summary.servicesMonitored}
          hint="Across the selected environment"
          icon={Server}
          accent="info"
        />
        <MetricCard
          label="Healthy Services"
          value={summary.healthyServices}
          hint="Passing HTTP + functional checks"
          icon={CheckCircle2}
          accent="healthy"
        />
        <MetricCard
          label="Failed Services"
          value={summary.failedServices}
          hint={summary.failedServices > 0 ? "Requires attention" : "No failures detected"}
          icon={XCircle}
          accent={summary.failedServices > 0 ? "down" : "healthy"}
        />
        <MetricCard
          label="Active Incidents"
          value={summary.activeIncidents}
          hint={activeIncident ? `Latest: ${activeIncident.id}` : "No open incidents"}
          icon={TriangleAlert}
          accent={summary.activeIncidents > 0 ? "degraded" : "healthy"}
        />
        <MetricCard
          label="Average Response Time"
          value={formatResponseTime(summary.averageResponseTimeMs)}
          hint={`SLA threshold ${SLA_THRESHOLD_MS} ms`}
          icon={Timer}
          accent="info"
        />
        <MetricCard
          label="Uptime"
          value={formatPercent(summary.uptimePct)}
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
