"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
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
import { formatDuration, formatRelative } from "@/lib/format";
import type { Incident, IncidentSeverity, IncidentStatus } from "@/types";

const STATUS_VARIANT: Record<IncidentStatus, "danger" | "warning" | "success" | "neutral"> = {
  Open: "danger",
  Investigating: "warning",
  Recovered: "success",
  Resolved: "neutral",
};

const SEVERITY_VARIANT: Record<IncidentSeverity, "danger" | "warning" | "info" | "neutral"> = {
  Critical: "danger",
  High: "warning",
  Medium: "info",
  Low: "neutral",
};

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "neutral"} size="sm">
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {status}
    </Badge>
  );
}

export function IncidentSeverityBadge({ severity }: { severity: IncidentSeverity }) {
  return (
    <Badge variant={SEVERITY_VARIANT[severity] ?? "neutral"} size="sm">
      {severity}
    </Badge>
  );
}

export interface IncidentTableProps {
  incidents: Incident[];
  title?: string;
  description?: string;
  showEnvironment?: boolean;
  /** Optional footer rendered under the table (e.g. a "view all" link). */
  footer?: React.ReactNode;
}

export function IncidentTable({
  incidents,
  title = "Recent Incidents",
  description = "Failures detected by the automated health checks.",
  showEnvironment = true,
  footer,
}: IncidentTableProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between">
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <span className="text-2xs text-muted-foreground tabular">{incidents.length} total</span>
      </CardHeader>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Incident</TableHead>
            <TableHead>Service</TableHead>
            {showEnvironment ? <TableHead>Environment</TableHead> : null}
            <TableHead>Started</TableHead>
            <TableHead className="text-right">Duration</TableHead>
            <TableHead className="text-right">Retry Attempts</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Severity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {incidents.map((incident) => (
            <TableRow key={incident.id}>
              <TableCell>
                <Link
                  href={`/incidents/${incident.id}?env=${incident.environment}`}
                  className="inline-flex items-center gap-1 font-medium text-status-info hover:underline"
                >
                  {incident.id}
                  <ArrowUpRight className="size-3" aria-hidden />
                </Link>
              </TableCell>
              <TableCell>{incident.serviceName}</TableCell>
              {showEnvironment ? (
                <TableCell className="text-muted-foreground">{incident.environment}</TableCell>
              ) : null}
              <TableCell className="text-xs text-muted-foreground">
                {formatRelative(incident.startedAt)}
              </TableCell>
              <TableCell className="text-right tabular">
                {formatDuration(incident.durationSeconds)}
              </TableCell>
              <TableCell className="text-right tabular">{incident.retryAttempts}</TableCell>
              <TableCell>
                <IncidentStatusBadge status={incident.status} />
              </TableCell>
              <TableCell className="text-right">
                <IncidentSeverityBadge severity={incident.severity} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {footer ? (
        <div className="border-t border-border/70 px-5 py-3 text-xs">{footer}</div>
      ) : null}
    </Card>
  );
}
