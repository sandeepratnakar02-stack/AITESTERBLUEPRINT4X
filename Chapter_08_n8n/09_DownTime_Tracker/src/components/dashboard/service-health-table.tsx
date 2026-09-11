"use client";

import * as React from "react";
import { ArrowUpRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { HealthCheckDrawer } from "@/components/dashboard/health-check-drawer";
import { formatResponseTime, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Service } from "@/types";

export interface ServiceHealthTableProps {
  services: Service[];
  title?: string;
  description?: string;
  /** Hide the environment column when the table is already env-scoped. */
  showEnvironment?: boolean;
}

/** Service health grid; clicking a row opens the health check detail drawer. */
export function ServiceHealthTable({
  services,
  title = "Service Health",
  description = "Latest check result for every monitored VWO service.",
  showEnvironment = true,
}: ServiceHealthTableProps) {
  const [selected, setSelected] = React.useState<Service | null>(null);

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-baseline justify-between">
          <div className="space-y-1">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <span className="text-2xs text-muted-foreground tabular">
            {services.length} service{services.length === 1 ? "" : "s"}
          </span>
        </CardHeader>

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Service</TableHead>
              {showEnvironment ? <TableHead>Environment</TableHead> : null}
              <TableHead>Check Type</TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">HTTP Status</TableHead>
              <TableHead className="text-right">Response Time</TableHead>
              <TableHead className="text-right">Attempts</TableHead>
              <TableHead className="text-right">Last Checked</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.map((service) => {
              const slow = service.responseTimeMs > service.responseTimeThresholdMs;
              return (
                <TableRow
                  key={`${service.environment}-${service.id}`}
                  className="cursor-pointer"
                  onClick={() => setSelected(service)}
                >
                  <TableCell className="font-medium">{service.name}</TableCell>
                  {showEnvironment ? (
                    <TableCell className="text-muted-foreground">{service.environment}</TableCell>
                  ) : null}
                  <TableCell className="text-muted-foreground">{service.checkType}</TableCell>
                  <TableCell className="max-w-[16rem] truncate font-mono text-2xs text-muted-foreground">
                    {service.endpoint}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={service.status} />
                  </TableCell>
                  <TableCell className="text-right tabular">
                    <span
                      className={cn(
                        service.httpStatus && service.httpStatus < 400
                          ? "text-foreground"
                          : "text-status-down-strong",
                      )}
                    >
                      {service.httpStatus ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell className={cn("text-right tabular", slow && "text-status-degraded-strong")}>
                    {formatResponseTime(service.responseTimeMs)}
                  </TableCell>
                  <TableCell className="text-right tabular">
                    {service.attempts}
                    <span className="text-muted-foreground">
                      /{service.retryPolicy?.maxAttempts ?? 3}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground tabular">
                    {formatTime(service.lastCheckedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelected(service);
                      }}
                      className="inline-flex items-center gap-1 text-xs font-medium text-status-info hover:underline"
                    >
                      Details
                      <ArrowUpRight className="size-3" aria-hidden />
                    </button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <HealthCheckDrawer service={selected} onClose={() => setSelected(null)} />
    </>
  );
}
