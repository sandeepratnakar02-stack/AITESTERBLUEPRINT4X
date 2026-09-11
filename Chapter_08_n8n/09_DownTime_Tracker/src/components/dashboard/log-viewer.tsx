"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { MOCK_NOW } from "@/lib/constants";
import { formatClockWithSeconds, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HealthState, LogEntry } from "@/types";

const STATUS_OPTIONS: { value: HealthState; label: string }[] = [
  { value: "HEALTHY", label: "Healthy" },
  { value: "SLOW", label: "Degraded (SLOW)" },
  { value: "FUNCTIONAL_FAILURE", label: "Degraded (FUNCTIONAL_FAILURE)" },
  { value: "DOWN", label: "Down" },
  { value: "RETRYING", label: "Retrying" },
  { value: "UNKNOWN", label: "Unknown" },
];

const RANGE_OPTIONS = [
  { value: "0.25", label: "Last 15 minutes" },
  { value: "1", label: "Last hour" },
  { value: "6", label: "Last 6 hours" },
  { value: "24", label: "Last 24 hours" },
  { value: "all", label: "All time" },
] as const;

export interface LogViewerProps {
  logs: LogEntry[];
  title?: string;
  description?: string;
  pageSize?: number;
  /** Hide the environment filter on pages already scoped to one environment. */
  showEnvironmentFilter?: boolean;
}

/** Developer-style log viewer with environment/service/status/time filters. */
export function LogViewer({
  logs,
  title = "Logs",
  description = "Every check the workflow executed, including retry attempts.",
  pageSize = 25,
  showEnvironmentFilter = true,
}: LogViewerProps) {
  const [environment, setEnvironment] = React.useState("ALL");
  const [service, setService] = React.useState("ALL");
  const [status, setStatus] = React.useState("ALL");
  const [range, setRange] = React.useState<string>("24");
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(1);

  const environments = React.useMemo(
    () => Array.from(new Set(logs.map((log) => log.environment))).sort(),
    [logs],
  );
  const services = React.useMemo(
    () => Array.from(new Set(logs.map((log) => log.serviceName))).sort(),
    [logs],
  );

  const filtered = React.useMemo(() => {
    const cutoff =
      range === "all"
        ? null
        : MOCK_NOW.getTime() - Number(range) * 60 * 60 * 1000;
    const needle = query.trim().toLowerCase();

    return logs.filter((log) => {
      if (showEnvironmentFilter && environment !== "ALL" && log.environment !== environment) return false;
      if (service !== "ALL" && log.serviceName !== service) return false;
      if (status !== "ALL" && log.status !== status) return false;
      if (cutoff !== null && new Date(log.timestamp).getTime() < cutoff) return false;
      if (needle) {
        const haystack = `${log.serviceName} ${log.message} ${log.status} ${log.httpCode ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [logs, environment, service, status, range, query, showEnvironmentFilter]);

  React.useEffect(() => {
    setPage(1);
  }, [environment, service, status, range, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * pageSize;
  const rows = filtered.slice(start, start + pageSize);

  const activeFilters =
    (environment !== "ALL" ? 1 : 0) +
    (service !== "ALL" ? 1 : 0) +
    (status !== "ALL" ? 1 : 0) +
    (range !== "24" ? 1 : 0) +
    (query ? 1 : 0);

  const resetFilters = () => {
    setEnvironment("ALL");
    setService("ALL");
    setStatus("ALL");
    setRange("24");
    setQuery("");
  };

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="space-y-1">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <span className="text-2xs text-muted-foreground tabular">
            {filtered.length} of {logs.length} entries
          </span>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search logs..."
              aria-label="Search logs"
              className="h-8 pl-8 text-xs"
            />
          </div>

          {showEnvironmentFilter ? (
            <Select
              aria-label="Filter by environment"
              value={environment}
              onChange={(event) => setEnvironment(event.target.value)}
              className="h-8 w-[8.5rem] text-xs"
            >
              <option value="ALL">All environments</option>
              {environments.map((env) => (
                <option key={env} value={env}>
                  {env}
                </option>
              ))}
            </Select>
          ) : null}

          <Select
            aria-label="Filter by service"
            value={service}
            onChange={(event) => setService(event.target.value)}
            className="h-8 w-[11rem] text-xs"
          >
            <option value="ALL">All services</option>
            {services.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-8 w-[12rem] text-xs"
          >
            <option value="ALL">All statuses</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Filter by time"
            value={range}
            onChange={(event) => setRange(event.target.value)}
            className="h-8 w-[10.5rem] text-xs"
          >
            {RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>

          {activeFilters > 0 ? (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              <X />
              Clear
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Timestamp</TableHead>
            <TableHead>Service</TableHead>
            <TableHead className="text-right">Attempt</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">HTTP Code</TableHead>
            <TableHead className="text-right">Response Time</TableHead>
            <TableHead>Message</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                No log entries match the current filters.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="font-mono text-2xs text-muted-foreground">
                  {formatDate(log.timestamp)} · {formatClockWithSeconds(log.timestamp)}
                </TableCell>
                <TableCell className="font-medium">{log.serviceName}</TableCell>
                <TableCell className="text-right tabular">
                  {log.attempt}
                  <span className="text-muted-foreground">/{log.maxAttempts}</span>
                </TableCell>
                <TableCell>
                  <StatusBadge status={log.status} size="sm" />
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular",
                    log.httpCode && log.httpCode >= 400 && "text-status-down-strong",
                  )}
                >
                  {log.httpCode ?? "—"}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular",
                    log.responseTimeMs > 3000 && "text-status-degraded-strong",
                  )}
                >
                  {log.responseTimeMs} ms
                </TableCell>
                <TableCell className="max-w-[24rem] truncate text-xs text-muted-foreground">
                  {log.message}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between gap-3 border-t border-border/70 px-5 py-3">
        <p className="text-2xs text-muted-foreground tabular">
          {filtered.length === 0
            ? "0 entries"
            : `${start + 1}–${Math.min(start + pageSize, filtered.length)} of ${filtered.length}`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={currentPage <= 1}
            onClick={() => setPage((previous) => Math.max(1, previous - 1))}
          >
            <ChevronLeft />
          </Button>
          <span className="text-2xs text-muted-foreground tabular">
            Page {currentPage} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={currentPage >= pageCount}
            onClick={() => setPage((previous) => Math.min(pageCount, previous + 1))}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </Card>
  );
}
