import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { LogViewer } from "@/components/dashboard/log-viewer";
import { getLogs } from "@/lib/api";
import { normalizeEnvironment } from "@/lib/environment";

export const metadata: Metadata = { title: "Logs" };

interface LogsPageProps {
  searchParams: Promise<{ env?: string }>;
}

export default async function LogsPage({ searchParams }: LogsPageProps) {
  const { env } = await searchParams;
  const environment = normalizeEnvironment(env);
  const logs = await getLogs(environment);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Logs"
        description={`Check-level log stream for ${environment}. Filter by environment, service, status, time or free-text search.`}
      />
      <LogViewer
        logs={logs}
        title={`Check Logs — ${environment}`}
        description="Newest entries first. Attempts above 1 were produced by the retry policy."
      />
    </div>
  );
}
