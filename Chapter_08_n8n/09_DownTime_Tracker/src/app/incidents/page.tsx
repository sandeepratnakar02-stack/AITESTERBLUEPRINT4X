import type { Metadata } from "next";
import { CheckCircle2, Clock, RefreshCw, TriangleAlert } from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { IncidentTable } from "@/components/dashboard/incident-table";
import { getIncidents } from "@/lib/api";
import { normalizeEnvironment } from "@/lib/environment";
import { formatDuration } from "@/lib/format";

export const metadata: Metadata = { title: "Incidents" };

interface IncidentsPageProps {
  searchParams: Promise<{ env?: string }>;
}

export default async function IncidentsPage({ searchParams }: IncidentsPageProps) {
  const { env } = await searchParams;
  const environment = normalizeEnvironment(env);
  const incidents = await getIncidents(environment);

  const open = incidents.filter((incident) => incident.status === "Open" || incident.status === "Investigating");
  const recovered = incidents.filter((incident) => incident.status === "Recovered" || incident.status === "Resolved");
  const totalRetries = incidents.reduce((sum, incident) => sum + incident.retryAttempts, 0);
  const averageDowntime = incidents.length
    ? incidents.reduce((sum, incident) => sum + incident.durationSeconds, 0) / incidents.length
    : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Incidents"
        description={`Downtime and degradation incidents detected in the ${environment} environment.`}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Open Incidents"
          value={open.length}
          hint="Awaiting investigation or fix"
          icon={TriangleAlert}
          accent={open.length > 0 ? "down" : "healthy"}
        />
        <MetricCard
          label="Recovered"
          value={recovered.length}
          hint="Service restored automatically"
          icon={CheckCircle2}
          accent="healthy"
        />
        <MetricCard
          label="Retry Attempts"
          value={totalRetries}
          hint="Total automatic retries executed"
          icon={RefreshCw}
          accent="info"
        />
        <MetricCard
          label="Average Downtime"
          value={formatDuration(averageDowntime)}
          hint="Mean time to recovery"
          icon={Clock}
          accent="degraded"
        />
      </section>

      <IncidentTable
        incidents={incidents}
        title={`Incident History — ${environment}`}
        description="Select an incident to open the full drill-down with the n8n execution link."
        showEnvironment={false}
      />
    </div>
  );
}
