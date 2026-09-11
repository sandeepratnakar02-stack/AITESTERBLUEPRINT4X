import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/dashboard/page-header";
import { ServiceHealthTable } from "@/components/dashboard/service-health-table";
import { StatusClassification } from "@/components/dashboard/status-classification";
import { getServiceHealth } from "@/lib/api";
import { normalizeEnvironment } from "@/lib/environment";

export const metadata: Metadata = { title: "Services" };

interface ServicesPageProps {
  searchParams: Promise<{ env?: string }>;
}

export default async function ServicesPage({ searchParams }: ServicesPageProps) {
  const { env } = await searchParams;
  const environment = normalizeEnvironment(env);
  const services = await getServiceHealth(environment);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Services"
        description={`Monitored VWO services and their check definitions for the ${environment} environment.`}
      />

      <ServiceHealthTable
        services={services}
        title={`Monitored Services — ${environment}`}
        description="Click any row to inspect the full health check definition."
        showEnvironment={false}
      />

      <Card>
        <CardHeader>
          <CardTitle>Check Configuration</CardTitle>
          <CardDescription>
            Endpoint, assertions and retry policy applied by the n8n workflow.
          </CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Service</TableHead>
              <TableHead>Check Type</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>URL</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Threshold</TableHead>
              <TableHead className="text-right">Retry Policy</TableHead>
              <TableHead>Critical</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.map((service) => (
              <TableRow key={service.id}>
                <TableCell className="font-medium">{service.name}</TableCell>
                <TableCell className="text-muted-foreground">{service.checkType}</TableCell>
                <TableCell className="font-mono text-2xs">{service.httpMethod}</TableCell>
                <TableCell className="max-w-[20rem] truncate font-mono text-2xs text-muted-foreground">
                  {service.url}
                </TableCell>
                <TableCell className="text-right tabular">
                  {service.expectedStatus}
                  {service.expectedText ? (
                    <span className="ml-1 text-2xs text-muted-foreground">
                      “{service.expectedText}”
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular">
                  {service.responseTimeThresholdMs} ms
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground tabular">
                  {service.retryPolicy?.maxAttempts ?? 3} attempts ·{" "}
                  {(service.retryPolicy?.delaysSeconds ?? [20, 30]).join("s, ")}s
                </TableCell>
                <TableCell>
                  <Badge variant={service.critical ? "danger" : "neutral"} size="sm">
                    {service.critical ? "Critical" : "Standard"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <StatusClassification />
    </div>
  );
}
